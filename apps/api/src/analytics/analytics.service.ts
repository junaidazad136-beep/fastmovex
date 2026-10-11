import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { CountryInfo } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRange, RangePreset, tzFor } from './range';

const { sql } = Prisma;
/** Orders that count as sales: placed and not cancelled / not still awaiting payment. */
const SOLD = sql`o."status" NOT IN ('PENDING', 'CANCELLED')`;

export interface RangeInput { range: RangePreset; from?: string; to?: string }
export type TopKind = 'products' | 'sellers' | 'categories' | 'customers';

const s = (v: bigint | number | string | null | undefined) => (v === null || v === undefined ? '0' : v.toString());
const ratioBps = (num: bigint, den: bigint) => (den > 0n ? Number((num * 10_000n) / den) : 0); // 1234 = 12.34%

/**
 * Admin and seller analytics. Revenue/commission come from the LEDGER (what FastMoveX actually earned, net of
 * refunds); GMV/orders come from orders. Everything is computed in the market's time zone and cached 5 min.
 * Pass sellerId to scope every number to one seller.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private key(kind: string, country: CountryInfo, r: RangeInput, sellerId?: string, extra = '') {
    return `analytics:${kind}:${country.code}:${sellerId ?? 'all'}:${r.range}:${r.from ?? ''}:${r.to ?? ''}:${extra}`;
  }

  overview(country: CountryInfo, r: RangeInput, sellerId?: string, now = new Date()) {
    return sellerId ? this.sellerOverviewCached(country, r, sellerId, now) : this.platformOverview(country, r, now);
  }

  sellerOverviewCached(country: CountryInfo, r: RangeInput, sellerId: string, now = new Date()) {
    const { from, to } = resolveRange(r.range, now, country.code, r);
    return this.cache.wrap(this.key('overview', country, r, sellerId), 300, () => this.sellerOverview(country, from, to, sellerId));
  }

  async platformOverview(country: CountryInfo, r: RangeInput, now = new Date()) {
    const { from, to } = resolveRange(r.range, now, country.code, r);
    return this.cache.wrap(this.key('overview', country, r), 300, async () => {

      const [[orders], [revenue], [refunds], [carts], customers, sellers, products, pendingSellers, pendingProducts, pendingPayouts] = await Promise.all([
        this.prisma.$queryRaw<[{ n: number; gmv: bigint | null; buyers: number }]>(sql`
          SELECT count(*)::int AS n, sum(o."totalMinor")::bigint AS gmv, count(DISTINCT o."userId")::int AS buyers
          FROM "Order" o WHERE o."countryCode" = ${country.code} AND o."placedAt" >= ${from} AND o."placedAt" < ${to} AND ${SOLD}`),
        this.prisma.$queryRaw<[{ commission: bigint | null }]>(sql`
          SELECT sum(e."amountMinor")::bigint AS commission FROM "LedgerEntry" e
          JOIN "LedgerAccount" a ON a."id" = e."accountId"
          WHERE a."type" = 'PLATFORM_REVENUE' AND a."currencyCode" = ${country.currencyCode} AND e."createdAt" >= ${from} AND e."createdAt" < ${to}`),
        this.prisma.$queryRaw<[{ n: number; amount: bigint | null }]>(sql`
          SELECT count(*)::int AS n, sum(r."amountMinor")::bigint AS amount FROM "Refund" r JOIN "Order" o ON o."id" = r."orderId"
          WHERE o."countryCode" = ${country.code} AND r."status" = 'SUCCEEDED' AND r."completedAt" >= ${from} AND r."completedAt" < ${to}`),
        this.prisma.$queryRaw<[{ n: number }]>(sql`
          SELECT count(*)::int AS n FROM "Cart" c WHERE c."countryCode" = ${country.code} AND c."createdAt" >= ${from} AND c."createdAt" < ${to}`),
        this.prisma.user.count({ where: { countryCode: country.code, createdAt: { gte: from, lt: to }, roles: { some: { role: { code: 'CUSTOMER' } } } } }),
        this.prisma.seller.count({ where: { countryCode: country.code, status: 'APPROVED' } }),
        this.prisma.product.count({ where: { countryCode: country.code, status: 'ACTIVE', deletedAt: null } }),
        this.prisma.seller.count({ where: { countryCode: country.code, status: 'UNDER_REVIEW' } }),
        this.prisma.product.count({ where: { countryCode: country.code, status: 'PENDING_REVIEW', deletedAt: null } }),
        this.prisma.sellerPayout.aggregate({ where: { currencyCode: country.currencyCode, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } }, _count: true, _sum: { amountMinor: true } }),
      ]);
      const gmv = orders.gmv ?? 0n;
      return {
        currencyCode: country.currencyCode, from, to,
        orders: orders.n,
        gmvMinor: s(gmv),
        averageOrderValueMinor: s(orders.n ? gmv / BigInt(orders.n) : 0n),
        commissionRevenueMinor: s(revenue.commission), // FastMoveX's earnings, net of refunded commission
        refunds: { count: refunds.n, amountMinor: s(refunds.amount), rateBps: ratioBps(refunds.amount ?? 0n, gmv) },
        buyers: orders.buyers,
        newCustomers: customers,
        cartToOrderRateBps: carts.n ? Math.round((orders.n * 10_000) / carts.n) : 0, // no page-view tracking yet, so this is cart -> order
        activeSellers: sellers,
        activeProducts: products,
        pendingApprovals: { sellers: pendingSellers, products: pendingProducts },
        pendingPayouts: { count: pendingPayouts._count, amountMinor: s(pendingPayouts._sum.amountMinor) },
      };
    });
  }

  private async sellerOverview(country: CountryInfo, from: Date, to: Date, sellerId: string) {
    const [[row]] = await Promise.all([
      this.prisma.$queryRaw<[{ n: number; gmv: bigint | null; commission: bigint | null; net: bigint | null; units: bigint | null; cancelled: number }]>(sql`
        SELECT count(*) FILTER (WHERE so."status" <> 'CANCELLED')::int AS n,
               (sum(so."subtotalMinor" - so."discountMinor" + so."deliveryFeeMinor") FILTER (WHERE so."status" <> 'CANCELLED'))::bigint AS gmv,
               (sum(so."commissionMinor") FILTER (WHERE so."status" <> 'CANCELLED'))::bigint AS commission,
               (sum(so."sellerNetMinor") FILTER (WHERE so."status" <> 'CANCELLED'))::bigint AS net,
               (SELECT sum(oi."quantity")::bigint FROM "OrderItem" oi JOIN "SellerOrder" s2 ON s2."id" = oi."sellerOrderId"
                  JOIN "Order" o2 ON o2."id" = s2."orderId"
                  WHERE s2."sellerId" = ${sellerId}::uuid AND s2."status" <> 'CANCELLED' AND o2."placedAt" >= ${from} AND o2."placedAt" < ${to}) AS units,
               count(*) FILTER (WHERE so."status" = 'CANCELLED')::int AS cancelled
        FROM "SellerOrder" so JOIN "Order" o ON o."id" = so."orderId"
        WHERE so."sellerId" = ${sellerId}::uuid AND o."placedAt" >= ${from} AND o."placedAt" < ${to} AND o."status" <> 'PENDING'`),
    ]);
    const gmv = row.gmv ?? 0n;
    return {
      currencyCode: country.currencyCode, from, to,
      orders: row.n,
      unitsSold: Number(row.units ?? 0n),
      gmvMinor: s(gmv),
      averageOrderValueMinor: s(row.n ? gmv / BigInt(row.n) : 0n),
      commissionMinor: s(row.commission),
      netEarningsMinor: s(row.net),
      cancelledOrders: row.cancelled,
      cancellationRateBps: row.n + row.cancelled ? Math.round((row.cancelled * 10_000) / (row.n + row.cancelled)) : 0,
    };
  }

  /** Sales per hour/day/week/month with empty periods filled in (charts never have gaps). */
  async timeseries(country: CountryInfo, r: RangeInput, sellerId?: string, now = new Date()) {
    const { from, to, bucket } = resolveRange(r.range, now, country.code, r);
    const { tz } = tzFor(country.code);
    return this.cache.wrap(this.key('ts', country, r, sellerId), 300, async () => {
      const amount = sellerId ? sql`so."subtotalMinor" - so."discountMinor" + so."deliveryFeeMinor"` : sql`o."totalMinor"`;
      const join = sellerId
        ? sql`LEFT JOIN "SellerOrder" so ON so."orderId" = o."id" AND so."sellerId" = ${sellerId}::uuid AND so."status" <> 'CANCELLED'`
        : sql``;
      const scope = sellerId ? sql`AND so."id" IS NOT NULL` : sql``;
      const rows = await this.prisma.$queryRaw<{ t: string; orders: number; gmv: bigint | null }[]>(sql`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc(${bucket}, (${from}::timestamptz) AT TIME ZONE ${tz}),
            date_trunc(${bucket}, (${to}::timestamptz - interval '1 millisecond') AT TIME ZONE ${tz}),
            (${'1 ' + bucket})::interval) AS t
        ), sales AS (
          SELECT date_trunc(${bucket}, (o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS t, o."id", ${amount} AS amount
          FROM "Order" o ${join}
          WHERE o."countryCode" = ${country.code} AND o."placedAt" >= ${from} AND o."placedAt" < ${to} AND ${SOLD} ${scope}
        )
        SELECT to_char(b.t, 'YYYY-MM-DD"T"HH24:MI:SS') AS t, count(s."id")::int AS orders, sum(s.amount)::bigint AS gmv
        FROM buckets b LEFT JOIN sales s ON s.t = b.t
        GROUP BY b.t ORDER BY b.t`);
      // t = start of the period in the market's local time (see `timezone`), e.g. "2026-09-28T00:00:00"
      return { bucket, timezone: tz, currencyCode: country.currencyCode, points: rows.map((p) => ({ t: p.t, orders: p.orders, gmvMinor: s(p.gmv) })) };
    });
  }

  async top(country: CountryInfo, r: RangeInput, kind: TopKind, limit = 10, sellerId?: string, now = new Date()) {
    const { from, to } = resolveRange(r.range, now, country.code, r);
    return this.cache.wrap(this.key('top', country, r, sellerId, `${kind}:${limit}`), 300, async () => {
      const joins = sql`
        FROM "OrderItem" oi
        JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
        JOIN "Order" o ON o."id" = oi."orderId"`;
      const where = sql`
        WHERE o."countryCode" = ${country.code} AND o."placedAt" >= ${from} AND o."placedAt" < ${to} AND ${SOLD}
          AND so."status" <> 'CANCELLED' ${sellerId ? sql`AND so."sellerId" = ${sellerId}::uuid` : sql``}`;
      const cols = sql`sum(oi."quantity")::int AS units, sum(oi."lineTotalMinor")::bigint AS gmv, count(DISTINCT o."id")::int AS orders`;
      const pick: Record<TopKind, Prisma.Sql> = {
        products: sql`SELECT v."productId"::text AS id, min(oi."productTitle") AS name, ${cols}
          ${joins} JOIN "ProductVariant" v ON v."id" = oi."variantId" ${where}
          GROUP BY v."productId" ORDER BY gmv DESC LIMIT ${limit}`,
        sellers: sql`SELECT so."sellerId"::text AS id, min(st."name") AS name, ${cols}
          ${joins} JOIN "Store" st ON st."sellerId" = so."sellerId" ${where}
          GROUP BY so."sellerId" ORDER BY gmv DESC LIMIT ${limit}`,
        categories: sql`SELECT c."id"::text AS id, min(c."name") AS name, ${cols}
          ${joins} JOIN "ProductVariant" v ON v."id" = oi."variantId" JOIN "Product" p ON p."id" = v."productId" JOIN "Category" c ON c."id" = p."categoryId" ${where}
          GROUP BY c."id" ORDER BY gmv DESC LIMIT ${limit}`,
        customers: sql`SELECT o."userId"::text AS id, min(u."fullName") AS name, ${cols}
          ${joins} JOIN "User" u ON u."id" = o."userId" ${where}
          GROUP BY o."userId" ORDER BY gmv DESC LIMIT ${limit}`,
      };
      if (sellerId && (kind === 'sellers' || kind === 'customers')) return { kind, items: [] }; // sellers don't rank other sellers or see customer spend
      const rows = await this.prisma.$queryRaw<{ id: string; name: string; units: number; gmv: bigint | null; orders: number }[]>(pick[kind]);
      return { kind, currencyCode: country.currencyCode, items: rows.map((x) => ({ ...x, gmvMinor: s(x.gmv), gmv: undefined })) };
    });
  }

  /** Order rows for export (capped). */
  async orderRows(country: CountryInfo, r: RangeInput, now = new Date(), cap = 50_000) {
    const { from, to } = resolveRange(r.range, now, country.code, r);
    return this.prisma.order.findMany({
      where: { countryCode: country.code, placedAt: { gte: from, lt: to } },
      orderBy: { placedAt: 'asc' },
      take: cap,
      select: {
        orderNumber: true, placedAt: true, status: true, currencyCode: true, subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true, totalMinor: true,
        user: { select: { fullName: true } }, _count: { select: { items: true } }, payments: { select: { method: true, status: true }, take: 1 },
      },
    });
  }
}
