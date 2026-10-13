import { formatMoney } from '../notifications/templates';
import { box, DANGER, footers, line, lines, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';
import type { InvoiceSeller } from './invoice';

export interface CreditNoteInput {
  number: string;
  issuedAt: Date;
  tz: string;
  currencyCode: string;
  orderNumber: string;
  invoiceNumber: string;
  seller: InvoiceSeller;
  customer: { name: string; lines: string[] };
  reason: string;
  method: string;
  reference: string | null;
  amountMinor: bigint;
  items: { title: string; sku: string; quantity: number }[];
}

export interface ReturnReceiptInput {
  number: string;
  receivedAt: Date;
  tz: string;
  orderNumber: string;
  seller: InvoiceSeller;
  customer: { name: string };
  item: { title: string; sku: string; quantity: number };
  reason: string;
  condition: 'SELLABLE' | 'DAMAGED' | 'NOT_ACCEPTED' | null;
  note: string | null;
  receivedBy: string | null;
  refund: { status: string; amountMinor: bigint; currencyCode: string; creditNoteNo: string | null } | null;
}

const METHOD: Record<string, string> = { CARD: 'Back to the card used', APPLE_PAY: 'Back to Apple Pay', GOOGLE_PAY: 'Back to Google Pay', COD: 'Bank transfer (paid in cash)', PAYLATER: 'Back to your PayLater plan' };
const bi = (en: string, ar: string) => `${en} · ${ar}`;

function header(doc: PDFKit.PDFDocument, seller: InvoiceSeller, title: string, titleAr: string, number: string, at: Date, tz: string) {
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  line(doc, seller.name, left, 36, { width: W * 0.6, size: 14, bold: true });
  line(doc, title, left + W * 0.55, 36, { width: W * 0.45, size: 16, bold: true, align: 'right' });
  line(doc, titleAr, left + W * 0.55, 58, { width: W * 0.45, size: 11, color: MUTED, align: 'right' });
  let y = 56;
  for (const t of [seller.address, seller.crNumber && `CR No. ${seller.crNumber}`, seller.taxNumber && `Tax No. ${seller.taxNumber}`]) {
    if (!t) continue;
    line(doc, t, left, y, { width: W * 0.55, size: 8.5, color: MUTED });
    y += 12;
  }
  line(doc, number, left + W * 0.55, 76, { width: W * 0.45, size: 10.5, bold: true, align: 'right' });
  line(doc, localTime(at, tz), left + W * 0.55, 90, { width: W * 0.45, size: 8.5, color: MUTED, align: 'right' });
  return Math.max(y, 104) + 14;
}

/**
 * Credit note: the document that reduces an invoice when money goes back to the customer (refund or return).
 * Numbered by the database when the refund succeeds; read together with the order's invoice.
 */
export async function renderCreditNote(c: CreditNoteInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A4', title: `Credit note ${c.number}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  let y = header(doc, c.seller, 'CREDIT NOTE', 'إشعار دائن', c.number, c.issuedAt, c.tz);

  line(doc, bi('Customer', 'العميل'), left, y, { width: W * 0.5, size: 8, bold: true, color: MUTED });
  let cy = y + 13;
  cy += line(doc, c.customer.name, left, cy, { width: W * 0.5, size: 10.5, bold: true });
  for (const l of c.customer.lines) cy += line(doc, l, left, cy, { width: W * 0.5, size: 9 });
  const facts: [string, string][] = [
    [bi('Against invoice', 'مقابل الفاتورة'), c.invoiceNumber],
    [bi('Order No', 'رقم الطلب'), c.orderNumber],
    [bi('Refunded', 'طريقة الاسترداد'), METHOD[c.method] ?? c.method],
    ...(c.reference ? [[bi('Reference', 'المرجع'), c.reference] as [string, string]] : []),
  ];
  let fy = y;
  for (const [k, v] of facts) {
    line(doc, k, left + W * 0.52, fy, { width: W * 0.22, size: 8, color: MUTED });
    line(doc, v, left + W * 0.74, fy, { width: W * 0.26, size: 9, align: 'right' });
    fy += 15;
  }
  y = Math.max(cy, fy) + 18;

  if (c.items.length) {
    doc.save().rect(left, y, W, 16).fill('#f3f4f6').restore();
    line(doc, bi('Item', 'الصنف'), left + 4, y + 4, { width: W * 0.6, size: 7.5, bold: true, color: MUTED });
    line(doc, 'SKU', left + W * 0.62, y + 4, { width: W * 0.24, size: 7.5, bold: true, color: MUTED });
    line(doc, bi('Qty', 'الكمية'), left + W * 0.86, y + 4, { width: W * 0.14 - 4, size: 7.5, bold: true, color: MUTED, align: 'right' });
    y += 21;
    for (const it of c.items) {
      const h = lines(doc, it.title, left + 4, y, { width: W * 0.58, size: 9, max: 2 });
      line(doc, it.sku, left + W * 0.62, y, { width: W * 0.24, size: 8.5, color: MUTED });
      line(doc, String(it.quantity), left + W * 0.86, y, { width: W * 0.14 - 4, size: 9.5, align: 'right' });
      y += Math.max(h, 13) + 5;
      rule(doc, left, left + W, y - 3, '#eef0f3');
    }
  }
  y += 6;
  line(doc, bi('Reason', 'السبب'), left, y, { width: W * 0.2, size: 8, color: MUTED });
  lines(doc, c.reason, left + W * 0.2, y, { width: W * 0.8, size: 9, max: 3 });
  y += 34;
  rule(doc, left + W * 0.5, left + W, y, '#111827', 1.2);
  y += 6;
  line(doc, bi('Amount credited', 'المبلغ المسترد'), left + W * 0.5, y, { width: W * 0.3, size: 10.5, bold: true });
  line(doc, formatMoney(c.amountMinor, c.currencyCode), left + W * 0.8, y, { width: W * 0.2, size: 12, bold: true, align: 'right', color: DANGER });

  const by = doc.page.height - doc.page.margins.bottom - 46;
  box(doc, left, by, W, 30, '#e5e7eb');
  line(doc, 'This credit note reduces the invoice above by the amount shown. يخفض هذا الإشعار الدائن قيمة الفاتورة المذكورة بالمبلغ الموضح.', left + 8, by + 6, { width: W - 16, size: 8, align: 'center' });
  line(doc, `All amounts in ${c.currencyCode}.`, left + 8, by + 17, { width: W - 16, size: 7.5, color: MUTED, align: 'center' });
  footers(doc, `FastMoveX · ${c.number} · ${c.orderNumber}`);
  return toBuffer(doc);
}

const CONDITION: Record<string, [string, string]> = {
  SELLABLE: ['Accepted — as new', 'مقبول — بحالة جيدة'],
  DAMAGED: ['Accepted — damaged', 'مقبول — تالف'],
  NOT_ACCEPTED: ['Not accepted', 'غير مقبول'],
};

/** Return receipt: proof for the customer that the item came back, what condition it was in and what happens next. */
export async function renderReturnReceipt(r: ReturnReceiptInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A5', title: `Return receipt ${r.number}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  let y = header(doc, r.seller, 'RETURN RECEIPT', 'إيصال إرجاع', r.number, r.receivedAt, r.tz);
  const pair = (k: string, v: string, bold = false) => {
    line(doc, k, left, y, { width: W * 0.38, size: 8, color: MUTED });
    const h = lines(doc, v, left + W * 0.38, y, { width: W * 0.62, size: 9.5, bold, max: 3 });
    y += Math.max(h, 13) + 5;
  };
  pair(bi('Customer', 'العميل'), r.customer.name, true);
  pair(bi('Order No', 'رقم الطلب'), r.orderNumber);
  pair(bi('Item', 'الصنف'), `${r.item.title} (${r.item.sku})`, true);
  pair(bi('Quantity', 'الكمية'), String(r.item.quantity));
  pair(bi('Reason given', 'سبب الإرجاع'), r.reason);
  const cond = r.condition ? CONDITION[r.condition] : null;
  pair(bi('Condition', 'الحالة'), cond ? `${cond[0]} · ${cond[1]}` : '—', true);
  if (r.note) pair(bi('Note', 'ملاحظة'), r.note);
  if (r.receivedBy) pair(bi('Received by', 'استلمه'), r.receivedBy);
  y += 6;
  rule(doc, left, left + W, y, '#e5e7eb');
  y += 10;
  const next = r.condition === 'NOT_ACCEPTED'
    ? 'No refund: the item was not accepted on inspection. Contact us if you disagree. لا يوجد استرداد.'
    : r.refund
      ? r.refund.status === 'SUCCEEDED'
        ? `Refunded ${formatMoney(r.refund.amountMinor, r.refund.currencyCode)}${r.refund.creditNoteNo ? ` — credit note ${r.refund.creditNoteNo}` : ''}. تم الاسترداد.`
        : `Refund of ${formatMoney(r.refund.amountMinor, r.refund.currencyCode)} is being processed. جارٍ معالجة الاسترداد.`
      : 'Your refund is being prepared. جارٍ تجهيز الاسترداد.';
  lines(doc, next, left, y, { width: W, size: 9.5, bold: true, max: 3 });
  footers(doc, `FastMoveX · ${r.number}`);
  return toBuffer(doc);
}
