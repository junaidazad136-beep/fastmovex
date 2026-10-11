import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Headers, Get, HttpCode, Injectable, Logger, NotFoundException, Optional, Param, Patch, Post, Put, Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { OrderAccessService } from '../common/order-access.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AddressDto, assertAddressFormat } from '../addresses/addresses';
import { tzFor } from '../analytics/range';
import { AuditService } from '../audit/audit.service';
import { DeliverySlotsService } from '../delivery/slots.module';
import { slotLabel } from '../delivery/slots';
import { EVENTS } from '../notifications/notification.events';
import { NotificationsService } from '../notifications/notifications.service';
import { formatMoney } from '../notifications/templates';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveUnitPrice } from '../cart/cart.service';
import { CommissionService } from '../commission/commission.service';
import { taxOn } from '../pricing/pricing.engine';

type Tx = Prisma.TransactionClient;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Staff may change a shipment until it leaves the warehouse (the driver has not picked it up). */
export const STAFF_EDITABLE: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];
/** The customer may change the window or the address until packing is finished. */
export const CUSTOMER_EDITABLE: OrderStatus[] = ['CONFIRMED', 'PREPARING'];
/** How many times a customer may change their own order (stops endless back-and-forth for the warehouse). */
export const CUSTOMER_CHANGE_LIMIT = 3;

export type ChangeRole = 'STAFF' | 'CUSTOMER' | 'DRIVER';

interface LineMoney { unitPriceMinor: bigint; quantity: number; discountMinor: bigint; taxMinor: bigint; lineTotalMinor: bigint; commissionMinor: bigint }

/**
 * A line keeps `keep` of its units: discount, VAT and commission shrink in proportion (rounded down for what is kept,
 * so the removed part gets the rounding and the totals always add up). Returns the new line and what was taken off.
 * Exported for tests.
 */
export function scaleLine(l: LineMoney, keep: number, pricesIncludeTax: boolean) {
  if (!Number.isInteger(keep) || keep < 0 || keep > l.quantity) throw new BadRequestException('Quantity out of range');
  const q = BigInt(l.quantity);
  const k = BigInt(keep);
  const discount = (l.discountMinor * k) / q;
  const tax = (l.taxMinor * k) / q;
  const commission = (l.commissionMinor * k) / q;
  const subtotal = l.unitPriceMinor * k;
  const lineTotal = subtotal - discount + (pricesIncludeTax ? 0n : tax);
  const removed = {
    subtotalMinor: l.unitPriceMinor * q - subtotal,
    discountMinor: l.discountMinor - discount,
    taxMinor: l.taxMinor - tax,
    commissionMinor: l.commissionMinor - commission,
    totalMinor: l.lineTotalMinor - lineTotal,
  };
  return { kept: { quantity: keep, discountMinor: discount, taxMinor: tax, commissionMinor: commission, lineTotalMinor: lineTotal }, removed };
}

const ADDRESS_KEYS = ['recipientName', 'phone', 'countryCode', 'city', 'zone', 'street', 'building', 'unit', 'line1', 'postalCode', 'lat', 'lng', 'label'] as const;
/** One-line address for summaries ("Zone 61, Street 840, Building 3, Doha"). Exported for tests. */
export function addressLine(a: Record<string, unknown> | null | undefined): string {
  if (!a) return '—';
  const s = (k: string) => (typeof a[k] === 'string' && a[k] ? String(a[k]) : null);
  return [s('unit'), s('zone') && `Zone ${s('zone')}`, s('street') && `Street ${s('street')}`, s('building') && `Building ${s('building')}`, s('line1'), s('city')].filter(Boolean).join(', ') || '—';
}

export interface ItemChange { itemId: string; quantity: number }

/**
 * Changes to an order after checkout, with everything that has to follow: stock given back (or brought back by the
 * driver), deal and coupon figures, the shipment and order totals, the cash to collect or a refund for what was
 * already paid, a permanent change record, the audit log and a message to the customer.
 */
@Injectable()
export class OrderChangesService {
  private readonly logger = new Logger(OrderChangesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly slots?: DeliverySlotsService,
    @Optional() private readonly commissions?: CommissionService,
  ) {}

  // ------------------------------------------------------------------ items

