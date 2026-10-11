import { describe, expect, it } from 'vitest';
import en from '../i18n/messages/en';
import ar from '../i18n/messages/ar';
import { createTranslator } from '../i18n/translate';
import { buildMerchantFeed, type FeedPage } from '../merchant-feed';
import { itemListJsonLd, seoDescriptionOf, seoTitleOf } from '../seo';
import { urlset } from '../sitemap';

const page: FeedPage = {
  enabled: true, page: 1, pageSize: 5000, total: 2, currencyCode: 'QAR', minorUnits: 2,
  shipping: { countryCode: 'QA', flatFeeMinor: '1000', freeOverMinor: '10000' },
  items: [
    {
      id: 'DAL-1', itemGroupId: 'dallah', productSlug: 'dallah', title: 'Dallah & Cups <Set>', titleAr: 'طقم دلة', description: 'Brass dallah.', descriptionAr: 'دلة نحاس.',
      imageUrl: 'https://media.fastmovex.qa/a.jpg', additionalImages: ['https://media.fastmovex.qa/b.jpg'], priceMinor: '17900', salePriceMinor: '14900',
      saleStartsAt: '2026-10-01T00:00:00.000Z', saleEndsAt: '2026-10-10T00:00:00.000Z', availability: 'in_stock', brand: 'Pearl Home', gtin: '4006381333931', mpn: 'DAL-1',
      color: 'Gold', size: null, productType: 'Home > Kitchen', productTypeAr: 'المنزل > المطبخ', options: { Color: 'Gold' },
    },
    {
      id: 'NOIMG', itemGroupId: null, productSlug: 'x', title: 'No photo', titleAr: null, description: 'x', descriptionAr: null, imageUrl: null, additionalImages: [],
      priceMinor: '100', salePriceMinor: null, saleStartsAt: null, saleEndsAt: null, availability: 'out_of_stock', brand: 'FastMoveX', gtin: null, mpn: 'NOIMG',
      color: null, size: null, productType: 'Home', productTypeAr: 'المنزل', options: {},
    },
  ],
};

describe('Google Merchant feed', () => {
  it('prices with currency, the deal as sale price with dates, escaped text, items without a photo left out', () => {
    const xml = buildMerchantFeed('https://fastmovex.qa', 'en', [page]);
    expect(xml).toContain('<g:id>DAL-1</g:id>');
    expect(xml).toContain('<g:title>Dallah &amp; Cups &lt;Set&gt; — Gold</g:title>');
    expect(xml).toContain('<g:price>179.00 QAR</g:price>');
    expect(xml).toContain('<g:sale_price>149.00 QAR</g:sale_price>');
    expect(xml).toContain('<g:sale_price_effective_date>2026-10-01T00:00:00.000Z/2026-10-10T00:00:00.000Z</g:sale_price_effective_date>');
    expect(xml).toContain('<g:link>https://fastmovex.qa/en/p/dallah</g:link>');
    expect(xml).toContain('<g:gtin>4006381333931</g:gtin>');
    expect(xml).toContain('<g:shipping><g:country>QA</g:country><g:price>10.00 QAR</g:price></g:shipping>');
    expect(xml).toContain('<g:price_threshold>100.00 QAR</g:price_threshold>');
    expect(xml).not.toContain('NOIMG');
  });
  it('the Arabic feed uses the Arabic title, text and links', () => {
    const xml = buildMerchantFeed('https://fastmovex.qa', 'ar', [page]);
    expect(xml).toContain('<g:title>طقم دلة — Gold</g:title>');
    expect(xml).toContain('<g:link>https://fastmovex.qa/ar/p/dallah</g:link>');
    expect(xml).toContain('<g:product_type>المنزل &gt; المطبخ</g:product_type>');
  });
});

describe('SEO helpers', () => {
  it('own title per language, else the generated one; description falls back to the intro text', () => {
    expect(seoTitleOf('en', { seoTitle: '  Groceries in Qatar ' }, 'x')).toBe('Groceries in Qatar');
    expect(seoTitleOf('ar', { seoTitle: 'English only' }, 'عربي')).toBe('عربي');
    expect(seoDescriptionOf('en', { description: 'Intro text.' }, 'fallback')).toBe('Intro text.');
    expect(seoDescriptionOf('ar', { description: 'Intro text.' }, 'احتياطي')).toBe('احتياطي');
  });
  it('the listing as ItemList (product links in order)', () => {
    const l = itemListJsonLd('https://fastmovex.qa', 'ar', [{ slug: 'a', title: 'A', titleAr: 'أ' }, { slug: 'b', title: 'B', titleAr: null }], 'قسم');
    expect(l.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, url: 'https://fastmovex.qa/ar/p/a', name: 'أ' },
      { '@type': 'ListItem', position: 2, url: 'https://fastmovex.qa/ar/p/b', name: 'B' },
    ]);
  });
  it('product photos go into the sitemap (absolute addresses only)', () => {
    const xml = urlset('https://fastmovex.qa', [{ path: '/p/a', images: [{ url: 'https://media.fastmovex.qa/a.jpg', title: 'A & B' }, { url: '/relative.jpg' }] }]);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain('<image:image><image:loc>https://media.fastmovex.qa/a.jpg</image:loc><image:title>A &amp; B</image:title></image:image>');
    expect(xml).not.toContain('relative.jpg');
  });
  it('page titles in both languages', () => {
    expect(createTranslator('en', en)('meta.categoryTitle', { name: 'Groceries', country: 'Qatar' })).toBe('Groceries — buy online in Qatar');
    expect(createTranslator('ar', ar).plural('brand.count', 2)).toBe('منتجان');
  });
});
