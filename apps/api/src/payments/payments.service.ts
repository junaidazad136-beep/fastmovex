import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrderLedgerService } from '../ledger/order-ledger.service';
import { UnpaidOrdersService } from '../orders/unpaid-orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentIntentInput, PaymentProvider, WebhookEventData } from './payment-provider';
import { CodProvider } from './providers/cod.provider';
import { DibsyProvider } from './providers/dibsy.provider';
import { TestPaymentProvider } from './providers/test.provider';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers: PaymentProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orderLedger: OrderLedgerService,
    private readonly ledger: LedgerService,
    private readonly unpaid: UnpaidOrdersService,
    cod: CodProvider,
    test: TestPaymentProvider,
    @Optional() dibsy?: DibsyProvider,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    // The first provider that supports a method takes it. The sandbox never exists in production.
    const real = [dibsy].filter((p): p is DibsyProvider => !!p?.enabled);
    // With a real gateway configured the sandbox is not offered at all (no duplicate "Apple Pay" options that bypass it).
    this.providers = process.env.NODE_ENV === 'production' || real.length ? [cod, ...real] : [cod, test];
    // Before an unpaid card order is expired, ask the gateway once more (a lost webhook must not cancel a paid order).
    this.unpaid.setReconciler?.((orderId) => this.reconcileOrder(orderId));
  }

  /**
   * Where the gateway may send the customer back: only our own website (STOREFRONT_URL or a CORS origin), never an
   * address chosen by whoever calls the API. Hosted-page gateways (Dibsy) need one.
   */
  assertReturnUrl(method: PaymentMethod, url: string | undefined) {
    if (method === 'COD') return;
    if (!url) {
      if (this.providerFor(method).code === 'dibsy') throw new BadRequestException('returnUrl is required for card payments');
      return;
    }
    let u: URL;
    try { u = new URL(url); } catch { throw new BadRequestException('returnUrl is not a valid address'); }
    const allowed = new Set(
      [...(process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','), process.env.STOREFRONT_URL ?? '']
        .map((o) => o.trim()).filter(Boolean)
        .map((o) => { try { return new URL(o).origin; } catch { return ''; } }),
    );
    if (!allowed.has(u.origin) || u.username || u.password) throw new BadRequestException('returnUrl must be an address on the FastMoveX website');
    if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') throw new BadRequestException('returnUrl must use https');
  }

  /** The gateway that takes card payments right now (the website words the card option after it). */
  cardProvider(): string | null {
    return this.providers.find((x) => x.supports('CARD'))?.code ?? null;
  }

  /** Whether a method can actually be paid with right now (a provider is configured for it). */
  isAvailable(method: PaymentMethod): boolean {
    return this.providers.some((x) => x.supports(method));
  }

  providerFor(method: PaymentMethod): PaymentProvider {
    const p = this.providers.find((x) => x.supports(method));
    if (!p) throw new BadRequestException(`No payment provider available for ${method}`);
    return p;
  }

  byCode(code: string): PaymentProvider {
    const p = this.providers.find((x) => x.code === code);
    if (!p) throw new NotFoundException('Unknown payment provider');
    return p;
  }

  /** Called right after the order is created. Updates the Payment row with whatever the provider said. */
  async start(paymentId: string, method: PaymentMethod, input: PaymentIntentInput) {
    const provider = this.providerFor(method);
    let result;
    try {
      result = await provider.createPayment(input);
    } catch (err) {
      this.logger.error(`payment ${paymentId} failed at ${provider.code}: ${(err as Error).message}`);
      result = { status: 'FAILED' as const, providerRef: null, failureReason: 'Payment could not be started' };
    }
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: result.status, providerRef: result.providerRef, failureReason: result.failureReason ?? null },
    });
    return result;
  }

  /**
   * Webhooks are the source of truth for card payments. Replays are ignored via the
   * (provider, eventId) unique key, so a gateway retry can never double-capture an order.
   */
  async handleWebhook(providerCode: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const provider = this.byCode(providerCode);
    const event = await provider.parseWebhook(headers, rawBody);
    let payload: unknown = event.payload;
    if (payload === undefined) {
      try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = { raw: rawBody.toString('utf8').slice(0, 2000) }; }
    }
    return this.apply(providerCode, event, payload);
  }

  /**
   * Asks the gateway for the state of an order's open card payment and applies it like a webhook.
   * Used when the customer comes back from the payment page and before an unpaid order expires.
   * Returns true when the payment is (now) paid.
   */
  async reconcileOrder(orderId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, method: { not: 'COD' }, providerRef: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { provider: true, providerRef: true, status: true },
    });
    if (!payment?.providerRef) return false;
    if (payment.status === 'CAPTURED' || payment.status === 'AUTHORIZED') return true;
    const provider = this.providers.find((p) => p.code === payment.provider);
    if (!provider?.retrieve) return false;
    try {
      const event = await provider.retrieve(payment.providerRef);
      if (!event || !event.status || event.status === 'PENDING') return false;
      await this.apply(provider.code, event, event.payload ?? { reconciled: true });
      return event.status === 'CAPTURED' || event.status === 'AUTHORIZED';
    } catch (e) {
      this.logger.warn(`reconcile ${orderId} at ${provider.code} failed: ${(e as Error).message}`);
      return false;
    }
  }

  private async apply(providerCode: string, event: WebhookEventData, payload: unknown) {
    try {
      await this.prisma.webhookEvent.create({
        data: { provider: providerCode, eventId: event.eventId, type: event.type, payload: payload as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { duplicate: true };
      throw err;
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider: providerCode, providerRef: event.providerRef },
      select: { id: true, orderId: true, status: true, amountMinor: true, currencyCode: true, order: { select: { status: true, orderNumber: true } } },
    });
    if (!payment || !event.status) return { ignored: true };
    if (payment.status === event.status) return { unchanged: true };
    const paid = event.status === 'CAPTURED' || event.status === 'AUTHORIZED';

    // The gateway's answer must be about THIS order and THIS amount; otherwise nothing is confirmed.
    const mismatch =
      (event.orderId !== undefined && event.orderId !== payment.orderId) ||
      (paid && event.amountMinor !== undefined && event.amountMinor !== payment.amountMinor) ||
      (paid && event.currencyCode !== undefined && event.currencyCode.toUpperCase() !== payment.currencyCode);
    if (mismatch) {
      this.logger.error(`payment ${payment.id}: gateway answer does not match the order (event ${event.eventId})`);
      await this.audit.log({
        action: 'payment.mismatch', entityType: 'Payment', entityId: payment.id,
        after: { eventId: event.eventId, orderId: event.orderId ?? null, amountMinor: event.amountMinor?.toString() ?? null, currencyCode: event.currencyCode ?? null },
      });
      return { ignored: true, reason: 'mismatch' };
    }

    if (event.status === 'FAILED' && payment.order.status === 'PENDING') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      await this.unpaid.abandon(payment.orderId, 'Payment failed at the gateway');
    } else if (paid && payment.order.status === 'CANCELLED') {
      // Money arrived after the order had already expired or been cancelled: keep a record and pay it back.
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: event.status as PaymentStatus } });
        if (event.status === 'CAPTURED') {
          await this.ledger.post({
            type: 'LATE_PAYMENT', refType: 'Payment', refId: payment.id, idempotencyKey: `late_payment_${payment.id}`, currencyCode: payment.currencyCode,
            description: `Payment for cancelled order ${payment.order.orderNumber}`,
            entries: [{ type: 'CUSTOMER_CLEARING', amountMinor: -payment.amountMinor }, { type: 'REFUND_PAYABLE', amountMinor: payment.amountMinor }],
          }, tx);
          await tx.refund.upsert({
            where: { idempotencyKey: `late_payment_${payment.id}` },
            update: {},
            create: { paymentId: payment.id, orderId: payment.orderId, amountMinor: payment.amountMinor, reason: 'Payment received after the order was cancelled', status: 'PENDING', idempotencyKey: `late_payment_${payment.id}` },
          });
        }
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: event.status as PaymentStatus } });
        if (paid && payment.order.status === 'PENDING') {
          await tx.order.update({ where: { id: payment.orderId }, data: { status: 'CONFIRMED' } });
          await tx.sellerOrder.updateMany({ where: { orderId: payment.orderId, status: 'PENDING' }, data: { status: 'CONFIRMED' } });
          await tx.orderItem.updateMany({ where: { orderId: payment.orderId, status: 'PENDING' }, data: { status: 'CONFIRMED' } });
          await tx.orderStatusHistory.create({ data: { orderId: payment.orderId, fromStatus: 'PENDING', toStatus: 'CONFIRMED', note: 'Payment confirmed by gateway' } });
        }
        if (event.status === 'CAPTURED') await this.orderLedger.postCapture(payment.orderId, tx);
      });
    }
    await this.audit.log({ action: `payment.${String(event.status).toLowerCase()}`, entityType: 'Payment', entityId: payment.id, after: { eventId: event.eventId, paidWith: event.paidWith ?? null } });
    await this.prisma.webhookEvent.updateMany({ where: { provider: providerCode, eventId: event.eventId }, data: { processedAt: new Date() } });
    if (paid && payment.order.status === 'PENDING') this.events?.emit(EVENTS.ORDER_CONFIRMED, { orderId: payment.orderId });
    if (event.status === 'FAILED') this.events?.emit(EVENTS.PAYMENT_FAILED, { orderId: payment.orderId });
    return { ok: true };
  }
}
