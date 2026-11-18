import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ReturnCondition, ReturnReason, ReturnStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';
import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UPLOAD_LIMITS, validateUpload } from '../storage/file-validation';
import { cleanPhoto } from '../storage/photo';
import { REPORT_WINDOW_HOURS, refundAfterFee, reportWindowOpen, returnDeadline, returnFee, returnRefundAmount } from './finance-math';
import { RefundsService } from './refunds.service';
import { StorageService } from '../storage/storage.service';

const OPEN_RETURN: ReturnStatus[] = ['REQUESTED', 'APPROVED'];
const MAX_RETURN_PHOTOS = 5;
const needsPhotos = (r: ReturnReason) => r !== 'CHANGE_OF_MIND';

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly warehouseService?: WarehousesService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  private get warehouses(): WarehousesService {
    if (!this.warehouseService) throw new Error('WarehousesService is not available');
    return this.warehouseService;
  }

  async request(userId: string, orderNumber: string, input: { orderItemId: string; quantity: number; reason: string; reasonType?: ReturnReason }, now = new Date()) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: input.orderItemId, order: { orderNumber, userId } }, // must be the caller's own order
      select: {
        id: true, quantity: true, refundedQty: true, status: true,
        order: { select: { currencyCode: true } },
        sellerOrder: { select: { deliveredAt: true, status: true, seller: { select: { returnWindowDays: true } } } },
        variant: { select: { product: { select: { returnPolicyDays: true } } } },
        returns: { where: { status: { in: OPEN_RETURN } }, select: { quantity: true } },
      },
    });
    if (!item) throw new NotFoundException('Item not found in this order');
    if (!item.sellerOrder.deliveredAt || !['DELIVERED', 'RETURN_REQUESTED', 'RETURNED'].includes(item.status)) {
      throw new BadRequestException('Returns can be requested after the item is delivered');
    }
    const policyDays = item.variant.product.returnPolicyDays;
    if (policyDays === 0) throw new BadRequestException('This item is not returnable');
    if (now > returnDeadline(item.sellerOrder.deliveredAt, policyDays, item.sellerOrder.seller.returnWindowDays)) {
      throw new BadRequestException('The return window for this item has closed');
    }
    const reasonType: ReturnReason = input.reasonType ?? 'CHANGE_OF_MIND';
    if (needsPhotos(reasonType) && !reportWindowOpen(item.sellerOrder.deliveredAt, now)) {
      throw new BadRequestException(`Defects and wrong items must be reported within ${REPORT_WINDOW_HOURS} hours of delivery. You can still return it as "change of mind" (a fee applies).`);
    }
    const openQty = item.returns.reduce((s, r) => s + r.quantity, 0);
    const returnable = item.quantity - item.refundedQty - openQty;
    if (input.quantity > returnable) throw new BadRequestException(`You can return at most ${returnable} of this item`);

    const ret = await this.prisma.$transaction(async (tx) => {
      const r = await tx.returnRequest.create({ data: { orderItemId: item.id, userId, quantity: input.quantity, reason: input.reason, reasonType, feeMinor: returnFee(reasonType, item.order.currencyCode) } });
      await tx.orderItem.update({ where: { id: item.id }, data: { status: 'RETURN_REQUESTED' } });
      return r;
    });
    await this.audit.log({ actorId: userId, action: 'return.request', entityType: 'ReturnRequest', entityId: ret.id, after: { quantity: input.quantity, reasonType } });
    return { ...ret, feeMinor: ret.feeMinor.toString(), photosRequired: needsPhotos(reasonType) };
  }

  /** The customer adds a photo to an open return request (needed for defect / wrong item / not as described). */
  async addPhoto(userId: string, returnId: string, file: Express.Multer.File | undefined) {
    const ret = await this.prisma.returnRequest.findFirst({ where: { id: returnId, userId }, select: { id: true, status: true, images: true } });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status !== 'REQUESTED') throw new BadRequestException('Photos can only be added while the request is waiting for review');
    const images = (ret.images as string[]) ?? [];
    if (images.length >= MAX_RETURN_PHOTOS) throw new BadRequestException(`Up to ${MAX_RETURN_PHOTOS} photos per return`);
    if (!this.storage) throw new Error('StorageService is not available');
    const photo = await cleanPhoto(validateUpload(file, 'image').buffer);
    const key = `returns/${returnId}/${randomUUID()}.${photo.ext}`;
    await this.storage.put('public', key, photo.buffer, photo.mime); // same bucket the seller list reads from; the key is an unguessable UUID
    const res = await this.prisma.returnRequest.updateMany({ where: { id: returnId, userId, status: 'REQUESTED', images: { equals: images } }, data: { images: [...images, key] } });
    if (res.count !== 1) throw new ConflictException('Another photo is being added. Please try again.');
    return { photos: images.length + 1 };
  }

  async listForCustomer(userId: string) {
    const rows = await this.prisma.returnRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      // Customer view: no staff ids
      select: {
        id: true, quantity: true, reason: true, reasonType: true, feeMinor: true, status: true, resolution: true, createdAt: true, updatedAt: true,
        orderItem: { select: { productTitle: true, sku: true, order: { select: { orderNumber: true } } } },
        pickup: { select: { status: true, date: true } }, // a driver collects it
      },
    });
    return rows.map((r) => ({ ...r, feeMinor: r.feeMinor.toString() }));
  }

  /** The store's returns: only what the seller needs (no customer or staff ids); photos the customer added. */
  async listForSeller(sellerId: string, q: { status?: ReturnStatus; cursor?: string }) {
    const rows = await this.prisma.returnRequest.findMany({
      where: { status: q.status, orderItem: { sellerOrder: { sellerId } }, ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: {
        id: true, quantity: true, reason: true, reasonType: true, feeMinor: true, images: true, status: true, resolution: true, condition: true, inspectionNote: true, receivedAt: true, createdAt: true,
        pickup: { select: { status: true, date: true } },
        orderItem: { select: { productTitle: true, sku: true, quantity: true, unitPriceMinor: true, imageKey: true, sellerOrderId: true, order: { select: { orderNumber: true, currencyCode: true } } } },
      },
    });
    const page = toPage(rows, 25);
    const url = (k: string | null) => (k ? this.storage?.publicUrl(k) ?? null : null);
    return {
      ...page,
      items: page.items.map(({ images, orderItem: { imageKey, unitPriceMinor, ...item }, pickup, feeMinor, ...r }) => ({
        ...r, feeMinor: feeMinor.toString(),
        images: ((images as string[]) ?? []).map(url).filter(Boolean),
        pickup: pickup ? { status: pickup.status, date: pickup.date.toISOString().slice(0, 10) } : null,
        orderItem: { ...item, unitPriceMinor: unitPriceMinor.toString(), imageUrl: url(imageKey) },
      })),
    };
  }

  async listForAdmin(q: { status?: ReturnStatus; cursor?: string }) {
    const rows = await this.prisma.returnRequest.findMany({
      where: { status: q.status, ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        pickup: { select: { status: true, date: true, courierUserId: true, collectedAt: true, failureReason: true } },
        orderItem: {
          select: {
            productTitle: true, sku: true, quantity: true, unitPriceMinor: true,
            order: { select: { orderNumber: true, currencyCode: true } },
            sellerOrder: { select: { sellerId: true, seller: { select: { businessName: true, isHouse: true } } } },
          },
        },
      },
    });
    const page = toPage(rows, 25);
    const drivers = [...new Set(page.items.map((r) => r.pickup?.courierUserId).filter((x): x is string => !!x))];
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: drivers } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      ...page,
      items: page.items.map((r) => ({
        ...r, orderItem: { ...r.orderItem, unitPriceMinor: r.orderItem.unitPriceMinor.toString() },
        pickup: r.pickup ? { ...r.pickup, date: r.pickup.date.toISOString().slice(0, 10), driver: names.get(r.pickup.courierUserId) ?? null } : null,
      })),
    };
  }

  /** sellerId set = seller acting (scoped to own items). Undefined = admin. */
  async decide(returnId: string, decision: 'APPROVED' | 'REJECTED', actorId: string, sellerId?: string, resolution?: string) {
    const ret = await this.load(returnId, sellerId);
    if (ret.status !== 'REQUESTED') throw new BadRequestException(`Return is already ${ret.status.toLowerCase()}`);
    if (decision === 'REJECTED' && !resolution) throw new BadRequestException('Give the customer a reason for rejecting');
    if (decision === 'APPROVED' && needsPhotos(ret.reasonType) && ((ret.images as string[]) ?? []).length === 0) {
      throw new BadRequestException('This return needs photos from the customer before it can be approved. Reject it asking for photos, or wait for them.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.returnRequest.update({ where: { id: returnId }, data: { status: decision, resolution, reviewedById: actorId } });
      if (decision === 'REJECTED') {
        const stillOpen = await tx.returnRequest.count({ where: { orderItemId: ret.orderItemId, status: { in: OPEN_RETURN }, id: { not: returnId } } });
        if (!stillOpen) await tx.orderItem.update({ where: { id: ret.orderItemId }, data: { status: 'DELIVERED' } });
      }
    });
    await this.audit.log({ actorId, action: `return.${decision.toLowerCase()}`, entityType: 'ReturnRequest', entityId: returnId, after: { resolution: resolution ?? null } });
    this.events?.emit(EVENTS.RETURN_UPDATED, { id: returnId });
    return this.prisma.returnRequest.findUniqueOrThrow({ where: { id: returnId } });
  }

  /**
   * Goods are back and inspected:
   *  - SELLABLE: back on the shelf, refund queued for finance
   *  - DAMAGED: refund queued, but the item stays off sellable stock (recorded as a zero-quantity movement for the trail)
   *  - NOT_ACCEPTED: not what was sold, or used — no refund, no restock, the customer is told why
   */
  async markReceived(returnId: string, actorId: string, sellerId?: string, inspection: { condition?: ReturnCondition; note?: string } = {}) {
    const ret = await this.load(returnId, sellerId);
    if (ret.status !== 'APPROVED') throw new BadRequestException('Only approved returns can be marked as received');
    const condition = inspection.condition ?? 'SELLABLE';
    const note = inspection.note?.trim() || null;
    if (condition !== 'SELLABLE' && (!note || note.length < 5)) throw new BadRequestException('Describe what was wrong with the item (at least 5 characters)');

    if (condition === 'NOT_ACCEPTED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({ where: { id: returnId }, data: { status: 'REJECTED', condition, inspectionNote: note, receivedById: actorId, receivedAt: new Date(), resolution: `Not accepted on inspection: ${note}`.slice(0, 500) } });
        const stillOpen = await tx.returnRequest.count({ where: { orderItemId: ret.orderItemId, status: { in: OPEN_RETURN }, id: { not: returnId } } });
        if (!stillOpen) await tx.orderItem.update({ where: { id: ret.orderItemId }, data: { status: 'DELIVERED' } });
      });
      await this.audit.log({ actorId, action: 'return.not_accepted', entityType: 'ReturnRequest', entityId: returnId, after: { condition, note } });
      this.events?.emit(EVENTS.RETURN_UPDATED, { id: returnId });
      return this.prisma.returnRequest.findUniqueOrThrow({ where: { id: returnId } });
    }

    await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUniqueOrThrow({
        where: { id: ret.orderItemId },
        select: { id: true, orderId: true, sellerOrderId: true, variantId: true, quantity: true, refundedQty: true, lineTotalMinor: true, sellerOrder: { select: { sellerId: true, warehouseId: true } } },
      });
      const amount = returnRefundAmount(item.lineTotalMinor, item.quantity, item.refundedQty, ret.quantity);
      const { remaining } = await this.refunds.refundableForShipment(item.sellerOrderId, tx);
      const payment = await tx.payment.findFirst({ where: { orderId: item.orderId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } }, select: { id: true } });
      if (!payment) throw new BadRequestException('No captured payment found for this order');

      // back on the shelf of the warehouse it was sent from (or the default one)
      const warehouseId = item.sellerOrder.warehouseId ?? (await this.warehouses.defaultFor(tx, item.sellerOrder.sellerId));
      if (condition === 'SELLABLE') {
        await this.warehouses.move(tx, { warehouseId, variantId: item.variantId, delta: ret.quantity, reason: 'RETURN', refType: 'return', refId: returnId, actorId });
      } else {
        // damaged: not sellable — leave a trace in the stock history without changing sellable stock
        await tx.inventoryMovement.create({ data: { variantId: item.variantId, warehouseId, qtyDelta: 0, reason: 'RETURN', refType: 'return', refId: returnId, actorId, note: `Damaged return x${ret.quantity}, kept off stock: ${note}`.slice(0, 300) } });
      }
      await tx.orderItem.update({
        where: { id: item.id },
        data: { refundedQty: { increment: ret.quantity }, status: item.refundedQty + ret.quantity >= item.quantity ? 'RETURNED' : 'DELIVERED' },
      });
      await tx.returnRequest.update({ where: { id: returnId }, data: { status: 'RECEIVED', condition, inspectionNote: note, receivedById: actorId, receivedAt: new Date() } });
      await tx.refund.create({
        data: {
          paymentId: payment.id, orderId: item.orderId, sellerOrderId: item.sellerOrderId, amountMinor: (() => { const net = refundAfterFee(amount, ret.feeMinor); return net < remaining ? net : remaining; })(),
          reason: `Return: ${ret.reason}`.slice(0, 500), status: 'PENDING', createdById: actorId, idempotencyKey: `return_${returnId}`,
        },
      });
    });
    await this.audit.log({ actorId, action: 'return.received', entityType: 'ReturnRequest', entityId: returnId, after: { condition, note } });
    this.events?.emit(EVENTS.RETURN_UPDATED, { id: returnId });
    const pending = await this.prisma.refund.findUnique({ where: { idempotencyKey: `return_${returnId}` }, select: { id: true, status: true } });
    if (pending?.status === 'PENDING') this.events?.emit(EVENTS.REFUND_REQUESTED, { id: pending.id });
    return this.prisma.returnRequest.findUniqueOrThrow({ where: { id: returnId } });
  }

  private async load(returnId: string, sellerId?: string) {
    const ret = await this.prisma.returnRequest.findUnique({
      where: { id: returnId },
      select: { id: true, status: true, quantity: true, reason: true, reasonType: true, feeMinor: true, images: true, orderItemId: true, orderItem: { select: { sellerOrder: { select: { sellerId: true } } } } },
    });
    if (!ret || (sellerId && ret.orderItem.sellerOrder.sellerId !== sellerId)) throw new NotFoundException('Return not found');
    return ret;
  }
}

