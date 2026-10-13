import { labelQrText, parseLabelQr, renderShippingLabels, ShippingLabel } from '../src/documents/label';

const ID = '3f0c8a2e-1b4d-4c6e-9a7b-2d5e8f1a3c9b';
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

const label = (over: Partial<ShippingLabel> = {}): ShippingLabel => ({
  shipmentId: ID, orderNumber: 'FMX-QA-261013-ABC123', shipmentNo: 'FMX-QA-261013-ABC123-2', placedAt: new Date('2026-10-13T08:00:00Z'),
  slot: { start: new Date('2026-10-13T14:00:00Z'), end: new Date('2026-10-13T16:00:00Z') }, deliveryMethod: 'JOVIA',
  from: { store: 'Doha Gadgets Hub', phone: '+97455550000' },
  customer: { name: 'سارة أحمد', phone: '+97455551234', address: ['Zone 45, Street 901, Building 12', 'Al Waab, Doha'] },
  note: 'Call before coming', cash: { amountMinor: 14900n, currencyCode: 'QAR' },
  items: [{ title: 'Nova X12 Wireless Earbuds', sku: 'NX12-WHT', options: 'White', quantity: 2 }],
  ...over,
});

describe('Phase 26 — shipping labels for sellers', () => {
  it('the label QR is short and the driver page reads it back (also from the end of a link); anything else is refused', () => {
    expect(labelQrText(ID)).toBe(`FMXS:${ID}`);
    expect(parseLabelQr(`FMXS:${ID}`)).toBe(ID);
    expect(parseLabelQr(`  fmxs:${ID.toUpperCase()} `)).toBe(ID);
    expect(parseLabelQr(`https://fastmovex.qa/t?x=FMXS:${ID}`)).toBe(ID);
    expect(parseLabelQr('FMX-QA-261013-ABC123')).toBeNull();
    expect(parseLabelQr(`FMXS:${ID}x`)).toBeNull();
    expect(parseLabelQr('')).toBeNull();
  });

  it('one parcel prints as a 10 × 15 cm label plus its packing list (Arabic names, cash or paid)', async () => {
    const cod = await renderShippingLabels([label()], 'Asia/Qatar');
    expect(cod.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(cod)).toBe(2);
    expect(cod.toString('latin1')).toMatch(/MediaBox \[0 0 283\.46 425\.2\]/);
    const paid = await renderShippingLabels([label({ cash: null, note: null, slot: null })], 'Asia/Qatar');
    expect(pages(paid)).toBe(2);
  });

  it('a long order continues the packing list on more pages; several parcels print in one file', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Item number ${i + 1} with a fairly long product title to wrap`, sku: `SKU-${i}`, options: null, quantity: 1 }));
    const long = await renderShippingLabels([label({ items: many })], 'Asia/Qatar');
    expect(pages(long)).toBeGreaterThan(2);
    const two = await renderShippingLabels([label(), label({ shipmentId: ID.replace('3f', '4f') })], 'Asia/Qatar');
    expect(pages(two)).toBe(4);
  });
});
