import { parseLabelQr } from '../documents/label';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { EVENTS, ShipmentStatusEvent } from '../notifications/notification.events';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateUpload } from '../storage/file-validation';
import { StorageService } from '../storage/storage.service';
import { shipmentPaidTotal } from '../finance/finance-math';
import { tzFor } from '../analytics/range';
import { CashService } from '../cash/cash';
import { CodGuardService } from '../cash/cod-rules';
import { renderRunSheet } from '../documents/run-sheet';
import { codeMatches, courierCan, deliveryStatusFor, distanceMetres, FAR_FROM_ADDRESS_M, firstName, mapLink, newDeliveryCode, runOrder } from './delivery-rules';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderAccessService } from '../common/order-access.service';
import { DeliverySlotsService } from './slots.module';
import { slotLabel } from './slots';

const ACTIVE: DeliveryStatus[] = ['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'FAILED'];

/**
 * One delivery record per seller shipment, whoever delivers it (seller, FastMoveX fleet, later 3PLs).
 * Shipment status is the source of truth: seller actions create/update the delivery record through the
 * SHIPMENT_STATUS event; courier actions move the shipment through OrdersService (actor SYSTEM),
 * which emits the same event — the listener sees nothing changed and stops (no loops).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Optional() private readonly cash?: CashService,
    @Optional() private readonly cod?: CodGuardService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly access?: OrderAccessService,
    @Optional() private readonly slots?: DeliverySlotsService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  @OnEvent(EVENTS.SHIPMENT_STATUS, { async: true })
  async onShipmentStatus(e: ShipmentStatusEvent) {
    try {
      await this.sync(e.sellerOrderId);
    } catch (err) {
      this.logger.error(`delivery sync failed for ${e.sellerOrderId}: ${(err as Error).message}`);
    }
  }

  async sync(sellerOrderId: string, attempt = 0): Promise<void> {
    const so = await this.prisma.sellerOrder.findUnique({ where: { id: sellerOrderId }, select: { id: true, status: true, delivery: true } });
    if (!so) return;
    const target = deliveryStatusFor(so.status, !!so.delivery, so.delivery?.method);
    if (!target) return;

    if (!so.delivery) {
      if (target === 'CANCELLED' || target === 'DELIVERED') return; // nothing was ever dispatched
      const fleet = so.status === 'READY_FOR_PICKUP';
      try {
        await this.prisma.$transaction([
          this.prisma.deliveryOrder.create({
            data: {
              sellerOrderId, method: fleet ? 'JOVIA' : 'SELLER', providerCode: fleet ? 'jovia_fleet' : 'seller', status: target,
              deliveryCode: fleet ? newDeliveryCode() : null, pickedUpAt: fleet ? null : new Date(),
              events: { create: { status: target, note: fleet ? 'Waiting for a FastMoveX courier' : 'Seller is delivering' } },
            },
          }),
          this.prisma.sellerOrder.update({ where: { id: sellerOrderId }, data: { deliveryMethod: fleet ? 'JOVIA' : 'SELLER' } }),
        ]);
      } catch (e) {
        // the same change reached us twice at once (event listener + direct call): the other one made the record
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
        throw e;
      }
      return;
    }
    if (so.delivery.status === target) return; // already in sync (courier-driven change)
    // Only if nobody changed it since we read it: two quick shipment changes (shipped, then delivered) fire two syncs,
    // and the older one must not overwrite the newer state. If it moved, read again and redo.
    const moved = await this.prisma.deliveryOrder.updateMany({
      where: { id: so.delivery.id, status: so.delivery.status },
      data: {
        status: target,
        ...(target === 'DELIVERED' && { deliveredAt: new Date() }),
        ...(target === 'PICKED_UP' && { pickedUpAt: new Date() }),
      },
    });
    if (moved.count === 1) {
      await this.prisma.deliveryEvent.create({ data: { deliveryOrderId: so.delivery.id, status: target } });
      return;
    }
    if (attempt < 3) return this.sync(sellerOrderId, attempt + 1);
  }

  // ------------------------------------------------------------------- ops

  async list(status?: DeliveryStatus, unassignedOnly = false) {
    return this.prisma.deliveryOrder.findMany({
      where: { status: status ?? { in: ACTIVE }, ...(unassignedOnly && { courierUserId: null, method: 'JOVIA' }) },
      orderBy: { createdAt: 'asc' },
      take: 200,
      omit: { deliveryCode: true }, // the customer's proof: staff never see it
      include: {
        sellerOrder: {
          select: {
            id: true, status: true, order: { select: { orderNumber: true, shippingAddress: true, deliverySlotStart: true, deliverySlotEnd: true } },
            warehouse: { select: { id: true, name: true, code: true } },
            seller: { select: { businessName: true, contactPhone: true, store: { select: { name: true, city: true, lat: true, lng: true } } } },
          },
        },
      },
    });
  }

  couriers() {
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { code: 'DELIVERY_AGENT' } } } },
      select: { id: true, fullName: true, phone: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async assign(deliveryId: string, courierUserId: string, adminId: string) {
    const d = await this.prisma.deliveryOrder.findUnique({ where: { id: deliveryId }, select: { status: true, method: true } });
    if (!d) throw new NotFoundException('Delivery not found');
    if (d.method !== 'JOVIA') throw new BadRequestException('Only FastMoveX-fleet deliveries can be assigned to a courier');
    if (!['CREATED', 'ASSIGNED', 'FAILED'].includes(d.status)) throw new BadRequestException(`Cannot assign a ${d.status.toLowerCase()} delivery`);
    const courier = await this.prisma.user.findFirst({
      where: { id: courierUserId, status: 'ACTIVE', roles: { some: { role: { code: 'DELIVERY_AGENT' } } } },
      select: { fullName: true, phone: true },
    });
    if (!courier) throw new BadRequestException('User is not an active delivery agent');
    const next: DeliveryStatus = d.status === 'FAILED' ? 'OUT_FOR_DELIVERY' : 'ASSIGNED'; // failed attempt -> retry run
    await this.prisma.deliveryOrder.update({
      where: { id: deliveryId },
      data: { courierUserId, courierName: courier.fullName, courierPhone: courier.phone, assignedAt: new Date(), status: next, events: { create: { status: next, note: 'Courier assigned' } } },
    });
    await this.audit.log({ actorId: adminId, action: 'delivery.assign', entityType: 'DeliveryOrder', entityId: deliveryId, after: { courierUserId } });
    return this.prisma.deliveryOrder.findUniqueOrThrow({ where: { id: deliveryId }, omit: { deliveryCode: true } });
  }

  // ---------------------------------------------------------------- courier

  courierJobs(courierId: string) {
    return this.prisma.deliveryOrder.findMany({
      where: { courierUserId: courierId, status: { in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED'] } },
      orderBy: { assignedAt: 'asc' },
      select: {
        id: true, status: true, attempts: true, etaAt: true,
        sellerOrder: {
          select: {
            order: { select: { orderNumber: true, shippingAddress: true, customerNote: true } }, // courier needs the address + phone
            seller: { select: { contactPhone: true, store: { select: { name: true, city: true, lat: true, lng: true } } } },
            _count: { select: { items: { where: { status: { not: 'CANCELLED' } } } } },
          },
        },
      },
    });
  }

  /**
   * The driver's day: open jobs plus what they finished today, in the order to drive them (delivery window, then zone),
   * each with what the driver needs at the door — name, phone, address with a map link, items, cash to collect.
   */
  async courierRun(courierId: string, now = new Date()) {
    const dayStart = new Date(Math.floor((now.getTime() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000); // Doha midnight
    const rows = await this.prisma.deliveryOrder.findMany({
      where: {
        courierUserId: courierId,
        OR: [
          { status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] } },
          { status: 'FAILED', updatedAt: { gte: dayStart } },
          { status: 'DELIVERED', deliveredAt: { gte: dayStart } },
        ],
      },
      take: 200,
      select: {
        id: true, status: true, attempts: true, assignedAt: true, deliveredAt: true, failureReason: true, proofOfDeliveryKey: true,
        sellerOrder: {
          select: {
            subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true,
            items: { where: { status: { not: 'CANCELLED' } }, select: { id: true, productTitle: true, quantity: true, unitPriceMinor: true } },
            warehouse: { select: { name: true, address: true, city: true } },
            seller: { select: { contactPhone: true, store: { select: { name: true, city: true, lat: true, lng: true } } } },
            order: {
              select: {
                orderNumber: true, shippingAddress: true, customerNote: true, deliverySlotStart: true, deliverySlotEnd: true, currencyCode: true, countryCode: true,
                payments: { where: { method: 'COD' }, select: { status: true }, take: 1 },
              },
            },
          },
        },
      },
    });
    const taxInclusive = new Map<string, boolean>();
    for (const c of await this.prisma.country.findMany({ select: { code: true, pricesIncludeTax: true } })) taxInclusive.set(c.code, c.pricesIncludeTax);
    const jobs = rows.map((d) => {
      const so = d.sellerOrder;
      const a = (so.order.shippingAddress ?? {}) as Record<string, string | number | null | undefined>;
      const cod = so.order.payments[0];
      const cash = cod && (cod.status === 'PENDING' || cod.status === 'AUTHORIZED' || d.status === 'DELIVERED') ? shipmentPaidTotal(so, taxInclusive.get(so.order.countryCode) ?? true) : null;
      const str = (k: string) => (typeof a[k] === 'string' && a[k] ? (a[k] as string) : null);
      const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : null);
      const address = { zone: str('zone'), street: str('street'), building: str('building'), unit: str('unit'), city: str('city'), line1: str('line1'), lat: num('lat'), lng: num('lng') };
      return {
        id: d.id, status: d.status, attempts: d.attempts, assignedAt: d.assignedAt, deliveredAt: d.deliveredAt, failureReason: d.failureReason, hasPhoto: !!d.proofOfDeliveryKey,
        orderNumber: so.order.orderNumber,
        slot: so.order.deliverySlotStart ? { start: so.order.deliverySlotStart, end: so.order.deliverySlotEnd } : null,
        customer: { name: str('recipientName'), phone: str('phone') },
        address: { ...address, mapUrl: mapLink(address) },
        note: so.order.customerNote,
        items: so.items.map((i) => ({ id: i.id, title: i.productTitle, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor.toString() })),
        pickup: so.warehouse
          ? { name: so.warehouse.name, place: [so.warehouse.address, so.warehouse.city].filter(Boolean).join(', ') || null, phone: so.seller.contactPhone }
          : { name: so.seller.store?.name ?? null, place: so.seller.store?.city ?? null, phone: so.seller.contactPhone },
        cash: cash !== null ? { amountMinor: cash.toString(), currencyCode: so.order.currencyCode } : null,
        // sorting keys
        slotStart: so.order.deliverySlotStart, zone: address.zone,
      };
    });
    const ordered = runOrder(jobs).map(({ slotStart: _s, zone: _z, ...j }) => j);
    const open = ordered.filter((j) => j.status !== 'DELIVERED' && j.status !== 'FAILED');
    const sum = (list: typeof ordered) => list.reduce((n, j) => n + BigInt(j.cash?.amountMinor ?? '0'), 0n).toString();
    return {
      summary: {
        toDo: open.length,
        delivered: ordered.filter((j) => j.status === 'DELIVERED').length,
        failed: ordered.filter((j) => j.status === 'FAILED').length,
        cashToCollectMinor: sum(open),
        cashCollectedMinor: sum(ordered.filter((j) => j.status === 'DELIVERED')),
        currencyCode: rows[0]?.sellerOrder.order.currencyCode ?? 'QAR',
      },
      jobs: ordered,
    };
  }

  private async myJob(deliveryId: string, courierId: string) {
    const d = await this.prisma.deliveryOrder.findUnique({ where: { id: deliveryId }, select: { id: true, status: true, courierUserId: true, sellerOrderId: true, deliveryCode: true, attempts: true } });
    if (!d || d.courierUserId !== courierId) throw new NotFoundException('Job not found'); // couriers see only their own jobs
    return d;
  }

  private async step(deliveryId: string, courierId: string, to: DeliveryStatus, extra: Prisma.DeliveryOrderUpdateInput = {}, note?: string) {
    const d = await this.myJob(deliveryId, courierId);
    if (!courierCan(d.status, to)) throw new BadRequestException(`Cannot go from ${d.status.toLowerCase()} to ${to.toLowerCase()}`);
    // Delivery record first (so the SHIPMENT_STATUS listener finds it already in sync), then the shipment
    await this.prisma.deliveryOrder.update({ where: { id: d.id }, data: { status: to, ...extra, events: { create: { status: to, note } } } });
    const soStatus = to === 'PICKED_UP' ? 'SHIPPED' : to === 'OUT_FOR_DELIVERY' ? 'OUT_FOR_DELIVERY' : to === 'DELIVERED' ? 'DELIVERED' : null;
    if (soStatus) {
      const so = await this.prisma.sellerOrder.findUniqueOrThrow({ where: { id: d.sellerOrderId }, select: { status: true } });
      if (so.status !== soStatus) await this.orders.setSellerOrderStatus(d.sellerOrderId, soStatus, 'SYSTEM', courierId, note);
    }
    return this.prisma.deliveryOrder.findUniqueOrThrow({ where: { id: d.id }, select: { id: true, status: true, attempts: true } });
  }

  async pickup(id: string, courierId: string) {
    if (this.cash) {
      const d = await this.prisma.deliveryOrder.findFirst({ where: { id, courierUserId: courierId }, select: { sellerOrder: { select: { order: { select: { countryCode: true } } } } } });
      if (d) await this.cash.assertCanPickUp(courierId, d.sellerOrder.order.countryCode);
    }
    return this.step(id, courierId, 'PICKED_UP', { pickedUpAt: new Date() }, 'Picked up from seller');
  }

  /**
   * The driver scans a parcel's label at the seller: if it is one of their assigned jobs it is picked up in one step;
   * a parcel already picked up just says so; anything else is not theirs to take.
   */
  async scanPickup(courierId: string, code: string) {
    const sellerOrderId = parseLabelQr(code);
    if (!sellerOrderId) throw new BadRequestException('This is not a FastMoveX label. Scan the QR on the parcel.');
    const d = await this.prisma.deliveryOrder.findFirst({
      where: { sellerOrderId, courierUserId: courierId, status: { notIn: ['CANCELLED', 'RETURNED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, sellerOrder: { select: { order: { select: { orderNumber: true } } } } },
    });
    if (!d) throw new NotFoundException('This parcel is not on your list. Ask operations to assign it to you.');
    const orderNumber = d.sellerOrder.order.orderNumber;
    if (d.status !== 'ASSIGNED') return { id: d.id, orderNumber, status: d.status, pickedUp: false };
    await this.pickup(d.id, courierId);
    return { id: d.id, orderNumber, status: 'PICKED_UP' as const, pickedUp: true };
  }

  outForDelivery(id: string, courierId: string) {
    return this.step(id, courierId, 'OUT_FOR_DELIVERY', { failureReason: null }, 'Out for delivery');
  }

  async location(id: string, courierId: string, lat: number, lng: number) {
    const d = await this.myJob(id, courierId);
    if (!['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(d.status)) throw new BadRequestException('Location is only shared while delivering');
    await this.prisma.deliveryOrder.update({ where: { id }, data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() } });
    return { ok: true };
  }

  /** Proof of delivery: the customer's 4-digit code, plus an optional doorstep photo. 5 wrong codes lock the job. */
  async deliver(id: string, courierId: string, code: string, recipientName?: string, photo?: Express.Multer.File) {
    const d = await this.myJob(id, courierId);
    if (d.status !== 'OUT_FOR_DELIVERY') throw new BadRequestException('Mark the job out for delivery first');
    if (d.attempts >= 5) throw new ForbiddenException('Too many wrong codes. Contact operations.');
    if (!codeMatches(d.deliveryCode, code)) {
      await this.prisma.deliveryOrder.update({ where: { id }, data: { attempts: { increment: 1 } } });
      await this.audit.log({ actorId: courierId, action: 'delivery.code_failed', entityType: 'DeliveryOrder', entityId: id, after: { attempt: d.attempts + 1 } });
      throw new BadRequestException('Wrong delivery code');
    }
    let proofKey: string | undefined;
    if (photo) {
      const f = validateUpload(photo, 'image');
      proofKey = `deliveries/${id}/${randomUUID()}.${f.ext}`;
      await this.storage.put('private', proofKey, f.buffer, f.mime); // doorstep photos are private
    }
    return this.step(id, courierId, 'DELIVERED', { deliveredAt: new Date(), recipientName, proofOfDeliveryKey: proofKey }, 'Delivered, code verified');
  }

  /**
   * A failed attempt. `refused` = the customer turned the order down at the door: on a cash-on-delivery order it counts
   * towards switching COD off for that customer (CodGuardService).
   */
  async fail(id: string, courierId: string, reason: string, refused = false, proof: { lat?: number; lng?: number; photo?: Express.Multer.File } = {}) {
    const job = await this.myJob(id, courierId);
    if (!courierCan(job.status, 'FAILED')) throw new BadRequestException(`Cannot go from ${job.status.toLowerCase()} to failed`);
    // proof of the attempt: where the driver was (and how far from the customer's pin), and a photo of the door
    const pin = await this.prisma.deliveryOrder.findUniqueOrThrow({ where: { id }, select: { sellerOrder: { select: { order: { select: { shippingAddress: true } } } } } });
    const a = (pin.sellerOrder.order.shippingAddress ?? {}) as { lat?: unknown; lng?: unknown };
    const at = typeof proof.lat === 'number' && typeof proof.lng === 'number' ? { lat: proof.lat, lng: proof.lng } : null;
    const distance = at && typeof a.lat === 'number' && typeof a.lng === 'number' ? distanceMetres(at, { lat: a.lat, lng: a.lng }) : null;
    let photoKey: string | undefined;
    if (proof.photo) {
      const f = validateUpload(proof.photo, 'image');
      photoKey = `deliveries/${id}/failed-${randomUUID()}.${f.ext}`;
      await this.storage.put('private', photoKey, f.buffer, f.mime);
    }
    const where = at ? ` · at ${at.lat.toFixed(5)},${at.lng.toFixed(5)}${distance !== null ? ` (${distance} m from the address${distance > FAR_FROM_ADDRESS_M ? ' — far' : ''})` : ''}` : ' · no location';
    const note = (refused ? `[refused] Customer refused the order: ${reason}` : `Delivery attempt failed: ${reason}`) + where;
    const out = await this.step(id, courierId, 'FAILED', {
      failureReason: refused ? `Refused: ${reason}` : reason, failedAt: new Date(), failureLat: at?.lat ?? null, failureLng: at?.lng ?? null,
      failureDistanceM: distance, failurePhotoKey: photoKey ?? null, customerRequest: null, customerRequestAt: null,
    }, note);
    if (at) await this.prisma.deliveryEvent.updateMany({ where: { deliveryOrderId: id, status: 'FAILED', lat: null, occurredAt: { gte: new Date(Date.now() - 60_000) } }, data: { lat: at.lat, lng: at.lng } });
    await this.audit.log({ actorId: courierId, action: 'delivery.failed', entityType: 'DeliveryOrder', entityId: id, after: { reason, refused, distanceM: distance, hasPhoto: !!photoKey, hasLocation: !!at } });
    if (refused) await this.cod?.recordRefusal(id, courierId);
    else await this.tellCustomerAttemptFailed(id, reason).catch((e: Error) => this.logger.warn(`failed-attempt notice: ${e.message}`));
    this.events?.emit(EVENTS.DELIVERY_FAILED, { id, reason: refused ? `Refused: ${reason}` : reason });
    return out;
  }

  /** The customer hears about it at once, with a link to choose a new time (guests get their private order link). */
  private async tellCustomerAttemptFailed(deliveryId: string, reason: string) {
    if (!this.notifications) return;
    const d = await this.prisma.deliveryOrder.findUniqueOrThrow({
      where: { id: deliveryId },
      select: { sellerOrder: { select: { order: { select: { id: true, orderNumber: true, userId: true, user: { select: { isGuest: true, locale: true } } } } } } },
    });
    const o = d.sellerOrder.order;
    const base = process.env.STOREFRONT_URL?.replace(/\/$/, '');
    const link = o.user.isGuest ? this.access?.trackUrl(o.orderNumber, o.id, o.user.locale) ?? '' : base ? `${base}/${o.user.locale === 'ar' ? 'ar' : 'en'}/account/orders/${o.orderNumber}` : '';
    const ar = o.user.locale === 'ar';
    const friendly: Record<string, [string, string]> = {
      'Customer not answering': ['we could not reach you by phone', 'لم نتمكن من الوصول إليك هاتفياً'],
      'Customer not at home': ['nobody was at home', 'لم يكن أحد في المنزل'],
      'Wrong or incomplete address': ['we could not find the address', 'لم نتمكن من إيجاد العنوان'],
      'Customer asked for another day': ['you asked for another day', 'طلبت يوماً آخر'],
    };
    const why = friendly[reason]?.[ar ? 1 : 0] ?? (ar ? 'لم نتمكن من التسليم' : 'the delivery could not be completed');
    await this.notifications.notify(o.userId, 'DELIVERY_FAILED', { orderNumber: o.orderNumber, reason: why, link }, { orderNumber: o.orderNumber });
  }

  /**
   * After a failed attempt the customer chooses what happens next: a new delivery window (when the market uses them)
   * and/or a note for the driver. Operations see it on the delivery and send the driver again.
   */
  async reschedule(orderNumber: string, who: { userId?: string; guestOrderId?: string }, input: { deliverySlot?: string; note?: string }) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, ...(who.userId ? { userId: who.userId } : { id: who.guestOrderId }) },
      select: { id: true, countryCode: true, user: { select: { locale: true } }, sellerOrders: { select: { delivery: { select: { id: true, status: true, failureReason: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const d = order.sellerOrders.map((so) => so.delivery).find((x) => x?.status === 'FAILED');
    if (!d) throw new BadRequestException({ message: 'There is no missed delivery to rearrange on this order.', reason: 'NOT_FAILED' });
    if (d.failureReason?.startsWith('Refused')) throw new BadRequestException({ message: 'Please contact us about this order.', reason: 'REFUSED' });
    const note = input.note?.trim() || null;
    if (!input.deliverySlot && !note) throw new BadRequestException('Choose a new time or write when we can come');
    const text = await this.prisma.$transaction(async (tx) => {
      let slotText: string | null = null;
      if (input.deliverySlot && this.slots) {
        const slot = await this.slots.book(tx, order.countryCode, input.deliverySlot);
        if (slot) {
          await tx.order.update({ where: { id: order.id }, data: { deliverySlotStart: slot.start, deliverySlotEnd: slot.end } });
          slotText = slotLabel(slot.start, slot.end, tzFor(order.countryCode).tz, 'en');
        }
      }
      const t = [slotText && `New time: ${slotText}`, note && `Customer: ${note}`].filter(Boolean).join(' · ');
      if (!t) throw new BadRequestException('Choose a new time or write when we can come');
      await tx.deliveryOrder.update({ where: { id: d.id }, data: { customerRequest: t.slice(0, 500), customerRequestAt: new Date(), events: { create: { status: 'FAILED', note: `Customer rearranged: ${t}`.slice(0, 500) } } } });
      return t;
    });
    return { ok: true, request: text };
  }

  /** The driver's run as a printable PDF (driver: their own; staff: any driver). */
  async runSheet(courierId: string, printedBy: string) {
    const driver = await this.prisma.user.findFirst({
      where: { id: courierId, roles: { some: { role: { code: 'DELIVERY_AGENT' } } } },
      select: { fullName: true, phone: true, countryCode: true, country: { select: { currencyCode: true } } },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    const run = await this.courierRun(courierId);
    return renderRunSheet({
      driver, date: new Date(), tz: tzFor(driver.countryCode).tz, currencyCode: run.summary.currencyCode || driver.country.currencyCode, printedBy,
      jobs: run.jobs,
    });
  }

  // --------------------------------------------------------------- customer

  /** Tracking for the customer's own order. Courier location only while it is on the way. */
  async tracking(userId: string, orderNumber: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, userId },
      select: {
        orderNumber: true, status: true,
        sellerOrders: {
          select: {
            status: true, seller: { select: { store: { select: { name: true } } } },
            delivery: {
              select: {
                method: true, status: true, trackingUrl: true, etaAt: true, courierName: true, lastLat: true, lastLng: true, deliveryCode: true, deliveredAt: true,
                events: { orderBy: { occurredAt: 'asc' }, select: { status: true, note: true, occurredAt: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      shipments: order.sellerOrders.map((so) => {
        const d = so.delivery;
        const onTheWay = d?.status === 'OUT_FOR_DELIVERY';
        return {
          store: so.seller.store?.name ?? null,
          status: so.status,
          delivery: d && {
            method: d.method, status: d.status, trackingUrl: d.trackingUrl, etaAt: d.etaAt, deliveredAt: d.deliveredAt,
            courier: firstName(d.courierName),
            location: onTheWay && d.lastLat !== null ? { lat: d.lastLat, lng: d.lastLng } : null,
            deliveryCode: d.status !== 'DELIVERED' ? d.deliveryCode : null, // show to the customer, they give it to the courier
            events: d.events,
          },
        };
      }),
    };
  }

  /** Photo taken at a failed attempt (private: signed link for staff). */
  async failurePhotoUrl(id: string, actorId: string) {
    const d = await this.prisma.deliveryOrder.findUnique({ where: { id }, select: { failurePhotoKey: true } });
    if (!d?.failurePhotoKey) throw new NotFoundException('No photo for this attempt');
    await this.audit.log({ actorId, action: 'delivery.failure_photo_view', entityType: 'DeliveryOrder', entityId: id });
    return { url: await this.storage.signedUrl(d.failurePhotoKey, 300), expiresIn: 300 };
  }

  async proofUrl(deliveryId: string, adminId: string) {
    const d = await this.prisma.deliveryOrder.findUnique({ where: { id: deliveryId }, select: { proofOfDeliveryKey: true } });
    if (!d?.proofOfDeliveryKey) throw new NotFoundException('No proof photo for this delivery');
    await this.audit.log({ actorId: adminId, action: 'delivery.proof_view', entityType: 'DeliveryOrder', entityId: deliveryId });
    return { url: await this.storage.signedUrl(d.proofOfDeliveryKey, 300), expiresIn: 300 };
  }
}
