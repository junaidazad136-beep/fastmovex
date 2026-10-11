import { formatMoney } from '../notifications/templates';
import { box, DANGER, footers, line, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

export interface CashReceiptInput {
  number: string;
  createdAt: Date;
  tz: string;
  currencyCode: string;
  holder: { fullName: string; phone: string | null };
  receivedBy: { fullName: string };
  expectedMinor: bigint;
  receivedMinor: bigint;
  varianceMinor: bigint;
  note: string | null;
  orders: { orderNumber: string; collectedAt: Date; amountMinor: bigint }[];
}

/** Receipt for cash a driver handed to a cashier: which orders, what was expected, what was counted, any shortage. */
export async function renderCashReceipt(r: CashReceiptInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A5', title: `Cash handover ${r.number}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  const money = (v: bigint) => formatMoney(v, r.currencyCode);

  line(doc, 'FastMoveX — Cash handover receipt', left, 30, { width: W, size: 14, bold: true });
  line(doc, r.number, left, 52, { width: W / 2, size: 10, bold: true });
  line(doc, localTime(r.createdAt, r.tz), left + W / 2, 52, { width: W / 2, size: 9, align: 'right', color: MUTED });
  let y = 76;
  const pair = (k: string, v: string) => {
    line(doc, k, left, y, { width: W * 0.35, size: 8.5, color: MUTED, align: 'left' });
    line(doc, v, left + W * 0.35, y, { width: W * 0.65, size: 9.5, bold: true });
    y += 15;
  };
  pair('Handed over by', `${r.holder.fullName}${r.holder.phone ? ` · ${r.holder.phone}` : ''}`);
  pair('Received by', r.receivedBy.fullName);
  y += 6;

  doc.save().rect(left, y, W, 15).fill('#f3f4f6').restore();
  line(doc, 'Order', left + 4, y + 3, { width: W * 0.45, size: 7.5, bold: true, color: MUTED, align: 'left' });
  line(doc, 'Delivered', left + W * 0.45, y + 3, { width: W * 0.3, size: 7.5, bold: true, color: MUTED, align: 'left' });
  line(doc, 'Cash', left + W * 0.75, y + 3, { width: W * 0.25 - 4, size: 7.5, bold: true, color: MUTED, align: 'right' });
  y += 18;
  for (const o of r.orders) {
    if (y > doc.page.height - doc.page.margins.bottom - 150) { doc.addPage(); y = doc.page.margins.top; }
    line(doc, o.orderNumber, left + 4, y, { width: W * 0.45, size: 8.5, align: 'left' });
    line(doc, localTime(o.collectedAt, r.tz), left + W * 0.45, y, { width: W * 0.3, size: 8, color: MUTED, align: 'left' });
    line(doc, money(o.amountMinor), left + W * 0.75, y, { width: W * 0.25 - 4, size: 8.5, align: 'right' });
    y += 16;
    rule(doc, left, left + W, y - 2, '#eef0f3');
  }
  y += 6;
  const total = (k: string, v: string, color?: string, bold = false) => {
    line(doc, k, left + W * 0.4, y, { width: W * 0.35, size: 9, color: MUTED, align: 'left' });
    line(doc, v, left + W * 0.75, y, { width: W * 0.25 - 4, size: bold ? 11 : 9.5, bold: true, color, align: 'right' });
    y += bold ? 18 : 15;
  };
  total(`Expected (${r.orders.length} orders)`, money(r.expectedMinor));
  total('Counted', money(r.receivedMinor));
  const v = r.varianceMinor;
  total(v === 0n ? 'Difference' : v < 0n ? 'SHORT' : 'Over', v === 0n ? money(0n) : money(v), v < 0n ? DANGER : undefined, true);
  if (r.note) {
    y += 4;
    box(doc, left, y, W, 30);
    line(doc, `Note: ${r.note}`, left + 6, y + 9, { width: W - 12, size: 8.5 });
    y += 38;
  }
  y = Math.max(y + 30, doc.page.height - doc.page.margins.bottom - 60);
  for (const [i, label] of ['Driver signature', 'Cashier signature'].entries()) {
    const x = left + i * (W / 2);
    rule(doc, x, x + W / 2 - 16, y, '#9ca3af');
    line(doc, label, x, y + 4, { width: W / 2 - 16, size: 8, color: MUTED, align: 'left' });
  }
  footers(doc, 'FastMoveX · This receipt is generated from the cash records and cannot be edited.');
  return toBuffer(doc);
}
