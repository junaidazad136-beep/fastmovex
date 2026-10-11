import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Param,
  Optional, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InventoryReason, StockCountStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DOHA_OFFSET_MS = 3 * 3_600_000;
/** Today's date in Qatar as a UTC-midnight Date (how @db.Date values come back). */
export function dohaToday(now = new Date()): Date {
  const d = new Date(now.getTime() + DOHA_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const stamp = () => new Date(Date.now() + DOHA_OFFSET_MS).toISOString().slice(2, 10).replace(/-/g, '');

// ====================================================================== expiry

/**
 * Dated stock: what expires soon (to sell or mark down first) and, every night, expired units written off the shelf so
 * they can never be sold. Units already promised to open orders are left for staff to check (shown as "expired").
 */
@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);
  constructor(private readonly prisma: PrismaService, private readonly warehouses: WarehousesService, private readonly audit: AuditService) {}

  async report(days = 30, now = new Date()) {
    const today = dohaToday(now);
    const until = new Date(today.getTime() + days * 86_400_000);
    const lots = await this.prisma.stockLot.findMany({
      where: { quantity: { gt: 0 }, expiresOn: { lte: until } },
      orderBy: [{ expiresOn: 'asc' }],
      take: 500,
      select: {
        id: true, lotCode: true, expiresOn: true, quantity: true, warehouse: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, priceMinor: true, costPriceMinor: true, product: { select: { id: true, title: true, country: { select: { currencyCode: true } } } } } },
      },
    });
    const rows = lots.map((l) => ({
      id: l.id, lotCode: l.lotCode || null, expiresOn: l.expiresOn.toISOString().slice(0, 10), quantity: l.quantity,
      daysLeft: Math.round((l.expiresOn.getTime() - today.getTime()) / 86_400_000), expired: l.expiresOn < today,
      warehouse: l.warehouse, variantId: l.variant.id, sku: l.variant.sku, productId: l.variant.product.id, title: l.variant.product.title,
      valueMinor: ((l.variant.costPriceMinor ?? l.variant.priceMinor) * BigInt(l.quantity)).toString(), currencyCode: l.variant.product.country.currencyCode,
    }));
    return {
      days,
      expired: rows.filter((r) => r.expired).length,
      expiringSoon: rows.filter((r) => !r.expired).length,
      valueAtRiskMinor: rows.reduce((n, r) => n + BigInt(r.valueMinor), 0n).toString(),
      items: rows,
    };
  }

  /** Nightly (00:10 Qatar): expired lots leave the shelf with reason EXPIRED — as much as is not promised to orders. */
  @Cron('10 21 * * *')
  async nightly() {
    if (process.env.NODE_ENV === 'test') return;
    try { await this.writeOffExpired(null); } catch (e) { this.logger.error(`expiry run failed: ${(e as Error).message}`); }
  }

  async writeOffExpired(actorId: string | null, now = new Date()) {
    const today = dohaToday(now);
    const lots = await this.prisma.stockLot.findMany({ where: { quantity: { gt: 0 }, expiresOn: { lt: today } }, orderBy: { expiresOn: 'asc' }, select: { id: true, warehouseId: true, variantId: true, lotCode: true, expiresOn: true, quantity: true } });
    let units = 0;
    let held = 0;
    for (const l of lots) {
      await this.prisma.$transaction(async (tx) => {
        const inv = await tx.inventory.findUnique({ where: { variantId: l.variantId }, select: { onHand: true, reserved: true } });
        const free = Math.max(0, (inv?.onHand ?? 0) - (inv?.reserved ?? 0));
        const qty = Math.min(l.quantity, free);
        held += l.quantity - qty;
        if (qty <= 0) return;
        await this.warehouses.move(tx, { warehouseId: l.warehouseId, variantId: l.variantId, delta: -qty, reason: 'EXPIRED', lotId: l.id, refType: 'expiry', actorId, note: `Expired ${l.expiresOn.toISOString().slice(0, 10)}${l.lotCode ? ` (lot ${l.lotCode})` : ''}` });
        units += qty;
      });
    }
    if (units || held) await this.audit.log({ actorId, action: 'inventory.expired_written_off', entityType: 'StockLot', entityId: 'nightly', after: { lots: lots.length, units, stillOnOrders: held } });
    return { lots: lots.length, unitsWrittenOff: units, unitsStillOnOrders: held };
  }
}

