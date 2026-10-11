import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { returnDeadline, shipmentPaidTotal } from '../finance/finance-math';
import { OrderLedgerService } from '../ledger/order-ledger.service';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PaymentsService } from '../payments/payments.service';
import { tzFor } from '../analytics/range';
import { localToUtc } from '../delivery/slots';
import { documentsForOrder } from '../documents/documents';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';
import { StorageService } from '../storage/storage.service';
import { AuthUser } from '../common/auth-user';
import { codeMatches, estimateArrival, failureKind, firstName, mapLink, runOrder } from '../delivery/delivery-rules';
import { OrdersQuery, UpdateSellerOrderStatusDto } from './dto/order.dto';
import { Actor, assertTransition, COMMITS_STOCK, CUSTOMER_CANCELLABLE, deriveOrderStatus } from './order-status';
import { CUSTOMER_CHANGE_LIMIT, CUSTOMER_EDITABLE, STAFF_EDITABLE } from './order-changes';

const PAGE = 20;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly orderLedger: OrderLedgerService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly payments?: PaymentsService,
    @Optional() private readonly warehouses?: WarehousesService,
  ) {}

  private readonly lastSync = new Map<string, number>();

  /**
   * The customer is looking at an order that still waits for a card payment (typically right after the payment page):
   * ask the gateway directly instead of waiting for its webhook. At most once every 5 s per order.
   */
  private async syncPending(where: Prisma.OrderWhereInput) {
    if (!this.payments) return;
    const o = await this.prisma.order.findFirst({ where: { ...where, status: 'PENDING', payments: { some: { method: { not: 'COD' }, status: 'PENDING' } } }, select: { id: true } });
    if (!o) return;
    const now = Date.now();
    if (now - (this.lastSync.get(o.id) ?? 0) < 5_000) return;
    this.lastSync.set(o.id, now);
    if (this.lastSync.size > 5_000) this.lastSync.clear();
    await this.payments.reconcileOrder(o.id);
  }

  // -------------------------------------------------------------- customer

  async listForCustomer(userId: string, q: OrdersQuery) {
    const rows = await this.prisma.order.findMany({
      where: { userId, status: q.status, ...(q.q && { orderNumber: { contains: q.q.toUpperCase() } }), ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      select: {
        id: true, orderNumber: true, status: true, totalMinor: true, currencyCode: true, placedAt: true, createdAt: true,
        items: { select: { productTitle: true, imageKey: true, quantity: true }, take: 4 },
        _count: { select: { items: true } },
      },
    });
    const page = toPage(rows, PAGE);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ items, _count, totalMinor, ...o }) => ({
        ...o, totalMinor: totalMinor.toString(), itemCount: _count.items,
        preview: items.map((i) => ({ title: i.productTitle, quantity: i.quantity, imageUrl: this.storage.publicUrl(i.imageKey) })),
      })),
    };
  }

  /** What "Buy again" puts back in the cart: every line of the order (same product once), the quantity bought. */
  async buyAgainLines(userId: string, orderNumber: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, userId },
      select: { items: { select: { variantId: true, quantity: true, productTitle: true }, orderBy: { id: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const by = new Map<string, { variantId: string; quantity: number; title: string }>();
    for (const i of order.items) {
      const prev = by.get(i.variantId);
      by.set(i.variantId, { variantId: i.variantId, title: i.productTitle, quantity: (prev?.quantity ?? 0) + i.quantity });
    }
    return [...by.values()];
  }

  async detailForCustomer(userId: string, orderNumber: string) {
    await this.syncPending({ orderNumber, userId });
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, userId },
      include: {
        sellerOrders: {
          include: {
            seller: { select: { returnWindowDays: true, store: { select: { slug: true, name: true, nameAr: true } } } },
            items: {
              include: {
                variant: { select: { product: { select: { slug: true, returnPolicyDays: true } } } },
                returns: { where: { status: { in: ['REQUESTED', 'APPROVED'] } }, select: { quantity: true } },
              },
            },
            delivery: { select: { id: true, method: true, status: true, trackingUrl: true, etaAt: true, courierName: true, courierUserId: true, deliveryCode: true, lastLat: true, lastLng: true, lastLocationAt: true, failedAt: true, failureReason: true, customerRequest: true, customerRequestAt: true } },
          },
        },
        payments: { select: { method: true, status: true, amountMinor: true, createdAt: true } },
        history: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, note: true, createdAt: true } },
        changes: { orderBy: { createdAt: 'asc' }, select: { kind: true, byRole: true, summary: true, amountMinor: true, createdAt: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const now = new Date();
    const etas = new Map<string, ReturnType<typeof estimateArrival>>();
    for (const so of order.sellerOrders) if (so.delivery?.status === 'OUT_FOR_DELIVERY') etas.set(so.delivery.id, await this.arrival(so.delivery, order.shippingAddress, now));
    // What the customer may still do, computed with the same rules the actions enforce (no dead buttons in the apps).
    const shaped = {
      ...order,
      canCancel: order.sellerOrders.some((so) => CUSTOMER_CANCELLABLE.includes(so.status)),
      sellerOrders: order.sellerOrders.map(({ seller, items, delivery, ...so }) => ({
        ...so,
        delivery: delivery && { ...customerDelivery(delivery), eta: etas.get(delivery.id) ?? null },
        seller: { store: seller.store },
        items: items.map(({ variant, returns, ...i }) => {
          const policyDays = variant.product.returnPolicyDays;
          const deadline = so.deliveredAt && policyDays !== 0 ? returnDeadline(so.deliveredAt, policyDays, seller.returnWindowDays) : null;
          const delivered = ['DELIVERED', 'RETURN_REQUESTED', 'RETURNED'].includes(i.status);
          const open = returns.reduce((s, r) => s + r.quantity, 0);
          const returnableQty = delivered && deadline && now <= deadline ? Math.max(0, i.quantity - i.refundedQty - open) : 0;
          return { ...i, productSlug: variant.product.slug, returnDeadline: deadline, returnableQty, openReturnQty: open };
        }),
      })),
    };
    const view = this.customerSafe(this.renderOrder({ ...shaped, changes: (order.changes ?? []).map((c) => ({ ...c, amountMinor: c.amountMinor.toString() })) }, false));
    // downloads: the invoice once confirmed, credit notes for refunds paid, receipts for returned items checked
    // changes the customer may still make (window / address) — same rules the change endpoints enforce
    const live = order.sellerOrders.filter((so) => so.status !== 'CANCELLED');
    const customerChanges = (order.changes ?? []).filter((c) => c.byRole === 'CUSTOMER').length;
    const canChange = live.length > 0 && live.every((so) => CUSTOMER_EDITABLE.includes(so.status)) && customerChanges < CUSTOMER_CHANGE_LIMIT;
    return {
      ...view, changeOptions: { canChange, changesLeft: Math.max(0, CUSTOMER_CHANGE_LIMIT - customerChanges) },
      documents: { invoice: order.status !== 'PENDING', ...(await documentsForOrder(this.prisma, order.id)) },
    };
  }

  /** The driver's estimated arrival at this address (null without a fresh driver position or an address pin). */
  private async arrival(d: { id: string; courierUserId: string | null; lastLat: number | null; lastLng: number | null; lastLocationAt: Date | null }, address: Prisma.JsonValue, now: Date) {
    const a = (address ?? {}) as Record<string, unknown>;
    const pin = typeof a.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : null;
    const driver = d.lastLat !== null && d.lastLng !== null && d.lastLocationAt ? { lat: d.lastLat, lng: d.lastLng, at: d.lastLocationAt } : null;
    if (!pin || !driver || !d.courierUserId) return null;
    // the driver's other stops on the road now, in the order the driver page lists them
    const run = await this.prisma.deliveryOrder.findMany({
      where: { courierUserId: d.courierUserId, status: 'OUT_FOR_DELIVERY' },
      take: 100,
      select: { id: true, status: true, assignedAt: true, sellerOrder: { select: { order: { select: { deliverySlotStart: true, shippingAddress: true } } } } },
    });
    const ordered = runOrder(run.map((r) => {
      const ad = (r.sellerOrder.order.shippingAddress ?? {}) as Record<string, unknown>;
      return { id: r.id, status: r.status, assignedAt: r.assignedAt, slotStart: r.sellerOrder.order.deliverySlotStart, zone: typeof ad.zone === 'string' ? ad.zone : null };
    }));
    const idx = ordered.findIndex((r) => r.id === d.id);
    return estimateArrival({ now, driver, pin, stopsBefore: Math.max(0, idx) });
  }

  /** Commission, seller earnings and internal keys are business data: never shown to customers. */
  private customerSafe<T extends Record<string, unknown>>(view: T) {
    const HIDDEN = ['commissionMinor', 'sellerNetMinor', 'commissionRuleId', 'commissionSnapshot', 'idempotencyKey', 'releasedAt', 'userId', 'couponId', 'placedById', 'unitCostMinor'];
    const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !HIDDEN.includes(k)));
    const sellerOrders = (view.sellerOrders as Record<string, unknown>[]).map((so) => ({
      ...strip(so),
      items: (so.items as Record<string, unknown>[]).map(strip),
    }));
    return { ...strip(view), sellerOrders };
  }

  async cancelByCustomer(userId: string, orderNumber: string, reason: string) {
    const order = await this.prisma.order.findFirst({ where: { orderNumber, userId }, select: { id: true, sellerOrders: { select: { id: true, status: true } } } });
    if (!order) throw new NotFoundException('Order not found');
    // Same rule as the status machine: a customer can cancel only shipments the seller has not started preparing.
    const cancellable = order.sellerOrders.filter((so) => CUSTOMER_CANCELLABLE.includes(so.status));
    if (!cancellable.length) throw new BadRequestException('This order is already being prepared and can no longer be cancelled. You can request a return after delivery.');
    for (const so of cancellable) await this.setSellerOrderStatus(so.id, 'CANCELLED', 'CUSTOMER', userId, reason);
    return this.detailForCustomer(userId, orderNumber);
  }

  // ---------------------------------------------------------------- seller

  async listForSeller(sellerId: string, q: OrdersQuery) {
    const rows = await this.prisma.sellerOrder.findMany({
      where: { sellerId, status: q.status, ...(q.q && { order: { orderNumber: { contains: q.q.toUpperCase() } } }), ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      select: {
        id: true, status: true, subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, commissionMinor: true, sellerNetMinor: true,
        createdAt: true, order: { select: { orderNumber: true, currencyCode: true, placedAt: true, shippingAddress: true } },
        _count: { select: { items: true } },
      },
    });
    const page = toPage(rows, PAGE);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((so) => ({
        id: so.id, status: so.status, orderNumber: so.order.orderNumber, currencyCode: so.order.currencyCode, placedAt: so.order.placedAt,
        itemCount: so._count.items, city: (so.order.shippingAddress as { city?: string } | null)?.city ?? null,
        subtotalMinor: so.subtotalMinor.toString(), discountMinor: so.discountMinor.toString(), deliveryFeeMinor: so.deliveryFeeMinor.toString(),
        commissionMinor: so.commissionMinor.toString(), sellerNetMinor: so.sellerNetMinor.toString(),
      })),
    };
  }

  async detailForSeller(sellerId: string, sellerOrderId: string) {
    const so = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, sellerId }, // scoped: a seller can never open another seller's shipment
      include: {
        items: true,
        delivery: true,
        order: { select: { orderNumber: true, currencyCode: true, placedAt: true, customerNote: true, shippingAddress: true, user: { select: { fullName: true } } } },
        history: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, note: true, createdAt: true } },
      },
    });
    if (!so) throw new NotFoundException('Order not found');
    const addr = so.order.shippingAddress as Record<string, unknown>;
    return {
      ...this.money(so),
      order: { orderNumber: so.order.orderNumber, currencyCode: so.order.currencyCode, placedAt: so.order.placedAt, customerNote: so.order.customerNote },
      customer: { name: so.order.user.fullName },
      // Sellers see what they need to deliver, not the customer's account details
      shippingAddress: { recipientName: addr.recipientName, phone: addr.phone, city: addr.city, zone: addr.zone, street: addr.street, building: addr.building, unit: addr.unit, line1: addr.line1, lat: addr.lat, lng: addr.lng },
      items: so.items.map((i) => ({ ...this.money(i), imageUrl: this.storage.publicUrl(i.imageKey) })),
      history: so.history,
      delivery: staffDelivery(so.delivery),
    };
  }

  async updateSellerOrderStatus(sellerId: string, sellerOrderId: string, to: OrderStatus, actorId: string, note?: string) {
    const so = await this.prisma.sellerOrder.findFirst({ where: { id: sellerOrderId, sellerId }, select: { id: true, delivery: { select: { method: true } } } });
    if (!so) throw new NotFoundException('Order not found');
    // A FastMoveX driver delivers it: only the driver (with the customer's code) or FastMoveX staff can close it
    if (to === 'DELIVERED' && so.delivery?.method === 'JOVIA') throw new ForbiddenException('A FastMoveX driver is delivering this order. It is marked delivered when the customer gives the driver their code.');
    await this.setSellerOrderStatus(sellerOrderId, to, 'SELLER', actorId, note);
    return this.detailForSeller(sellerId, sellerOrderId);
  }

  async cancelBySeller(sellerId: string, sellerOrderId: string, actorId: string, reason: string) {
    const so = await this.prisma.sellerOrder.findFirst({ where: { id: sellerOrderId, sellerId }, select: { id: true } });
    if (!so) throw new NotFoundException('Order not found');
    await this.setSellerOrderStatus(sellerOrderId, 'CANCELLED', 'SELLER', actorId, reason);
    return this.detailForSeller(sellerId, sellerOrderId);
  }

  // ----------------------------------------------------------------- admin

  async listForAdmin(q: OrdersQuery) {
    const rows = await this.prisma.order.findMany({
      where: {
        status: q.status,
        ...(q.view === 'to_fulfil' && { sellerOrders: { some: { status: { in: ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'] as OrderStatus[] } } } }),
        ...(q.slotDate && (() => {
          const from = localToUtc(q.slotDate, '00:00', tzFor(process.env.DEFAULT_COUNTRY ?? 'QA').offsetMin);
          return { deliverySlotStart: { gte: from, lt: new Date(from.getTime() + 86_400_000) } };
        })()),
        // Staff search by order number, customer name, email or phone
        ...(q.q && {
          OR: [
            { orderNumber: { contains: q.q.toUpperCase() } },
            { user: { fullName: { contains: q.q, mode: 'insensitive' as const } } },
            { user: { email: { contains: q.q.toLowerCase() } } },
            { user: { phone: { contains: q.q.replace(/\s/g, '') } } },
          ],
        }),
        ...afterCursor(decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      select: {
        id: true, orderNumber: true, status: true, totalMinor: true, currencyCode: true, countryCode: true, placedAt: true, createdAt: true,
        deliverySlotStart: true, deliverySlotEnd: true,
        user: { select: { id: true, fullName: true, phone: true, tags: true } }, _count: { select: { sellerOrders: true, items: true } },
        payments: { select: { method: true, status: true }, take: 1, orderBy: { createdAt: 'asc' } },
        sellerOrders: { select: { status: true, deliveryMethod: true } },
      },
    });
    const page = toPage(rows, PAGE);
    return { nextCursor: page.nextCursor, items: page.items.map(({ totalMinor, payments, ...o }) => ({ ...o, totalMinor: totalMinor.toString(), payment: payments[0] ?? null })) };
  }

  async orderNumberOfShipment(sellerOrderId: string): Promise<string> {
    const so = await this.prisma.sellerOrder.findUnique({ where: { id: sellerOrderId }, select: { order: { select: { orderNumber: true } } } });
    if (!so) throw new NotFoundException('Shipment not found');
    return so.order.orderNumber;
  }

  async detailForAdmin(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, tags: true } },
        sellerOrders: {
          include: {
            seller: { select: { id: true, businessName: true, legalName: true, commercialRegNo: true, taxNumber: true, isHouse: true, store: { select: { slug: true, name: true, nameAr: true } } } },
            items: true, delivery: true,
          },
        },
        payments: true, refunds: true, coupon: { select: { code: true, fundedBy: true } },
        history: { orderBy: { createdAt: 'asc' } },
        changes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    // who changed what (staff, the customer, the driver at the door) and who took a phone order
    const people = [...new Set([...order.changes.map((c) => c.actorId), order.placedById].filter((x): x is string => !!x))];
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: people } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const editable = order.sellerOrders.some((so) => STAFF_EDITABLE.includes(so.status));
    return {
      ...this.renderOrder({ ...order, changes: order.changes.map((c) => ({ ...c, amountMinor: c.amountMinor.toString(), actorName: c.actorId ? names.get(c.actorId) ?? null : null })) }),
      placedBy: order.placedById ? { id: order.placedById, name: names.get(order.placedById) ?? null } : null,
      editable,
    };
  }

  /**
   * Staff move a shipment on. A FastMoveX-driver delivery is only "delivered" with the customer's code — the same proof the
   * driver needs. Without the code, a manager (delivery.override) may close it with a written reason; that is recorded
   * on the delivery and in the audit log. Wrong codes count towards the same 5-try lock as the driver's.
   */
  async staffShipmentStatus(sellerOrderId: string, dto: UpdateSellerOrderStatusDto, user: AuthUser) {
    const orderNumber = await this.orderNumberOfShipment(sellerOrderId);
    const d = dto.status === 'DELIVERED'
      ? await this.prisma.deliveryOrder.findUnique({ where: { sellerOrderId }, select: { id: true, method: true, status: true, deliveryCode: true, attempts: true } })
      : null;
    let override: string | null = null;
    if (d && d.method === 'JOVIA' && d.status !== 'DELIVERED') {
      if (dto.code) {
        if (d.attempts >= 5) throw new ForbiddenException('Too many wrong codes on this delivery. A manager can close it with a reason.');
        if (!codeMatches(d.deliveryCode, dto.code)) {
          await this.prisma.deliveryOrder.update({ where: { id: d.id }, data: { attempts: { increment: 1 } } });
          throw new BadRequestException('Wrong delivery code');
        }
      } else {
        if (!user.permissions.includes('delivery.override')) {
          throw new ForbiddenException({ message: 'Enter the code the customer received. Only a manager can mark it delivered without the code.', reason: 'DELIVERY_CODE_REQUIRED' });
        }
        const reason = dto.overrideReason?.trim() ?? '';
        if (reason.length < 10) throw new BadRequestException({ message: 'Write why the customer’s code is not available (at least 10 characters).', reason: 'OVERRIDE_REASON_REQUIRED' });
        override = reason;
        await this.prisma.deliveryOrder.update({ where: { id: d.id }, data: { overrideById: user.id, overrideReason: reason } });
        await this.audit.log({ actorId: user.id, action: 'delivery.override', entityType: 'DeliveryOrder', entityId: d.id, after: { orderNumber, reason } });
      }
    }
    const note = override ? `Delivered without the customer's code: ${override}` : dto.code && d?.method === 'JOVIA' ? 'Delivered, code verified by staff' : dto.note;
    await this.setSellerOrderStatus(sellerOrderId, dto.status, 'ADMIN', user.id, note);
    return this.detailForAdmin(orderNumber);
  }

  async cancelByAdmin(orderNumber: string, actorId: string, reason: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber }, select: { id: true, sellerOrders: { select: { id: true, status: true } } } });
    if (!order) throw new NotFoundException('Order not found');
    const open = order.sellerOrders.filter((so) => !COMMITS_STOCK.includes(so.status) && so.status !== 'CANCELLED');
    if (!open.length) throw new BadRequestException('Nothing left to cancel on this order');
    for (const so of open) await this.setSellerOrderStatus(so.id, 'CANCELLED', 'ADMIN', actorId, reason);
    return this.detailForAdmin(orderNumber);
  }

  // --------------------------------------------------------------- engine

  /**
   * Single place where a shipment changes state. Validates the transition, moves stock
   * (commit when shipped, release when cancelled), writes history and recalculates
   * the customer-facing order status.
   */
  async setSellerOrderStatus(sellerOrderId: string, to: OrderStatus, actor: Actor, actorId: string, note?: string) {
    await this.prisma.$transaction(async (tx) => {
      const so = await tx.sellerOrder.findUniqueOrThrow({
        where: { id: sellerOrderId },
        select: { id: true, orderId: true, status: true, sellerId: true, warehouseId: true, items: { where: { status: { not: 'CANCELLED' } }, select: { id: true, variantId: true, quantity: true, sku: true } } }, // lines removed by an order change stay cancelled
      });
      assertTransition(so.status, to, actor);

      const wasCommitted = COMMITS_STOCK.includes(so.status);
      if (!wasCommitted && COMMITS_STOCK.includes(to)) {
        // the goods leave the shipment's warehouse: no longer held for the order, and off that shelf
        const warehouseId = so.warehouseId ?? (await this.warehouses!.defaultFor(tx, so.sellerId));
        for (const it of so.items) {
          await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = "reserved" - ${it.quantity}, "version" = "version" + 1 WHERE "variantId" = ${it.variantId}::uuid`;
          await this.warehouses!.move(tx, { warehouseId, variantId: it.variantId, delta: -it.quantity, reason: 'COMMIT', refType: 'order_item', refId: it.id, actorId, label: it.sku, skipExpired: true });
        }
      }
      if (to === 'CANCELLED' && !wasCommitted) {
        for (const it of so.items) {
          await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = GREATEST(0, "reserved" - ${it.quantity}), "version" = "version" + 1 WHERE "variantId" = ${it.variantId}::uuid`;
          await tx.inventoryMovement.create({ data: { variantId: it.variantId, qtyDelta: 0, reason: 'RELEASE', refType: 'order_item', refId: it.id, actorId, note: 'Order cancelled' } });
        }
      }

      await tx.sellerOrder.update({
        where: { id: sellerOrderId },
        data: { status: to, deliveredAt: to === 'DELIVERED' ? new Date() : undefined, cancelledAt: to === 'CANCELLED' ? new Date() : undefined, cancelReason: to === 'CANCELLED' ? note : undefined },
      });
      await tx.orderItem.updateMany({ where: { sellerOrderId, status: { not: 'CANCELLED' } }, data: { status: to } });
      await tx.orderStatusHistory.create({ data: { orderId: so.orderId, sellerOrderId, fromStatus: so.status, toStatus: to, actorId, note } });

      const siblings = await tx.sellerOrder.findMany({ where: { orderId: so.orderId }, select: { status: true } });
      const derived = deriveOrderStatus(siblings.map((s) => s.status));
      const order = await tx.order.findUniqueOrThrow({ where: { id: so.orderId }, select: { status: true } });
      if (order.status !== derived) {
        await tx.order.update({ where: { id: so.orderId }, data: { status: derived } });
        await tx.orderStatusHistory.create({ data: { orderId: so.orderId, fromStatus: order.status, toStatus: derived, actorId, note: 'Updated from shipment status' } });
      }

      if (to === 'CANCELLED') await this.requestRefundIfPaid(tx, so.orderId, sellerOrderId, actorId, note ?? 'Order cancelled');
      if (to === 'DELIVERED') await this.recordCashCollected(tx, so.orderId, sellerOrderId, actorId);
      // Cash on delivery: the money only exists once everything is delivered
      if (derived === 'DELIVERED') await this.settleCashOnDelivery(tx, so.orderId);
    });

    await this.audit.log({ actorId, action: `order.${to.toLowerCase()}`, entityType: 'SellerOrder', entityId: sellerOrderId, after: { status: to, by: actor, note: note ?? null } });
    this.events?.emit(EVENTS.SHIPMENT_STATUS, { sellerOrderId, status: to });
  }

  private async settleCashOnDelivery(tx: Prisma.TransactionClient, orderId: string) {
    const payment = await tx.payment.findFirst({ where: { orderId, method: 'COD', status: { in: ['PENDING', 'AUTHORIZED'] } }, select: { id: true } });
    if (!payment) return;
    const collected = await this.orderLedger.postCapture(orderId, tx);
    // cash actually collected = live shipments only (a seller may have cancelled part of the order)
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'CAPTURED', ...(collected !== null && { amountMinor: collected }) } });
  }

  /**
   * Cash on delivery: the cash taken for this shipment is now in someone's hands — the FastMoveX driver who delivered it,
   * otherwise the person who marked it delivered. It stays on their name until a cashier receives it (CashService).
   */
  private async recordCashCollected(tx: Prisma.TransactionClient, orderId: string, sellerOrderId: string, actorId: string) {
    const payment = await tx.payment.findFirst({ where: { orderId, method: 'COD', status: { in: ['PENDING', 'AUTHORIZED', 'CAPTURED'] } }, select: { id: true } });
    if (!payment) return;
    const so = await tx.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      select: { subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true, order: { select: { countryCode: true, currencyCode: true } }, delivery: { select: { method: true, courierUserId: true } } },
    });
    const country = await tx.country.findUnique({ where: { code: so.order.countryCode }, select: { pricesIncludeTax: true } });
    const amount = shipmentPaidTotal(so, country?.pricesIncludeTax ?? true);
    const holderUserId = so.delivery?.method === 'JOVIA' && so.delivery.courierUserId ? so.delivery.courierUserId : actorId;
    await tx.codCollection.upsert({
      where: { sellerOrderId },
      update: {}, // recorded once
      create: { sellerOrderId, holderUserId, amountMinor: amount, currencyCode: so.order.currencyCode },
    });
  }

  /** A cancelled shipment that was already paid gets a refund request; the refunds phase processes it. */
  private async requestRefundIfPaid(tx: Prisma.TransactionClient, orderId: string, sellerOrderId: string, actorId: string, reason: string) {
    const payment = await tx.payment.findFirst({ where: { orderId, status: { in: ['CAPTURED', 'AUTHORIZED', 'PARTIALLY_REFUNDED'] } }, select: { id: true } });
    if (!payment) return;
    const so = await tx.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId }, select: { subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true, order: { select: { countryCode: true } } } });
    const country = await tx.country.findUnique({ where: { code: so.order.countryCode }, select: { pricesIncludeTax: true } });
    const amount = shipmentPaidTotal(so, country?.pricesIncludeTax ?? true); // VAT only added when prices exclude it
    if (amount <= 0n) return;
    await tx.refund.create({
      data: { paymentId: payment.id, orderId, sellerOrderId, amountMinor: amount, reason, status: 'PENDING', createdById: actorId, idempotencyKey: `cancel_${sellerOrderId}_${randomUUID().slice(0, 8)}` },
    });
  }

  // --------------------------------------------------------------- render

  private money<T extends Record<string, unknown>>(row: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? v.toString() : v;
    return out as T;
  }

  private renderOrder(order: Record<string, unknown>, staff = true) {
    const sellerOrders = (order.sellerOrders as Record<string, unknown>[]).map((so) => ({
      ...this.money(so),
      ...(staff && 'delivery' in so && { delivery: staffDelivery(so.delivery as { deliveryCode?: string | null } | null) }),
      items: (so.items as Record<string, unknown>[]).map((i) => ({ ...this.money(i), imageUrl: this.storage.publicUrl(i.imageKey as string | null) })),
    }));
    return { ...this.money(order), sellerOrders, payments: (order.payments as Record<string, unknown>[] | undefined)?.map((p) => this.money(p)) };
  }
}

