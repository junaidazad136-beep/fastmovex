import { formatMoney } from '../notifications/templates';
import { box, DANGER, footers, line, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

type ByMethod = { method: string; totalMinor: string }[];
export interface DailyClosingInput {
  date: string;
  tz: string;
  currencyCode: string;
  generatedAt: Date;
  sales: { byMethod: (ByMethod[number] & { orders: number })[]; orders: number; totalMinor: string; cancelledOrders: number; cancelledMinor: string };
  cardCaptured: { byMethod: (ByMethod[number] & { payments: number })[]; totalMinor: string };
  refunds: { byMethod: (ByMethod[number] & { refunds: number })[]; totalMinor: string };
  cash: {
    collectedMinor: string; collections: number; handedOverExpectedMinor: string; handedOverReceivedMinor: string; varianceMinor: string;
    handovers: { number: string; expectedMinor: string; receivedMinor: string; varianceMinor: string; note: string | null; createdAt: Date; holder: { fullName: string }; receivedBy: { fullName: string } }[];
    stillWithDriversMinor: string; stillWithDriversCount: number;
  };
  netMinor: string;
}

const METHOD: Record<string, string> = { CARD: 'Card', APPLE_PAY: 'Apple Pay', GOOGLE_PAY: 'Google Pay', COD: 'Cash on delivery', PAYLATER: 'PayLater', NONE: 'No payment' };

/** End-of-day report for finance: what was sold, what money came in and went out, and where the cash is. */
export async function renderDailyClosing(r: DailyClosingInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A4', title: `Daily closing ${r.date}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  const money = (v: string | bigint) => formatMoney(BigInt(v), r.currencyCode);

  line(doc, 'FastMoveX — Daily closing report', left, 36, { width: W * 0.65, size: 16, bold: true });
  line(doc, r.date, left + W * 0.65, 38, { width: W * 0.35, size: 12, bold: true, align: 'right' });
  line(doc, `Generated ${localTime(r.generatedAt, r.tz)} (${r.tz})`, left + W * 0.4, 58, { width: W * 0.6, size: 8.5, color: MUTED, align: 'right' });

  // headline tiles
  let y = 84;
  const tiles: [string, string, string?][] = [
    ['Orders', `${r.sales.orders} · ${money(r.sales.totalMinor)}`],
    ['Card money in', money(r.cardCaptured.totalMinor)],
    ['Cash collected', money(r.cash.collectedMinor)],
    ['Refunds out', money(r.refunds.totalMinor)],
  ];
  const tw = (W - 3 * 8) / 4;
  tiles.forEach(([k, v], i) => {
    const x = left + i * (tw + 8);
    box(doc, x, y, tw, 44);
    line(doc, k, x + 8, y + 8, { width: tw - 16, size: 7.5, color: MUTED, align: 'left' });
    line(doc, v, x + 8, y + 22, { width: tw - 16, size: 10.5, bold: true, align: 'left' });
  });
  y += 58;
  line(doc, 'Net money in (card + cash − refunds)', left, y, { width: W * 0.6, size: 10, color: MUTED, align: 'left' });
  line(doc, money(r.netMinor), left + W * 0.6, y - 1, { width: W * 0.4, size: 13, bold: true, align: 'right' });
  y += 26;

  const section = (title: string) => {
    if (y > doc.page.height - doc.page.margins.bottom - 140) { doc.addPage(); y = doc.page.margins.top; }
    line(doc, title, left, y, { width: W, size: 11, bold: true, align: 'left' });
    y += 18;
  };
  const table = (head: string[], widths: number[], rows: string[][], colors: (string | undefined)[] = []) => {
    doc.save().rect(left, y, W, 15).fill('#f3f4f6').restore();
    let x = left;
    head.forEach((h, j) => { line(doc, h, x + 4, y + 3, { width: W * widths[j] - 8, size: 7.5, bold: true, color: MUTED, align: j === 0 ? 'left' : 'right' }); x += W * widths[j]; });
    y += 19;
    if (!rows.length) { line(doc, 'None', left + 4, y, { width: W, size: 8.5, color: MUTED, align: 'left' }); y += 16; }
    rows.forEach((row, i) => {
      if (y > doc.page.height - doc.page.margins.bottom - 60) { doc.addPage(); y = doc.page.margins.top; }
      let cx = left;
      row.forEach((v, j) => { line(doc, v, cx + 4, y, { width: W * widths[j] - 8, size: 8.5, align: j === 0 ? 'left' : 'right', color: j === row.length - 1 ? colors[i] : undefined }); cx += W * widths[j]; });
      y += 15;
      rule(doc, left, left + W, y - 3, '#eef0f3');
    });
    y += 10;
  };

  section('Sales by payment method (orders placed today)');
  table(['Method', 'Orders', 'Value'], [0.5, 0.2, 0.3], [
    ...r.sales.byMethod.map((m) => [METHOD[m.method] ?? m.method, String(m.orders), money(m.totalMinor)]),
    ...(r.sales.cancelledOrders ? [[`Cancelled the same day (not counted)`, String(r.sales.cancelledOrders), money(r.sales.cancelledMinor)]] : []),
  ]);

  section('Card payments captured');
  table(['Method', 'Payments', 'Amount'], [0.5, 0.2, 0.3], r.cardCaptured.byMethod.map((m) => [METHOD[m.method] ?? m.method, String(m.payments), money(m.totalMinor)]));

  section('Refunds sent');
  table(['Paid with', 'Refunds', 'Amount'], [0.5, 0.2, 0.3], r.refunds.byMethod.map((m) => [METHOD[m.method] ?? m.method, String(m.refunds), money(m.totalMinor)]));

  section('Cash');
  table(['', 'Amount'], [0.6, 0.4], [
    [`Collected at the door (${r.cash.collections} deliveries)`, money(r.cash.collectedMinor)],
    ['Handed in — expected', money(r.cash.handedOverExpectedMinor)],
    ['Handed in — counted', money(r.cash.handedOverReceivedMinor)],
    ['Short (−) / over (+)', money(r.cash.varianceMinor)],
    [`Still with drivers at day end (${r.cash.stillWithDriversCount} deliveries)`, money(r.cash.stillWithDriversMinor)],
  ], [undefined, undefined, undefined, BigInt(r.cash.varianceMinor) < 0n ? DANGER : undefined]);

  if (r.cash.handovers.length) {
    section('Cash handovers');
    table(['Receipt · driver → cashier', 'Expected', 'Counted', 'Difference'], [0.46, 0.18, 0.18, 0.18],
      r.cash.handovers.map((h) => [`${h.number} · ${h.holder.fullName} → ${h.receivedBy.fullName}${h.note ? ` · ${h.note}` : ''}`, money(h.expectedMinor), money(h.receivedMinor), money(h.varianceMinor)]),
      r.cash.handovers.map((h) => (BigInt(h.varianceMinor) < 0n ? DANGER : undefined)));
  }

  y = Math.max(y + 30, doc.page.height - doc.page.margins.bottom - 60);
  if (y > doc.page.height - doc.page.margins.bottom - 40) { doc.addPage(); y = doc.page.margins.top + 40; }
  for (const [i, label] of ['Prepared by (finance)', 'Checked by (manager)'].entries()) {
    const x = left + i * (W / 2);
    rule(doc, x, x + W / 2 - 24, y, '#9ca3af');
    line(doc, label, x, y + 4, { width: W / 2 - 24, size: 8, color: MUTED, align: 'left' });
  }
  footers(doc, `FastMoveX · Daily closing ${r.date} · generated from payment, refund and cash records`);
  return toBuffer(doc);
}
