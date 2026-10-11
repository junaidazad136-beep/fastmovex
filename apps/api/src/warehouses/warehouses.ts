import {
  BadRequestException, Body, ConflictException, Controller, Get, Global, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InventoryReason, Prisma, TransferStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;
export interface TakenLot { lotCode: string; expiresOn: Date; quantity: number }
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Shipment states before the goods leave: the warehouse can still change, and the units count as allocated there. */
export const NOT_YET_SHIPPED = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'] as const;

// ====================================================================== choosing a warehouse (pure, unit-tested)

export interface Candidate {
  id: string;
  isDefault: boolean;
  priority: number;
  zones: string[];
  /** units free to send per variant: on the shelf minus what open shipments from here already need */
  free: Map<string, number>;
}

/**
 * The warehouse that sends a shipment: the one that has everything (then: closest to the delivery zone, then the
 * staff's priority, then the default); if none has everything, the one that has the most of it. Staff can change it.
 */
export function pickWarehouse(candidates: Candidate[], need: { variantId: string; quantity: number }[], zone?: string | null): string | null {
  if (!candidates.length) return null;
  const score = (c: Candidate) => {
    const lines = need.filter((n) => (c.free.get(n.variantId) ?? 0) >= n.quantity).length;
    const units = need.reduce((sum, n) => sum + Math.min(c.free.get(n.variantId) ?? 0, n.quantity), 0);
    return { all: lines === need.length, lines, units, near: !!zone && c.zones.includes(zone) };
  };
  return [...candidates]
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) =>
      Number(b.s.all) - Number(a.s.all) || Number(b.s.near) - Number(a.s.near) || b.s.lines - a.s.lines || b.s.units - a.s.units
      || a.c.priority - b.c.priority || Number(b.c.isDefault) - Number(a.c.isDefault))[0].c.id;
}

// ====================================================================== DTOs

const CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
class WarehouseDto {
  @ApiProperty({ example: 'WAK' }) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(CODE, { message: 'code: 2–20 letters, digits or dashes' }) code: string;
  @ApiProperty({ example: 'Al Wakrah store room' }) @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) nameAr?: string;
  @ApiPropertyOptional({ example: 'Al Wakrah' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ example: ['90', '91'], description: 'Delivery zones this warehouse is closest to' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @Matches(/^\d{1,3}$/, { each: true }) zones?: string[];
  @ApiPropertyOptional({ default: 100, description: 'Lower first' }) @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Where stock goes when no warehouse is named' }) @IsOptional() @IsBoolean() isDefault?: boolean;
}
class UpdateWarehouseDto implements Partial<WarehouseDto> {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(100) @Matches(/^\d{1,3}$/, { each: true }) zones?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
class StockQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
class TransferItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity: number;
}
class CreateTransferDto {
  @ApiProperty() @IsUUID() fromWarehouseId: string;
  @ApiProperty() @IsUUID() toWarehouseId: string;
  @ApiProperty({ type: [TransferItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TransferItemDto) items: TransferItemDto[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class TransfersQuery {
  @ApiPropertyOptional({ enum: TransferStatus }) @IsOptional() @IsEnum(TransferStatus) status?: TransferStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class ShipmentWarehouseDto {
  @ApiProperty() @IsUUID() warehouseId: string;
}

// ====================================================================== service

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The seller's default warehouse, made on first use ("Main warehouse"). */
  async defaultFor(db: Db, sellerId: string): Promise<string> {
    const found = await db.warehouse.findFirst({ where: { sellerId, isDefault: true }, select: { id: true } });
    if (found) return found.id;
    await db.$executeRaw`
      INSERT INTO "Warehouse" ("id", "sellerId", "code", "name", "nameAr", "city", "isDefault", "updatedAt")
      VALUES (gen_random_uuid(), ${sellerId}::uuid, 'MAIN', 'Main warehouse', 'المستودع الرئيسي', 'Doha', true, now())
      ON CONFLICT DO NOTHING`;
    return (await db.warehouse.findFirstOrThrow({ where: { sellerId, isDefault: true }, select: { id: true } })).id;
  }

  /** A warehouse of this seller, open for stock. */
  async ownWarehouse(db: Db, sellerId: string, warehouseId: string | undefined) {
    if (!warehouseId) return this.defaultFor(db, sellerId);
    const w = await db.warehouse.findFirst({ where: { id: warehouseId, sellerId }, select: { id: true, isActive: true } });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (!w.isActive) throw new BadRequestException('This warehouse is closed. Open it again first.');
    return w.id;
  }

  /**
   * Adds or takes units on a warehouse shelf, with a movement row. The shop's total follows (database trigger).
   * Never below zero; fails with a clear message instead.
   *
   * Dated stock (products that track expiry): units added with `lot` / `lots` are kept in StockLot; units taken are
   * taken from the lots earliest-expiry first (FEFO) — a named `lotId` first, and for shipping (`skipExpired`) lots
   * already past their date only as a last resort. Returns the lots taken, so a transfer can land them as they were.
   */
  async move(tx: Prisma.TransactionClient, m: {
    warehouseId: string; variantId: string; delta: number; reason: InventoryReason; refType?: string; refId?: string; actorId?: string | null; note?: string; label?: string;
    lot?: { lotCode?: string | null; expiresOn: Date }; lots?: TakenLot[]; lotId?: string; skipExpired?: boolean;
  }): Promise<TakenLot[]> {
    if (m.delta === 0) return [];
    let taken: TakenLot[] = [];
    if (m.delta > 0) {
      await tx.$executeRaw`
        INSERT INTO "WarehouseStock" ("warehouseId", "variantId", "onHand", "updatedAt") VALUES (${m.warehouseId}::uuid, ${m.variantId}::uuid, ${m.delta}, now())
        ON CONFLICT ("warehouseId", "variantId") DO UPDATE SET "onHand" = "WarehouseStock"."onHand" + EXCLUDED."onHand", "updatedAt" = now()`;
      const add = m.lot ? [{ lotCode: m.lot.lotCode ?? '', expiresOn: m.lot.expiresOn, quantity: m.delta }] : (m.lots ?? []);
      let room = m.delta;
      for (const l of add) {
        const q = Math.min(l.quantity, room);
        if (q <= 0) break;
        room -= q;
        await tx.$executeRaw`
          INSERT INTO "StockLot" ("id", "warehouseId", "variantId", "lotCode", "expiresOn", "quantity", "updatedAt")
          VALUES (gen_random_uuid(), ${m.warehouseId}::uuid, ${m.variantId}::uuid, ${l.lotCode ?? ''}, ${l.expiresOn}::date, ${q}, now())
          ON CONFLICT ("warehouseId", "variantId", "lotCode", "expiresOn") DO UPDATE SET "quantity" = "StockLot"."quantity" + EXCLUDED."quantity", "updatedAt" = now()`;
      }
    } else {
      const n = await tx.$executeRaw`
        UPDATE "WarehouseStock" SET "onHand" = "onHand" + ${m.delta}, "updatedAt" = now()
        WHERE "warehouseId" = ${m.warehouseId}::uuid AND "variantId" = ${m.variantId}::uuid AND "onHand" >= ${-m.delta}`;
      if (n !== 1) {
        const [w, have] = await Promise.all([
          tx.warehouse.findUnique({ where: { id: m.warehouseId }, select: { name: true } }),
          tx.warehouseStock.findUnique({ where: { warehouseId_variantId: { warehouseId: m.warehouseId, variantId: m.variantId } }, select: { onHand: true } }),
        ]);
        throw new ConflictException({ message: `Not enough ${m.label ?? 'stock'} at ${w?.name ?? 'this warehouse'}: ${have?.onHand ?? 0} there, ${-m.delta} needed. Move stock there or choose another warehouse.`, reason: 'WAREHOUSE_SHORT' });
      }
      taken = await this.takeFromLots(tx, m.warehouseId, m.variantId, -m.delta, { lotId: m.lotId, skipExpired: m.skipExpired });
    }
    const lotNote = taken.length ? ` [lots: ${taken.map((t) => `${t.lotCode || 'no code'} exp ${t.expiresOn.toISOString().slice(0, 10)} ×${t.quantity}`).join(', ')}]` : m.lot ? ` [lot ${m.lot.lotCode || 'no code'} exp ${m.lot.expiresOn.toISOString().slice(0, 10)}]` : '';
    await tx.inventoryMovement.create({ data: { variantId: m.variantId, warehouseId: m.warehouseId, qtyDelta: m.delta, reason: m.reason, refType: m.refType, refId: m.refId, actorId: m.actorId ?? undefined, note: ((m.note ?? '') + lotNote).trim().slice(0, 500) || undefined } });
    return taken;
  }

  /** Takes units from dated lots, earliest expiry first. Undated units (stock from before tracking) are not in lots. */
  private async takeFromLots(tx: Prisma.TransactionClient, warehouseId: string, variantId: string, qty: number, o: { lotId?: string; skipExpired?: boolean }): Promise<TakenLot[]> {
    const lots = await tx.$queryRaw<{ id: string; lotCode: string; expiresOn: Date; quantity: number }[]>`
      SELECT "id", "lotCode", "expiresOn", "quantity" FROM "StockLot"
      WHERE "warehouseId" = ${warehouseId}::uuid AND "variantId" = ${variantId}::uuid AND "quantity" > 0
      ORDER BY ("id" = ${o.lotId ?? null}::uuid) DESC NULLS LAST,
               (${o.skipExpired ?? false}::boolean AND "expiresOn" < (now() AT TIME ZONE 'Asia/Qatar')::date) ASC,
               "expiresOn" ASC, "receivedAt" ASC
      FOR UPDATE`;
    const out: TakenLot[] = [];
    let left = qty;
    for (const l of lots) {
      if (left <= 0) break;
      const q = Math.min(left, l.quantity);
      await tx.stockLot.update({ where: { id: l.id }, data: { quantity: { decrement: q } } });
      out.push({ lotCode: l.lotCode, expiresOn: l.expiresOn, quantity: q });
      left -= q;
    }
    return out;
  }

  /** Free units per warehouse and variant: on the shelf minus what not-yet-shipped orders from there need. */
  async freeStock(db: Db, warehouseIds: string[], variantIds: string[], excludeSellerOrderId?: string) {
    if (!warehouseIds.length || !variantIds.length) return new Map<string, Map<string, number>>();
    const rows = await db.$queryRaw<{ warehouseId: string; variantId: string; free: number }[]>`
      SELECT w.id AS "warehouseId", v.id AS "variantId",
             (coalesce(ws."onHand", 0) - coalesce((
               SELECT sum(oi."quantity") FROM "OrderItem" oi JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
               WHERE so."warehouseId" = w.id AND oi."variantId" = v.id AND so."status"::text = ANY(${[...NOT_YET_SHIPPED]})
                 AND so."id" IS DISTINCT FROM ${excludeSellerOrderId ?? null}::uuid
             ), 0))::int AS free
      FROM unnest(${warehouseIds}::uuid[]) AS w(id)
      CROSS JOIN unnest(${variantIds}::uuid[]) AS v(id)
      LEFT JOIN "WarehouseStock" ws ON ws."warehouseId" = w.id AND ws."variantId" = v.id`;
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!out.has(r.warehouseId)) out.set(r.warehouseId, new Map());
      out.get(r.warehouseId)!.set(r.variantId, r.free);
    }
    return out;
  }

  /** Warehouse for a new shipment (at checkout). */
  async choose(tx: Prisma.TransactionClient, sellerId: string, need: { variantId: string; quantity: number }[], zone?: string | null): Promise<string> {
    const list = await tx.warehouse.findMany({ where: { sellerId, isActive: true }, select: { id: true, isDefault: true, priority: true, zones: true } });
    if (list.length <= 1) return list[0]?.id ?? this.defaultFor(tx, sellerId);
    const free = await this.freeStock(tx, list.map((w) => w.id), [...new Set(need.map((n) => n.variantId))]);
    return pickWarehouse(list.map((w) => ({ ...w, free: free.get(w.id) ?? new Map() })), need, zone) ?? this.defaultFor(tx, sellerId);
  }

  // ---------------------------------------------------------------- staff screens

  async list(sellerId: string) {
    await this.defaultFor(this.prisma, sellerId);
    const [rows, totals, open, pending] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { sellerId }, orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }, { name: 'asc' }] }),
      this.prisma.warehouseStock.groupBy({ by: ['warehouseId'], where: { warehouse: { sellerId }, onHand: { gt: 0 } }, _sum: { onHand: true }, _count: { _all: true } }),
      this.prisma.sellerOrder.groupBy({ by: ['warehouseId'], where: { sellerId, status: { in: [...NOT_YET_SHIPPED] } }, _count: { _all: true } }),
      this.prisma.stockTransfer.count({ where: { status: 'PENDING', fromWarehouse: { sellerId } } }),
    ]);
    return {
      pendingTransfers: pending,
      items: rows.map((w) => {
        const t = totals.find((x) => x.warehouseId === w.id);
        return { ...w, products: t?._count._all ?? 0, units: t?._sum.onHand ?? 0, openShipments: open.find((o) => o.warehouseId === w.id)?._count._all ?? 0 };
      }),
    };
  }

  async create(sellerId: string, dto: WarehouseDto, actorId: string) {
    try {
      const w = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) await tx.warehouse.updateMany({ where: { sellerId, isDefault: true }, data: { isDefault: false } });
        return tx.warehouse.create({ data: { ...dto, zones: dto.zones ?? [], sellerId, isActive: dto.isDefault ? true : dto.isActive ?? true } });
      });
      await this.audit.log({ actorId, action: 'warehouse.create', entityType: 'Warehouse', entityId: w.id, after: { code: w.code, name: w.name } });
      return w;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Another warehouse already uses the code ${dto.code}`);
      throw e;
    }
  }

  async update(sellerId: string, id: string, dto: UpdateWarehouseDto, actorId: string) {
    const w = await this.prisma.warehouse.findFirst({ where: { id, sellerId } });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (dto.isDefault === false && w.isDefault) throw new BadRequestException('Choose another warehouse as the default instead');
    if (dto.isActive === false && (w.isDefault || dto.isDefault)) throw new BadRequestException('The default warehouse cannot be closed. Make another one the default first.');
    if (dto.isActive === false) {
      const [units, open] = await Promise.all([
        this.prisma.warehouseStock.aggregate({ where: { warehouseId: id }, _sum: { onHand: true } }),
        this.prisma.sellerOrder.count({ where: { warehouseId: id, status: { in: [...NOT_YET_SHIPPED] } } }),
      ]);
      if ((units._sum.onHand ?? 0) > 0) throw new BadRequestException(`Move the ${units._sum.onHand} units out of this warehouse before closing it`);
      if (open) throw new BadRequestException(`${open} shipment(s) still go out from this warehouse. Send them from another one first.`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault && !w.isDefault) await tx.warehouse.updateMany({ where: { sellerId, isDefault: true }, data: { isDefault: false } });
      return tx.warehouse.update({ where: { id }, data: { ...dto, ...(dto.isDefault && { isActive: true }) } });
    });
    await this.audit.log({ actorId, action: 'warehouse.update', entityType: 'Warehouse', entityId: id, before: { name: w.name, isActive: w.isActive, isDefault: w.isDefault, priority: w.priority }, after: { ...dto } as Prisma.InputJsonValue });
    return updated;
  }

  /** What is on the shelves of one warehouse (search by name or SKU). */
  async stock(sellerId: string, warehouseId: string, q: StockQuery) {
    const w = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, sellerId }, select: { id: true } });
    if (!w) throw new NotFoundException('Warehouse not found');
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const offset = q.offset ?? 0;
    const rows = await this.prisma.$queryRaw<{ variantId: string; sku: string; title: string; optionValues: unknown; onHand: number; allocated: number; total: number }[]>`
      SELECT ws."variantId", v."sku", p."title", v."optionValues", ws."onHand",
             coalesce((SELECT sum(oi."quantity") FROM "OrderItem" oi JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
                       WHERE so."warehouseId" = ws."warehouseId" AND oi."variantId" = ws."variantId" AND so."status"::text = ANY(${[...NOT_YET_SHIPPED]})), 0)::int AS allocated,
             count(*) OVER()::int AS total
      FROM "WarehouseStock" ws JOIN "ProductVariant" v ON v."id" = ws."variantId" JOIN "Product" p ON p."id" = v."productId"
      WHERE ws."warehouseId" = ${warehouseId}::uuid AND p."deletedAt" IS NULL
        AND (${like}::text IS NULL OR p."title" ILIKE ${like} OR v."sku" ILIKE ${like})
      ORDER BY p."title", v."sku" LIMIT 50 OFFSET ${offset}`;
    return { total: rows[0]?.total ?? 0, items: rows.map(({ total: _t, ...r }) => ({ ...r, free: r.onHand - r.allocated })) };
  }

  /** One variant across all warehouses (for the stock dialog). */
  async forVariant(sellerId: string, variantId: string) {
    const ws = await this.prisma.warehouse.findMany({ where: { sellerId }, orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }], select: { id: true, code: true, name: true, isDefault: true, isActive: true, stock: { where: { variantId }, select: { onHand: true, bin: true } } } });
    const free = await this.freeStock(this.prisma, ws.map((w) => w.id), [variantId]);
    return ws.map(({ stock, ...w }) => ({ ...w, onHand: stock[0]?.onHand ?? 0, bin: stock[0]?.bin ?? null, free: free.get(w.id)?.get(variantId) ?? 0 }));
  }

  // ---------------------------------------------------------------- shipments

  /** Staff send a shipment from another warehouse (before it ships). */
  async changeShipmentWarehouse(sellerOrderId: string, warehouseId: string, actorId: string, sellerId?: string) {
    const so = await this.prisma.sellerOrder.findUnique({ where: { id: sellerOrderId }, select: { id: true, sellerId: true, status: true, warehouseId: true } });
    if (!so || (sellerId && so.sellerId !== sellerId)) throw new NotFoundException('Shipment not found');
    if (!(NOT_YET_SHIPPED as readonly string[]).includes(so.status)) throw new BadRequestException('This shipment has already left the warehouse');
    const id = await this.ownWarehouse(this.prisma, so.sellerId, warehouseId);
    await this.prisma.sellerOrder.update({ where: { id: sellerOrderId }, data: { warehouseId: id } });
    await this.audit.log({ actorId, action: 'shipment.warehouse', entityType: 'SellerOrder', entityId: sellerOrderId, before: { warehouseId: so.warehouseId }, after: { warehouseId: id } });
    return this.shipmentStock(sellerOrderId);
  }

  /** For the order screen: where it ships from, and whether that warehouse has everything (with alternatives). */
  async shipmentStock(sellerOrderId: string) {
    const so = await this.prisma.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      select: { id: true, sellerId: true, status: true, warehouseId: true, items: { select: { variantId: true, quantity: true, sku: true } } },
    });
    const ws = await this.prisma.warehouse.findMany({ where: { sellerId: so.sellerId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }], select: { id: true, code: true, name: true } });
    const shipped = !(NOT_YET_SHIPPED as readonly string[]).includes(so.status);
    const need = new Map<string, number>();
    for (const i of so.items) need.set(i.variantId, (need.get(i.variantId) ?? 0) + i.quantity);
    const free = shipped ? new Map<string, Map<string, number>>() : await this.freeStock(this.prisma, ws.map((w) => w.id), [...need.keys()], so.id);
    const check = (wid: string) => so.items.map((i) => ({ variantId: i.variantId, sku: i.sku, need: i.quantity, free: free.get(wid)?.get(i.variantId) ?? 0 }));
    return {
      warehouseId: so.warehouseId,
      shipped,
      options: ws.map((w) => {
        const lines = shipped ? [] : check(w.id);
        return { ...w, hasEverything: lines.every((l) => l.free >= l.need), short: lines.filter((l) => l.free < l.need) };
      }),
    };
  }

  // ---------------------------------------------------------------- transfers

  async transfers(sellerId: string, q: TransfersQuery) {
    const rows = await this.prisma.stockTransfer.findMany({
      where: { fromWarehouse: { sellerId }, status: q.status, ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      include: {
        fromWarehouse: { select: { id: true, name: true, code: true } }, toWarehouse: { select: { id: true, name: true, code: true } },
        items: { select: { variantId: true, quantity: true, variant: { select: { sku: true, product: { select: { title: true } } } } } },
      },
    });
    const p = toPage(rows, 25);
    return { nextCursor: p.nextCursor, items: p.items.map((t) => ({ ...t, items: t.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, sku: i.variant.sku, title: i.variant.product.title })) })) };
  }

  async createTransfer(sellerId: string, dto: CreateTransferDto, actorId: string) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Choose two different warehouses');
    await this.ownWarehouse(this.prisma, sellerId, dto.fromWarehouseId);
    await this.ownWarehouse(this.prisma, sellerId, dto.toWarehouseId);
    const ids = [...new Set(dto.items.map((i) => i.variantId))];
    if (ids.length !== dto.items.length) throw new BadRequestException('Each product once per transfer');
    const owned = await this.prisma.productVariant.count({ where: { id: { in: ids }, product: { store: { sellerId }, deletedAt: null } } });
    if (owned !== ids.length) throw new BadRequestException('Some products are not yours');
    const stock = await this.prisma.warehouseStock.findMany({ where: { warehouseId: dto.fromWarehouseId, variantId: { in: ids } }, select: { variantId: true, onHand: true } });
    const short = dto.items.filter((i) => (stock.find((s) => s.variantId === i.variantId)?.onHand ?? 0) < i.quantity);
    if (short.length) throw new BadRequestException({ message: 'The sending warehouse does not have that many of some products', short: short.map((s) => s.variantId) });
    const number = `TR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const t = await this.prisma.stockTransfer.create({
      data: { number, fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, note: dto.note, createdById: actorId, items: { create: dto.items } },
    });
    await this.audit.log({ actorId, action: 'transfer.create', entityType: 'StockTransfer', entityId: t.id, after: { number, items: dto.items.length } as Prisma.InputJsonValue });
    return t;
  }

  /** The goods arrived: units leave one shelf and land on the other in one go (the shop's total does not change). */
  async receiveTransfer(sellerId: string, id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.stockTransfer.findFirst({ where: { id, fromWarehouse: { sellerId } }, include: { items: { include: { variant: { select: { sku: true } } } } } });
      if (!t) throw new NotFoundException('Transfer not found');
      const done = await tx.stockTransfer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: actorId } });
      if (done.count !== 1) throw new ConflictException('This transfer is not waiting any more');
      for (const i of t.items) {
        // destination first: the shop's total never dips below what open orders hold
        // the dated lots travel with the goods: taken first-to-expire at the source, landed with the same dates
        const lots = await this.lotsToTake(tx, t.fromWarehouseId, i.variantId, i.quantity);
        await this.move(tx, { warehouseId: t.toWarehouseId, variantId: i.variantId, delta: i.quantity, reason: 'TRANSFER_IN', refType: 'transfer', refId: t.id, actorId, note: t.number, lots });
        await this.move(tx, { warehouseId: t.fromWarehouseId, variantId: i.variantId, delta: -i.quantity, reason: 'TRANSFER_OUT', refType: 'transfer', refId: t.id, actorId, note: t.number, label: i.variant.sku });
      }
      await this.audit.log({ actorId, action: 'transfer.receive', entityType: 'StockTransfer', entityId: t.id, after: { number: t.number } }, tx);
      return { id, status: 'RECEIVED' as const };
    });
  }

  async cancelTransfer(sellerId: string, id: string, actorId: string) {
    const t = await this.prisma.stockTransfer.findFirst({ where: { id, fromWarehouse: { sellerId } }, select: { id: true, number: true } });
    if (!t) throw new NotFoundException('Transfer not found');
    const done = await this.prisma.stockTransfer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (done.count !== 1) throw new ConflictException('Only a waiting transfer can be cancelled');
    await this.audit.log({ actorId, action: 'transfer.cancel', entityType: 'StockTransfer', entityId: id, after: { number: t.number } });
    return { id, status: 'CANCELLED' as const };
  }

  /** Which lots a removal of `qty` would take (same order as takeFromLots), without changing anything. */
  private async lotsToTake(tx: Prisma.TransactionClient, warehouseId: string, variantId: string, qty: number): Promise<TakenLot[]> {
    const lots = await tx.stockLot.findMany({ where: { warehouseId, variantId, quantity: { gt: 0 } }, orderBy: [{ expiresOn: 'asc' }, { receivedAt: 'asc' }], select: { lotCode: true, expiresOn: true, quantity: true } });
    const out: TakenLot[] = [];
    let left = qty;
    for (const l of lots) { if (left <= 0) break; const q = Math.min(left, l.quantity); out.push({ ...l, quantity: q }); left -= q; }
    return out;
  }

  /** The store FastMoveX runs itself: the admin panel manages its warehouses. */
  async house(): Promise<string> {
    const s = await this.prisma.seller.findFirst({ where: { isHouse: true }, select: { id: true } });
    if (!s) throw new NotFoundException('The FastMoveX store is not set up. Run the base seed (npm run db:seed).');
    return s.id;
  }
}

