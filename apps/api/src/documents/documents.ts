import {
  BadRequestException, ConflictException, Controller, Get, Headers, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OrderStatus, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import type { Response } from 'express';
import { tzFor } from '../analytics/range';
import { AuditService } from '../audit/audit.service';
import { sendPdf } from '../cash/cash';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { OrderAccessService } from '../common/order-access.service';
import { shipmentPaidTotal } from '../finance/finance-math';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';
import { renderCreditNote, renderReturnReceipt } from './credit-note';
import { InvoiceSeller, renderInvoice } from './invoice';
import { PackingSlip, PickLine, renderPackingSlips, renderPickList } from './packing';
import { addressText } from './run-sheet';

type Lang = 'en' | 'ar';
type Access = { userId: string } | { guestToken: string | undefined } | { staff: true };
type Legal = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const TO_PACK: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];

/** Shipment number shown on packing slips and invoices: the order number, plus -2, -3… when one order has several sellers. Exported for tests. */
export function shipmentNo(orderNumber: string, index: number, count: number): string {
  return count > 1 ? `${orderNumber}-${index + 1}` : orderNumber;
}
/** Return receipt number from the return's id: stable, short, unguessable enough for a printed paper. Exported for tests. */
export const returnReceiptNo = (id: string) => `RR-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;

type ShipAddress = { recipientName?: string; phone?: string; zone?: string; street?: string; building?: string; unit?: string; city?: string; line1?: string; area?: string };
const addressLines = (a: ShipAddress | null) => {
  if (!a) return [];
  const one = addressText({ zone: a.zone ?? null, street: a.street ?? null, building: a.building ?? null, unit: a.unit ?? null, city: null, line1: a.line1 ?? null });
  return [one, [a.area, a.city].filter(Boolean).join(', ')].filter((x) => !!x);
};
const optionsText = (o: unknown) => (o && typeof o === 'object' ? Object.values(o as Record<string, string>).filter(Boolean).join(' / ') || null : null);

/** Qatar-day bounds for a YYYY-MM-DD (delivery date filters). */
function dayRange(day: string, offsetMin: number) {
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - offsetMin * 60_000;
  return { gte: new Date(start), lt: new Date(start + 86_400_000) };
}

class LangQuery { @ApiPropertyOptional({ enum: ['en', 'ar'] }) @IsOptional() @IsIn(['en', 'ar']) lang?: Lang; }
class BatchQuery {
  @ApiPropertyOptional({ description: 'Comma-separated shipment ids (or use the filters)' }) @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : value)) @IsUUID('4', { each: true }) ids?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ example: '2026-10-06', description: 'Delivery date (Qatar)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @ApiPropertyOptional({ description: 'One delivery window (its start, ISO)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T/) slotStart?: string;
}

/**
 * Printed documents: the customer's invoice, packing slips and picking lists for the warehouse, credit notes for
 * refunds and receipts for returned items. Customers get only their own (guests with their order link); staff by
 * permission.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}

  private async authorise(order: { id: string; userId: string } | null, who: Access) {
    if (!order) throw new NotFoundException('Order not found');
    if ('staff' in who) return;
    if ('userId' in who) { if (order.userId !== who.userId) throw new NotFoundException('Order not found'); return; }
    if (!this.access.verify(order.id, who.guestToken)) throw new NotFoundException('Order not found');
  }

  private seller(s: { businessName: string; legalName: string | null; commercialRegNo: string | null; taxNumber: string | null; isHouse: boolean; store: { name: string } | null }, legal: Legal): InvoiceSeller {
    if (s.isHouse) {
      const contact = [str(legal.supportEmail), str(legal.supportPhone)].filter(Boolean).join(' · ') || null;
      return { name: str(legal.companyName) ?? s.store?.name ?? 'FastMoveX', address: str(legal.address), crNumber: str(legal.commercialRegNo), taxNumber: str(legal.taxNumber), contact, house: true };
    }
    return { name: s.legalName ?? s.businessName, address: null, crNumber: s.commercialRegNo, taxNumber: s.taxNumber, contact: null, house: false };
  }

  // ------------------------------------------------------------------ invoice

  async invoice(orderNumber: string, who: Access, lang: Lang = 'en') {
    const o = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        user: { select: { email: true, fullName: true } },
        country: { select: { vatRateBps: true, pricesIncludeTax: true, legalSettings: true } },
        coupon: { select: { code: true } },
        payments: { orderBy: { createdAt: 'asc' }, take: 1, select: { method: true, status: true } },
        refunds: { where: { status: 'SUCCEEDED' }, orderBy: { creditNoteAt: 'asc' }, select: { creditNoteNo: true, amountMinor: true, creditNoteAt: true } },
        sellerOrders: {
          orderBy: { createdAt: 'asc' },
          include: {
            seller: { select: { businessName: true, legalName: true, commercialRegNo: true, taxNumber: true, isHouse: true, store: { select: { name: true } } } },
            items: { include: { variant: { select: { product: { select: { titleAr: true } } } } } },
          },
        },
      },
    });
    await this.authorise(o, who);
    if (o!.status === 'PENDING') throw new ConflictException({ message: 'The invoice is ready once the order is confirmed (after payment).', reason: 'NOT_CONFIRMED' });
    const order = o!;
    const legal = (order.country.legalSettings ?? {}) as Legal;
    const a = order.shippingAddress as ShipAddress | null;
    const pdf = await renderInvoice({
      orderNumber: order.orderNumber, placedAt: order.placedAt, tz: tzFor(order.countryCode).tz, currencyCode: order.currencyCode,
      vatRateBps: order.country.vatRateBps, pricesIncludeTax: order.country.pricesIncludeTax, coupon: order.coupon?.code ?? null,
      payment: order.payments[0] ?? null,
      billTo: { name: a?.recipientName ?? order.user.fullName, lines: addressLines(a), phone: a?.phone ?? null, email: order.user.email },
      cancelled: order.status === 'CANCELLED',
      creditNotes: order.refunds.filter((r) => r.creditNoteNo).map((r) => ({ number: r.creditNoteNo!, amountMinor: r.amountMinor, at: r.creditNoteAt! })),
      sections: order.sellerOrders.map((so, i) => ({
        number: shipmentNo(order.orderNumber, i, order.sellerOrders.length), seller: this.seller(so.seller, legal), status: so.status,
        subtotalMinor: so.subtotalMinor, discountMinor: so.discountMinor, deliveryFeeMinor: so.deliveryFeeMinor, taxMinor: so.taxMinor,
        // lines removed by an order change are not on the invoice (a cancelled shipment keeps them, stamped CANCELLED)
        items: so.items.filter((it) => so.status === 'CANCELLED' || it.status !== 'CANCELLED').map((it) => ({
          title: (lang === 'ar' && it.variant.product.titleAr) || it.productTitle, sku: it.sku, quantity: it.quantity, refundedQty: it.refundedQty,
          unitPriceMinor: it.unitPriceMinor, lineTotalMinor: it.lineTotalMinor,
        })),
      })),
    });
    return { pdf, name: `FastMoveX-invoice-${order.orderNumber}.pdf` };
  }

  // ------------------------------------------------------------------ packing slips and picking list

  private async shipmentsFor(q: BatchQuery) {
    const sellerId = await this.warehouses.house();
    const { offsetMin } = tzFor(process.env.DEFAULT_COUNTRY ?? 'QA');
    if (!q.ids?.length && !q.warehouseId && !q.date && !q.slotStart) {
      // default: everything waiting to be packed in the default warehouse
      q.warehouseId = (await this.prisma.warehouse.findFirst({ where: { sellerId, isDefault: true }, select: { id: true } }))?.id;
    }
    const where: Prisma.SellerOrderWhereInput = q.ids?.length
      ? { id: { in: q.ids }, sellerId }
      : {
          sellerId, status: { in: TO_PACK },
          ...(q.warehouseId && { warehouseId: q.warehouseId }),
          ...((q.date || q.slotStart) && { order: { deliverySlotStart: q.slotStart ? new Date(q.slotStart) : dayRange(q.date!, offsetMin) } }),
        };
    const rows = await this.prisma.sellerOrder.findMany({
      where, take: 300,
      orderBy: [{ order: { deliverySlotStart: { sort: 'asc', nulls: 'last' } } }, { createdAt: 'asc' }],
      include: {
        warehouse: { select: { id: true, name: true } },
        order: {
          select: {
            id: true, orderNumber: true, placedAt: true, shippingAddress: true, customerNote: true, deliverySlotStart: true, deliverySlotEnd: true, currencyCode: true,
            country: { select: { pricesIncludeTax: true } }, payments: { take: 1, orderBy: { createdAt: 'asc' }, select: { method: true } },
            sellerOrders: { select: { id: true }, orderBy: { createdAt: 'asc' } },
          },
        },
        items: { include: { variant: { select: { barcode: true, optionValues: true } } } },
      },
    });
    if (q.ids?.length && rows.length !== new Set(q.ids).size) throw new NotFoundException('Some shipments were not found');
    if (q.ids?.length && rows.some((r) => r.status === 'CANCELLED')) throw new ConflictException({ message: 'A cancelled shipment has nothing to pack.', reason: 'CANCELLED' });
    return rows;
  }

  private async bins(pairs: { warehouseId: string | null; variantId: string }[]) {
    const ws = [...new Set(pairs.map((p) => p.warehouseId).filter((x): x is string => !!x))];
    if (!ws.length) return new Map<string, string | null>();
    const rows = await this.prisma.warehouseStock.findMany({ where: { warehouseId: { in: ws }, variantId: { in: pairs.map((p) => p.variantId) } }, select: { warehouseId: true, variantId: true, bin: true } });
    return new Map(rows.map((r) => [`${r.warehouseId}:${r.variantId}`, r.bin]));
  }

  async packingSlips(q: BatchQuery, actor: AuthUser) {
    const rows = await this.shipmentsFor(q);
    if (!rows.length) throw new BadRequestException('No shipments to print');
    const bins = await this.bins(rows.flatMap((so) => so.items.map((i) => ({ warehouseId: so.warehouseId, variantId: i.variantId }))));
    const slips: PackingSlip[] = rows.map((so) => {
      const a = so.order.shippingAddress as ShipAddress | null;
      const idx = so.order.sellerOrders.findIndex((x) => x.id === so.id);
      const cod = so.order.payments[0]?.method === 'COD';
      return {
        orderNumber: so.order.orderNumber, shipmentNo: shipmentNo(so.order.orderNumber, idx, so.order.sellerOrders.length), placedAt: so.order.placedAt,
        slot: so.order.deliverySlotStart ? { start: so.order.deliverySlotStart, end: so.order.deliverySlotEnd } : null,
        deliveryMethod: so.deliveryMethod, warehouse: so.warehouse?.name ?? null,
        customer: { name: a?.recipientName ?? 'Customer', phone: a?.phone ?? null, address: addressLines(a) },
        note: so.order.customerNote,
        cash: cod ? { amountMinor: shipmentPaidTotal(so, so.order.country.pricesIncludeTax), currencyCode: so.order.currencyCode } : null,
        items: so.items.filter((i) => i.status !== 'CANCELLED').map((i) => ({
          title: i.productTitle, sku: i.sku, barcode: i.variant.barcode, options: optionsText(i.variant.optionValues), quantity: i.quantity - i.refundedQty,
          bin: bins.get(`${so.warehouseId}:${i.variantId}`) ?? null,
        })),
      };
    });
    await this.audit.log({ actorId: actor.id, action: 'documents.packing_slips', entityType: 'SellerOrder', entityId: rows.length === 1 ? rows[0].id : 'batch', after: { count: rows.length } });
    const pdf = await renderPackingSlips(slips, tzFor(process.env.DEFAULT_COUNTRY ?? 'QA').tz);
    return { pdf, name: rows.length === 1 ? `packing-slip-${slips[0].shipmentNo}.pdf` : `packing-slips-${rows.length}.pdf` };
  }

  /** What to take off the shelves for these shipments, grouped by product in walking order (JSON for the screen). */
  async pickList(q: BatchQuery) {
    const rows = await this.shipmentsFor(q);
    const bins = await this.bins(rows.flatMap((so) => so.items.map((i) => ({ warehouseId: so.warehouseId, variantId: i.variantId }))));
    const byVariant = new Map<string, PickLine & { variantId: string }>();
    for (const so of rows) {
      for (const i of so.items) {
        const qty = i.quantity - i.refundedQty;
        if (i.status === 'CANCELLED' || qty <= 0) continue;
        const key = `${so.warehouseId}:${i.variantId}`;
        const cur = byVariant.get(key) ?? { variantId: i.variantId, sku: i.sku, barcode: i.variant.barcode, title: i.productTitle, options: optionsText(i.variant.optionValues), bin: bins.get(key) ?? null, quantity: 0, orders: [] };
        cur.quantity += qty;
        const o = cur.orders.find((x) => x.orderNumber === so.order.orderNumber);
        if (o) o.quantity += qty; else cur.orders.push({ orderNumber: so.order.orderNumber, quantity: qty });
        byVariant.set(key, cur);
      }
    }
    const warehouse = q.warehouseId ? (await this.prisma.warehouse.findUnique({ where: { id: q.warehouseId }, select: { name: true } }))?.name : [...new Set(rows.map((r) => r.warehouse?.name).filter(Boolean))].join(', ');
    return {
      warehouse: warehouse || 'All warehouses',
      shipments: rows.map((so) => ({ id: so.id, orderNumber: so.order.orderNumber, status: so.status, slotStart: so.order.deliverySlotStart, slotEnd: so.order.deliverySlotEnd, units: so.items.reduce((n, i) => n + i.quantity - i.refundedQty, 0) })),
      lines: [...byVariant.values()],
    };
  }

  async pickListPdf(q: BatchQuery, actor: AuthUser) {
    const p = await this.pickList(q);
    const { tz } = tzFor(process.env.DEFAULT_COUNTRY ?? 'QA');
    const slotLabel = q.slotStart ? `Window from ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(q.slotStart))}` : null;
    const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { fullName: true } });
    const pdf = await renderPickList({ warehouse: p.warehouse, date: q.date ?? null, slotLabel, tz, printedBy: me?.fullName ?? 'staff', shipments: p.shipments.length, lines: p.lines });
    return { pdf, name: `picking-list-${q.date ?? 'open'}.pdf` };
  }

  // ------------------------------------------------------------------ credit notes and return receipts

  async creditNote(refundId: string, who: Access, orderNumber?: string) {
    const r = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: { select: { method: true } },
        order: { select: { id: true, userId: true, orderNumber: true, countryCode: true, currencyCode: true, shippingAddress: true, user: { select: { fullName: true } }, country: { select: { legalSettings: true } }, sellerOrders: { select: { id: true }, orderBy: { createdAt: 'asc' } } } },
        sellerOrder: { select: { id: true, seller: { select: { businessName: true, legalName: true, commercialRegNo: true, taxNumber: true, isHouse: true, store: { select: { name: true } } } } } },
      },
    });
    if (!r || (orderNumber && r.order.orderNumber !== orderNumber)) throw new NotFoundException('Credit note not found');
    await this.authorise(r.order, who);
    if (!r.creditNoteNo) throw new ConflictException({ message: 'A credit note is issued once the refund has been paid.', reason: 'NOT_REFUNDED' });
    const house = r.sellerOrder?.seller ?? (await this.prisma.seller.findFirstOrThrow({ where: { isHouse: true }, select: { businessName: true, legalName: true, commercialRegNo: true, taxNumber: true, isHouse: true, store: { select: { name: true } } } }));
    const idx = r.sellerOrderId ? r.order.sellerOrders.findIndex((s) => s.id === r.sellerOrderId) : 0;
    // which items the money was for: returns refunded through this refund (matched by shipment and amount), else none
    const returns = await this.prisma.returnRequest.findMany({
      where: { orderItem: { orderId: r.orderId, ...(r.sellerOrderId && { sellerOrderId: r.sellerOrderId }) }, status: 'REFUNDED' },
      select: { quantity: true, orderItem: { select: { productTitle: true, sku: true } } },
    });
    const a = r.order.shippingAddress as ShipAddress | null;
    const pdf = await renderCreditNote({
      number: r.creditNoteNo, issuedAt: r.creditNoteAt ?? r.completedAt ?? r.createdAt, tz: tzFor(r.order.countryCode).tz, currencyCode: r.order.currencyCode,
      orderNumber: r.order.orderNumber, invoiceNumber: shipmentNo(r.order.orderNumber, Math.max(0, idx), r.order.sellerOrders.length),
      seller: this.seller(house, (r.order.country.legalSettings ?? {}) as Legal),
      customer: { name: a?.recipientName ?? r.order.user.fullName, lines: addressLines(a) },
      reason: r.reason, method: r.payment.method, reference: r.providerRef, amountMinor: r.amountMinor,
      items: /return/i.test(r.reason) ? returns.map((x) => ({ title: x.orderItem.productTitle, sku: x.orderItem.sku, quantity: x.quantity })) : [],
    });
    return { pdf, name: `${r.creditNoteNo}.pdf` };
  }

  async returnReceipt(returnId: string, who: Access, orderNumber?: string) {
    const rr = await this.prisma.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        user: { select: { fullName: true } },
        orderItem: {
          select: {
            productTitle: true, sku: true, sellerOrderId: true,
            order: { select: { id: true, userId: true, orderNumber: true, countryCode: true, country: { select: { legalSettings: true } } } },
            sellerOrder: { select: { seller: { select: { businessName: true, legalName: true, commercialRegNo: true, taxNumber: true, isHouse: true, store: { select: { name: true } } } } } },
          },
        },
      },
    });
    if (!rr || (orderNumber && rr.orderItem.order.orderNumber !== orderNumber)) throw new NotFoundException('Return not found');
    await this.authorise(rr.orderItem.order, who);
    if (!rr.receivedAt) throw new ConflictException({ message: 'The receipt is ready once the item is back with us and checked.', reason: 'NOT_RECEIVED' });
    const [staff, refund] = await Promise.all([
      rr.receivedById ? this.prisma.user.findUnique({ where: { id: rr.receivedById }, select: { fullName: true } }) : null,
      this.prisma.refund.findFirst({ where: { orderId: rr.orderItem.order.id, sellerOrderId: rr.orderItem.sellerOrderId, createdAt: { gte: rr.receivedAt } }, orderBy: { createdAt: 'asc' }, select: { status: true, amountMinor: true, creditNoteNo: true, order: { select: { currencyCode: true } } } }),
    ]);
    const pdf = await renderReturnReceipt({
      number: returnReceiptNo(rr.id), receivedAt: rr.receivedAt, tz: tzFor(rr.orderItem.order.countryCode).tz, orderNumber: rr.orderItem.order.orderNumber,
      seller: this.seller(rr.orderItem.sellerOrder.seller, (rr.orderItem.order.country.legalSettings ?? {}) as Legal),
      customer: { name: rr.user.fullName }, item: { title: rr.orderItem.productTitle, sku: rr.orderItem.sku, quantity: rr.quantity },
      reason: rr.reason, condition: rr.condition, note: rr.inspectionNote,
      receivedBy: staff?.fullName?.split(/\s+/)[0] ?? null, // first name only on the customer's paper
      refund: refund ? { status: refund.status, amountMinor: refund.amountMinor, currencyCode: refund.order.currencyCode, creditNoteNo: refund.creditNoteNo } : null,
    });
    return { pdf, name: `${returnReceiptNo(rr.id)}.pdf` };
  }
}

/** What the customer's order page offers to download: credit notes and return receipts (the invoice is always there once confirmed). */
export async function documentsForOrder(prisma: PrismaService, orderId: string) {
  const [refunds, returns] = await Promise.all([
    prisma.refund.findMany({ where: { orderId, status: 'SUCCEEDED', creditNoteNo: { not: null } }, orderBy: { creditNoteAt: 'asc' }, select: { id: true, creditNoteNo: true, creditNoteAt: true, amountMinor: true } }),
    prisma.returnRequest.findMany({ where: { orderItem: { orderId }, receivedAt: { not: null } }, orderBy: { receivedAt: 'asc' }, select: { id: true, receivedAt: true, quantity: true, condition: true, orderItem: { select: { productTitle: true } } } }),
  ]);
  return {
    creditNotes: refunds.map((r) => ({ id: r.id, number: r.creditNoteNo!, at: r.creditNoteAt, amountMinor: r.amountMinor.toString() })),
    returnReceipts: returns.map((r) => ({ id: r.id, number: returnReceiptNo(r.id), at: r.receivedAt, title: r.orderItem.productTitle, quantity: r.quantity, condition: r.condition })),
  };
}

// ====================================================================== controllers

@ApiTags('Orders') @ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class CustomerDocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get(':orderNumber/invoice.pdf')
  async invoice(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Query() q: LangQuery, @Res() res: Response) {
    const r = await this.docs.invoice(n, { userId: u.id }, q.lang);
    sendPdf(res, r.pdf, r.name);
  }
  @Get(':orderNumber/credit-notes/:id.pdf')
  async creditNote(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.docs.creditNote(id, { userId: u.id }, n);
    sendPdf(res, r.pdf, r.name);
  }
  @Get(':orderNumber/return-receipts/:id.pdf')
  async returnReceipt(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.docs.returnReceipt(id, { userId: u.id }, n);
    sendPdf(res, r.pdf, r.name);
  }
}

@ApiTags('Orders')
@Controller({ path: 'orders/guest', version: '1' })
export class GuestDocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Public() @ApiHeader({ name: 'X-Order-Token', required: true }) @Get(':orderNumber/invoice.pdf')
  async invoice(@Param('orderNumber') n: string, @Query() q: LangQuery, @Headers('x-order-token') t: string | undefined, @Res() res: Response) {
    const r = await this.docs.invoice(n, { guestToken: t }, q.lang);
    sendPdf(res, r.pdf, r.name);
  }
  @Public() @ApiHeader({ name: 'X-Order-Token', required: true }) @Get(':orderNumber/credit-notes/:id.pdf')
  async creditNote(@Param('orderNumber') n: string, @Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') t: string | undefined, @Res() res: Response) {
    const r = await this.docs.creditNote(id, { guestToken: t }, n);
    sendPdf(res, r.pdf, r.name);
  }
  @Public() @ApiHeader({ name: 'X-Order-Token', required: true }) @Get(':orderNumber/return-receipts/:id.pdf')
  async returnReceipt(@Param('orderNumber') n: string, @Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') t: string | undefined, @Res() res: Response) {
    const r = await this.docs.returnReceipt(id, { guestToken: t }, n);
    sendPdf(res, r.pdf, r.name);
  }
}

@ApiTags('Admin / Documents') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminDocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @RequirePermissions('orders.read') @Get('orders/:orderNumber/invoice.pdf')
  async invoice(@Param('orderNumber') n: string, @Query() q: LangQuery, @Res() res: Response) {
    const r = await this.docs.invoice(n, { staff: true }, q.lang);
    sendPdf(res, r.pdf, r.name);
  }
  @RequirePermissions('orders.read') @Get('orders/shipments/:id/packing-slip.pdf')
  async packingSlip(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const r = await this.docs.packingSlips({ ids: [id] }, u);
    sendPdf(res, r.pdf, r.name);
  }
  @RequirePermissions('orders.read') @Get('fulfilment/packing-slips.pdf')
  async packingSlips(@Query() q: BatchQuery, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const r = await this.docs.packingSlips(q, u);
    sendPdf(res, r.pdf, r.name);
  }
  @RequirePermissions('orders.read') @Get('fulfilment/pick-list') pickList(@Query() q: BatchQuery) { return this.docs.pickList(q); }
  @RequirePermissions('orders.read') @Get('fulfilment/pick-list.pdf')
  async pickListPdf(@Query() q: BatchQuery, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const r = await this.docs.pickListPdf(q, u);
    sendPdf(res, r.pdf, r.name);
  }
  @RequirePermissions('payments.read') @Get('refunds/:id/credit-note.pdf')
  async creditNote(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.docs.creditNote(id, { staff: true });
    sendPdf(res, r.pdf, r.name);
  }
  @RequirePermissions('returns.manage') @Get('returns/:id/receipt.pdf')
  async returnReceipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.docs.returnReceipt(id, { staff: true });
    sendPdf(res, r.pdf, r.name);
  }
}

@Module({ controllers: [CustomerDocumentsController, GuestDocumentsController, AdminDocumentsController], providers: [DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}