  /**
   * Reduce or remove items. Staff: before the driver picks the shipment up (units go back to free stock).
   * Driver (`door`): the customer refuses some items at the door — the units ride back with the driver and wait to be
   * booked in by the warehouse. A shipment cannot lose all its items here: cancel it (or mark it refused) instead.
   */
  async changeItems(
    orderNumber: string, changes: ItemChange[], reason: string, actor: { id: string; role: 'STAFF' | 'DRIVER' },
    door?: { deliveryOrderId: string },
  ) {
    if (!changes.length) throw new BadRequestException('Nothing to change');
    const ids = new Set<string>();
    for (const c of changes) {
      if (ids.has(c.itemId)) throw new BadRequestException('Each item only once');
      ids.add(c.itemId);
    }
    const refundIds: string[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        select: {
          id: true, orderNumber: true, countryCode: true, currencyCode: true, userId: true,
          country: { select: { pricesIncludeTax: true } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, method: true, status: true, amountMinor: true } },
          sellerOrders: {
            select: {
              id: true, status: true, deliveryFeeMinor: true, subtotalMinor: true, discountMinor: true, taxMinor: true, commissionMinor: true,
              delivery: { select: { id: true, courierUserId: true } },
              items: { where: { status: { not: 'CANCELLED' } }, select: { id: true, variantId: true, productTitle: true, quantity: true, refundedQty: true, unitPriceMinor: true, discountMinor: true, taxMinor: true, lineTotalMinor: true, commissionMinor: true, campaignId: true } },
            },
          },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id}::uuid FOR UPDATE`; // one change at a time per order
      const inclusive = order.country.pricesIncludeTax;
      const byItem = new Map(order.sellerOrders.flatMap((so) => so.items.map((it) => [it.id, { so, it }] as const)));
      const touched = new Map<string, { so: (typeof order.sellerOrders)[number]; lines: { it: (typeof order.sellerOrders)[number]['items'][number]; keep: number }[] }>();
      for (const c of changes) {
        const hit = byItem.get(c.itemId);
        if (!hit) throw new NotFoundException('Item not found on this order (or already removed)');
        if (c.quantity === hit.it.quantity) continue; // unchanged
        if (c.quantity > hit.it.quantity) throw new BadRequestException({ message: 'Items can only be reduced or removed here. For more, place a new order.', reason: 'ONLY_REDUCE' });
        if (c.quantity < 0) throw new BadRequestException('Quantity cannot be negative');
        const entry = touched.get(hit.so.id) ?? { so: hit.so, lines: [] };
        entry.lines.push({ it: hit.it, keep: c.quantity });
        touched.set(hit.so.id, entry);
      }
      if (!touched.size) throw new BadRequestException('Nothing changed');

      const payment = order.payments[0];
      const out: { sellerOrderId: string; amountMinor: bigint; summary: string }[] = [];
      for (const { so, lines } of touched.values()) {
        if (door) {
          if (so.status !== 'OUT_FOR_DELIVERY' || so.delivery?.id !== door.deliveryOrderId) throw new ConflictException('Only items of the shipment you are delivering can be refused');
        } else if (!STAFF_EDITABLE.includes(so.status)) {
          throw new ConflictException({ message: 'This shipment has left the warehouse and can no longer be changed. Use a return or a refund instead.', reason: 'NOT_EDITABLE' });
        }
        const remaining = so.items.reduce((n, it) => n + (lines.find((l) => l.it.id === it.id)?.keep ?? it.quantity), 0);
        if (remaining === 0) {
          throw new BadRequestException(door
            ? { message: 'The customer refused everything: mark the delivery as refused instead.', reason: 'ALL_REFUSED' }
            : { message: 'That removes every item: cancel the shipment instead.', reason: 'ALL_REMOVED' });
        }
        const removed = { subtotalMinor: 0n, discountMinor: 0n, taxMinor: 0n, commissionMinor: 0n, totalMinor: 0n };
        const parts: string[] = [];
        const before: Record<string, number> = {};
        const after: Record<string, number> = {};
        for (const { it, keep } of lines) {
          const sc = scaleLine(it, keep, inclusive);
          for (const k of Object.keys(removed) as (keyof typeof removed)[]) removed[k] += sc.removed[k];
          const units = it.quantity - keep;
          before[it.id] = it.quantity;
          after[it.id] = keep;
          parts.push(keep === 0 ? `${it.productTitle} removed (${it.quantity})` : `${it.productTitle} ${it.quantity} → ${keep}`);
          if (keep === 0) {
            await tx.orderItem.update({ where: { id: it.id }, data: { status: 'CANCELLED' } }); // the line stays on record, out of the sale
          } else {
            await tx.orderItem.update({ where: { id: it.id }, data: { quantity: keep, discountMinor: sc.kept.discountMinor, taxMinor: sc.kept.taxMinor, commissionMinor: sc.kept.commissionMinor, lineTotalMinor: sc.kept.lineTotalMinor } });
          }
          if (door) {
            // the goods are on the driver's van: the warehouse books them back in when they arrive
            await tx.doorReturn.create({ data: { deliveryOrderId: door.deliveryOrderId, orderItemId: it.id, quantity: units, reason: reason.slice(0, 300), courierUserId: actor.id } });
          } else {
            await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = GREATEST(0, "reserved" - ${units}), "version" = "version" + 1 WHERE "variantId" = ${it.variantId}::uuid`;
            await tx.inventoryMovement.create({ data: { variantId: it.variantId, qtyDelta: 0, reason: 'RELEASE', refType: 'order_item', refId: it.id, actorId: actor.id, note: `Order changed: ${units} fewer` } });
          }
          if (it.campaignId) {
            await tx.$executeRaw`UPDATE "CampaignProduct" SET "soldCount" = GREATEST(0, "soldCount" - ${units}) WHERE "campaignId" = ${it.campaignId}::uuid AND "variantId" = ${it.variantId}::uuid`;
          }
        }
        const subtotal = so.subtotalMinor - removed.subtotalMinor;
        const discount = so.discountMinor - removed.discountMinor;
        const commission = so.commissionMinor - removed.commissionMinor;
        await tx.sellerOrder.update({
          where: { id: so.id },
          data: { subtotalMinor: subtotal, discountMinor: discount, taxMinor: so.taxMinor - removed.taxMinor, commissionMinor: commission, sellerNetMinor: subtotal - discount + so.deliveryFeeMinor - commission },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { subtotalMinor: { decrement: removed.subtotalMinor }, discountMinor: { decrement: removed.discountMinor }, taxMinor: { decrement: removed.taxMinor }, totalMinor: { decrement: removed.totalMinor } },
        });
        if (removed.discountMinor > 0n) {
          await tx.couponRedemption.updateMany({ where: { orderId: order.id }, data: { discountMinor: { decrement: removed.discountMinor } } });
        }
        // money: cash to collect goes down; a payment already taken gets a refund for the difference (normal approval)
        let moneyNote = '';
        if (payment && removed.totalMinor > 0n) {
          if (payment.method === 'COD' && ['PENDING', 'AUTHORIZED'].includes(payment.status)) {
            await tx.payment.update({ where: { id: payment.id }, data: { amountMinor: { decrement: removed.totalMinor } } });
            moneyNote = 'cash';
          } else if (['CAPTURED', 'AUTHORIZED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
            const r = await tx.refund.create({
              data: {
                paymentId: payment.id, orderId: order.id, sellerOrderId: so.id, amountMinor: removed.totalMinor, status: 'PENDING', createdById: actor.id,
                reason: `${door ? 'Refused at the door' : 'Order changed'}: ${parts.join('; ')}`.slice(0, 500), idempotencyKey: `change_${so.id}_${randomUUID().slice(0, 8)}`,
              },
              select: { id: true },
            });
            refundIds.push(r.id);
            moneyNote = 'refund';
          }
        }
        const summary = parts.join('; ');
        await tx.orderChange.create({
          data: {
            orderId: order.id, sellerOrderId: so.id, kind: door ? 'DOOR_REFUSAL' : 'ITEMS', byRole: actor.role, actorId: actor.id,
            reason: reason.slice(0, 500), summary: summary.slice(0, 1000), before, after, amountMinor: removed.totalMinor,
          },
        });
        await tx.orderStatusHistory.create({ data: { orderId: order.id, sellerOrderId: so.id, toStatus: so.status, actorId: actor.id, note: `${door ? 'Refused at the door' : 'Order changed'}: ${summary}`.slice(0, 500) } });
        out.push({ sellerOrderId: so.id, amountMinor: removed.totalMinor, summary: summary + (moneyNote ? `|${moneyNote}` : '') });
      }
      return { order, out };
    });

    const total = result.out.reduce((n, x) => n + x.amountMinor, 0n);
    await this.audit.log({ actorId: actor.id, action: door ? 'order.items_refused' : 'order.items_changed', entityType: 'Order', entityId: result.order.id, after: { orderNumber, reason, changes: changes.map((c) => ({ itemId: c.itemId, quantity: c.quantity })), amountMinor: total.toString() } });
    for (const id of refundIds) this.events?.emit(EVENTS.REFUND_REQUESTED, { id });
    const paidByCard = result.out.some((x) => x.summary.endsWith('|refund'));
    const summary = result.out.map((x) => x.summary.replace(/\|(cash|refund)$/, '')).join('; ');
    await this.tell(result.order.userId, result.order.orderNumber, summary, total, result.order.currencyCode, paidByCard ? 'refund' : 'cash');
    return { orderNumber, amountMinor: total.toString(), refunds: refundIds };
  }

  /**
   * The customer asked for something more (usually on the phone) before the shipment leaves: a new line on the
   * shipment of the same seller, at today's price (a live deal included), stock reserved, totals and commission
   * updated and the extra added to the cash to collect. Cash-on-delivery orders only: a paid card order cannot be
   * charged again here — place a new order for the extra items.
   */
  async addItem(orderNumber: string, input: { variantId: string; quantity: number; reason: string }, actor: { id: string }) {
    const now = new Date();
    const res = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        select: {
          id: true, orderNumber: true, userId: true, countryCode: true, currencyCode: true,
          country: { select: { pricesIncludeTax: true, vatRateBps: true } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, method: true, status: true } },
          sellerOrders: { select: { id: true, sellerId: true, status: true, subtotalMinor: true, discountMinor: true, taxMinor: true, commissionMinor: true, deliveryFeeMinor: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id}::uuid FOR UPDATE`;
      const pay = order.payments[0];
      if (!pay || pay.method !== 'COD' || !['PENDING', 'AUTHORIZED'].includes(pay.status)) {
        throw new ConflictException({ message: 'Items can only be added to cash-on-delivery orders. For a paid order, place a new order for the extra items.', reason: 'ADD_NEEDS_COD' });
      }
      const v = await tx.productVariant.findUnique({
        where: { id: input.variantId },
        select: {
          id: true, sku: true, isActive: true, priceMinor: true,
          campaignProducts: { select: { campaignId: true, dealPriceMinor: true, stockLimit: true, soldCount: true, campaign: { select: { isActive: true, startsAt: true, endsAt: true, countryCode: true } } } },
          product: { select: { id: true, title: true, status: true, deletedAt: true, countryCode: true, category: { select: { path: true } }, images: { select: { fileKey: true }, orderBy: { sortOrder: 'asc' }, take: 1 }, store: { select: { isActive: true, sellerId: true } } } },
        },
      });
      if (!v || !v.isActive || v.product.status !== 'ACTIVE' || v.product.deletedAt || !v.product.store.isActive) throw new NotFoundException('This product is not on sale');
      if (v.product.countryCode !== order.countryCode) throw new BadRequestException('This product is not sold in the order’s country');
      const so = order.sellerOrders.find((x) => x.sellerId === v.product.store.sellerId && x.status !== 'CANCELLED');
      if (!so) throw new BadRequestException({ message: 'This order has no shipment from that seller. Place a new order instead.', reason: 'OTHER_SELLER' });
      if (!STAFF_EDITABLE.includes(so.status)) throw new ConflictException({ message: 'This shipment has left the warehouse and can no longer be changed.', reason: 'NOT_EDITABLE' });

      let { unit, campaignId } = effectiveUnitPrice(v, order.countryCode, now);
      const deal = campaignId ? v.campaignProducts.find((c) => c.campaignId === campaignId) : null;
      if (deal && deal.stockLimit !== null && deal.soldCount + input.quantity > deal.stockLimit) { unit = v.priceMinor; campaignId = null; } // not enough deal units left

      const reserved = await tx.$executeRaw`
        UPDATE "Inventory" SET "reserved" = "reserved" + ${input.quantity}, "version" = "version" + 1, "updatedAt" = now()
        WHERE "variantId" = ${v.id}::uuid AND "onHand" - "reserved" >= ${input.quantity}`;
      if (reserved !== 1) throw new ConflictException({ message: `Not enough "${v.product.title}" in stock`, reason: 'OUT_OF_STOCK' });
      if (campaignId) await tx.$executeRaw`UPDATE "CampaignProduct" SET "soldCount" = "soldCount" + ${input.quantity} WHERE "campaignId" = ${campaignId}::uuid AND "variantId" = ${v.id}::uuid`;

      const inclusive = order.country.pricesIncludeTax;
      const subtotal = unit * BigInt(input.quantity);
      const tax = taxOn(subtotal, { rateBps: order.country.vatRateBps, inclusive });
      const lineTotal = inclusive ? subtotal : subtotal + tax;
      let commission = { commissionMinor: 0n, ruleId: null as string | null, snapshot: {} as Record<string, unknown> };
      if (this.commissions) {
        const rules = await this.commissions.loadRules(order.countryCode);
        const c = this.commissions.compute(rules, { countryCode: order.countryCode, categoryPath: v.product.category.path, sellerId: so.sellerId, productId: v.product.id, campaignId, quantity: input.quantity, netAmountMinor: subtotal }, now);
        commission = { commissionMinor: c.commissionMinor, ruleId: c.ruleId, snapshot: c.snapshot as Record<string, unknown> };
      }
      const item = await tx.orderItem.create({
        data: {
          orderId: order.id, sellerOrderId: so.id, variantId: v.id, productTitle: v.product.title, sku: v.sku, imageKey: v.product.images[0]?.fileKey ?? null,
          unitPriceMinor: unit, quantity: input.quantity, discountMinor: 0n, taxMinor: tax, lineTotalMinor: lineTotal,
          commissionMinor: commission.commissionMinor, commissionRuleId: commission.ruleId, campaignId,
          commissionSnapshot: { ...commission.snapshot, addedAfterCheckout: true } as Prisma.InputJsonValue, status: so.status,
        },
        select: { id: true },
      });
      await tx.inventoryMovement.create({ data: { variantId: v.id, qtyDelta: 0, reason: 'RESERVE', refType: 'order_item', refId: item.id, actorId: actor.id, note: `Added to ${orderNumber}: ${input.quantity}` } });
      const soSubtotal = so.subtotalMinor + subtotal;
      const soCommission = so.commissionMinor + commission.commissionMinor;
      await tx.sellerOrder.update({
        where: { id: so.id },
        data: { subtotalMinor: soSubtotal, taxMinor: so.taxMinor + tax, commissionMinor: soCommission, sellerNetMinor: soSubtotal - so.discountMinor + so.deliveryFeeMinor - soCommission },
      });
      await tx.order.update({ where: { id: order.id }, data: { subtotalMinor: { increment: subtotal }, taxMinor: { increment: tax }, totalMinor: { increment: lineTotal } } });
      await tx.payment.update({ where: { id: pay.id }, data: { amountMinor: { increment: lineTotal } } });
      const summary = `${v.product.title} × ${input.quantity} added`;
      await tx.orderChange.create({
        data: {
          orderId: order.id, sellerOrderId: so.id, kind: 'ADDED', byRole: 'STAFF', actorId: actor.id, reason: input.reason.slice(0, 500), summary,
          before: {}, after: { [item.id]: input.quantity, variantId: v.id } as Prisma.InputJsonValue, amountMinor: lineTotal, // ADDED: how much more
        },
      });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, sellerOrderId: so.id, toStatus: so.status, actorId: actor.id, note: `Order changed: ${summary}`.slice(0, 500) } });
      return { order, summary, lineTotal, itemId: item.id };
    });
    await this.audit.log({ actorId: actor.id, action: 'order.items_added', entityType: 'Order', entityId: res.order.id, after: { orderNumber, variantId: input.variantId, quantity: input.quantity, reason: input.reason, amountMinor: res.lineTotal.toString() } });
    await this.tellAdded(res.order.userId, orderNumber, res.summary, res.lineTotal, res.order.currencyCode);
    return { orderNumber, itemId: res.itemId, amountMinor: res.lineTotal.toString() };
  }

  /** Products that can be added to this order: same market, sellers that still have an open shipment on it. */
  async addableProducts(orderNumber: string, q: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber }, select: { countryCode: true, currencyCode: true, sellerOrders: { select: { sellerId: true, status: true } } } });
    if (!order) throw new NotFoundException('Order not found');
    const sellers = order.sellerOrders.filter((so) => STAFF_EDITABLE.includes(so.status)).map((so) => so.sellerId);
    if (!sellers.length) return [];
    const term = q.trim();
    const rows = await this.prisma.productVariant.findMany({
      where: {
        isActive: true,
        product: { status: 'ACTIVE', deletedAt: null, countryCode: order.countryCode, store: { isActive: true, sellerId: { in: sellers } } },
        OR: [{ sku: { contains: term, mode: 'insensitive' } }, { barcode: term }, { product: { title: { contains: term, mode: 'insensitive' } } }, { product: { titleAr: { contains: term } } }],
      },
      take: 20, orderBy: { product: { title: 'asc' } },
      select: { id: true, sku: true, priceMinor: true, optionValues: true, inventory: { select: { onHand: true, reserved: true } }, product: { select: { title: true, store: { select: { name: true } } } } },
    });
    return rows.map((v) => ({
      variantId: v.id, sku: v.sku, title: v.product.title, options: v.optionValues, store: v.product.store.name, priceMinor: v.priceMinor.toString(), currencyCode: order.currencyCode,
      available: Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)),
    }));
  }

  // ------------------------------------------------------------------ address and window

  /** Who is changing what is checked here, once, for address and window alike. */
  private async loadForChange(tx: Tx, orderNumber: string, who: { role: ChangeRole; userId?: string; orderId?: string }) {
    const order = await tx.order.findFirst({
      where: { orderNumber, ...(who.role === 'CUSTOMER' && (who.userId ? { userId: who.userId } : { id: who.orderId })) },
      select: {
        id: true, orderNumber: true, userId: true, countryCode: true, shippingAddress: true, deliverySlotStart: true, deliverySlotEnd: true,
        country: { select: { addressFormat: true } },
        sellerOrders: { select: { status: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } },
        user: { select: { locale: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id}::uuid FOR UPDATE`;
    const live = order.sellerOrders.filter((so) => so.status !== 'CANCELLED');
    const allowed = who.role === 'CUSTOMER' ? CUSTOMER_EDITABLE : STAFF_EDITABLE;
    if (!live.length || !live.every((so) => allowed.includes(so.status))) {
      throw new ConflictException({
        message: who.role === 'CUSTOMER' ? 'Your order is already packed or on its way, so it can no longer be changed. Please contact us.' : 'A shipment has left the warehouse: the address and window can no longer be changed.',
        reason: 'NOT_EDITABLE',
      });
    }
    if (who.role === 'CUSTOMER') {
      const done = await tx.orderChange.count({ where: { orderId: order.id, byRole: 'CUSTOMER' } });
      if (done >= CUSTOMER_CHANGE_LIMIT) throw new ForbiddenException({ message: 'This order was already changed several times. Please contact us for another change.', reason: 'CHANGE_LIMIT' });
    }
    return order;
  }

  /**
   * New delivery address (staff: any; customer: one of their saved addresses, or a full address for guests).
   * Cash orders keep the cash-on-delivery safety rules: a number blocked for cash cannot be used.
   */
  async changeAddress(orderNumber: string, input: { addressId?: string; address?: AddressDto }, reason: string | undefined, who: { role: 'STAFF' | 'CUSTOMER'; actorId: string; userId?: string; orderId?: string }) {
    const res = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadForChange(tx, orderNumber, { role: who.role, userId: who.userId, orderId: who.orderId });
      let next: Record<string, unknown>;
      if (input.addressId) {
        const a = await tx.address.findFirst({ where: { id: input.addressId, userId: order.userId } });
        if (!a) throw new NotFoundException('Address not found');
        next = { addressId: a.id, ...Object.fromEntries(ADDRESS_KEYS.map((k) => [k, (a as Record<string, unknown>)[k] ?? null]).filter(([, v]) => v !== null && v !== undefined)) };
      } else if (input.address) {
        assertAddressFormat(input.address, order.country.addressFormat);
        if (input.address.countryCode && input.address.countryCode !== order.countryCode) throw new BadRequestException('The new address must be in the same country');
        const { isDefault: _d, ...rest } = input.address;
        next = Object.fromEntries(Object.entries({ ...rest, countryCode: order.countryCode }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      } else {
        throw new BadRequestException('Choose an address');
      }
      if (order.payments[0]?.method === 'COD' && typeof next.phone === 'string') {
        const blocked = await tx.user.count({ where: { phone: next.phone, codBlocked: true } });
        if (blocked) throw new ForbiddenException({ message: 'Cash on delivery is not available for this phone number. Please contact us.', reason: 'COD_BLOCKED' });
      }
      const before = (order.shippingAddress ?? {}) as Record<string, unknown>;
      const summary = `Delivery address: ${addressLine(next)}`;
      await tx.order.update({ where: { id: order.id }, data: { shippingAddress: next as Prisma.InputJsonValue } });
      await tx.orderChange.create({ data: { orderId: order.id, kind: 'ADDRESS', byRole: who.role, actorId: who.actorId, reason: reason?.slice(0, 500), summary: summary.slice(0, 1000), before: before as Prisma.InputJsonValue, after: next as Prisma.InputJsonValue } });
      return { order, summary };
    });
    await this.audit.log({ actorId: who.actorId, action: 'order.address_changed', entityType: 'Order', entityId: res.order.id, after: { orderNumber, by: who.role, reason: reason ?? null } });
    if (who.role === 'STAFF') await this.tell(res.order.userId, orderNumber, res.summary, 0n, '', null);
    return { orderNumber, summary: res.summary };
  }

  /** Move the order to another delivery window (or none, when windows are optional): the old place is given back. */
  async changeSlot(orderNumber: string, deliverySlot: string | null, reason: string | undefined, who: { role: 'STAFF' | 'CUSTOMER'; actorId: string; userId?: string; orderId?: string }) {
    if (!this.slots) throw new BadRequestException('Delivery windows are not available');
    const res = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadForChange(tx, orderNumber, { role: who.role, userId: who.userId, orderId: who.orderId });
      if (deliverySlot && order.deliverySlotStart && new Date(deliverySlot).getTime() === order.deliverySlotStart.getTime()) throw new BadRequestException('That is already the delivery time');
      const slot = await this.slots!.book(tx, order.countryCode, deliverySlot ?? undefined);
      if (!slot && deliverySlot) throw new BadRequestException('Delivery windows are switched off');
      await this.slots!.release(tx, order.countryCode, order.deliverySlotStart);
      const tz = tzFor(order.countryCode).tz;
      const label = (s: Date | null, e: Date | null) => (s && e ? slotLabel(s, e, tz, 'en') : 'Any time');
      const summary = `Delivery time: ${label(slot?.start ?? null, slot?.end ?? null)} (was ${label(order.deliverySlotStart, order.deliverySlotEnd)})`;
      await tx.order.update({ where: { id: order.id }, data: { deliverySlotStart: slot?.start ?? null, deliverySlotEnd: slot?.end ?? null } });
      await tx.orderChange.create({
        data: {
          orderId: order.id, kind: 'SLOT', byRole: who.role, actorId: who.actorId, reason: reason?.slice(0, 500), summary,
          before: { start: order.deliverySlotStart, end: order.deliverySlotEnd } as Prisma.InputJsonValue, after: { start: slot?.start ?? null, end: slot?.end ?? null } as Prisma.InputJsonValue,
        },
      });
      return { order, summary, slot, tz };
    });
    await this.audit.log({ actorId: who.actorId, action: 'order.slot_changed', entityType: 'Order', entityId: res.order.id, after: { orderNumber, by: who.role, slot: res.slot?.start ?? null } });
    if (who.role === 'STAFF') {
      const ar = res.order.user.locale === 'ar';
      const when = res.slot ? slotLabel(res.slot.start, res.slot.end, res.tz, res.order.user.locale) : ar ? 'في أي وقت' : 'any time';
      await this.tell(res.order.userId, orderNumber, ar ? `موعد التوصيل الجديد: ${when}` : `New delivery time: ${when}`, 0n, '', null, true);
    }
    return { orderNumber, summary: res.summary, slot: res.slot };
  }

  /** What the customer may still change on the order (shown as buttons only when allowed). */
  async customerOptions(orderId: string) {
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { sellerOrders: { select: { status: true } }, changes: { where: { byRole: 'CUSTOMER' }, select: { id: true } } } });
    const live = o.sellerOrders.filter((so) => so.status !== 'CANCELLED');
    const open = live.length > 0 && live.every((so) => CUSTOMER_EDITABLE.includes(so.status));
    const left = Math.max(0, CUSTOMER_CHANGE_LIMIT - o.changes.length);
    return { canChange: open && left > 0, changesLeft: left };
  }

  // ------------------------------------------------------------------ message

  private async tellAdded(userId: string, orderNumber: string, summary: string, amount: bigint, currency: string) {
    if (!this.notifications) return;
    try {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
      const ar = u?.locale === 'ar';
      const moneyLine = ar ? ` المبلغ المطلوب عند التسليم أكثر بـ ${formatMoney(amount, currency)}.` : ` You pay ${formatMoney(amount, currency)} more on delivery.`;
      await this.notifications.notify(userId, 'ORDER_CHANGED', { orderNumber, summary: (ar ? `تمت إضافة: ${summary}` : summary).slice(0, 400), moneyLine }, { orderNumber });
    } catch (e) {
      this.logger.warn(`order changed notice failed: ${(e as Error).message}`);
    }
  }

  private async tell(userId: string, orderNumber: string, summary: string, amount: bigint, currency: string, money: 'cash' | 'refund' | null, localised = false) {
    if (!this.notifications) return;
    try {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
      const ar = u?.locale === 'ar';
      const moneyLine = amount > 0n
        ? money === 'refund'
          ? (ar ? ` سنعيد ${formatMoney(amount, currency)} إلى وسيلة الدفع.` : ` We will refund ${formatMoney(amount, currency)} to your payment method.`)
          : (ar ? ` المبلغ المطلوب عند التسليم أقل بـ ${formatMoney(amount, currency)}.` : ` You pay ${formatMoney(amount, currency)} less on delivery.`)
        : '';
      const text = localised || !ar ? summary : `تغييرات: ${summary}`;
      await this.notifications.notify(userId, 'ORDER_CHANGED', { orderNumber, summary: text.slice(0, 400), moneyLine }, { orderNumber });
    } catch (e) {
      this.logger.warn(`order changed notice failed: ${(e as Error).message}`);
    }
  }
}

