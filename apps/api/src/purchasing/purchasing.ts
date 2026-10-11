import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param,
  ParseUUIDPipe, Patch, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { tzFor } from '../analytics/range';
import { AuditService } from '../audit/audit.service';
import { sendPdf } from '../cash/cash';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { renderPurchaseOrder } from '../documents/purchase-order';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);
const MINOR_MSG = { message: 'Amount must be a whole number in minor units, e.g. "1250" for QAR 12.50' };
const DOHA_OFFSET_MS = 3 * 3_600_000;
const stamp = () => new Date(Date.now() + DOHA_OFFSET_MS).toISOString().slice(2, 10).replace(/-/g, '');
const country = () => process.env.DEFAULT_COUNTRY ?? 'QA';
const isoDate = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Dates must look like 2026-12-31');
  return d;
};

/** Weighted-average cost after receiving `qty` units at `unit` onto `onHand` units that cost `old` each. Exported for tests. */
export function weightedCost(onHand: number, old: bigint | null, qty: number, unit: bigint): bigint {
  const have = BigInt(Math.max(0, onHand));
  if (old === null || have === 0n) return unit;
  const total = have + BigInt(qty);
  return (have * old + BigInt(qty) * unit + total / 2n) / total; // rounded to the nearest minor unit
}

// ====================================================================== DTOs

class SupplierDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+?[\d\s-]{6,20}$/, { message: 'Enter a phone number like +974 5555 1234' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsEmail() @MaxLength(200) email?: string;
  @ApiPropertyOptional({ description: 'Commercial registration number' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) crNumber?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ example: '30 days' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(120) paymentTerms?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
}
class UpdateSupplierDto extends SupplierDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) declare name: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class SuppliersQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() all?: boolean;
}

class PoLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) quantity: number;
  @ApiProperty({ example: '1250', description: 'Cost per unit, minor units' }) @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) unitCostMinor: string;
}
class CreatePoDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ example: '2026-10-20' }) @IsOptional() @IsISO8601() expectedOn?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [PoLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PoLineDto) lines: PoLineDto[];
}
class UpdatePoDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() expectedOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [PoLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PoLineDto) lines?: PoLineDto[];
}
class PoQuery {
  @ApiPropertyOptional({ enum: PurchaseOrderStatus }) @IsOptional() @IsEnum(PurchaseOrderStatus) status?: PurchaseOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
}
class ReceiveLineDto {
  @ApiProperty() @IsUUID() lineId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) quantity: number;
  @ApiPropertyOptional({ description: 'Batch / lot number printed on the goods' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) lotCode?: string;
  @ApiPropertyOptional({ example: '2027-03-31', description: 'Required for products that track expiry' }) @IsOptional() @IsISO8601() expiresOn?: string;
}
class ReceiveDto {
  @ApiPropertyOptional({ description: "The supplier's delivery note or invoice number" }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) supplierRef?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ type: [ReceiveLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines: ReceiveLineDto[];
}

// ====================================================================== service

const PO_INCLUDE = {
  supplier: { select: { id: true, name: true, contactName: true, phone: true, email: true, crNumber: true, address: true, paymentTerms: true } },
  warehouse: { select: { id: true, name: true, code: true, address: true, city: true } },
  lines: {
    orderBy: { variant: { sku: 'asc' } },
    select: {
      id: true, variantId: true, quantity: true, receivedQty: true, unitCostMinor: true,
      variant: { select: { sku: true, barcode: true, optionValues: true, product: { select: { id: true, title: true, tracksExpiry: true } } } },
    },
  },
  receipts: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, number: true, supplierRef: true, note: true, createdAt: true, receivedById: true, lines: { select: { poLineId: true, quantity: true, lotCode: true, expiresOn: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

/**
 * Buying stock: suppliers, purchase orders (draft → ordered → received in one or more deliveries) and goods receipts.
 * Receiving adds the units to the warehouse with their batch and expiry date, updates the average cost, and must be
 * done by someone other than the person who raised the order (four-eyes), except a super admin.
 */
@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService, private readonly warehouses: WarehousesService, private readonly audit: AuditService) {}

  // -------------------------------------------------------------------- suppliers

  suppliers(q: SuppliersQuery) {
    return this.prisma.supplier.findMany({
      where: {
        ...(q.all ? {} : { isActive: true }),
        ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { contactName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] }),
      },
      orderBy: { name: 'asc' }, take: 200,
      include: { _count: { select: { orders: true } } },
    });
  }

