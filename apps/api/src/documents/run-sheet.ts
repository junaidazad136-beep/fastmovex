import { formatMoney } from '../notifications/templates';
import { box, DANGER, Doc, footers, line, lines, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

export interface RunSheetJob {
  orderNumber: string;
  status: string;
  slot: { start: Date | string; end: Date | string | null } | null;
  customer: { name: string | null; phone: string | null };
  address: { zone: string | null; street: string | null; building: string | null; unit: string | null; city: string | null; line1: string | null };
  note: string | null;
  items: { title: string; quantity: number }[];
  pickup: { name: string | null; place: string | null };
  cash: { amountMinor: string; currencyCode: string } | null;
}

export interface RunSheetInput {
  driver: { fullName: string; phone: string | null };
  date: Date;
  tz: string;
  currencyCode: string;
  printedBy: string;
  jobs: RunSheetJob[];
}

const STATUS: Record<string, string> = { ASSIGNED: 'To pick up', PICKED_UP: 'Picked up', IN_TRANSIT: 'Picked up', OUT_FOR_DELIVERY: 'On the way', FAILED: 'Failed – retry', DELIVERED: 'Delivered' };

export function addressText(a: RunSheetJob['address']): string {
  return [a.unit, a.building && `Bldg ${a.building}`, a.street && `St ${a.street}`, a.zone && `Zone ${a.zone}`, a.line1, a.city].filter(Boolean).join(', ');
}

/**
 * The driver's paper for the day: every stop in driving order with the customer, phone, address, what to hand over and
 * how much cash to collect, plus a signature box per stop and the cash total to hand over at the end.
 * Delivered stops of today are listed after the open ones for the record.
 */
export async function renderRunSheet(r: RunSheetInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A4', layout: 'landscape', title: `Run sheet ${r.driver.fullName}` });
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const W = right - left;
  const open = r.jobs.filter((j) => j.status !== 'DELIVERED');
  const cashTotal = open.reduce((n, j) => n + BigInt(j.cash?.amountMinor ?? '0'), 0n);
  const pickups = [...new Set(open.map((j) => [j.pickup.name, j.pickup.place].filter(Boolean).join(' — ')).filter(Boolean))];

  // header
  line(doc, 'FastMoveX — Driver run sheet', left, 30, { width: W / 2, size: 16, bold: true });
  line(doc, `Date: ${localTime(r.date, r.tz, false)}`, left + W / 2, 32, { width: W / 2, size: 10, align: 'right' });
  let y = 54;
  line(doc, `Driver: ${r.driver.fullName}${r.driver.phone ? `  ·  ${r.driver.phone}` : ''}`, left, y, { width: W / 2, size: 10 });
  line(doc, `Printed ${localTime(new Date(), r.tz)} by ${r.printedBy}`, left + W / 2, y, { width: W / 2, size: 8, color: MUTED, align: 'right' });
  y += 18;
  // summary strip
  const cells: [string, string][] = [
    ['Stops to deliver', String(open.length)],
    ['Cash to collect', formatMoney(cashTotal, r.currencyCode)],
    ['Pick up from', pickups.join(' / ') || '—'],
  ];
  const cw = [W * 0.2, W * 0.25, W * 0.55];
  let cx = left;
  cells.forEach(([k, v], i) => {
    box(doc, cx, y, cw[i], 34);
    line(doc, k, cx + 6, y + 4, { width: cw[i] - 12, size: 7, color: MUTED });
    line(doc, v, cx + 6, y + 15, { width: cw[i] - 12, size: 11, bold: true });
    cx += cw[i];
  });
  y += 46;

  // table
  const cols = [
    { k: '#', w: 0.03 }, { k: 'Order / time', w: 0.13 }, { k: 'Customer', w: 0.15 }, { k: 'Address', w: 0.2 },
    { k: 'Items', w: 0.2 }, { k: 'Cash', w: 0.09 }, { k: 'Status', w: 0.08 }, { k: 'Received by (name & signature)', w: 0.12 },
  ].map((c) => ({ ...c, w: c.w * W }));
  const head = () => {
    doc.save().rect(left, y, W, 16).fill('#f3f4f6').restore();
    let x = left;
    for (const c of cols) { line(doc, c.k, x + 3, y + 3, { width: c.w - 6, size: 7.5, bold: true, color: MUTED, align: 'left' }); x += c.w; }
    y += 18;
  };
  head();
  const all = [...open, ...r.jobs.filter((j) => j.status === 'DELIVERED')];
  all.forEach((j, i) => {
    const items = j.items.map((it) => `${it.quantity} × ${it.title}`);
    const rowH = Math.max(38, 12 + Math.min(items.length, 6) * 11 + (j.note ? 11 : 0));
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 70) { doc.addPage(); y = doc.page.margins.top; head(); }
    const done = j.status === 'DELIVERED';
    let x = left;
    const c = (n: number) => { const at = x; x += cols[n].w; return at + 3; };
    const w = (n: number) => cols[n].w - 6;
    const color = done ? MUTED : undefined;
    line(doc, String(i + 1), c(0), y + 3, { width: w(0), size: 9, bold: true, color });
    const slot = j.slot ? `${localTime(j.slot.start, r.tz).split(', ')[1]}${j.slot.end ? `–${localTime(j.slot.end, r.tz).split(', ')[1]}` : ''}` : 'Any time';
    const ox = c(1);
    line(doc, j.orderNumber, ox, y + 3, { width: w(1), size: 8, bold: true, color, align: 'left' });
    line(doc, slot, ox, y + 15, { width: w(1), size: 8, color: MUTED, align: 'left' });
    const cux = c(2);
    line(doc, j.customer.name ?? '—', cux, y + 3, { width: w(2), size: 9, bold: true, color });
    line(doc, j.customer.phone ?? '', cux, y + 15, { width: w(2), size: 8.5, color, align: 'left' });
    lines(doc, addressText(j.address), c(3), y + 3, { width: w(3), size: 8.5, color, max: 3 });
    const ix = c(4);
    items.slice(0, 6).forEach((t, k) => line(doc, k === 5 && items.length > 6 ? `+ ${items.length - 5} more items` : t, ix, y + 3 + k * 11, { width: w(4), size: 8, color, align: 'left' }));
    if (j.note) {
      const ny = y + 3 + Math.min(items.length, 6) * 11;
      doc.font('Bold').fontSize(7.5);
      const lw = doc.widthOfString('Note: ');
      line(doc, 'Note:', ix, ny, { width: lw, size: 7.5, bold: true, color: DANGER });
      line(doc, j.note, ix + lw, ny, { width: w(4) - lw, size: 7.5, color: DANGER });
    }
    line(doc, j.cash ? formatMoney(j.cash.amountMinor, j.cash.currencyCode) : 'Paid', c(5), y + 3, { width: w(5), size: 9, bold: !!j.cash, color: j.cash ? color : MUTED, align: 'left' });
    line(doc, STATUS[j.status] ?? j.status, c(6), y + 3, { width: w(6), size: 8, color, align: 'left' });
    c(7);
    rule(doc, left, right, y + rowH, '#e5e7eb');
    y += rowH + 2;
  });
  if (!all.length) { line(doc, 'No jobs assigned.', left, y + 6, { width: W, size: 10, color: MUTED }); y += 24; }

  // totals + signatures
  if (y > doc.page.height - doc.page.margins.bottom - 70) { doc.addPage(); y = doc.page.margins.top; }
  y += 10;
  line(doc, `Cash to hand over after this run: ${formatMoney(cashTotal, r.currencyCode)}`, left, y, { width: W / 2, size: 11, bold: true });
  y += 30;
  for (const [i, label] of ['Driver signature', 'Dispatcher signature', 'Cashier signature'].entries()) {
    const x = left + i * (W / 3);
    rule(doc, x, x + W / 3 - 24, y + 14, '#9ca3af');
    line(doc, label, x, y + 18, { width: W / 3 - 24, size: 8, color: MUTED });
  }
  footers(doc, 'FastMoveX · Ask every customer for their 4-digit delivery code before handing over the order. Never hand over without it.');
  return toBuffer(doc);
}
