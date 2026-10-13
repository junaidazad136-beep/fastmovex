import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { RANGE_PRESETS, RangePreset, resolveRange, tzFor } from '../analytics/range';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { FAR_FROM_ADDRESS_M } from '../delivery/delivery-rules';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';

const country = () => process.env.DEFAULT_COUNTRY ?? 'QA';
/** A position older than this is shown as "last seen" (the phone may be off or out of signal). */
export const STALE_AFTER_MIN = 10;
export const FAR_M = FAR_FROM_ADDRESS_M;

class RangeQuery {
  @ApiPropertyOptional({ enum: RANGE_PRESETS, default: '7d' }) @IsOptional() @IsIn(RANGE_PRESETS) range?: RangePreset;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
class MarginQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: ['day', 'product', 'category'], default: 'day' }) @IsOptional() @IsIn(['day', 'product', 'category']) group?: 'day' | 'product' | 'category';
}

const pct = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 10000n) / whole) / 100 : null);
/** Margin % of revenue, 2 decimals; null without revenue. Exported for tests. */
export const marginPct = (revenue: bigint, profit: bigint) => pct(profit, revenue);
/** On-time share of deliveries that had a promised window. Exported for tests. */
export const onTimePct = (onTime: number, withSlot: number) => (withSlot > 0 ? Math.round((onTime / withSlot) * 1000) / 10 : null);

