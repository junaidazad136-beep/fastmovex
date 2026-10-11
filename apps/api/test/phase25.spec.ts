import { ProductCardService } from '../src/catalog/product-card.service';
import { bannerText } from '../src/marketing/marketing';
import { buildBaseQuery, codeLike } from '../src/search/postgres-search.engine';

const sqlText = (s: { sql?: string; strings?: readonly string[] }) => (s as { sql: string }).sql ?? (s.strings ?? []).join('?');

describe('Phase 25 — storefront look', () => {
  it('a scanned barcode or a SKU is recognised; ordinary words are not', () => {
    expect(codeLike('6291041500213')).toBe('6291041500213');
    expect(codeLike(' FMX-PFC-120 ')).toBe('FMX-PFC-120');
    expect(codeLike('npc20k')).toBe('npc20k');
    expect(codeLike('dates')).toBeNull(); // no digit
    expect(codeLike('oud 50')).toBeNull(); // two words
    expect(codeLike('12')).toBeNull(); // too short
    expect(codeLike(undefined)).toBeNull();
  });

  it('search matches the barcode / SKU exactly (bound values, never pasted into SQL)', () => {
    const base = { countryCode: 'QA', limit: 24, offset: 0, sort: 'relevance' as const };
    const withCode = buildBaseQuery({ ...base, q: '6291041500213' });
    expect(sqlText(withCode)).toContain('cv."barcode" =');
    expect(sqlText(withCode)).not.toContain('6291041500213');
    expect(withCode.values).toContain('6291041500213');
    expect(sqlText(buildBaseQuery({ ...base, q: 'khalas dates' }))).not.toContain('cv."barcode"');
  });

  it('banner text: trimmed, line breaks unified, empty means none', () => {
    expect(bannerText({ value: '  Big deals \r\n Up to *50% off*  ' })).toBe('Big deals\nUp to *50% off*');
    expect(bannerText({ value: '   ' })).toBeNull();
    expect(bannerText({ value: 5 })).toBe(5);
  });

  it('"Add" on a card goes straight to the cart only for a one-option product in stock', async () => {
    const variant = (id: string, onHand: number) => ({ id, priceMinor: 1000n, compareAtMinor: null, currencyCode: 'QAR', inventory: { onHand, reserved: 0, lowStockThreshold: 5 }, campaignProducts: [] });
    const row = (id: string, variants: ReturnType<typeof variant>[]) => ({ id, slug: id, title: id, titleAr: null, ratingAvg: 0, ratingCount: 0, soldCount: 0, sponsoredUntil: null, countryCode: 'QA', store: { slug: 's', name: 'S', nameAr: null }, images: [], variants });
    const prisma = { product: { findMany: jest.fn().mockResolvedValue([row('one', [variant('v1', 9)]), row('two', [variant('v2', 9), variant('v3', 9)]), row('none', [variant('v4', 0)])]) } };
    const svc = new ProductCardService(prisma as never, { publicUrl: () => null } as never);
    const cards = await svc.hydrate(['one', 'two', 'none']);
    expect(cards.map((c) => c.quickAddVariantId)).toEqual(['v1', null, null]);
  });
});
