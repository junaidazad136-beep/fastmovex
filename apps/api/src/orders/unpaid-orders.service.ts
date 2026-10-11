import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Online payments that neither succeed nor fail (customer closed the 3-D Secure page) are cancelled after this. */
export const UNPAID_ORDER_TTL_MS = 30 * 60_000;

/**
 * Cleans up orders whose online payment failed or never completed, so stock, deal quotas and coupon uses
 * are not locked forever. The items go back into the customer's cart so they can simply try again.
 * The PENDING -> CANCELLED switch is a conditional update: a late webhook and the expiry job can never
 * both act on the same order.
 */
@Injectable()
export class UnpaidOrdersService {
  private readonly logger = new Logger(UnpaidOrdersService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async abandon(orderId: string, reason: string, restoreCart = true): Promise<boolean> {
    const done = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (claimed.count !== 1) return false;

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          userId: true, countryCode: true, currencyCode: true, couponId: true, coupon: { select: { code: true } }, user: { select: { isGuest: true } },
          items: { select: { id: true, variantId: true, quantity: true, unitPriceMinor: true, campaignId: true } },
        },
      });
      for (const item of order.items) {
        await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = GREATEST("reserved" - ${item.quantity}, 0), "version" = "version" + 1, "updatedAt" = now() WHERE "variantId" = ${item.variantId}::uuid`;
        await tx.inventoryMovement.create({ data: { variantId: item.variantId, qtyDelta: 0, reason: 'RELEASE', refType: 'order_item', refId: item.id, note: `Released ${item.quantity}: ${reason}` } });
        if (item.campaignId) {
          await tx.$executeRaw`UPDATE "CampaignProduct" SET "soldCount" = GREATEST("soldCount" - ${item.quantity}, 0) WHERE "campaignId" = ${item.campaignId}::uuid AND "variantId" = ${item.variantId}::uuid`;
        }
      }
      if (order.couponId) {
        const removed = await tx.couponRedemption.deleteMany({ where: { couponId: order.couponId, orderId } });
        if (removed.count) await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${order.couponId}::uuid`;
      }
      const now = new Date();
      await tx.sellerOrder.updateMany({ where: { orderId }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason } });
      await tx.orderItem.updateMany({ where: { orderId }, data: { status: 'CANCELLED' } });
      await tx.payment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await tx.orderStatusHistory.create({ data: { orderId, fromStatus: 'PENDING', toStatus: 'CANCELLED', note: reason } });

      // A guest has no account cart to come back to: guest checkout puts the items back in the browser's cart itself.
      if (restoreCart && !order.user.isGuest) await this.restoreCart(tx, order);
      return true;
    });
    if (done) await this.audit.log({ action: 'order.abandoned', entityType: 'Order', entityId: orderId, after: { reason } });
    return done;
  }

  private async restoreCart(
    tx: Prisma.TransactionClient,
    order: { userId: string; countryCode: string; currencyCode: string; coupon: { code: string } | null; items: { variantId: string; quantity: number; unitPriceMinor: bigint }[] },
  ) {
    const cart = await tx.cart.upsert({
      where: { userId_countryCode: { userId: order.userId, countryCode: order.countryCode } },
      update: {},
      create: { userId: order.userId, countryCode: order.countryCode, currencyCode: order.currencyCode },
    });
    for (const i of order.items) {
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: i.variantId } },
        update: {},
        create: { cartId: cart.id, variantId: i.variantId, quantity: i.quantity, priceSnapshotMinor: i.unitPriceMinor },
      });
    }
    if (order.coupon && !cart.couponCode) await tx.cart.update({ where: { id: cart.id }, data: { couponCode: order.coupon.code } });
  }

  /** Runs every 5 minutes on every instance; the conditional update makes concurrent runs harmless. */
  private reconciler?: (orderId: string) => Promise<boolean>;

  /** PaymentsService registers a check with the gateway (set here to avoid a circular dependency). */
  setReconciler(fn: (orderId: string) => Promise<boolean>) {
    this.reconciler = fn;
  }

  @Interval(5 * 60_000)
  async expireStale(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let expired = 0;
    try {
      const stale = await this.prisma.order.findMany({
        where: { status: 'PENDING', placedAt: { lt: new Date(now.getTime() - UNPAID_ORDER_TTL_MS) }, payments: { some: { method: { not: 'COD' }, status: { in: ['PENDING', 'FAILED'] } } } },
        select: { id: true },
        take: 200,
      });
      for (const o of stale) {
        if (this.reconciler && (await this.reconciler(o.id))) continue; // paid after all (webhook lost or late)
        if (await this.abandon(o.id, 'Payment was not completed in time')) expired++;
      }
    } catch (e) {
      this.logger.error(`expiry run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return expired;
  }
}