// ====================================================================== HTTP

class ItemChangeDto {
  @ApiProperty() @IsUUID() itemId: string;
  @ApiProperty({ minimum: 0, description: 'How many to keep (0 removes the line)' }) @Type(() => Number) @IsInt() @Min(0) @Max(9999) quantity: number;
}
class ChangeItemsDto {
  @ApiProperty({ type: [ItemChangeDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemChangeDto) changes: ItemChangeDto[];
  @ApiProperty({ example: 'Customer called: only one box' }) @Transform(trim) @IsString() @Length(5, 300) reason: string;
}
class AddItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity: number;
  @ApiProperty({ example: 'Customer called: add a second charger' }) @Transform(trim) @IsString() @Length(5, 300) reason: string;
}
class AddableQuery { @ApiProperty({ example: 'charger' }) @Transform(trim) @IsString() @Length(2, 100) q: string; }
class StaffAddressDto {
  @ApiPropertyOptional({ description: 'One of the customer’s saved addresses' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ type: AddressDto }) @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}
class SlotDto {
  @ApiPropertyOptional({ nullable: true, example: '2026-10-09T13:00:00.000Z', description: 'Start of a window from GET /delivery/slots; null = any time (when windows are optional)' })
  @IsOptional() @IsISO8601({ strict: true }) deliverySlot?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}
class CustomerAddressDto {
  @ApiPropertyOptional({ description: 'Signed-in customers: one of their saved addresses' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ type: AddressDto, description: 'Guests: the full new address' }) @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
}

@ApiTags('Admin / Orders') @ApiBearerAuth()
@Controller({ path: 'admin/orders', version: '1' })
export class AdminOrderChangesController {
  constructor(private readonly changes: OrderChangesService) {}

