import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma, RefundStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { formatMoney } from '../notifications/templates';
import { AuditService } from '../audit/audit.service';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { LedgerService } from '../ledger/ledger.service';
import { deriveOrderStatus } from '../orders/order-status';
import { PaymentsService } from '../payments/payments.service';
import { max, sum } from '../pricing/money-math';
import { PrismaService } from '../prisma/prisma.service';
import { buildRefundEntries, shipmentPaidTotal } from './finance-math';
import { SellerLedgerQuery } from './seller-ledger.query';

const OPEN: RefundStatus[] = ['PENDING', 'PROCESSING', 'SUCCEEDED'];

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly query: SellerLedgerQuery,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** How much can still be refunded on a shipment (paid total minus refunds that are open or done). */
  async refundableForShipment(sellerOrderId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const so = await db.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { id: true, orderId: true, subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true, order: { select: { countryCode: true } } },
    });
    if (!so) throw new NotFoundException('Shipment not found');
    const country = await db.country.findUnique({ where: { code: so.order.countryCode }, select: { pricesIncludeTax: true } });
    const paid = shipmentPaidTotal(so, country?.pricesIncludeTax ?? true);
    const agg = await db.refund.aggregate({ where: { sellerOrderId, status: { in: OPEN } }, _sum: { amountMinor: true } });
    return { so, paid, remaining: max(0n, paid - (agg._sum.amountMinor ?? 0n)) };
  }

  /** Finance creates a (partial) refund by hand, e.g. damaged item kept by the customer. */
  async createManual(input: { orderNumber: string; sellerOrderId: string; amountMinor: bigint; reason: string }, adminId: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber: input.orderNumber }, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found');
    const { so, remaining } = await this.refundableForShipment(input.sellerOrderId);
    if (so.orderId !== order.id) throw new BadRequestException('This shipment does not belong to that order');
    if (input.amountMinor <= 0n || input.amountMinor > remaining) throw new BadRequestException(`Refund must be between 1 and ${remaining} (minor units)`);
    const payment = await this.capturedPayment(order.id);

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id, orderId: order.id, sellerOrderId: so.id, amountMinor: input.amountMinor, reason: input.reason,
        status: 'PENDING', createdById: adminId, idempotencyKey: `manual_${randomUUID()}`,
      },
    });
    await this.audit.log({ actorId: adminId, action: 'refund.create', entityType: 'Refund', entityId: refund.id, after: { amountMinor: input.amountMinor.toString(), reason: input.reason } });
    this.events?.emit(EVENTS.REFUND_REQUESTED, { id: refund.id });
    return refund;
  }

  /** Admin payments ledger view: every payment attempt, newest first. Provider references only, never card data. */
  async listPayments(q: { status?: PaymentStatus; method?: PaymentMethod; cursor?: string }) {
    const rows = await this.prisma.payment.findMany({
      where: { status: q.status, method: q.method, ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: {
        id: true, provider: true, method: true, status: true, amountMinor: true, refundedMinor: true, currencyCode: true, providerRef: true,
        failureReason: true, createdAt: true, order: { select: { orderNumber: true, status: true } },
      },
    });
    return toPage(rows, 25);
  }

  async list(q: { status?: RefundStatus; cursor?: string }) {
    const rows = await this.prisma.refund.findMany({
      where: { status: q.status, ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      include: { order: { select: { orderNumber: true, currencyCode: true } }, payment: { select: { method: true, provider: true } } },
    });
    const page = toPage(rows, 25);
    // who asked for it and who let it through, so the screen can show (and enforce) the four-eyes rule
    const ids = [...new Set(page.items.flatMap((r) => [r.createdById, r.approvedById]).filter((v): v is string => !!v))];
    const people = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u]));
    return { ...page, items: page.items.map((r) => ({ ...r, createdBy: r.createdById ? people.get(r.createdById) ?? null : null, approvedBy: r.approvedById ? people.get(r.approvedById) ?? null : null })) };
  }

  /**
   * Finance approves -> the gateway is asked to send the money back.
   * PENDING -> PROCESSING is an atomic claim, so two admins clicking at once cannot refund twice.
   */
  /** Four-eyes: money only goes out when a second person agrees. A super admin (the owner) may do both. */
  private async assertSecondPerson(refundId: string, admin: { id: string; roles?: string[] }) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, select: { createdById: true } });
    if (!r) throw new NotFoundException('Refund not found');
    if (r.createdById && r.createdById === admin.id && !admin.roles?.includes('SUPER_ADMIN')) {
      throw new ForbiddenException({ message: 'You created this refund. A different person must approve it (four-eyes rule).', reason: 'FOUR_EYES' });
    }
  }

  /**
   * Each staff member may have their own ceiling for a single refund (`User.refundLimitMinor`, set on the Staff page).
   * Above it, someone with a higher limit (or none) approves. Exported rule: see `withinRefundLimit`.
   */
  private async assertWithinLimit(refundId: string, adminId: string) {
    const [r, me] = await Promise.all([
      this.prisma.refund.findUnique({ where: { id: refundId }, select: { amountMinor: true, payment: { select: { currencyCode: true } } } }),
      this.prisma.user.findUnique({ where: { id: adminId }, select: { refundLimitMinor: true } }),
    ]);
    if (!r) throw new NotFoundException('Refund not found');
    if (!withinRefundLimit(r.amountMinor, me?.refundLimitMinor ?? null)) {
      throw new ForbiddenException({
        message: `This refund is above your approval limit (${formatMoney(me!.refundLimitMinor!, r.payment.currencyCode)}). Ask a manager with a higher limit to approve it.`,
        reason: 'REFUND_LIMIT', limitMinor: me!.refundLimitMinor!.toString(),
      });
    }
  }

  async approve(refundId: string, admin: { id: string; roles?: string[] }) {
    await this.assertSecondPerson(refundId, admin);
    await this.assertWithinLimit(refundId, admin.id);
    const adminId = admin.id;
    const claimed = await this.prisma.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'PROCESSING', approvedById: adminId } });
    if (claimed.count !== 1) throw new ConflictException('Refund is not pending (already processed or in progress)');

    const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    let result;
    try {
      result = await this.payments.byCode(refund.payment.provider).refund({
        paymentProviderRef: refund.payment.providerRef, amountMinor: refund.amountMinor, currencyCode: refund.payment.currencyCode,
        idempotencyKey: refund.idempotencyKey, reason: refund.reason,
      });
    } catch (e) {
      this.logger.error(`refund ${refundId} provider error: ${(e as Error).message}`);
      result = { status: 'FAILED' as const, providerRef: null, failureReason: 'Payment provider error' };
    }

    if (result.status === 'SUCCEEDED') return this.complete(refundId, adminId, result.providerRef);
    if (result.status === 'FAILED') {
      await this.prisma.refund.update({ where: { id: refundId }, data: { status: 'FAILED' } });
      await this.audit.log({ actorId: adminId, action: 'refund.failed', entityType: 'Refund', entityId: refundId, after: { reason: result.failureReason ?? null } });
      throw new BadRequestException(`Refund failed: ${result.failureReason ?? 'unknown error'}`);
    }
    // Provider accepted but pays later (or COD: finance sends a bank transfer and then marks it paid)
    await this.audit.log({ actorId: adminId, action: 'refund.processing', entityType: 'Refund', entityId: refundId });
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  /** For refunds paid outside the gateway (COD customers, bank transfer). */
  async markPaid(refundId: string, admin: { id: string; roles?: string[] }, reference: string) {
    await this.assertSecondPerson(refundId, admin);
    await this.assertWithinLimit(refundId, admin.id);
    const adminId = admin.id;
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, select: { status: true } });
    if (!r) throw new NotFoundException('Refund not found');
    if (r.status !== 'PROCESSING') throw new BadRequestException('Only refunds in progress can be marked as paid');
    return this.complete(refundId, adminId, reference);
  }

  async reject(refundId: string, adminId: string, reason: string) {
    const res = await this.prisma.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'FAILED' } });
    if (res.count !== 1) throw new BadRequestException('Only pending refunds can be rejected');
    await this.audit.log({ actorId: adminId, action: 'refund.reject', entityType: 'Refund', entityId: refundId, after: { reason } });
    return { id: refundId, status: 'FAILED' as const };
  }

  /** Money is back with the customer: update payment, ledger, item and shipment statuses — all in one transaction. */
  private async complete(refundId: string, adminId: string, providerRef: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (refund.status === 'SUCCEEDED') return;

      const bumped = await tx.$executeRaw`
        UPDATE "Payment" SET "refundedMinor" = "refundedMinor" + ${refund.amountMinor}, "updatedAt" = now()
        WHERE "id" = ${refund.paymentId}::uuid AND "refundedMinor" + ${refund.amountMinor} <= "amountMinor"`;
      if (bumped !== 1) throw new ConflictException('Refund would exceed the amount paid');
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId }, select: { amountMinor: true, refundedMinor: true, currencyCode: true } });
      await tx.payment.update({ where: { id: refund.paymentId }, data: { status: payment.refundedMinor >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await tx.refund.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', providerRef, completedAt: new Date() } });

      if (refund.idempotencyKey.startsWith('return_')) {
        await tx.returnRequest.updateMany({ where: { id: refund.idempotencyKey.slice('return_'.length) }, data: { status: 'REFUNDED' } });
      }
      if (refund.sellerOrderId) await this.postLedgerAndStatuses(tx, refund.id, refund.sellerOrderId, refund.amountMinor, payment.currencyCode, adminId);
      else {
        // refund of a late payment for a cancelled order: pays back the REFUND_PAYABLE balance
        await this.ledger.post({
          type: 'REFUND', refType: 'Refund', refId: refund.id, idempotencyKey: `refund_${refund.id}`, currencyCode: payment.currencyCode, actorId: adminId,
          entries: [{ type: 'CUSTOMER_CLEARING', amountMinor: refund.amountMinor }, { type: 'REFUND_PAYABLE', amountMinor: -refund.amountMinor }],
        }, tx);
      }
    });
    await this.audit.log({ actorId: adminId, action: 'refund.succeeded', entityType: 'Refund', entityId: refundId, after: { providerRef } });
    this.events?.emit(EVENTS.REFUND_SUCCEEDED, { id: refundId });
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  private async postLedgerAndStatuses(tx: Prisma.TransactionClient, refundId: string, sellerOrderId: string, amount: bigint, currencyCode: string, actorId: string) {
    const so = await tx.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      select: { id: true, orderId: true, sellerId: true, sellerNetMinor: true, commissionMinor: true, taxMinor: true, subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, releasedAt: true, status: true, order: { select: { countryCode: true } } },
    });
    const country = await tx.country.findUnique({ where: { code: so.order.countryCode }, select: { pricesIncludeTax: true } });
    const inclusive = country?.pricesIncludeTax ?? true;

    const captured = await this.query.capturedForSeller(so.orderId, so.sellerId, currencyCode, tx);
    if (captured !== null) {
      const entries = buildRefundEntries({
        refundMinor: amount, sellerId: so.sellerId, sellerNetMinor: so.sellerNetMinor, commissionMinor: so.commissionMinor,
        taxAddedMinor: inclusive ? 0n : so.taxMinor, reimbursementMinor: max(0n, captured - so.sellerNetMinor), released: !!so.releasedAt,
      });
      await this.ledger.post({ type: 'REFUND', refType: 'Refund', refId: refundId, idempotencyKey: `refund_${refundId}`, currencyCode, entries, actorId }, tx);
    }

    // Whole shipment refunded -> shipment REFUNDED, customer order status re-derived
    const done = await tx.refund.findMany({ where: { sellerOrderId, status: 'SUCCEEDED' }, select: { amountMinor: true } });
    if (sum(done.map((d) => d.amountMinor)) >= shipmentPaidTotal(so, inclusive) && so.status !== 'CANCELLED') {
      await tx.sellerOrder.update({ where: { id: so.id }, data: { status: 'REFUNDED' } });
      await tx.orderItem.updateMany({ where: { sellerOrderId: so.id, status: { not: 'CANCELLED' } }, data: { status: 'REFUNDED' } });
      await tx.orderStatusHistory.create({ data: { orderId: so.orderId, sellerOrderId: so.id, fromStatus: so.status, toStatus: 'REFUNDED', actorId, note: 'Fully refunded' } });
    }
    const siblings = await tx.sellerOrder.findMany({ where: { orderId: so.orderId }, select: { status: true } });
    const derived = deriveOrderStatus(siblings.map((s) => s.status));
    await tx.order.update({ where: { id: so.orderId }, data: { status: derived } });
  }

  private async capturedPayment(orderId: string) {
    const p = await this.prisma.payment.findFirst({ where: { orderId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } }, select: { id: true } });
    if (!p) throw new BadRequestException('This order has no captured payment to refund');
    return p;
  }
}

/** A refund may be approved by someone without a limit, or whose limit is at least the amount. Exported for tests. */
export function withinRefundLimit(amountMinor: bigint, limitMinor: bigint | null): boolean {
  return limitMinor === null || amountMinor <= limitMinor;
}