/** What the customer sees of a delivery: the code to give the driver (until delivered), the driver's first name and, while on the way, where the driver is. */
export function customerDelivery(d: { method: string; status: string; trackingUrl: string | null; etaAt: Date | null; courierName: string | null; deliveryCode: string | null; lastLat: number | null; lastLng: number | null; failedAt?: Date | null; failureReason?: string | null; customerRequest?: string | null; customerRequestAt?: Date | null }) {
  const live = d.status === 'OUT_FOR_DELIVERY' || d.status === 'PICKED_UP';
  const open = !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(d.status);
  return {
    method: d.method, status: d.status, trackingUrl: d.trackingUrl, etaAt: d.etaAt,
    courierName: firstName(d.courierName),
    deliveryCode: d.method === 'JOVIA' && open ? d.deliveryCode : null,
    location: live && d.lastLat !== null && d.lastLng !== null ? { lat: d.lastLat, lng: d.lastLng, mapUrl: mapLink({ lat: d.lastLat, lng: d.lastLng }) } : null,
    // the last attempt failed: why (as a code the website words), and what the customer asked for since
    attempt: d.status === 'FAILED' && d.failedAt ? { failedAt: d.failedAt, kind: failureKind(d.failureReason), canReschedule: failureKind(d.failureReason) !== 'REFUSED' } : null,
    request: d.status === 'FAILED' && d.customerRequest ? { text: d.customerRequest, at: d.customerRequestAt } : null,
  };
}

/** Staff and sellers never see the customer's code — otherwise anyone at the desk could close a delivery without the customer. */
export function staffDelivery<T extends { deliveryCode?: string | null }>(d: T | null): (Omit<T, 'deliveryCode'> & { hasCode: boolean }) | null {
  if (!d) return null;
  const { deliveryCode, ...rest } = d;
  return { ...rest, hasCode: !!deliveryCode };
}
