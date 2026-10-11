import { DELETED_NAME, scrubAddress } from '../src/account/privacy';
import { renderCreditNote, renderReturnReceipt } from '../src/documents/credit-note';
import { returnReceiptNo, shipmentNo } from '../src/documents/documents';
import { renderInvoice, sectionTotal } from '../src/documents/invoice';
import { binOrder, renderPackingSlips, renderPickList } from '../src/documents/packing';

const seller = { name: 'FastMoveX Trading W.L.L.', address: 'Lusail, Qatar', crNumber: '123456', taxNumber: null, contact: 'care@fastmovex.qa', house: true };
const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-';

describe('document numbers and maths', () => {
  it('shipment numbers: the order number, with -1, -2 only when several sellers', () => {
    expect(shipmentNo('FMX-QA-261005-ABC', 0, 1)).toBe('FMX-QA-261005-ABC');
    expect(shipmentNo('FMX-QA-261005-ABC', 1, 2)).toBe('FMX-QA-261005-ABC-2');
  });
  it('return receipt numbers are stable and short', () => {
    expect(returnReceiptNo('49543ce4-a5d3-44ee-90e8-dd6617802c64')).toBe('RR-49543CE4A5');
  });
  it('invoice total adds VAT only where prices exclude it', () => {
    const s = { subtotalMinor: 10000n, discountMinor: 1000n, deliveryFeeMinor: 1500n, taxMinor: 500n };
    expect(sectionTotal(s, true)).toBe(10500n);
    expect(sectionTotal(s, false)).toBe(11000n);
  });
  it('pick in shelf order: A-2 before A-10, no shelf last', () => {
    const rows = [{ bin: 'A-10', sku: 'x' }, { bin: null, sku: 'a' }, { bin: 'A-2', sku: 'y' }, { bin: 'B-1', sku: 'z' }, { bin: 'A-2', sku: 'b' }];
    expect([...rows].sort(binOrder).map((r) => `${r.bin}/${r.sku}`)).toEqual(['A-2/b', 'A-2/y', 'A-10/x', 'B-1/z', 'null/a']);
  });
});

describe('printed documents', () => {
  it('invoice: Arabic item names, several sellers, cancelled stamp, credit notes listed', async () => {
    const pdf = await renderInvoice({
      orderNumber: 'FMX-QA-261005-ABC', placedAt: new Date(), tz: 'Asia/Qatar', currencyCode: 'QAR', vatRateBps: 0, pricesIncludeTax: true, coupon: 'WELCOME10',
      payment: { method: 'COD', status: 'CAPTURED' }, billTo: { name: 'سارة', lines: ['Bldg 12, St 901, Zone 66', 'Doha'], phone: '+97450000001', email: 'sara@example.com' },
      cancelled: true, creditNotes: [{ number: 'CN-QA-261005-000001', amountMinor: 1000n, at: new Date() }],
      sections: [
        { number: 'FMX-QA-261005-ABC-1', seller, status: 'DELIVERED', subtotalMinor: 17900n, discountMinor: 1790n, deliveryFeeMinor: 0n, taxMinor: 0n, items: [{ title: 'وسادة أرضية مخملية', sku: 'PFC-120', quantity: 1, refundedQty: 1, unitPriceMinor: 17900n, lineTotalMinor: 17900n }] },
        { number: 'FMX-QA-261005-ABC-2', seller: { ...seller, house: false, name: 'Pearl Home Living' }, status: 'CANCELLED', subtotalMinor: 5000n, discountMinor: 0n, deliveryFeeMinor: 1500n, taxMinor: 0n, items: [{ title: 'Dates 1kg', sku: 'D-1', quantity: 2, refundedQty: 0, unitPriceMinor: 2500n, lineTotalMinor: 5000n }] },
      ],
    });
    expect(isPdf(pdf)).toBe(true);
  });
  it('packing slips (one page each, cash to collect) and the picking list', async () => {
    const slip = { orderNumber: 'FMX-1', shipmentNo: 'FMX-1', placedAt: new Date(), slot: { start: new Date(), end: new Date(Date.now() + 4 * 3_600_000) }, deliveryMethod: 'JOVIA', warehouse: 'Main', customer: { name: 'Noora', phone: '+974 5555 1234', address: ['Zone 66', 'Doha'] }, note: 'Ring twice', cash: { amountMinor: 17900n, currencyCode: 'QAR' }, items: [{ title: 'Lamp', sku: 'L-1', barcode: '629100', options: 'Black', quantity: 2, bin: 'A-02' }] };
    expect(isPdf(await renderPackingSlips([slip, { ...slip, shipmentNo: 'FMX-2', cash: null, slot: null }], 'Asia/Qatar'))).toBe(true);
    expect(isPdf(await renderPickList({ warehouse: 'Main', date: '2026-10-06', slotLabel: null, tz: 'Asia/Qatar', printedBy: 'Ops', shipments: 2, lines: [{ sku: 'L-1', barcode: null, title: 'Lamp', options: null, bin: 'A-02', quantity: 4, orders: [{ orderNumber: 'FMX-1', quantity: 2 }, { orderNumber: 'FMX-2', quantity: 2 }] }] }))).toBe(true);
    expect(isPdf(await renderPickList({ warehouse: 'Main', date: null, slotLabel: null, tz: 'Asia/Qatar', printedBy: 'Ops', shipments: 0, lines: [] }))).toBe(true);
  });
  it('credit note and return receipt', async () => {
    expect(isPdf(await renderCreditNote({ number: 'CN-QA-261005-000001', issuedAt: new Date(), tz: 'Asia/Qatar', currencyCode: 'QAR', orderNumber: 'FMX-1', invoiceNumber: 'FMX-1', seller, customer: { name: 'Noora', lines: ['Doha'] }, reason: 'Return: box crushed', method: 'CARD', reference: 're_1', amountMinor: 17900n, items: [{ title: 'Lamp', sku: 'L-1', quantity: 1 }] }))).toBe(true);
    for (const condition of ['SELLABLE', 'DAMAGED', 'NOT_ACCEPTED', null] as const) {
      expect(isPdf(await renderReturnReceipt({ number: 'RR-1', receivedAt: new Date(), tz: 'Asia/Qatar', orderNumber: 'FMX-1', seller, customer: { name: 'Noora' }, item: { title: 'Lamp', sku: 'L-1', quantity: 1 }, reason: 'Broken', condition, note: 'Glass cracked', receivedBy: 'Omar', refund: condition === 'NOT_ACCEPTED' ? null : { status: 'SUCCEEDED', amountMinor: 17900n, currencyCode: 'QAR', creditNoteNo: 'CN-1' } }))).toBe(true);
    }
  });
});

describe('account deletion', () => {
  it('keeps only the area of an order address', () => {
    expect(scrubAddress({ recipientName: 'Noora Al-Thani', phone: '+97455551234', zone: '66', street: '901', building: '12', unit: 'Flat 3', city: 'Doha', countryCode: 'QA', lat: 25.3, lng: 51.5 }))
      .toEqual({ recipientName: DELETED_NAME, countryCode: 'QA', city: 'Doha', zone: '66' });
    expect(scrubAddress(null)).toEqual({ recipientName: DELETED_NAME });
  });
});