/**
 * Operations insight: where the drivers are right now, how each driver performs, and how much the shop really earns
 * on what it sells (margin at the cost frozen at the sale).
 */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService, private readonly warehouses: WarehousesService) {}

  private range(q: RangeQuery, now = new Date()) {
    return resolveRange(q.range ?? (q.from && q.to ? 'custom' : '7d'), now, country(), { from: q.from, to: q.to });
  }

  // ------------------------------------------------------------------ live map

  async live(now = new Date()) {
    const couriers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { code: 'DELIVERY_AGENT' } } } },
      select: { id: true, fullName: true, phone: true }, orderBy: { fullName: 'asc' },
    });
    const ids = couriers.map((c) => c.id);
    const [jobs, cash, warehouses] = await Promise.all([
      this.prisma.deliveryOrder.findMany({
        where: { courierUserId: { in: ids }, status: { in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED'] } },
        orderBy: [{ sellerOrder: { order: { deliverySlotStart: { sort: 'asc', nulls: 'last' } } } }, { assignedAt: 'asc' }],
        select: {
          id: true, status: true, courierUserId: true, lastLat: true, lastLng: true, lastLocationAt: true, failedAt: true,
          sellerOrder: { select: { order: { select: { orderNumber: true, shippingAddress: true, deliverySlotStart: true, deliverySlotEnd: true } } } },
        },
      }),
      this.prisma.codCollection.groupBy({ by: ['holderUserId'], where: { holderUserId: { in: ids }, handoverId: null }, _sum: { amountMinor: true } }),
      this.prisma.warehouse.findMany({ where: { sellerId: await this.warehouses.house(), isActive: true }, select: { id: true, name: true, city: true } }),
    ]);
    // the newest position any of a driver's jobs received is where the driver is
    const lastSeen = await this.prisma.deliveryOrder.findMany({
      where: { courierUserId: { in: ids }, lastLocationAt: { not: null } },
      orderBy: { lastLocationAt: 'desc' }, distinct: ['courierUserId'],
      select: { courierUserId: true, lastLat: true, lastLng: true, lastLocationAt: true },
    });
    const pos = new Map(lastSeen.map((p) => [p.courierUserId!, p]));
    const cashBy = new Map(cash.map((c) => [c.holderUserId, c._sum.amountMinor ?? 0n]));
    const drivers = couriers.map((c) => {
      const p = pos.get(c.id);
      const mine = jobs.filter((j) => j.courierUserId === c.id);
      return {
        id: c.id, name: c.fullName, phone: c.phone,
        location: p?.lastLat != null && p.lastLng != null && p.lastLocationAt
          ? { lat: p.lastLat, lng: p.lastLng, at: p.lastLocationAt, stale: now.getTime() - p.lastLocationAt.getTime() > STALE_AFTER_MIN * 60_000 }
          : null,
        cashInHandMinor: (cashBy.get(c.id) ?? 0n).toString(),
        onTheRoad: mine.some((j) => j.status === 'OUT_FOR_DELIVERY'),
        jobs: mine.map((j) => {
          const a = (j.sellerOrder.order.shippingAddress ?? {}) as { recipientName?: string; zone?: string; city?: string; lat?: number; lng?: number };
          return {
            id: j.id, status: j.status, orderNumber: j.sellerOrder.order.orderNumber, recipient: a.recipientName ?? null, zone: a.zone ?? null,
            slotStart: j.sellerOrder.order.deliverySlotStart, slotEnd: j.sellerOrder.order.deliverySlotEnd,
            pin: typeof a.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : null,
            late: !!j.sellerOrder.order.deliverySlotEnd && j.sellerOrder.order.deliverySlotEnd < now && j.status !== 'FAILED',
          };
        }),
      };
    });
    const waiting = await this.prisma.deliveryOrder.count({ where: { method: 'FASTMOVEX', courierUserId: null, status: 'CREATED' } });
    return { at: now, drivers, waitingForDriver: waiting, warehouses };
  }

  // ------------------------------------------------------------------ driver performance

  async performance(q: RangeQuery, now = new Date()) {
    const { from, to } = this.range(q, now);
    const rows = await this.prisma.$queryRaw<{
      id: string; name: string; phone: string | null; assigned: number; delivered: number; with_slot: number; on_time: number; avg_min: number | null;
      failed: number; refused: number; far: number; wrong_codes: number; collected: bigint; short: bigint; over: bigint;
    }[]>`
      WITH couriers AS (
        SELECT u.id, u."fullName" AS name, u.phone FROM "User" u
        WHERE EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r.code = 'DELIVERY_AGENT')
      ),
      del AS (
        SELECT d."courierUserId" AS cid,
               count(*) FILTER (WHERE d."assignedAt" >= ${from} AND d."assignedAt" < ${to})::int AS assigned,
               count(*) FILTER (WHERE d.status = 'DELIVERED' AND d."deliveredAt" >= ${from} AND d."deliveredAt" < ${to})::int AS delivered,
               count(*) FILTER (WHERE d.status = 'DELIVERED' AND d."deliveredAt" >= ${from} AND d."deliveredAt" < ${to} AND o."deliverySlotEnd" IS NOT NULL)::int AS with_slot,
               count(*) FILTER (WHERE d.status = 'DELIVERED' AND d."deliveredAt" >= ${from} AND d."deliveredAt" < ${to} AND o."deliverySlotEnd" IS NOT NULL AND d."deliveredAt" <= o."deliverySlotEnd")::int AS on_time,
               avg(EXTRACT(EPOCH FROM (d."deliveredAt" - ofd.at)) / 60) FILTER (WHERE d.status = 'DELIVERED' AND d."deliveredAt" >= ${from} AND d."deliveredAt" < ${to} AND ofd.at IS NOT NULL) AS avg_min,
               count(*) FILTER (WHERE d."failedAt" >= ${from} AND d."failedAt" < ${to} AND d."failureDistanceM" > ${FAR_M})::int AS far,
               coalesce(sum(d.attempts) FILTER (WHERE coalesce(d."deliveredAt", d."failedAt", d."assignedAt") >= ${from} AND coalesce(d."deliveredAt", d."failedAt", d."assignedAt") < ${to}), 0)::int AS wrong_codes
        FROM "DeliveryOrder" d
        JOIN "SellerOrder" so ON so.id = d."sellerOrderId" JOIN "Order" o ON o.id = so."orderId"
        LEFT JOIN LATERAL (SELECT max(e."occurredAt") AS at FROM "DeliveryEvent" e WHERE e."deliveryOrderId" = d.id AND e.status = 'OUT_FOR_DELIVERY') ofd ON true
        WHERE d."courierUserId" IS NOT NULL GROUP BY d."courierUserId"
      ),
      fails AS (
        SELECT d."courierUserId" AS cid, count(*)::int AS failed, count(*) FILTER (WHERE e.note ILIKE '%refused%')::int AS refused
        FROM "DeliveryEvent" e JOIN "DeliveryOrder" d ON d.id = e."deliveryOrderId"
        WHERE e.status = 'FAILED' AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to} GROUP BY d."courierUserId"
      ),
      cash AS (
        SELECT c."holderUserId" AS cid, sum(c."amountMinor")::bigint AS collected FROM "CodCollection" c
        WHERE c."collectedAt" >= ${from} AND c."collectedAt" < ${to} GROUP BY c."holderUserId"
      ),
      hand AS (
        SELECT h."holderUserId" AS cid,
               coalesce(-sum(h."varianceMinor") FILTER (WHERE h."varianceMinor" < 0), 0)::bigint AS short,
               coalesce(sum(h."varianceMinor") FILTER (WHERE h."varianceMinor" > 0), 0)::bigint AS over
        FROM "CashHandover" h WHERE h."createdAt" >= ${from} AND h."createdAt" < ${to} GROUP BY h."holderUserId"
      )
      SELECT c.id, c.name, c.phone,
             coalesce(del.assigned, 0) AS assigned, coalesce(del.delivered, 0) AS delivered, coalesce(del.with_slot, 0) AS with_slot,
             coalesce(del.on_time, 0) AS on_time, del.avg_min::float AS avg_min, coalesce(fails.failed, 0) AS failed, coalesce(fails.refused, 0) AS refused,
             coalesce(del.far, 0) AS far, coalesce(del.wrong_codes, 0) AS wrong_codes,
             coalesce(cash.collected, 0)::bigint AS collected, coalesce(hand.short, 0)::bigint AS short, coalesce(hand.over, 0)::bigint AS over
      FROM couriers c LEFT JOIN del ON del.cid = c.id LEFT JOIN fails ON fails.cid = c.id LEFT JOIN cash ON cash.cid = c.id LEFT JOIN hand ON hand.cid = c.id
      ORDER BY coalesce(del.delivered, 0) DESC, c.name`;
    const c = await this.prisma.country.findUnique({ where: { code: country() }, select: { currencyCode: true } });
    return {
      from, to, currencyCode: c?.currencyCode ?? 'QAR', farMetres: FAR_M,
      drivers: rows.map((r) => {
        const attempts = r.delivered + r.failed;
        return {
          id: r.id, name: r.name, phone: r.phone, assigned: r.assigned, delivered: r.delivered, failed: r.failed, refused: r.refused,
          successPct: attempts ? Math.round((r.delivered / attempts) * 1000) / 10 : null,
          onTimePct: onTimePct(r.on_time, r.with_slot), withSlot: r.with_slot,
          avgMinutes: r.avg_min === null ? null : Math.round(r.avg_min),
          farFromAddress: r.far, wrongCodes: r.wrong_codes,
          cashCollectedMinor: r.collected.toString(), cashShortMinor: r.short.toString(), cashOverMinor: r.over.toString(),
        };
      }),
    };
  }

  // ------------------------------------------------------------------ margin

  async margin(q: MarginQuery, now = new Date()) {
    const { from, to } = this.range(q, now);
    const group = q.group ?? 'day';
    const { offsetMin } = tzFor(country());
    const house = await this.warehouses.house();
    // net revenue of units kept (refunded units taken out), excluding VAT; cost at the price frozen at the sale
    const keyExpr = group === 'day'
      ? `to_char((o."placedAt" + interval '${offsetMin} minutes'), 'YYYY-MM-DD')`
      : group === 'product' ? `p.id::text` : `coalesce(c.id::text, 'none')`;
    const labelExpr = group === 'day' ? keyExpr : group === 'product' ? `min(p.title)` : `coalesce(min(c.name), 'No category')`;
    const rows = await this.prisma.$queryRawUnsafe<{ key: string; label: string; units: number; revenue: bigint; cost: bigint; costed_revenue: bigint; uncosted_units: number; refunded: bigint }[]>(`
      SELECT ${keyExpr} AS key, ${labelExpr} AS label,
             sum(oi.quantity - oi."refundedQty")::int AS units,
             sum(((oi."lineTotalMinor" - oi."taxMinor") * (oi.quantity - oi."refundedQty")) / oi.quantity)::bigint AS revenue,
             coalesce(sum(oi."unitCostMinor" * (oi.quantity - oi."refundedQty")) FILTER (WHERE oi."unitCostMinor" IS NOT NULL), 0)::bigint AS cost,
             coalesce(sum(((oi."lineTotalMinor" - oi."taxMinor") * (oi.quantity - oi."refundedQty")) / oi.quantity) FILTER (WHERE oi."unitCostMinor" IS NOT NULL), 0)::bigint AS costed_revenue,
             coalesce(sum(oi.quantity - oi."refundedQty") FILTER (WHERE oi."unitCostMinor" IS NULL), 0)::int AS uncosted_units,
             sum(((oi."lineTotalMinor" - oi."taxMinor") * oi."refundedQty") / oi.quantity)::bigint AS refunded
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "SellerOrder" so ON so.id = oi."sellerOrderId"
      JOIN "ProductVariant" v ON v.id = oi."variantId" JOIN "Product" p ON p.id = v."productId"
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE o."placedAt" >= $1 AND o."placedAt" < $2 AND o."countryCode" = $3 AND so."sellerId" = $4::uuid
        AND o.status NOT IN ('PENDING', 'CANCELLED') AND oi.status <> 'CANCELLED' AND oi.quantity > 0
      GROUP BY 1 ORDER BY ${group === 'day' ? '1' : 'revenue DESC'} LIMIT 500`, from, to, country(), house);
    const [delivery, commission, cur] = await Promise.all([
      this.prisma.$queryRaw<{ fees: bigint }[]>`
        SELECT coalesce(sum(so."deliveryFeeMinor"), 0)::bigint AS fees FROM "SellerOrder" so JOIN "Order" o ON o.id = so."orderId"
        WHERE o."placedAt" >= ${from} AND o."placedAt" < ${to} AND o."countryCode" = ${country()} AND so."sellerId" = ${house}::uuid AND so.status <> 'CANCELLED' AND o.status <> 'PENDING'`,
      // marketplace sellers: FastMoveX earns the commission, not the sale
      this.prisma.$queryRaw<{ commission: bigint }[]>`
        SELECT coalesce(sum(so."commissionMinor"), 0)::bigint AS commission FROM "SellerOrder" so JOIN "Order" o ON o.id = so."orderId"
        WHERE o."placedAt" >= ${from} AND o."placedAt" < ${to} AND o."countryCode" = ${country()} AND so."sellerId" <> ${house}::uuid AND so.status <> 'CANCELLED' AND o.status <> 'PENDING'`,
      this.prisma.country.findUnique({ where: { code: country() }, select: { currencyCode: true } }),
    ]);
    const tot = rows.reduce((a, r) => ({
      units: a.units + r.units, revenue: a.revenue + r.revenue, cost: a.cost + r.cost, costed: a.costed + r.costed_revenue,
      uncosted: a.uncosted + r.uncosted_units, refunded: a.refunded + r.refunded,
    }), { units: 0, revenue: 0n, cost: 0n, costed: 0n, uncosted: 0, refunded: 0n });
    const missing = await this.prisma.$queryRaw<{ id: string; title: string; sku: string; units: number; revenue: bigint }[]>`
      SELECT p.id, min(p.title) AS title, min(v.sku) AS sku, sum(oi.quantity - oi."refundedQty")::int AS units,
             sum(((oi."lineTotalMinor" - oi."taxMinor") * (oi.quantity - oi."refundedQty")) / oi.quantity)::bigint AS revenue
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" JOIN "SellerOrder" so ON so.id = oi."sellerOrderId"
      JOIN "ProductVariant" v ON v.id = oi."variantId" JOIN "Product" p ON p.id = v."productId"
      WHERE o."placedAt" >= ${from} AND o."placedAt" < ${to} AND o."countryCode" = ${country()} AND so."sellerId" = ${house}::uuid
        AND o.status NOT IN ('PENDING', 'CANCELLED') AND oi.status <> 'CANCELLED' AND oi."unitCostMinor" IS NULL AND oi.quantity > 0
      GROUP BY p.id ORDER BY revenue DESC LIMIT 20`;
    const s = (v: bigint) => v.toString();
    const profit = tot.costed - tot.cost;
    return {
      from, to, group, currencyCode: cur?.currencyCode ?? 'QAR',
      totals: {
        units: tot.units, revenueMinor: s(tot.revenue), costMinor: s(tot.cost), profitMinor: s(profit),
        marginPct: marginPct(tot.costed, profit), refundedMinor: s(tot.refunded),
        uncostedUnits: tot.uncosted, uncostedRevenueMinor: s(tot.revenue - tot.costed),
        deliveryFeesMinor: s(delivery[0]?.fees ?? 0n), marketplaceCommissionMinor: s(commission[0]?.commission ?? 0n),
      },
      rows: rows.map((r) => ({
        key: r.key, label: r.label, units: r.units, revenueMinor: s(r.revenue), costMinor: s(r.cost),
        profitMinor: s(r.costed_revenue - r.cost), marginPct: marginPct(r.costed_revenue, r.costed_revenue - r.cost),
        uncostedUnits: r.uncosted_units, refundedMinor: s(r.refunded),
      })),
      missingCost: missing.map((m) => ({ ...m, revenueMinor: s(m.revenue), revenue: undefined })),
    };
  }

  async marginCsv(q: MarginQuery) {
    const r = await this.margin(q);
    const money = (v: string) => (Number(BigInt(v)) / 100).toFixed(2);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = [r.group === 'day' ? 'Date' : r.group === 'product' ? 'Product' : 'Category', 'Units', `Revenue (${r.currencyCode})`, `Cost (${r.currencyCode})`, `Profit (${r.currencyCode})`, 'Margin %', 'Units without cost', `Refunded (${r.currencyCode})`];
    const lines = r.rows.map((x) => [esc(x.label), x.units, money(x.revenueMinor), money(x.costMinor), money(x.profitMinor), x.marginPct ?? '', x.uncostedUnits, money(x.refundedMinor)].join(','));
    const t = r.totals;
    lines.push(['Total', t.units, money(t.revenueMinor), money(t.costMinor), money(t.profitMinor), t.marginPct ?? '', t.uncostedUnits, money(t.refundedMinor)].join(','));
    return { csv: `﻿${head.join(',')}\n${lines.join('\n')}\n`, name: `fastmovex-margin-${r.group}-${r.from.toISOString().slice(0, 10)}.csv` };
  }
}

@ApiTags('Admin / Insights') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  @RequirePermissions('delivery.read') @Get('deliveries/live') live() { return this.svc.live(); }
  @RequirePermissions('delivery.read') @Get('deliveries/performance') performance(@Query() q: RangeQuery) { return this.svc.performance(q); }
  @RequirePermissions('reports.margin') @Get('reports/margin') margin(@Query() q: MarginQuery) { return this.svc.margin(q); }
  @RequirePermissions('reports.margin') @Get('reports/margin.csv')
  async marginCsv(@Query() q: MarginQuery, @Res() res: Response) {
    const r = await this.svc.marginCsv(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(r.csv);
  }
}

@Module({ controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
