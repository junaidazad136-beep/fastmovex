import QRCode from 'qrcode';
import { formatMoney } from '../notifications/templates';
import { box, Doc, line, lines, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

/** What a 10 × 15 cm shipping label (and the packing list behind it) needs to know about one shipment. */
export interface ShippingLabel {
  /** The shipment (seller order) id: the QR the driver scans at pick-up. */
  shipmentId: string;
  orderNumber: string;
  shipmentNo: string;
  placedAt: Date;
  slot: { start: Date; end: Date | null } | null;
  deliveryMethod: string;
  from: { store: string; phone: string | null };
  customer: { name: string; phone: string | null; address: string[] };
  note: string | null;
  /** Cash to collect at the door, or null when already paid. */
  cash: { amountMinor: bigint; currencyCode: string } | null;
  items: { title: string; sku: string; options: string | null; quantity: number }[];
}

/** 100 × 150 mm, the usual thermal label (4 × 6 in printers print it 1:1; A4 printers scale it). */
export const LABEL_SIZE: [number, number] = [283.46, 425.2];

/** The QR on a label: "FMXS:" + the shipment id. Short, so it scans quickly even on a cheap printer. */
export const labelQrText = (shipmentId: string) => `FMXS:${shipmentId}`;

/** Reads a scanned label (the QR text, or a tracking link that ends with it). null when it is not ours. Exported for the driver page tests. */
export function parseLabelQr(text: string): string | null {
  const m = /FMXS:([0-9a-f-]{36})\s*$/i.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

const METHOD: Record<string, string> = { JOVIA: 'FastMoveX driver', SELLER: 'Seller delivers', COURIER: 'Courier', PICKUP: 'Customer pick-up' };
const timeOf = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

function drawQr(doc: Doc, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2; // modules of white border
  const cell = size / (n + quiet * 2);
  doc.save().rect(x, y, size, size).fill('#ffffff');
  doc.fillColor('#000000');
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.15, cell + 0.15);
    }
  }
  doc.fill().restore();
}

/**
 * Shipping labels: per shipment one label page — big order number, QR for the driver, cash to collect, who it goes
 * to and who sends it — followed by a packing list on the same paper (what goes in the box, with tick boxes, no
 * prices). One click prints everything a seller needs for one parcel.
 */