// ====================================================================== controllers (admin: FastMoveX's own warehouses)

@ApiTags('Admin / Warehouses') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminWarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @RequirePermissions('products.read') @Get('warehouses') async list() { return this.svc.list(await this.svc.house()); }
  @RequirePermissions('inventory.manage') @Post('warehouses') async create(@Body() d: WarehouseDto, @CurrentUser() u: AuthUser) { return this.svc.create(await this.svc.house(), d, u.id); }
  @RequirePermissions('inventory.manage') @Patch('warehouses/:id') async update(@Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateWarehouseDto, @CurrentUser() u: AuthUser) { return this.svc.update(await this.svc.house(), id, d, u.id); }
  @RequirePermissions('products.read') @Get('warehouses/:id/stock') async stock(@Param('id', ParseUUIDPipe) id: string, @Query() q: StockQuery) { return this.svc.stock(await this.svc.house(), id, q); }
  @RequirePermissions('products.read') @Get('variants/:variantId/warehouses') async forVariant(@Param('variantId', ParseUUIDPipe) id: string) { return this.svc.forVariant(await this.svc.house(), id); }

  @RequirePermissions('products.read') @Get('stock-transfers') async transfers(@Query() q: TransfersQuery) { return this.svc.transfers(await this.svc.house(), q); }
  @RequirePermissions('inventory.manage') @Post('stock-transfers') async createTransfer(@Body() d: CreateTransferDto, @CurrentUser() u: AuthUser) { return this.svc.createTransfer(await this.svc.house(), d, u.id); }
  @RequirePermissions('inventory.manage') @HttpCode(200) @Post('stock-transfers/:id/receive') async receive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.receiveTransfer(await this.svc.house(), id, u.id); }
  @RequirePermissions('inventory.manage') @HttpCode(200) @Post('stock-transfers/:id/cancel') async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.cancelTransfer(await this.svc.house(), id, u.id); }

  @RequirePermissions('orders.read') @Get('orders/shipments/:id/warehouse') shipment(@Param('id', ParseUUIDPipe) id: string) { return this.svc.shipmentStock(id); }
  @RequirePermissions('orders.update') @HttpCode(200) @Post('orders/shipments/:id/warehouse')
  change(@Param('id', ParseUUIDPipe) id: string, @Body() d: ShipmentWarehouseDto, @CurrentUser() u: AuthUser) { return this.svc.changeShipmentWarehouse(id, d.warehouseId, u.id); }
}

/** Global: products, orders, returns and checkout all move stock through it. */
@Global()
@Module({ controllers: [AdminWarehousesController], providers: [WarehousesService], exports: [WarehousesService] })
export class WarehousesModule {}