// ====================================================================== stocktake

class CreateCountDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ description: 'Count only these products (default: everything in the warehouse)' }) @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('4', { each: true }) variantIds?: string[];
  @ApiPropertyOptional({ description: 'Only this category (and below)' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ default: true, description: 'Counters do not see what the system expects' }) @IsOptional() @IsBoolean() blind?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class CountLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) countedQty: number;
}
class CountLinesDto {
  @ApiProperty({ type: [CountLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines: CountLineDto[];
}
class CountsQuery { @ApiPropertyOptional({ enum: StockCountStatus }) @IsOptional() @IsEnum(StockCountStatus) status?: StockCountStatus; }
class ShrinkageQuery {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsISO8601() to?: string;
}

const WRITE_OFF: InventoryReason[] = ['DAMAGED', 'EXPIRED', 'LOST', 'COUNT', 'FOUND', 'ADJUSTMENT'];

/**
 * Stocktake: staff count what is really on the shelves (blind: they do not see the expected number), submit, and a
 * different person approves. Approving posts each difference as a COUNT movement — counted minus what the system had
 * when that line was counted, so sales during the count do not distort it.
 */
@Injectable()
export class StocktakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async create(dto: CreateCountDto, actorId: string) {
    const sellerId = await this.warehouses.house();
    const w = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, sellerId }, select: { id: true, name: true } });
    if (!w) throw new NotFoundException('Warehouse not found');
    const open = await this.prisma.stockCount.count({ where: { warehouseId: w.id, status: { in: ['OPEN', 'SUBMITTED'] } } });
    if (open) throw new ConflictException('A stocktake is already open for this warehouse. Finish or cancel it first.');
    let variantIds = dto.variantIds;
    if (!variantIds) {
      const cat = dto.categoryId ? await this.prisma.category.findUnique({ where: { id: dto.categoryId }, select: { path: true } }) : null;
      const vs = await this.prisma.productVariant.findMany({
        where: {
          isActive: true, product: { store: { sellerId }, deletedAt: null, ...(cat && { category: { path: { startsWith: cat.path } } }) },
          OR: [{ warehouseStock: { some: { warehouseId: w.id, onHand: { gt: 0 } } } }, { product: { status: 'ACTIVE' } }],
        },
        select: { id: true }, take: 2000,
      });
      variantIds = vs.map((v) => v.id);
    }
    if (!variantIds.length) throw new BadRequestException('Nothing to count');
    const shelf = await this.prisma.warehouseStock.findMany({ where: { warehouseId: w.id, variantId: { in: variantIds } }, select: { variantId: true, onHand: true } });
    const qty = new Map(shelf.map((x) => [x.variantId, x.onHand]));
    const count = await this.prisma.stockCount.create({
      data: {
        number: `SC-${stamp()}-${randomBytes(2).toString('hex').toUpperCase()}`, warehouseId: w.id, blind: dto.blind ?? true, note: dto.note, createdById: actorId,
        lines: { create: variantIds.map((variantId) => ({ variantId, expectedQty: qty.get(variantId) ?? 0 })) },
      },
    });
    await this.audit.log({ actorId, action: 'stocktake.create', entityType: 'StockCount', entityId: count.id, after: { number: count.number, warehouse: w.name, lines: variantIds.length } });
    return this.get(count.id, { permissions: ['inventory.approve'] } as AuthUser);
  }

  list(q: CountsQuery) {
    return this.prisma.stockCount.findMany({
      where: { status: q.status }, orderBy: { createdAt: 'desc' }, take: 50,
      include: { warehouse: { select: { name: true, code: true } }, _count: { select: { lines: true } } },
    });
  }

  /** Counters on a blind count see only what they counted; approvers see expected numbers and the value of each difference. */
  async get(id: string, viewer: Pick<AuthUser, 'permissions'>) {
    const c = await this.prisma.stockCount.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          orderBy: { variant: { sku: 'asc' } },
          select: {
            variantId: true, expectedQty: true, countedQty: true, countedAt: true,
            variant: { select: { sku: true, barcode: true, priceMinor: true, costPriceMinor: true, product: { select: { title: true, country: { select: { currencyCode: true } } } } } },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Stocktake not found');
    const reveal = !c.blind || c.status !== 'OPEN' || viewer.permissions.includes('inventory.approve');
    let shortMinor = 0n;
    let overMinor = 0n;
    const lines = c.lines.map((l) => {
      const diff = l.countedQty === null ? null : l.countedQty - l.expectedQty;
      const unit = l.variant.costPriceMinor ?? l.variant.priceMinor;
      if (diff !== null && diff < 0) shortMinor += unit * BigInt(-diff);
      if (diff !== null && diff > 0) overMinor += unit * BigInt(diff);
      return {
        variantId: l.variantId, sku: l.variant.sku, barcode: l.variant.barcode, title: l.variant.product.title,
        countedQty: l.countedQty, countedAt: l.countedAt,
        ...(reveal && { expectedQty: l.expectedQty, difference: diff, differenceValueMinor: diff === null ? null : (unit * BigInt(diff)).toString() }),
      };
    });
    const { lines: _l, ...head } = c;
    return {
      ...head, lines,
      progress: { counted: c.lines.filter((l) => l.countedQty !== null).length, total: c.lines.length },
      ...(reveal && { shortValueMinor: shortMinor.toString(), overValueMinor: overMinor.toString(), currencyCode: c.lines[0]?.variant.product.country.currencyCode ?? 'QAR' }),
    };
  }

  /** Counted numbers come in (in batches, from a scanner or by hand); each line remembers what the shelf had at that moment. */
  async count(id: string, dto: CountLinesDto, actorId: string, viewer: AuthUser) {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, select: { id: true, status: true, warehouseId: true } });
    if (!c) throw new NotFoundException('Stocktake not found');
    if (c.status !== 'OPEN') throw new ConflictException('This stocktake is no longer open for counting');
    const ids = dto.lines.map((l) => l.variantId);
    const shelf = await this.prisma.warehouseStock.findMany({ where: { warehouseId: c.warehouseId, variantId: { in: ids } }, select: { variantId: true, onHand: true } });
    const qty = new Map(shelf.map((x) => [x.variantId, x.onHand]));
    const known = new Set((await this.prisma.stockCountLine.findMany({ where: { countId: id, variantId: { in: ids } }, select: { variantId: true } })).map((l) => l.variantId));
    const now = new Date();
    await this.prisma.$transaction(dto.lines.map((l) => known.has(l.variantId)
      ? this.prisma.stockCountLine.update({ where: { countId_variantId: { countId: id, variantId: l.variantId } }, data: { countedQty: l.countedQty, countedAt: now, countedById: actorId, expectedQty: qty.get(l.variantId) ?? 0 } })
      // found something not on the list (wrong shelf, new product): it joins the count
      : this.prisma.stockCountLine.create({ data: { countId: id, variantId: l.variantId, countedQty: l.countedQty, countedAt: now, countedById: actorId, expectedQty: qty.get(l.variantId) ?? 0 } })));
    // which lines and the counted numbers (what the shelf "should" have stays hidden from counters, also here)
    await this.audit.log({ actorId, action: 'stocktake.count', entityType: 'StockCount', entityId: id, after: { lines: dto.lines.length, added: dto.lines.filter((l) => !known.has(l.variantId)).length, counted: dto.lines.slice(0, 50).map((l) => ({ variantId: l.variantId, qty: l.countedQty })) } });
    return this.get(id, viewer);
  }

  async submit(id: string, actorId: string) {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, select: { status: true, number: true, _count: { select: { lines: { where: { countedQty: null } } } } } });
    if (!c) throw new NotFoundException('Stocktake not found');
    if (c.status !== 'OPEN') throw new ConflictException('Only an open stocktake can be submitted');
    if (c._count.lines > 0) throw new BadRequestException({ message: `${c._count.lines} product(s) are not counted yet. Count them (0 if none) before submitting.`, reason: 'NOT_COUNTED' });
    await this.prisma.stockCount.update({ where: { id }, data: { status: 'SUBMITTED', submittedById: actorId, submittedAt: new Date() } });
    await this.audit.log({ actorId, action: 'stocktake.submit', entityType: 'StockCount', entityId: id, after: { number: c.number } });
    this.events?.emit(EVENTS.STOCKTAKE_SUBMITTED, { id });
    return { id, status: 'SUBMITTED' as const };
  }

  /** A second person approves; the differences are posted as COUNT movements in one transaction. */
  async approve(id: string, actor: AuthUser) {
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await tx.stockCount.findUnique({ where: { id }, include: { lines: { select: { variantId: true, expectedQty: true, countedQty: true, variant: { select: { sku: true } } } } } });
      if (!c) throw new NotFoundException('Stocktake not found');
      if (c.status !== 'SUBMITTED') throw new ConflictException('Only a submitted stocktake can be approved');
      if (c.submittedById === actor.id || c.lines.length === 0) throw new ForbiddenException({ message: 'A different person must approve the count (four-eyes rule).', reason: 'FOUR_EYES' });
      const done = await tx.stockCount.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() } });
      if (done.count !== 1) throw new ConflictException('This stocktake was just approved');
      let up = 0;
      let down = 0;
      for (const l of c.lines) {
        const diff = (l.countedQty ?? l.expectedQty) - l.expectedQty;
        if (!diff) continue;
        if (diff < 0) {
          // the shop may have promised these units to orders: never below what is reserved
          const inv = await tx.inventory.findUniqueOrThrow({ where: { variantId: l.variantId }, select: { onHand: true, reserved: true } });
          if (inv.onHand + diff < inv.reserved) throw new ConflictException({ message: `${l.variant.sku}: open orders need more units than were counted. Sort those orders out first.`, reason: 'RESERVED' });
        }
        await this.warehouses.move(tx, { warehouseId: c.warehouseId, variantId: l.variantId, delta: diff, reason: 'COUNT', refType: 'stock_count', refId: c.id, actorId: actor.id, note: c.number, label: l.variant.sku });
        if (diff > 0) up += diff; else down -= diff;
      }
      return { number: c.number, unitsAdded: up, unitsRemoved: down };
    });
    await this.audit.log({ actorId: actor.id, action: 'stocktake.approve', entityType: 'StockCount', entityId: id, after: result });
    return { id, status: 'APPROVED' as const, ...result };
  }

  async cancel(id: string, actorId: string) {
    const done = await this.prisma.stockCount.updateMany({ where: { id, status: { in: ['OPEN', 'SUBMITTED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (done.count !== 1) throw new ConflictException('Only an open or submitted stocktake can be cancelled');
    await this.audit.log({ actorId, action: 'stocktake.cancel', entityType: 'StockCount', entityId: id });
    return { id, status: 'CANCELLED' as const };
  }

  /** What left the shelves other than by selling: by reason and by product, in units and value (at cost). */
  async shrinkage(q: ShrinkageQuery, now = new Date()) {
    const to = q.to ? new Date(new Date(q.to).getTime() + 86_400_000) : now;
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ reason: string; variantId: string; sku: string; title: string; units: number; valueMinor: bigint }[]>`
      SELECT m."reason"::text AS reason, v.id AS "variantId", v.sku, p.title,
             sum(m."qtyDelta")::int AS units,
             sum(m."qtyDelta"::bigint * coalesce(v."costPriceMinor", v."priceMinor"))::bigint AS "valueMinor"
      FROM "InventoryMovement" m JOIN "ProductVariant" v ON v.id = m."variantId" JOIN "Product" p ON p.id = v."productId"
      WHERE m."createdAt" >= ${from} AND m."createdAt" < ${to} AND m."reason"::text = ANY(${WRITE_OFF as string[]})
      GROUP BY m."reason", v.id, v.sku, p.title`;
    const byReason = new Map<string, { units: number; valueMinor: bigint }>();
    for (const r of rows) {
      const cur = byReason.get(r.reason) ?? { units: 0, valueMinor: 0n };
      byReason.set(r.reason, { units: cur.units + r.units, valueMinor: cur.valueMinor + r.valueMinor });
    }
    const lost = rows.filter((r) => r.units < 0);
    return {
      from: from.toISOString(), to: to.toISOString(),
      totalLostUnits: -lost.reduce((n, r) => n + r.units, 0),
      totalLostValueMinor: (-lost.reduce((n, r) => n + r.valueMinor, 0n)).toString(),
      byReason: [...byReason.entries()].map(([reason, v]) => ({ reason, units: v.units, valueMinor: v.valueMinor.toString() })).sort((a, b) => Number(BigInt(a.valueMinor) - BigInt(b.valueMinor))),
      topProducts: lost.sort((a, b) => Number(a.valueMinor - b.valueMinor)).slice(0, 20).map((r) => ({ ...r, valueMinor: r.valueMinor.toString() })),
    };
  }
}

// ====================================================================== controllers

class ExpiryQuery { @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) days?: number; }

@ApiTags('Admin / Stock control') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class StockControlController {
  constructor(private readonly expiry: ExpiryService, private readonly counts: StocktakeService) {}

  @RequirePermissions('products.read') @Get('inventory/expiry') expiryReport(@Query() q: ExpiryQuery) { return this.expiry.report(q.days ?? 30); }
  @RequirePermissions('inventory.approve') @HttpCode(200) @Post('inventory/expiry/write-off') writeOff(@CurrentUser() u: AuthUser) { return this.expiry.writeOffExpired(u.id); }
  @RequirePermissions('products.read') @Get('inventory/shrinkage') shrinkage(@Query() q: ShrinkageQuery) { return this.counts.shrinkage(q); }

  @RequirePermissions('products.read') @Get('stock-counts') list(@Query() q: CountsQuery) { return this.counts.list(q); }
  @RequirePermissions('inventory.manage') @Post('stock-counts') create(@Body() d: CreateCountDto, @CurrentUser() u: AuthUser) { return this.counts.create(d, u.id); }
  @RequirePermissions('products.read') @Get('stock-counts/:id') get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.counts.get(id, u); }
  @RequirePermissions('inventory.manage') @Patch('stock-counts/:id/lines') count(@Param('id', ParseUUIDPipe) id: string, @Body() d: CountLinesDto, @CurrentUser() u: AuthUser) { return this.counts.count(id, d, u.id, u); }
  @RequirePermissions('inventory.manage') @HttpCode(200) @Post('stock-counts/:id/submit') submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.counts.submit(id, u.id); }
  @RequirePermissions('inventory.approve') @HttpCode(200) @Post('stock-counts/:id/approve') approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.counts.approve(id, u); }
  @RequirePermissions('inventory.manage') @HttpCode(200) @Post('stock-counts/:id/cancel') cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.counts.cancel(id, u.id); }
}

@Module({ controllers: [StockControlController], providers: [ExpiryService, StocktakeService], exports: [ExpiryService] })
export class StockControlModule {}

