import { formatMoney } from '../notifications/templates';
import { box, footers, line, lines, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

export interface PackingSlip {
  orderNumber: string;
  shipmentNo: string;
  placedAt: Date;
  slot: { start: Date; end: Date | null } | null;
  deliveryMethod: string;
  warehouse: string | null;
  customer: { name: string; phone: string | null; address: string[] };
  note: string | null;
  cash: { amountMinor: bigint; currencyCode: string } | null;
  items: { title: string; sku: string; barcode: string | null; options: string | null; quantity: number; bin: string | null }[];
}

export interface PickLine {
  sku: string; barcode: string | null; title: string; options: string | null; bin: string | null; quantity: number;
  orders: { orderNumber: string; quantity: number }[];
}
export interface PickListInput {
  warehouse: string;
  date: string | null;
  slotLabel: string | null;
  tz: string;
  printedBy: string;
  shipments: number;
  lines: PickLine[];
}

const METHOD: Record<string, string> = { JOVIA: 'FastMoveX driver', SELLER: 'Seller delivers', COURIER: 'Courier', PICKUP: 'Customer pick-up' };

/** Shelf order for walking the warehouse: by bin (A-01 < A-02 < B-01, numbers compared as numbers), no bin last, then SKU. Exported for tests. */
export function binOrder(a: { bin: string | null; sku: string }, b: { bin: string | null; sku: string }): number {
  if (a.bin && !b.bin) return -1;
  if (!a.bin && b.bin) return 1;
  const byBin = (a.bin ?? '').localeCompare(b.bin ?? '', 'en', { numeric: true, sensitivity: 'base' });
  return byBin || a.sku.localeCompare(b.sku, 'en', { numeric: true });
}

/**
 * Packing slips: one page per shipment to put in the box — who it is for, the delivery window, every item with its
 * barcode and a tick box, the customer's note and the cash to collect. No prices (the customer may be a gift receiver).
 */
export async function renderPackingSlips(slips: PackingSlip[], tz: string): Promise<Buffer> {
  const doc = newPdf({ size: 'A5', title: slips.length === 1 ? `Packing slip ${slips[0].shipmentNo}` : `Packing slips (${slips.length})` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  slips.forEach((s, i) => {
    if (i > 0) doc.addPage();
    let y = 30;
    line(doc, 'FastMoveX — Packing slip', left, y, { width: W * 0.55, size: 13, bold: true });
    line(doc, s.shipmentNo, left + W * 0.55, y + 1, { width: W * 0.45, size: 11, bold: true, align: 'right' });
    y += 20;
    line(doc, `Order ${s.orderNumber} · ${localTime(s.placedAt, tz)}`, left, y, { width: W * 0.6, size: 8.5, color: MUTED });
    line(doc, METHOD[s.deliveryMethod] ?? s.deliveryMethod, left + W * 0.6, y, { width: W * 0.4, size: 8.5, color: MUTED, align: 'right' });
    y += 16;

    box(doc, left, y, W, 74);
    line(doc, 'DELIVER TO · التوصيل إلى', left + 8, y + 7, { width: W - 16, size: 7.5, bold: true, color: MUTED });
    let cy = y + 21;
    cy += line(doc, s.customer.name, left + 8, cy, { width: W * 0.6, size: 11, bold: true });
    for (const l of s.customer.address.slice(0, 2)) cy += line(doc, l, left + 8, cy, { width: W * 0.62, size: 9 });
    if (s.customer.phone) line(doc, s.customer.phone, left + 8, cy, { width: W * 0.6, size: 9 });
    line(doc, 'Delivery window', left + W * 0.64, y + 21, { width: W * 0.34, size: 7.5, color: MUTED, align: 'right' });
    line(doc, s.slot ? localTime(s.slot.start, tz, false) : 'As soon as possible', left + W * 0.64, y + 32, { width: W * 0.34, size: 9.5, bold: true, align: 'right' });
    if (s.slot) line(doc, `${timeOf(s.slot.start, tz)}–${s.slot.end ? timeOf(s.slot.end, tz) : ''}`, left + W * 0.64, y + 45, { width: W * 0.34, size: 9.5, bold: true, align: 'right' });
    y += 84;

    if (s.cash) {
      doc.save().rect(left, y, W, 20).fill('#fef3c7').restore();
      line(doc, `Collect ${formatMoney(s.cash.amountMinor, s.cash.currencyCode)} cash on delivery`, left + 8, y + 5, { width: W - 16, size: 10, bold: true });
      y += 28;
    }

    doc.save().rect(left, y, W, 15).fill('#f3f4f6').restore();
    line(doc, 'Item', left + 20, y + 3, { width: W * 0.5, size: 7.5, bold: true, color: MUTED });
    line(doc, 'SKU / barcode', left + W * 0.56, y + 3, { width: W * 0.3, size: 7.5, bold: true, color: MUTED });
    line(doc, 'Qty', left + W * 0.86, y + 3, { width: W * 0.14 - 4, size: 7.5, bold: true, color: MUTED, align: 'right' });
    y += 19;
    let units = 0;
    for (const it of s.items) {
      if (y > doc.page.height - doc.page.margins.bottom - 70) { doc.addPage(); y = doc.page.margins.top; }
      box(doc, left + 4, y + 1, 9, 9, '#9ca3af');
      const h = lines(doc, it.options ? `${it.title} — ${it.options}` : it.title, left + 20, y, { width: W * 0.5, size: 9, max: 2 });
      line(doc, it.sku, left + W * 0.56, y, { width: W * 0.3, size: 8.5 });
      if (it.barcode) line(doc, it.barcode, left + W * 0.56, y + 11, { width: W * 0.3, size: 7.5, color: MUTED });
      line(doc, String(it.quantity), left + W * 0.86, y, { width: W * 0.14 - 4, size: 11, bold: true, align: 'right' });
      if (it.bin) line(doc, `Shelf ${it.bin}`, left + 20, y + Math.max(h, 11), { width: W * 0.5, size: 7.5, color: MUTED });
      y += Math.max(h, 22) + (it.bin ? 10 : 0) + 4;
      rule(doc, left, left + W, y - 2, '#eef0f3');
      units += it.quantity;
    }
    y += 4;
    line(doc, `${s.items.length} line${s.items.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}`, left, y, { width: W, size: 9, bold: true, align: 'right' });
    y += 18;
    if (s.note) {
      box(doc, left, y, W, 34);
      lines(doc, `Customer note: ${s.note}`, left + 6, y + 6, { width: W - 12, size: 8.5, max: 2 });
      y += 42;
    }
    const sy = Math.max(y + 20, doc.page.height - doc.page.margins.bottom - 36);
    for (const [j, label] of ['Packed by', 'Checked by'].entries()) {
      const x = left + j * (W / 2);
      rule(doc, x, x + W / 2 - 14, sy, '#9ca3af');
      line(doc, label, x, sy + 3, { width: W / 2 - 14, size: 7.5, color: MUTED });
    }
  });
  footers(doc, 'FastMoveX · Packing slip — no prices shown');
  return toBuffer(doc);
}

const timeOf = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/**
 * Picking list: everything to take off the shelves for a batch of shipments, in walking order (shelf/bin), with the
 * total per product and which orders it is for — pick once, then sort into the orders.
 */
export async function renderPickList(p: PickListInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A4', title: `Picking list ${p.warehouse}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  let y = 34;
  line(doc, 'FastMoveX — Picking list', left, y, { width: W * 0.6, size: 16, bold: true });
  line(doc, p.warehouse, left + W * 0.6, y + 2, { width: W * 0.4, size: 12, bold: true, align: 'right' });
  y += 24;
  const scope = [p.date && `Delivery ${p.date}`, p.slotLabel].filter(Boolean).join(' · ') || 'All shipments waiting to be packed';
  line(doc, `${scope} · ${p.shipments} shipment${p.shipments === 1 ? '' : 's'} · ${p.lines.reduce((n, l) => n + l.quantity, 0)} units`, left, y, { width: W * 0.7, size: 9.5 });
  line(doc, `Printed ${localTime(new Date(), p.tz)} by ${p.printedBy}`, left + W * 0.6, y, { width: W * 0.4, size: 8, color: MUTED, align: 'right' });
  y += 20;
  const cols = [
    { k: '', w: 0.04, a: 'left' as const }, { k: 'Shelf', w: 0.1, a: 'left' as const }, { k: 'Product', w: 0.36, a: 'left' as const },
    { k: 'SKU / barcode', w: 0.18, a: 'left' as const }, { k: 'Qty', w: 0.08, a: 'right' as const }, { k: 'For orders', w: 0.24, a: 'left' as const },
  ];
  const head = () => {
    doc.save().rect(left, y, W, 16).fill('#f3f4f6').restore();
    let x = left;
    for (const c of cols) { line(doc, c.k, x + 3, y + 4, { width: W * c.w - 6, size: 7.5, bold: true, color: MUTED, align: c.a }); x += W * c.w; }
    y += 21;
  };
  head();
  for (const l of [...p.lines].sort(binOrder)) {
    const forOrders = l.orders.map((o) => (o.quantity > 1 ? `${o.orderNumber.slice(-6)} ×${o.quantity}` : o.orderNumber.slice(-6))).join(', ');
    if (y > doc.page.height - doc.page.margins.bottom - 50) { doc.addPage(); y = doc.page.margins.top; head(); }
    let x = left;
    box(doc, x + 3, y + 1, 9, 9, '#9ca3af');
    x += W * cols[0].w;
    line(doc, l.bin ?? '—', x + 3, y, { width: W * cols[1].w - 6, size: 10, bold: true });
    x += W * cols[1].w;
    const h = lines(doc, l.options ? `${l.title} — ${l.options}` : l.title, x + 3, y, { width: W * cols[2].w - 6, size: 9, max: 2 });
    x += W * cols[2].w;
    line(doc, l.sku, x + 3, y, { width: W * cols[3].w - 6, size: 8.5 });
    if (l.barcode) line(doc, l.barcode, x + 3, y + 11, { width: W * cols[3].w - 6, size: 7.5, color: MUTED });
    x += W * cols[3].w;
    line(doc, String(l.quantity), x + 3, y - 1, { width: W * cols[4].w - 6, size: 12, bold: true, align: 'right' });
    x += W * cols[4].w;
    const oh = lines(doc, forOrders, x + 3, y, { width: W * cols[5].w - 6, size: 7.5, color: MUTED, max: 3 });
    y += Math.max(h, oh, 22) + 5;
    rule(doc, left, left + W, y - 3, '#eef0f3');
  }
  if (!p.lines.length) line(doc, 'Nothing to pick.', left, y, { width: W, size: 10, color: MUTED });
  footers(doc, `FastMoveX · Picking list · ${p.warehouse}`);
  return toBuffer(doc);
}
