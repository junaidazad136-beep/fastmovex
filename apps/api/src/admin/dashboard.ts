import { Controller, ForbiddenException, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "What needs my attention" counters for the admin home screen.
 * Each counter is included only if the staff member may act on it, so one endpoint serves every role.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser) {
    const can = (p: string) => user.permissions.includes(p);
    const out: Record<string, number> = {};
    const jobs: Promise<void>[] = [];
    const add = (key: string, fn: () => Promise<number>) => jobs.push(fn().then((n) => { out[key] = n; }));

    if (can('orders.read')) {
      add('shipmentsToFulfil', () => this.prisma.sellerOrder.count({ where: { status: { in: ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'] } } }));
      add('ordersAwaitingPayment', () => this.prisma.order.count({ where: { status: 'PENDING' } }));
      add('ordersToday', () => this.prisma.order.count({ where: { placedAt: { gte: startOfTodayUtcForQatar() }, status: { not: 'CANCELLED' } } }));
    }
    if (can('products.read')) {
      jobs.push(this.prisma.$queryRaw<{ low: bigint; out: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE i."onHand" - i.reserved <= i."lowStockThreshold" AND i."onHand" - i.reserved > 0)::bigint AS low,
               COUNT(*) FILTER (WHERE i."onHand" - i.reserved <= 0)::bigint AS out
        FROM "Inventory" i JOIN "ProductVariant" v ON v.id = i."variantId" JOIN "Product" p ON p.id = v."productId"
        WHERE v."isActive" AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'`.then(([r]) => { out.lowStockVariants = Number(r.low); out.outOfStockVariants = Number(r.out); }));
      add('draftProducts', () => this.prisma.product.count({ where: { status: 'DRAFT', deletedAt: null } }));
    }
    if (can('products.moderate')) add('productsPendingReview', () => this.prisma.product.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }));
    if (can('returns.manage')) add('openReturns', () => this.prisma.returnRequest.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }));
    if (can('products.read')) {
      const soon = new Date(Date.now() + 3 * 3_600_000 + 7 * 86_400_000);
      add('lotsExpiringSoon', () => this.prisma.stockLot.count({ where: { quantity: { gt: 0 }, expiresOn: { lte: new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth(), soon.getUTCDate())) } } }));
      add('purchaseOrdersToReceive', () => this.prisma.purchaseOrder.count({ where: { status: { in: ['ORDERED', 'PARTIAL'] } } }));
    }
    if (can('inventory.approve')) add('stockCountsToApprove', () => this.prisma.stockCount.count({ where: { status: 'SUBMITTED' } }));
    if (can('payments.read')) {
      add('cardPaymentsStuck', () => this.prisma.payment.count({ where: { method: { not: 'COD' }, status: { in: ['PENDING', 'AUTHORIZED'] }, createdAt: { lt: new Date(Date.now() - 3_600_000) }, order: { status: { not: 'CANCELLED' } } } }));
    }
    if (can('refunds.approve')) add('refundsToApprove', () => this.prisma.refund.count({ where: { status: 'PENDING' } }));
    if (can('reviews.moderate')) add('reviewsPending', () => this.prisma.review.count({ where: { status: 'PENDING' } }));
    if (can('delivery.read')) add('deliveriesToAssign', () => this.prisma.deliveryOrder.count({ where: { method: 'JOVIA', courierUserId: null, status: 'CREATED' } }));
    if (can('reviews.moderate')) add('questionsPending', () => this.prisma.productQuestion.count({ where: { status: 'PENDING' } }));
    if (can('tickets.read')) {
      add('openTickets', () => this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'PENDING_SELLER'] } } }));
      add('newMessages', () => this.prisma.contactMessage.count({ where: { status: 'NEW' } }));
    }
    // cash on delivery still with a driver/staff member a day after it was taken: chase it
    if (can('cash.read')) add('cashOverdue', async () => (await this.prisma.codCollection.groupBy({ by: ['holderUserId'], where: { handoverId: null, collectedAt: { lt: new Date(Date.now() - 86_400_000) } } })).length);
    if (can('sellers.approve')) add('sellersPending', () => this.prisma.seller.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } } }));
    if (can('users.read')) {
      add('customers', () => this.prisma.user.count({ where: { deletedAt: null, roles: { some: { role: { code: 'CUSTOMER' } } } } }));
      add('newCustomers7d', () => this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, roles: { some: { role: { code: 'CUSTOMER' } } } } }));
    }
    await Promise.all(jobs);
    return out;
  }
}

/** Midnight in Doha (UTC+3, no daylight saving) expressed in UTC. */
export function startOfTodayUtcForQatar(now = new Date()): Date {
  const doha = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(doha.getUTCFullYear(), doha.getUTCMonth(), doha.getUTCDate()) - 3 * 3_600_000);
}

@ApiTags('Admin / Dashboard')
@ApiBearerAuth()
@Controller({ path: 'admin/dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() u: AuthUser) {
    if (!u.permissions.length) throw new ForbiddenException('Staff only');
    return this.svc.summary(u);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