  /** Reduce or remove items before the shipment leaves (stock freed, totals, cash or refund follow). */
  @RequirePermissions('orders.update') @HttpCode(200) @Patch(':orderNumber/items')
  items(@Param('orderNumber') n: string, @Body() d: ChangeItemsDto, @CurrentUser() u: AuthUser) {
    return this.changes.changeItems(n, d.changes, d.reason, { id: u.id, role: 'STAFF' });
  }
  /** Products that can be added to the order (sellers with an open shipment on it). */
  @RequirePermissions('orders.update') @Get(':orderNumber/addable-products')
  addable(@Param('orderNumber') n: string, @Query() q: AddableQuery) { return this.changes.addableProducts(n, q.q); }

  /** Add an item before the shipment leaves (cash-on-delivery orders): stock reserved, the cash to collect goes up. */
  @RequirePermissions('orders.update') @Post(':orderNumber/items')
  add(@Param('orderNumber') n: string, @Body() d: AddItemDto, @CurrentUser() u: AuthUser) {
    return this.changes.addItem(n, d, { id: u.id });
  }
  @RequirePermissions('orders.update') @Put(':orderNumber/address')
  address(@Param('orderNumber') n: string, @Body() d: StaffAddressDto, @CurrentUser() u: AuthUser) {
    return this.changes.changeAddress(n, d, d.reason, { role: 'STAFF', actorId: u.id });
  }
  @RequirePermissions('orders.update') @Put(':orderNumber/slot')
  slot(@Param('orderNumber') n: string, @Body() d: SlotDto, @CurrentUser() u: AuthUser) {
    return this.changes.changeSlot(n, d.deliverySlot ?? null, d.reason, { role: 'STAFF', actorId: u.id });
  }
}

@ApiTags('Orders') @ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class CustomerOrderChangesController {
  constructor(private readonly changes: OrderChangesService) {}

  /** Before packing is finished: deliver to another of my saved addresses. */
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) @Put(':orderNumber/address')
  address(@Param('orderNumber') n: string, @Body() d: CustomerAddressDto, @CurrentUser() u: AuthUser) {
    if (!d.addressId) throw new BadRequestException('Choose one of your saved addresses');
    return this.changes.changeAddress(n, { addressId: d.addressId }, undefined, { role: 'CUSTOMER', actorId: u.id, userId: u.id });
  }
  /** Before packing is finished: another delivery window. */
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) @Put(':orderNumber/slot')
  slot(@Param('orderNumber') n: string, @Body() d: SlotDto, @CurrentUser() u: AuthUser) {
    return this.changes.changeSlot(n, d.deliverySlot ?? null, undefined, { role: 'CUSTOMER', actorId: u.id, userId: u.id });
  }
}

