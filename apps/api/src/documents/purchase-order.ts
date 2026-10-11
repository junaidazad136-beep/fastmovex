import { formatMoney } from '../notifications/templates';
import { box, footers, line, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

export interface PurchaseOrderInput {
  number: string;
  status: string;
  createdAt: Date;
  orderedAt: Date | null;
  expectedOn: string | null;
  tz: string;
  currencyCode: string;
  supplier: { name: string; contactName: string | null; phone: string | null; email: string | null; crNumber: string | null; address: string | null; paymentTerms: string | null };
  warehouse: { name: string; code: string; address: string | null; city: string | null };
  note: string | null;
  raisedBy: string;
  lines: { sku: string; barcode: string | null; title: string; quantity: number; receivedQty: number; unitCostMinor: bigint }[];
}

/** The purchase order sent to a supplier: who, deliver where and by when, what, at what price. */
export async function renderPurchaseOrder(p: PurchaseOrderInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A4', title: `Purchase order ${p.number}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  const money = (v: bigint) => formatMoney(v, p.currencyCode);
  const draft = p.status === 'DRAFT';
  const cancelled = p.status === 'CANCELLED';

  line(doc, 'FastMoveX — Purchase order', left, 36, { width: W * 0.6, size: 16, bold: true });
  line(doc, p.number, left + W * 0.6, 38, { width: W * 0.4, size: 11, bold: true, align: 'right' });
  line(doc, draft ? 'DRAFT — not sent' : cancelled ? 'CANCELLED' : `Ordered ${localTime(p.orderedAt ?? p.createdAt, p.tz, false)}`, left + W * 0.6, 56, { width: W * 0.4, size: 9, align: 'right', color: draft || cancelled ? '#b91c1c' : MUTED });

  const top = 84;
  const half = W / 2 - 8;
  const block = (x: number, title: string, rows: (string | null | undefined)[]) => {
    box(doc, x, top, half, 96);
    line(doc, title, x + 8, top + 8, { width: half - 16, size: 8, bold: true, color: MUTED, align: 'left' });
    let y = top + 24;
    for (const r of rows.filter(Boolean) as string[]) {
      line(doc, r, x + 8, y, { width: half - 16, size: y === top + 24 ? 10.5 : 9, bold: y === top + 24 });
      y += 13;
      if (y > top + 86) break;
    }
  };
  const s = p.supplier;
  block(left, 'SUPPLIER', [s.name, s.contactName, [s.phone, s.email].filter(Boolean).join(' · '), s.address, s.crNumber && `CR ${s.crNumber}`]);
  block(left + half + 16, 'DELIVER TO', [
    `${p.warehouse.name} (${p.warehouse.code})`, p.warehouse.address, p.warehouse.city,
    p.expectedOn ? `Expected by ${p.expectedOn}` : null, s.paymentTerms ? `Payment: ${s.paymentTerms}` : null,
  ]);

  let y = top + 112;
  const cols = [
    { k: '#', w: 0.05, a: 'left' as const }, { k: 'SKU / barcode', w: 0.2, a: 'left' as const }, { k: 'Product', w: 0.37, a: 'left' as const },
    { k: 'Qty', w: 0.08, a: 'right' as const }, { k: 'Unit cost', w: 0.14, a: 'right' as const }, { k: 'Total', w: 0.16, a: 'right' as const },
  ];
  const head = () => {
    doc.save().rect(left, y, W, 16).fill('#f3f4f6').restore();
    let x = left;
    for (const c of cols) { line(doc, c.k, x + 4, y + 4, { width: W * c.w - 8, size: 7.5, bold: true, color: MUTED, align: c.a }); x += W * c.w; }
    y += 20;
  };
  head();
  let total = 0n;
  let units = 0;
  p.lines.forEach((l, i) => {
    if (y > doc.page.height - doc.page.margins.bottom - 120) { doc.addPage(); y = doc.page.margins.top; head(); }
    const sum = l.unitCostMinor * BigInt(l.quantity);
    total += sum;
    units += l.quantity;
    const cells = [String(i + 1), l.barcode ? `${l.sku} · ${l.barcode}` : l.sku, l.title, String(l.quantity), money(l.unitCostMinor), money(sum)];
    let x = left;
    cells.forEach((v, j) => { line(doc, v, x + 4, y, { width: W * cols[j].w - 8, size: 8.5, align: cols[j].a }); x += W * cols[j].w; });
    y += 17;
    rule(doc, left, left + W, y - 4, '#eef0f3');
  });
  y += 6;
  line(doc, `${p.lines.length} lines · ${units} units`, left, y, { width: W * 0.5, size: 9, color: MUTED, align: 'left' });
  line(doc, 'Total', left + W * 0.5, y, { width: W * 0.24, size: 10, color: MUTED, align: 'right' });
  line(doc, money(total), left + W * 0.74, y - 1, { width: W * 0.26 - 4, size: 12, bold: true, align: 'right' });
  y += 28;
  if (p.note) {
    box(doc, left, y, W, 30);
    line(doc, `Note: ${p.note}`, left + 8, y + 10, { width: W - 16, size: 9 });
    y += 40;
  }
  line(doc, 'Please quote the PO number on your delivery note and invoice. Goods are counted on arrival; batch number and expiry date must be printed on every pack.', left, y, { width: W, size: 8, color: MUTED, align: 'left' });
  y = Math.max(y + 50, doc.page.height - doc.page.margins.bottom - 60);
  for (const [i, label] of [`Raised by ${p.raisedBy}`, 'Authorised signature'].entries()) {
    const x = left + i * (W / 2);
    rule(doc, x, x + W / 2 - 24, y, '#9ca3af');
    line(doc, label, x, y + 4, { width: W / 2 - 24, size: 8, color: MUTED, align: 'left' });
  }
  footers(doc, `FastMoveX · ${p.number} · Generated ${localTime(new Date(), p.tz)}`);
  return toBuffer(doc);
}
