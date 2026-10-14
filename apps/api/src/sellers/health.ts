import { BadRequestException, Body, Controller, Get, Injectable, Optional, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { StorefrontService } from '../common/storefront.service';
import { PrismaService } from '../prisma/prisma.service';
import { isAway, MAX_AWAY_DAYS } from '../stores/away';

/**
 * Account Health: how well a store treats its customers, the way marketplaces judge sellers. Each measure has a target;
 * a store that misses targets is warned first (at risk), then reviewed by FastMoveX (poor). Small numbers are not judged:
 * a measure needs enough orders, reviews or questions before it counts.
 */

export type HealthState = 'good' | 'warn' | 'bad' | 'none';
export interface HealthMetric {
  key: 'cancellations' | 'lateDispatch' | 'returns' | 'rating' | 'questions';
  /** the measure: a share (0–1) or, for rating, the average stars */
  value: number | null;
  /** how many of how many (cancelled of orders, late of shipped …) */
  count: number;
  of: number;
  /** good up to `target`, a warning up to `limit`, bad beyond (for rating and questions: the other way round) */
  target: number;
  limit: number;
  days: number;
  state: HealthState;
}

const MIN_SAMPLE = { cancellations: 10, lateDispatch: 10, returns: 10, rating: 5, questions: 5 } as const;

/** Judges one measure. `higherIsBetter`: rating and answered questions. Exported for tests. */
export function judge(value: number | null, of: number, min: number, target: number, limit: number, higherIsBetter = false): HealthState {
  if (value === null || of < min) return 'none';
  if (higherIsBetter) return value >= target ? 'good' : value >= limit ? 'warn' : 'bad';
  return value <= target ? 'good' : value <= limit ? 'warn' : 'bad';
}

export function overall(metrics: HealthMetric[]): 'good' | 'risk' | 'poor' {
  if (metrics.some((m) => m.state === 'bad')) return 'poor';
  if (metrics.some((m) => m.state === 'warn')) return 'risk';
  return 'good';
}

const ratio = (n: number, of: number) => (of > 0 ? n / of : null);

class AwayDto {
  @ApiPropertyOptional({ description: 'Back on this date (closed until then). null = open again now.', nullable: true })
  @IsOptional() @Type(() => Date) @IsDate() until?: Date | null;
  @ApiPropertyOptional({ description: 'Shown to customers, e.g. "Back on 20 October"' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(200) message?: string;
}

@Injectable()
export class SellerHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly storefront?: StorefrontService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async health(sellerId: string) {
    const seller = await this.prisma.seller.findUniqueOrThrow({ where: { id: sellerId }, select: { ownerUserId: true } });
    const n = (rows: { n: bigint | number | null }[]) => Number(rows[0]?.n ?? 0);

    // 1) orders the store cancelled itself (not the customer, not a failed payment), last 30 days
    const [orders, cancelled] = await Promise.all([
      this.prisma.sellerOrder.count({ where: { sellerId, createdAt: { gte: daysAgo(30) }, status: { not: 'PENDING' } } }),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(DISTINCT so."id") AS n FROM "SellerOrder" so
        JOIN "OrderStatusHistory" h ON h."sellerOrderId" = so."id" AND h."toStatus" = 'CANCELLED' AND h."actorId" = ${seller.ownerUserId}::uuid
        WHERE so."sellerId" = ${sellerId}::uuid AND so."createdAt" >= now() - interval '30 days'`,
    ]);

    // 2) packed and ready for the driver more than 24 hours after the order, last 30 days
    const late = await this.prisma.$queryRaw<{ n: bigint; late: bigint }[]>`
      SELECT count(*) AS n, count(*) FILTER (WHERE x."readyAt" - x."createdAt" > interval '24 hours') AS late FROM (
        SELECT so."id", so."createdAt", min(h."createdAt") AS "readyAt" FROM "SellerOrder" so
        JOIN "OrderStatusHistory" h ON h."sellerOrderId" = so."id" AND h."toStatus" = 'READY_FOR_PICKUP'
        WHERE so."sellerId" = ${sellerId}::uuid AND h."createdAt" >= now() - interval '30 days'
        GROUP BY so."id", so."createdAt") x`;

    // 3) items returned out of items delivered, last 30 days
    const [delivered, returned] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint | null }[]>`
        SELECT coalesce(sum(oi."quantity"), 0) AS n FROM "OrderItem" oi JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
        WHERE so."sellerId" = ${sellerId}::uuid AND so."deliveredAt" >= now() - interval '30 days'`,
      this.prisma.$queryRaw<{ n: bigint | null }[]>`
        SELECT coalesce(sum(r."quantity"), 0) AS n FROM "ReturnRequest" r JOIN "OrderItem" oi ON oi."id" = r."orderItemId"
        JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
        WHERE so."sellerId" = ${sellerId}::uuid AND r."createdAt" >= now() - interval '30 days'`,
    ]);

    // 4) published reviews of the store and its products, last 90 days
    const reviews = await this.prisma.review.aggregate({
      where: { status: 'APPROVED', createdAt: { gte: daysAgo(90) }, OR: [{ sellerId }, { product: { store: { sellerId } } }] },
      _avg: { rating: true }, _count: { _all: true },
    });

    // 5) customers' questions answered within 48 hours (asked 2–32 days ago, so each had its full 48 hours)
    const q = await this.prisma.$queryRaw<{ n: bigint; ok: bigint }[]>`
      SELECT count(*) AS n, count(*) FILTER (WHERE q."answeredAt" IS NOT NULL AND q."answeredAt" - q."createdAt" <= interval '48 hours') AS ok
      FROM "ProductQuestion" q JOIN "Product" p ON p."id" = q."productId" JOIN "Store" s ON s."id" = p."storeId"
      WHERE s."sellerId" = ${sellerId}::uuid AND q."status" <> 'REJECTED'
        AND q."createdAt" BETWEEN now() - interval '32 days' AND now() - interval '48 hours'`;

    const c = { n: n(cancelled), of: orders };
    const l = { n: Number(late[0]?.late ?? 0), of: Number(late[0]?.n ?? 0) };
    const r = { n: n(returned), of: n(delivered) };
    const qa = { n: Number(q[0]?.ok ?? 0), of: Number(q[0]?.n ?? 0) };
    const avg = reviews._avg.rating === null ? null : Math.round(reviews._avg.rating * 10) / 10;

    const metrics: HealthMetric[] = [
      { key: 'cancellations', value: ratio(c.n, c.of), count: c.n, of: c.of, target: 0.025, limit: 0.05, days: 30, state: judge(ratio(c.n, c.of), c.of, MIN_SAMPLE.cancellations, 0.025, 0.05) },
      { key: 'lateDispatch', value: ratio(l.n, l.of), count: l.n, of: l.of, target: 0.04, limit: 0.1, days: 30, state: judge(ratio(l.n, l.of), l.of, MIN_SAMPLE.lateDispatch, 0.04, 0.1) },
      { key: 'returns', value: ratio(r.n, r.of), count: r.n, of: r.of, target: 0.08, limit: 0.15, days: 30, state: judge(ratio(r.n, r.of), r.of, MIN_SAMPLE.returns, 0.08, 0.15) },
      { key: 'rating', value: avg, count: reviews._count._all, of: reviews._count._all, target: 4, limit: 3.5, days: 90, state: judge(avg, reviews._count._all, MIN_SAMPLE.rating, 4, 3.5, true) },
      { key: 'questions', value: ratio(qa.n, qa.of), count: qa.n, of: qa.of, target: 0.9, limit: 0.7, days: 30, state: judge(ratio(qa.n, qa.of), qa.of, MIN_SAMPLE.questions, 0.9, 0.7, true) },
    ];
    return { status: overall(metrics), metrics, at: new Date().toISOString() };
  }

  async away(seller: SellerContext, dto: AwayDto, actorId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { sellerId: seller.id }, select: { id: true, slug: true } });
    const until = dto.until ?? null;
    if (until) {
      if (until.getTime() <= Date.now()) throw new BadRequestException('Choose a date in the future');
      if (until.getTime() > Date.now() + MAX_AWAY_DAYS * 86_400_000) throw new BadRequestException(`At most ${MAX_AWAY_DAYS} days at a time`);
    }
    const s = await this.prisma.store.update({
      where: { id: store.id },
      data: { awayUntil: until, awayMessage: until ? dto.message || null : null },
      select: { awayUntil: true, awayMessage: true },
    });
    await this.audit.log({ actorId, action: until ? 'store.away_on' : 'store.away_off', entityType: 'Store', entityId: store.id, after: { until: until?.toISOString() ?? null } });
    // lists, the store page and every product page show (or stop showing) the holiday at once
    this.storefront?.refresh(`store:${store.slug}`, 'home', 'search', 'offers');
    const products = await this.prisma.product.findMany({ where: { storeId: store.id, deletedAt: null, status: 'ACTIVE' }, select: { slug: true }, take: 2000 });
    for (const { slug } of products) await this.cache?.del(`product:v1:${slug}`);
    for (let i = 0; i < products.length; i += 20) this.storefront?.refresh(...products.slice(i, i + 20).map((p) => `product:${p.slug}`));
    return { awayUntil: isAway(s.awayUntil) ? s.awayUntil : null, awayMessage: s.awayMessage };
  }

  async awayState(sellerId: string) {
    const s = await this.prisma.store.findUniqueOrThrow({ where: { sellerId }, select: { awayUntil: true, awayMessage: true } });
    return { awayUntil: isAway(s.awayUntil) ? s.awayUntil : null, awayMessage: isAway(s.awayUntil) ? s.awayMessage : null };
  }
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

@ApiTags('Seller / Account health')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@Controller({ path: 'seller', version: '1' })
export class SellerHealthController {
  constructor(private readonly svc: SellerHealthService) {}

  @Get('health') health(@CurrentSeller() s: SellerContext) { return this.svc.health(s.id); }

  @Get('away') away(@CurrentSeller() s: SellerContext) { return this.svc.awayState(s.id); }

  /** Vacation mode on (until a date) or off (`until: null`). */
  @Put('away') setAway(@CurrentSeller() s: SellerContext, @Body() dto: AwayDto, @CurrentUser() u: AuthUser) { return this.svc.away(s, dto, u.id); }
}

@ApiTags('Admin / Sellers')
@ApiBearerAuth()
@Controller({ path: 'admin/sellers', version: '1' })
export class AdminSellerHealthController {
  constructor(private readonly svc: SellerHealthService) {}

  @RequirePermissions('sellers.read') @Get(':id/health')
  health(@Param('id', ParseUUIDPipe) id: string) { return this.svc.health(id); }
}
