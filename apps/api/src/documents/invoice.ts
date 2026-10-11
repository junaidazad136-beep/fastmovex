import { formatMoney } from '../notifications/templates';
import { box, DANGER, footers, line, lines, localTime, MUTED, newPdf, rule, toBuffer } from './pdf';

/** Seller who issues the invoice (FastMoveX's own store takes its company details from the market settings). */
export interface InvoiceSeller { name: string; address: string | null; crNumber: string | null; taxNumber: string | null; contact: string | null; house: boolean }

export interface InvoiceSection {
  number: string;
  seller: InvoiceSeller;
  status: string;
  items: { title: string; sku: string; quantity: number; refundedQty: number; unitPriceMinor: bigint; lineTotalMinor: bigint }[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  deliveryFeeMinor: bigint;
  taxMinor: bigint;
}

export interface InvoiceInput {
  orderNumber: string;
  placedAt: Date;
  tz: string;
  currencyCode: string;
  vatRateBps: number;
  pricesIncludeTax: boolean;
  coupon: string | null;
  payment: { method: string; status: string } | null;
  billTo: { name: string; lines: string[]; phone: string | null; email: string | null };
  sections: InvoiceSection[];
  cancelled: boolean;
  /** credit notes already issued against this order (shown so the invoice is read together with them) */
  creditNotes: { number: string; amountMinor: bigint; at: Date }[];
}

const METHOD: Record<string, string> = { CARD: 'Card', APPLE_PAY: 'Apple Pay', GOOGLE_PAY: 'Google Pay', COD: 'Cash on delivery' };
const PAID: Record<string, string> = { CAPTURED: 'Paid', PARTIALLY_REFUNDED: 'Paid (part refunded)', REFUNDED: 'Refunded', PENDING: 'To pay', AUTHORIZED: 'Authorised' };

/** Total the customer pays for one seller's part (VAT on top only where prices exclude it). Exported for tests. */
export function sectionTotal(s: Pick<InvoiceSection, 'subtotalMinor' | 'discountMinor' | 'deliveryFeeMinor' | 'taxMinor'>, pricesIncludeTax: boolean): bigint {
  return s.subtotalMinor - s.discountMinor + s.deliveryFeeMinor + (pricesIncludeTax ? 0n : s.taxMinor);
}

/** Two-language label, English first: "Invoice no. · رقم الفاتورة". */
const bi = (en: string, ar: string) => `${en} · ${ar}`;

/**
 * The customer's invoice: one section (page) per seller, because each seller is the one selling. Labels are in
 * English and Arabic; item names in the language asked for. A cancelled order prints "CANCELLED" across the page.
 */
export async function renderInvoice(inv: InvoiceInput): Promise<Buffer> {
  const doc = newPdf({ size: 'A4', title: `Invoice ${inv.orderNumber}` });
  const left = doc.page.margins.left;
  const W = doc.page.width - left - doc.page.margins.right;
  const money = (v: bigint) => formatMoney(v, inv.currencyCode);

  inv.sections.forEach((s, idx) => {
    if (idx > 0) doc.addPage();
    const taxInvoice = !!s.seller.taxNumber && inv.vatRateBps > 0;
    let y = 36;
    // seller block (left) and document title (right)
    line(doc, s.seller.name, left, y, { width: W * 0.6, size: 15, bold: true });
    line(doc, taxInvoice ? 'TAX INVOICE' : 'INVOICE', left + W * 0.6, y, { width: W * 0.4, size: 16, bold: true, align: 'right' });
    y += 22;
    line(doc, taxInvoice ? 'فاتورة ضريبية' : 'فاتورة', left + W * 0.6, y, { width: W * 0.4, size: 11, align: 'right', color: MUTED });
    for (const t of [s.seller.address, s.seller.crNumber && `CR No. ${s.seller.crNumber}`, s.seller.taxNumber && `Tax No. ${s.seller.taxNumber}`, s.seller.contact]) {
      if (!t) continue;
      line(doc, t, left, y, { width: W * 0.6, size: 9, color: MUTED });
      y += 13;
    }
    y = Math.max(y, 80) + 12;

    // bill to + invoice facts
    const factsX = left + W * 0.55;
    line(doc, bi('Bill to', 'فاتورة إلى'), left, y, { width: W * 0.5, size: 8, bold: true, color: MUTED });
    let by = y + 14;
    by += line(doc, inv.billTo.name, left, by, { width: W * 0.5, size: 10.5, bold: true });
    for (const l of inv.billTo.lines) by += line(doc, l, left, by, { width: W * 0.5, size: 9 });
    if (inv.billTo.phone) by += line(doc, inv.billTo.phone, left, by, { width: W * 0.5, size: 9 });
    if (inv.billTo.email) by += line(doc, inv.billTo.email, left, by, { width: W * 0.5, size: 9 });
    const facts: [string, string][] = [
      [bi('Invoice No', 'رقم الفاتورة'), s.number],
      [bi('Order No', 'رقم الطلب'), inv.orderNumber],
      [bi('Date', 'التاريخ'), localTime(inv.placedAt, inv.tz, false)],
      [bi('Payment', 'الدفع'), inv.payment ? `${METHOD[inv.payment.method] ?? inv.payment.method}${inv.cancelled ? '' : ` — ${PAID[inv.payment.status] ?? inv.payment.status.toLowerCase()}`}` : '—'],
    ];
    let fy = y;
    for (const [k, v] of facts) {
      line(doc, k, factsX, fy, { width: W * 0.17, size: 7.5, color: MUTED });
      line(doc, v, factsX + W * 0.17, fy, { width: W * 0.28, size: 9.5, bold: k.startsWith('Invoice'), align: 'right' });
      fy += 15;
    }
    y = Math.max(by, fy) + 16;

    // items
    const cols = [
      { k: bi('Item', 'الصنف'), w: 0.44, a: 'left' as const }, { k: 'SKU', w: 0.16, a: 'left' as const }, { k: bi('Qty', 'الكمية'), w: 0.1, a: 'right' as const },
      { k: bi('Unit price', 'سعر الوحدة'), w: 0.15, a: 'right' as const }, { k: bi('Amount', 'المبلغ'), w: 0.15, a: 'right' as const },
    ];
    const head = () => {
      rule(doc, left, left + W, y + 16, '#111827', 1.2);
      let x = left;
      for (const c of cols) { line(doc, c.k, x + 2, y + 3, { width: W * c.w - 6, size: 7.5, bold: true, color: MUTED, align: c.a }); x += W * c.w; }
      y += 22;
    };
    head();
    for (const it of s.items) {
      if (y > doc.page.height - doc.page.margins.bottom - 170) { doc.addPage(); y = doc.page.margins.top; head(); }
      let x = left;
      const h = lines(doc, it.title, x + 2, y, { width: W * cols[0].w - 6, size: 9, max: 2 });
      x += W * cols[0].w;
      const cells = [it.sku, String(it.quantity), money(it.unitPriceMinor), money(it.lineTotalMinor)];
      cells.forEach((v, j) => { line(doc, v, x + 2, y, { width: W * cols[j + 1].w - 6, size: j === 0 ? 8 : 9, color: j === 0 ? MUTED : undefined, align: cols[j + 1].a }); x += W * cols[j + 1].w; });
      let rowH = Math.max(h, 13);
      if (it.refundedQty > 0) {
        line(doc, `${it.refundedQty} returned / refunded — see credit note`, left + 2, y + rowH, { width: W * 0.6, size: 7.5, color: DANGER });
        rowH += 11;
      }
      y += rowH + 5;
      rule(doc, left, left + W, y - 3, '#e5e7eb');
    }

    // totals
    y += 8;
    const tx = left + W * 0.5;
    const tw = W * 0.5;
    const total = sectionTotal(s, inv.pricesIncludeTax);
    const row = (k: string, v: string, bold = false, color?: string) => {
      line(doc, k, tx, y, { width: tw * 0.6, size: bold ? 10.5 : 9, bold, color: color ?? (bold ? undefined : MUTED) });
      line(doc, v, tx + tw * 0.6, y, { width: tw * 0.4, size: bold ? 11 : 9.5, bold, align: 'right', color });
      y += bold ? 18 : 15;
    };
    row(bi('Subtotal', 'المجموع الفرعي'), money(s.subtotalMinor));
    if (s.discountMinor > 0n) row(bi(`Discount${inv.coupon ? ` (${inv.coupon})` : ''}`, 'الخصم'), `−${money(s.discountMinor)}`);
    row(bi('Delivery', 'التوصيل'), s.deliveryFeeMinor === 0n ? bi('Free', 'مجاني') : money(s.deliveryFeeMinor));
    if (inv.vatRateBps > 0) row(bi(`VAT ${inv.vatRateBps / 100}%${inv.pricesIncludeTax ? ' (included)' : ''}`, 'ضريبة القيمة المضافة'), money(s.taxMinor));
    y += 3;
    rule(doc, tx, tx + tw, y, '#111827', 1.2);
    y += 7;
    row(bi('Total', 'الإجمالي'), money(total), true);

    if (inv.creditNotes.length && idx === inv.sections.length - 1) {
      y += 6;
      line(doc, bi('Credit notes issued', 'إشعارات دائنة صادرة'), left, y, { width: W, size: 8, bold: true, color: MUTED });
      y += 13;
      for (const c of inv.creditNotes) {
        line(doc, `${c.number} · ${localTime(c.at, inv.tz, false)}`, left, y, { width: W * 0.6, size: 9 });
        line(doc, `−${money(c.amountMinor)}`, left + W * 0.6, y, { width: W * 0.4, size: 9, align: 'right', color: DANGER });
        y += 13;
      }
    }

    if (inv.cancelled || s.status === 'CANCELLED') {
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] }).fontSize(80).fillColor(DANGER).opacity(0.12)
        .font('Bold').text('CANCELLED', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center', lineBreak: false }).restore();
    }

    const fy2 = doc.page.height - doc.page.margins.bottom - 46;
    box(doc, left, fy2, W, 30, '#e5e7eb');
    line(doc, s.seller.house ? 'Thank you for shopping with FastMoveX. شكراً لتسوقك من فاست موف إكس.' : `Sold by ${s.seller.name} on the FastMoveX marketplace.`, left + 8, fy2 + 6, { width: W - 16, size: 8.5, align: 'center' });
    line(doc, `All amounts in ${inv.currencyCode}.${inv.vatRateBps === 0 ? ' No VAT is charged in this market.' : ''}`, left + 8, fy2 + 17, { width: W - 16, size: 7.5, color: MUTED, align: 'center' });
  });
  footers(doc, `FastMoveX · ${inv.orderNumber}`);
  return toBuffer(doc);
}

