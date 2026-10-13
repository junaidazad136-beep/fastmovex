import { tzFor } from '../analytics/range';
import { slotLabel } from '../delivery/slots';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderAccessService } from '../common/order-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { EVENTS, IdEvent, OrderEvent, ShipmentStatusEvent } from './notification.events';
import { NotificationsService } from './notifications.service';
import { formatMoney, NotificationType } from './templates';

const SHIPMENT_TYPES: Record<string, NotificationType> = {
  SHIPPED: 'ORDER_SHIPPED', OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY', DELIVERED: 'ORDER_DELIVERED', CANCELLED: 'ORDER_CANCELLED',
};

/** Turns domain events into customer/seller messages. Failures are logged, never thrown back to the request. */
@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly access?: OrderAccessService,
  ) {}

  private async safe(name: string, fn: () => Promise<unknown>) {
    try { await fn(); } catch (e) { this.logger.error(`${name} notification failed: ${(e as Error).message}`); }
  }

  @OnEvent(EVENTS.ORDER_PLACED, { async: true })
  onPlaced(e: OrderEvent) {
    return this.safe('order.placed', async () => {
      const o = await this.prisma.order.findUniqueOrThrow({
        where: { id: e.orderId },
        select: {
          id: true, userId: true, orderNumber: true, totalMinor: true, currencyCode: true, countryCode: true, deliverySlotStart: true, deliverySlotEnd: true, user: { select: { isGuest: true, locale: true } },
          sellerOrders: { select: { seller: { select: { ownerUserId: true } }, _count: { select: { items: true } } } },
        },
      });
      const total = formatMoney(o.totalMinor, o.currencyCode);
      const ar = o.user.locale === 'ar';
      const slot = o.deliverySlotStart && o.deliverySlotEnd ? slotLabel(o.deliverySlotStart, o.deliverySlotEnd, tzFor(o.countryCode).tz, o.user.locale) : null;
      const slotLine = slot ? ` ${ar ? 'موعد التوصيل' : 'Delivery'}: ${slot}.` : '';
      const delivery = slot ?? (ar ? 'في أقرب وقت' : 'as soon as possible');
      if (o.user.isGuest) {
        const url = this.access?.trackUrl(o.orderNumber, o.id, o.user.locale);
        const trackLine = url
          ? (ar ? `تتبّع طلبك: ${url}` : `Track your order: ${url}`)
          : (ar ? 'يمكنك تتبّع طلبك من صفحة "تتبّع الطلب" برقم الطلب وبريدك الإلكتروني.' : 'Track it on our website under "Track order" with the order number and your email.');
        await this.notifications.notify(o.userId, 'GUEST_ORDER_PLACED', { orderNumber: o.orderNumber, total, trackLine, slotLine, delivery }, { orderNumber: o.orderNumber });
      } else {
        await this.notifications.notify(o.userId, 'ORDER_PLACED', { orderNumber: o.orderNumber, total, slotLine, delivery }, { orderNumber: o.orderNumber });
      }
      for (const so of o.sellerOrders) {
        await this.notifications.notify(so.seller.ownerUserId, 'SELLER_NEW_ORDER', { orderNumber: o.orderNumber, items: so._count.items }, { orderNumber: o.orderNumber });
      }
    });
  }

  @OnEvent(EVENTS.ORDER_CONFIRMED, { async: true })
  onConfirmed(e: OrderEvent) {
    return this.safe('order.confirmed', async () => {
      const o = await this.prisma.order.findUniqueOrThrow({ where: { id: e.orderId }, select: { userId: true, orderNumber: true } });
      await this.notifications.notify(o.userId, 'ORDER_CONFIRMED', { orderNumber: o.orderNumber }, { orderNumber: o.orderNumber });
    });
  }

  @OnEvent(EVENTS.PAYMENT_FAILED, { async: true })
  onPaymentFailed(e: OrderEvent) {
    return this.safe('payment.failed', async () => {
      const o = await this.prisma.order.findUniqueOrThrow({ where: { id: e.orderId }, select: { userId: true, orderNumber: true } });
      await this.notifications.notify(o.userId, 'PAYMENT_FAILED', { orderNumber: o.orderNumber }, { orderNumber: o.orderNumber });
    });
  }

  @OnEvent(EVENTS.SHIPMENT_STATUS, { async: true })
  onShipment(e: ShipmentStatusEvent) {
    const type = SHIPMENT_TYPES[e.status];
    if (!type) return;
    return this.safe('shipment.status', async () => {
      const so = await this.prisma.sellerOrder.findUniqueOrThrow({
        where: { id: e.sellerOrderId },
        select: {
          order: { select: { userId: true, orderNumber: true, shippingAddress: true, user: { select: { locale: true, phone: true } } } }, seller: { select: { store: { select: { name: true } } } },
          delivery: { select: { method: true, deliveryCode: true } },
        },
      });
      const vars: Record<string, string> = { orderNumber: so.order.orderNumber, store: so.seller.store?.name ?? 'FastMoveX' };
      let code: string | null = null;
      if (type === 'ORDER_OUT_FOR_DELIVERY') {
        code = so.delivery?.method === 'FASTMOVEX' ? so.delivery.deliveryCode : null;
        const ar = so.order.user.locale === 'ar';
        vars.code = code ?? '-';
        vars.codeLine = code ? (ar ? ` رمز التسليم: ${code}. أعطه للسائق فقط عند استلام طلبك.` : ` Delivery code: ${code}. Give it to the driver only when you receive your order.`) : '';
      }
      const channels = await this.notifications.notify(so.order.userId, type, vars, { orderNumber: so.order.orderNumber });
      // The code must reach whoever opens the door: when the delivery phone is not the account's mobile (or the account
      // has none), it is also texted straight to the delivery phone.
      const shipPhone = (so.order.shippingAddress as { phone?: string } | null)?.phone;
      if (code && shipPhone && shipPhone !== so.order.user.phone) {
        const ar = so.order.user.locale === 'ar';
        const text = ar
          ? `فاست موف إكس: طلبك ${so.order.orderNumber} خرج للتوصيل. رمز التسليم: ${code}. أعطه للسائق فقط عند الاستلام.`
          : `FastMoveX: order ${so.order.orderNumber} is out for delivery. Delivery code: ${code}. Give it to the driver only when you receive it.`;
        await this.notifications.sendDirect('SMS', shipPhone, 'FastMoveX delivery code', text).catch((e: Error) => this.logger.warn(`delivery code SMS failed: ${e.message}`));
      } else if (code && !channels.includes('SMS') && !channels.includes('WHATSAPP')) {
        this.logger.warn(`order ${so.order.orderNumber}: delivery code shown in the app only (no phone to text)`);
      }
    });
  }

  @OnEvent(EVENTS.REFUND_SUCCEEDED, { async: true })
  onRefund(e: IdEvent) {
    return this.safe('refund.succeeded', async () => {
      const r = await this.prisma.refund.findUniqueOrThrow({ where: { id: e.id }, select: { amountMinor: true, order: { select: { userId: true, orderNumber: true, currencyCode: true } } } });
      await this.notifications.notify(r.order.userId, 'REFUND_COMPLETED', { orderNumber: r.order.orderNumber, amount: formatMoney(r.amountMinor, r.order.currencyCode) }, { orderNumber: r.order.orderNumber });
    });
  }

  @OnEvent(EVENTS.RETURN_UPDATED, { async: true })
  onReturn(e: IdEvent) {
    return this.safe('return.updated', async () => {
      const r = await this.prisma.returnRequest.findUniqueOrThrow({ where: { id: e.id }, select: { userId: true, status: true, orderItem: { select: { productTitle: true } } } });
      await this.notifications.notify(r.userId, 'RETURN_UPDATE', { product: r.orderItem.productTitle, status: r.status.toLowerCase() }, { returnId: e.id });
    });
  }

  @OnEvent(EVENTS.SELLER_APPROVED, { async: true })
  onSellerApproved(e: IdEvent) {
    return this.safe('seller.approved', async () => {
      const s = await this.prisma.seller.findUniqueOrThrow({ where: { id: e.id }, select: { ownerUserId: true, store: { select: { name: true } } } });
      await this.notifications.notify(s.ownerUserId, 'SELLER_APPROVED', { store: s.store?.name ?? '' });
    });
  }

  @OnEvent(EVENTS.SELLER_REJECTED, { async: true })
  onSellerRejected(e: IdEvent) {
    return this.safe('seller.rejected', async () => {
      const s = await this.prisma.seller.findUniqueOrThrow({ where: { id: e.id }, select: { ownerUserId: true } });
      await this.notifications.notify(s.ownerUserId, 'SELLER_REJECTED', { reason: e.reason ?? '' });
    });
  }

  @OnEvent(EVENTS.PAYOUT_PAID, { async: true })
  onPayout(e: IdEvent) {
    return this.safe('payout.paid', async () => {
      const p = await this.prisma.sellerPayout.findUniqueOrThrow({ where: { id: e.id }, select: { amountMinor: true, currencyCode: true, seller: { select: { ownerUserId: true, ibanLast4: true } } } });
      await this.notifications.notify(p.seller.ownerUserId, 'PAYOUT_PAID', { amount: formatMoney(p.amountMinor, p.currencyCode), last4: p.seller.ibanLast4 ?? '' });
    });
  }

  @OnEvent(EVENTS.TICKET_REPLIED, { async: true })
  onTicket(e: IdEvent) {
    return this.safe('ticket.replied', async () => {
      const t = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: e.id }, select: { userId: true, number: true } });
      await this.notifications.notify(t.userId, 'TICKET_REPLY', { ticket: t.number }, { ticket: t.number });
    });
  }
}