@ApiTags('Orders')
@Controller({ path: 'orders/guest', version: '1' })
export class GuestOrderChangesController {
  constructor(private readonly changes: OrderChangesService, private readonly access: OrderAccessService, private readonly prisma: PrismaService) {}

  private async guest(orderNumber: string, token?: string) {
    const o = await this.prisma.order.findUnique({ where: { orderNumber: orderNumber.toUpperCase() }, select: { id: true, userId: true } });
    if (!o || !this.access.verify(o.id, token)) throw new UnauthorizedException('This link has expired or is not valid. Look the order up with its number and your email.');
    return o;
  }
  @Public() @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) @ApiHeader({ name: 'X-Order-Token', required: true }) @Put(':orderNumber/address')
  async address(@Param('orderNumber') n: string, @Body() d: CustomerAddressDto, @Headers('x-order-token') token?: string) {
    const o = await this.guest(n, token);
    if (!d.address) throw new BadRequestException('Enter the new address');
    return this.changes.changeAddress(n.toUpperCase(), { address: d.address }, undefined, { role: 'CUSTOMER', actorId: o.userId, orderId: o.id });
  }
  @Public() @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) @ApiHeader({ name: 'X-Order-Token', required: true }) @Put(':orderNumber/slot')
  async slot(@Param('orderNumber') n: string, @Body() d: SlotDto, @Headers('x-order-token') token?: string) {
    const o = await this.guest(n, token);
    return this.changes.changeSlot(n.toUpperCase(), d.deliverySlot ?? null, undefined, { role: 'CUSTOMER', actorId: o.userId, orderId: o.id });
  }
}