export async function renderShippingLabels(labels: ShippingLabel[], tz: string): Promise<Buffer> {
  const doc = newPdf({ size: LABEL_SIZE, margins: { top: 12, bottom: 12, left: 12, right: 12 }, title: labels.length === 1 ? `Label ${labels[0].shipmentNo}` : `Labels (${labels.length})` });
  const left = 12;
  const W = LABEL_SIZE[0] - 24;
  labels.forEach((l, i) => {
    if (i > 0) doc.addPage({ size: LABEL_SIZE, margins: { top: 12, bottom: 12, left: 12, right: 12 } });
    let y = 12;
    // header: brand + how it travels
    doc.save().rect(left, y, W, 24).fill('#111827').restore();
    line(doc, 'FastMoveX', left + 8, y + 5, { width: W * 0.5, size: 12, bold: true, color: '#ffffff' });
    line(doc, METHOD[l.deliveryMethod] ?? l.deliveryMethod, left + W * 0.45, y + 7, { width: W * 0.55 - 8, size: 8.5, bold: true, color: '#ffffff', align: 'right' });
    y += 30;
    // order number (what people read out on the phone)
    line(doc, l.shipmentNo, left, y, { width: W, size: 15, bold: true, minSize: 9 });
    y += 21;
    line(doc, `Placed ${localTime(l.placedAt, tz)}`, left, y, { width: W, size: 7.5, color: MUTED });
    y += 12;

    // QR + cash / items / window
    const qr = 104;
    drawQr(doc, labelQrText(l.shipmentId), left, y, qr);
    const rx = left + qr + 8;
    const rw = W - qr - 8;
    box(doc, rx, y, rw, qr);
    if (l.cash) {
      line(doc, 'COLLECT CASH · تحصيل نقدي', rx + 6, y + 6, { width: rw - 12, size: 7, bold: true, color: MUTED });
      line(doc, formatMoney(l.cash.amountMinor.toString(), l.cash.currencyCode), rx + 6, y + 17, { width: rw - 12, size: 15, bold: true, minSize: 10 });
    } else {
      line(doc, 'PAID · مدفوع', rx + 6, y + 6, { width: rw - 12, size: 7, bold: true, color: MUTED });
      line(doc, 'Nothing to collect', rx + 6, y + 17, { width: rw - 12, size: 11, bold: true });
    }
    rule(doc, rx, rx + rw, y + 42);
    const pieces = l.items.reduce((s, it) => s + it.quantity, 0);
    line(doc, `Items: ${pieces}`, rx + 6, y + 48, { width: rw - 12, size: 10, bold: true });
    line(doc, l.slot ? localTime(l.slot.start, tz, false) : 'Deliver: as soon as possible', rx + 6, y + 66, { width: rw - 12, size: 8.5, bold: !!l.slot });
    if (l.slot) line(doc, `${timeOf(l.slot.start, tz)}–${l.slot.end ? timeOf(l.slot.end, tz) : ''}`, rx + 6, y + 79, { width: rw - 12, size: 10, bold: true });
    y += qr + 8;

    // deliver to
    const toH = 118;
    doc.save().rect(left, y, W, toH).lineWidth(1.4).strokeColor('#111827').stroke().restore();
    line(doc, 'DELIVER TO · التوصيل إلى', left + 8, y + 6, { width: W - 16, size: 7, bold: true, color: MUTED });
    line(doc, l.customer.name, left + 8, y + 17, { width: W - 16, size: 14, bold: true, minSize: 9 });
    if (l.customer.phone) line(doc, l.customer.phone, left + 8, y + 37, { width: W - 16, size: 13, bold: true });
    let ay = y + 57;
    for (const a of l.customer.address.slice(0, 3)) ay += lines(doc, a, left + 8, ay, { width: W - 16, size: 9.5, max: 2 });
    y += toH + 6;

    // customer's note
    if (l.note) {
      line(doc, 'NOTE · ملاحظة', left, y, { width: W, size: 7, bold: true, color: MUTED });
      y += 10;
      y += lines(doc, l.note, left, y, { width: W, size: 8.5, max: 2 }) + 2;
    }

    // from
    const fy = LABEL_SIZE[1] - 12 - 40;
    rule(doc, left, left + W, fy - 4);
    line(doc, 'FROM · من', left, fy, { width: W, size: 7, bold: true, color: MUTED });
    line(doc, [l.from.store, l.from.phone].filter(Boolean).join(' · '), left, fy + 10, { width: W, size: 9.5, bold: true });
    line(doc, 'Driver: scan the QR at pick-up · fastmovex.qa', left, fy + 25, { width: W, size: 7, color: MUTED });

    // packing list on the next page(s)
    doc.addPage({ size: LABEL_SIZE, margins: { top: 12, bottom: 12, left: 12, right: 12 } });
    y = 12;
    line(doc, 'Packing list · قائمة التعبئة', left, y, { width: W * 0.6, size: 10.5, bold: true });
    line(doc, l.shipmentNo, left + W * 0.4, y + 1, { width: W * 0.6, size: 8.5, bold: true, align: 'right', minSize: 6.5 });
    y += 18;
    line(doc, `${l.customer.name} · ${pieces} item${pieces === 1 ? '' : 's'}`, left, y, { width: W, size: 8, color: MUTED });
    y += 14;
    rule(doc, left, left + W, y);
    y += 5;
    for (const it of l.items) {
      if (y > LABEL_SIZE[1] - 40) {
        doc.addPage({ size: LABEL_SIZE, margins: { top: 12, bottom: 12, left: 12, right: 12 } });
        y = 12;
        line(doc, `${l.shipmentNo} (continued)`, left, y, { width: W, size: 8.5, bold: true });
        y += 16;
      }
      box(doc, left, y + 1, 10, 10, '#111827');
      line(doc, `${it.quantity} ×`, left + 15, y, { width: 30, size: 10, bold: true });
      const h = lines(doc, it.title, left + 46, y, { width: W - 46, size: 9, max: 2 });
      const sub = [it.options, it.sku].filter(Boolean).join(' · ');
      line(doc, sub, left + 46, y + h, { width: W - 46, size: 7.5, color: MUTED });
      y += h + 14;
      rule(doc, left, left + W, y - 3);
    }
    line(doc, 'No prices on this paper: it may be a gift.', left, LABEL_SIZE[1] - 24, { width: W, size: 7, color: MUTED });
  });
  return toBuffer(doc);
}