  async createSupplier(dto: SupplierDto, actorId: string) {
    const dup = await this.prisma.supplier.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' } }, select: { id: true } });
    if (dup) throw new ConflictException('A supplier with this name already exists');
    const s = await this.prisma.supplier.create({ data: dto });
    await this.audit.log({ actorId, action: 'supplier.create', entityType: 'Supplier', entityId: s.id, after: { name: s.name } });
    return s;
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, actorId: string) {
    const before = await this.prisma.supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Supplier not found');
    const s = await this.prisma.supplier.update({ where: { id }, data: dto });
    await this.audit.log({ actorId, action: 'supplier.update', entityType: 'Supplier', entityId: id, before, after: s });
    return s;
  }

  // -------------------------------------------------------------------- purchase orders

  async list(q: PoQuery) {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: { status: q.status, supplierId: q.supplierId }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { supplier: { select: { id: true, name: true } }, warehouse: { select: { name: true, code: true } }, lines: { select: { quantity: true, receivedQty: true } } },
    });
    return rows.map(({ lines, ...po }) => ({
      ...po, totalMinor: po.totalMinor.toString(),
      units: lines.reduce((n, l) => n + l.quantity, 0), receivedUnits: lines.reduce((n, l) => n + l.receivedQty, 0), lineCount: lines.length,
    }));
  }

  async get(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: PO_INCLUDE });
    if (!po) throw new NotFoundException('Purchase order not found');
    const ids = [po.createdById, po.orderedById, ...po.receipts.map((r) => r.receivedById)].filter((x): x is string => !!x);
    const people = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      ...po,
      totalMinor: po.totalMinor.toString(),
      expectedOn: po.expectedOn?.toISOString().slice(0, 10) ?? null,
      createdBy: { id: po.createdById, fullName: people.get(po.createdById) ?? null },
      orderedBy: po.orderedById ? { id: po.orderedById, fullName: people.get(po.orderedById) ?? null } : null,
      lines: po.lines.map((l) => ({
        id: l.id, variantId: l.variantId, sku: l.variant.sku, barcode: l.variant.barcode, title: l.variant.product.title, productId: l.variant.product.id,
        options: l.variant.optionValues, tracksExpiry: l.variant.product.tracksExpiry,
        quantity: l.quantity, receivedQty: l.receivedQty, remaining: l.quantity - l.receivedQty,
        unitCostMinor: l.unitCostMinor.toString(), lineTotalMinor: (l.unitCostMinor * BigInt(l.quantity)).toString(),
      })),
      receipts: po.receipts.map((r) => ({
        ...r, receivedBy: { id: r.receivedById, fullName: people.get(r.receivedById) ?? null },
        lines: r.lines.map((l) => ({ ...l, expiresOn: l.expiresOn?.toISOString().slice(0, 10) ?? null })),
      })),
    };
  }

  private async checkLines(lines: PoLineDto[], sellerId: string) {
    const ids = lines.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each product can appear only once on an order — change the quantity instead');
    const found = await this.prisma.productVariant.count({ where: { id: { in: ids }, product: { store: { sellerId }, deletedAt: null } } });
    if (found !== ids.length) throw new BadRequestException('Some products were not found');
    return lines.reduce((n, l) => n + BigInt(l.unitCostMinor) * BigInt(l.quantity), 0n);
  }

  private async checkParties(sellerId: string, supplierId?: string, warehouseId?: string) {
    if (supplierId && !(await this.prisma.supplier.count({ where: { id: supplierId, isActive: true } }))) throw new BadRequestException('Supplier not found or inactive');
    if (warehouseId && !(await this.prisma.warehouse.count({ where: { id: warehouseId, sellerId, isActive: true } }))) throw new BadRequestException('Warehouse not found or inactive');
  }

  async create(dto: CreatePoDto, actorId: string) {
    const sellerId = await this.warehouses.house();
    await this.checkParties(sellerId, dto.supplierId, dto.warehouseId);
    const total = await this.checkLines(dto.lines, sellerId);
    const c = await this.prisma.country.findUnique({ where: { code: country() }, select: { currencyCode: true } });
    const po = await this.prisma.purchaseOrder.create({
      data: {
        number: `PO-${country()}-${stamp()}-${randomBytes(2).toString('hex').toUpperCase()}`,
        supplierId: dto.supplierId, warehouseId: dto.warehouseId, currencyCode: c?.currencyCode ?? 'QAR', totalMinor: total,
        expectedOn: dto.expectedOn ? isoDate(dto.expectedOn) : null, note: dto.note, createdById: actorId,
        lines: { create: dto.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCostMinor: BigInt(l.unitCostMinor) })) },
      },
    });
    await this.audit.log({ actorId, action: 'purchase_order.create', entityType: 'PurchaseOrder', entityId: po.id, after: { number: po.number, total: total.toString(), lines: dto.lines.length } });
    return this.get(po.id);
  }

  /** Only a draft can be changed; once sent to the supplier it is fixed (cancel and raise a new one). */
  async update(id: string, dto: UpdatePoDto, actorId: string) {
    const sellerId = await this.warehouses.house();
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'DRAFT') throw new ConflictException('Only a draft can be changed');
    await this.checkParties(sellerId, dto.supplierId, dto.warehouseId);
    const total = dto.lines ? await this.checkLines(dto.lines, sellerId) : undefined;
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.purchaseOrder.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          supplierId: dto.supplierId, warehouseId: dto.warehouseId, note: dto.note, totalMinor: total,
          expectedOn: dto.expectedOn === null ? null : dto.expectedOn ? isoDate(dto.expectedOn) : undefined,
        },
      });
      if (n.count !== 1) throw new ConflictException('Only a draft can be changed');
      if (dto.lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrderLine.createMany({ data: dto.lines.map((l) => ({ orderId: id, variantId: l.variantId, quantity: l.quantity, unitCostMinor: BigInt(l.unitCostMinor) })) });
      }
    });
    await this.audit.log({ actorId, action: 'purchase_order.update', entityType: 'PurchaseOrder', entityId: id, after: { ...dto, lines: dto.lines?.length } });
    return this.get(id);
  }

  async place(id: string, actorId: string) {
    const n = await this.prisma.purchaseOrder.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'ORDERED', orderedById: actorId, orderedAt: new Date() } });
    if (n.count !== 1) throw new ConflictException('Only a draft can be sent to the supplier');
    await this.audit.log({ actorId, action: 'purchase_order.order', entityType: 'PurchaseOrder', entityId: id });
    return this.get(id);
  }

  /** Cancels what has not arrived. Goods already received stay in stock (and on record). */
  async cancel(id: string, actorId: string) {
    const n = await this.prisma.purchaseOrder.updateMany({ where: { id, status: { in: ['DRAFT', 'ORDERED', 'PARTIAL'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (n.count !== 1) throw new ConflictException('This order can no longer be cancelled');
    await this.audit.log({ actorId, action: 'purchase_order.cancel', entityType: 'PurchaseOrder', entityId: id });
    return this.get(id);
  }

  /**
   * Goods arrive: counted against the order (never more than ordered), put on the warehouse shelf with batch and
   * expiry, average cost updated, and a goods receipt (GRN) that cannot be edited is kept.
   */
  async receive(id: string, dto: ReceiveDto, actor: AuthUser) {
    const ids = dto.lines.map((l) => l.lineId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each order line can appear only once per delivery');
    const receipt = await this.prisma.$transaction(async (tx) => {
      // lock the order: two people receiving the same delivery at once would double the stock
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PurchaseOrder" WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Purchase order not found');
      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { lines: { include: { variant: { select: { sku: true, costPriceMinor: true, product: { select: { tracksExpiry: true } } } } } } },
      });
      if (po.status !== 'ORDERED' && po.status !== 'PARTIAL') throw new ConflictException(po.status === 'DRAFT' ? 'Send the order to the supplier before receiving it' : 'This order is closed');
      if (po.createdById === actor.id && !actor.roles.includes('SUPER_ADMIN')) {
        throw new ForbiddenException({ message: 'Someone other than the person who raised the order must receive the goods (four-eyes rule).', reason: 'FOUR_EYES' });
      }
      const byId = new Map(po.lines.map((l) => [l.id, l]));
      const grn = await tx.goodsReceipt.create({
        data: {
          number: `GRN-${country()}-${stamp()}-${randomBytes(2).toString('hex').toUpperCase()}`,
          orderId: id, warehouseId: po.warehouseId, receivedById: actor.id, supplierRef: dto.supplierRef, note: dto.note,
        },
      });
      let units = 0;
      for (const r of dto.lines) {
        const line = byId.get(r.lineId);
        if (!line) throw new BadRequestException('A line is not on this order');
        const left = line.quantity - line.receivedQty;
        if (r.quantity > left) throw new BadRequestException({ message: `${line.variant.sku}: only ${left} more ${left === 1 ? 'unit is' : 'units are'} expected on this order`, reason: 'OVER_RECEIVED' });
        if (line.variant.product.tracksExpiry && !r.expiresOn) throw new BadRequestException({ message: `${line.variant.sku}: enter the expiry date printed on the goods`, reason: 'EXPIRY_REQUIRED' });
        const expiresOn = r.expiresOn ? isoDate(r.expiresOn) : null;
        const inv = await tx.inventory.findUnique({ where: { variantId: line.variantId }, select: { onHand: true } });
        const cost = weightedCost(inv?.onHand ?? 0, line.variant.costPriceMinor, r.quantity, line.unitCostMinor);
        await tx.productVariant.update({ where: { id: line.variantId }, data: { costPriceMinor: cost } });
        const n = await tx.purchaseOrderLine.updateMany({ where: { id: line.id, receivedQty: line.receivedQty }, data: { receivedQty: { increment: r.quantity } } });
        if (n.count !== 1) throw new ConflictException('This order changed while you were receiving it. Reload and try again.');
        await this.warehouses.move(tx, {
          warehouseId: po.warehouseId, variantId: line.variantId, delta: r.quantity, reason: 'RESTOCK', refType: 'purchase_order', refId: po.id, actorId: actor.id,
          note: `${po.number} · ${grn.number}`, ...(expiresOn && { lot: { lotCode: r.lotCode ?? null, expiresOn } }),
        });
        await tx.goodsReceiptLine.create({ data: { receiptId: grn.id, poLineId: line.id, variantId: line.variantId, quantity: r.quantity, lotCode: r.lotCode, expiresOn } });
        line.receivedQty += r.quantity;
        units += r.quantity;
      }
      const complete = po.lines.every((l) => l.receivedQty >= l.quantity);
      await tx.purchaseOrder.update({ where: { id }, data: { status: complete ? 'RECEIVED' : 'PARTIAL', ...(complete && { receivedAt: new Date() }) } });
      return { id: grn.id, number: grn.number, units, status: complete ? 'RECEIVED' : 'PARTIAL' };
    });
    await this.audit.log({ actorId: actor.id, action: 'purchase_order.receive', entityType: 'PurchaseOrder', entityId: id, after: receipt });
    return { receipt, order: await this.get(id) };
  }

  async pdf(id: string) {
    const po = await this.get(id);
    const buf = await renderPurchaseOrder({
      number: po.number, status: po.status, createdAt: po.createdAt, orderedAt: po.orderedAt, expectedOn: po.expectedOn, tz: tzFor(country()).tz,
      currencyCode: po.currencyCode, supplier: po.supplier, warehouse: po.warehouse, note: po.note, raisedBy: po.createdBy.fullName ?? '',
      lines: po.lines.map((l) => ({ sku: l.sku, barcode: l.barcode, title: l.title, quantity: l.quantity, receivedQty: l.receivedQty, unitCostMinor: BigInt(l.unitCostMinor) })),
    });
    return { pdf: buf, number: po.number };
  }
}

// ====================================================================== controllers

@ApiTags('Admin / Purchasing') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class PurchasingController {
  constructor(private readonly svc: PurchasingService) {}

  @RequirePermissions('products.read') @Get('suppliers') suppliers(@Query() q: SuppliersQuery) { return this.svc.suppliers(q); }
  @RequirePermissions('purchasing.manage') @Post('suppliers') createSupplier(@Body() d: SupplierDto, @CurrentUser() u: AuthUser) { return this.svc.createSupplier(d, u.id); }
  @RequirePermissions('purchasing.manage') @Patch('suppliers/:id')
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateSupplierDto, @CurrentUser() u: AuthUser) { return this.svc.updateSupplier(id, d, u.id); }

  @RequirePermissions('products.read') @Get('purchase-orders') list(@Query() q: PoQuery) { return this.svc.list(q); }
  @RequirePermissions('purchasing.manage') @Post('purchase-orders') create(@Body() d: CreatePoDto, @CurrentUser() u: AuthUser) { return this.svc.create(d, u.id); }
  @RequirePermissions('products.read') @Get('purchase-orders/:id') get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @RequirePermissions('purchasing.manage') @Patch('purchase-orders/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() d: UpdatePoDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, d, u.id); }
  @RequirePermissions('purchasing.manage') @HttpCode(200) @Post('purchase-orders/:id/order') place(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.place(id, u.id); }
  @RequirePermissions('purchasing.manage') @HttpCode(200) @Post('purchase-orders/:id/cancel') cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.cancel(id, u.id); }
  @RequirePermissions('purchasing.receive') @HttpCode(201) @Post('purchase-orders/:id/receive')
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReceiveDto, @CurrentUser() u: AuthUser) { return this.svc.receive(id, d, u); }
  @RequirePermissions('products.read') @Get('purchase-orders/:id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.svc.pdf(id);
    sendPdf(res, r.pdf, `${r.number}.pdf`);
  }
}

@Module({ controllers: [PurchasingController], providers: [PurchasingService] })
export class PurchasingModule {}
