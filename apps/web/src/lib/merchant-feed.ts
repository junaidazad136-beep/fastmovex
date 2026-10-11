import { minorToDecimalString } from './money';

export interface FeedItem {
  id: string; itemGroupId: string | null; productSlug: string;
  title: string; titleAr: string | null; description: string; descriptionAr: string | null;
  imageUrl: string | null; additionalImages: string[];
  priceMinor: string; salePriceMinor: string | null; saleStartsAt: string | null; saleEndsAt: string | null;
  availability: 'in_stock' | 'out_of_stock';
  brand: string; gtin: string | null; mpn: string; color: string | null; size: string | null;
  productType: string; productTypeAr: string;
  options: Record<string, string>;
}
export interface FeedPage {
  enabled: boolean; page: number; pageSize: number; total: number;
  currencyCode: string; minorUnits: number;
  shipping: { countryCode: string; flatFeeMinor: string; freeOverMinor: string | null };
  items: FeedItem[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const tag = (name: string, value: string | null | undefined) => (value ? `<g:${name}>${esc(value)}</g:${name}>` : '');

/**
 * RSS 2.0 with Google's `g:` attributes. One <item> per variant; variants of one product share item_group_id. Prices
 * as "65.00 QAR"; a live deal is the sale price with its dates; only real GTINs are sent (otherwise
 * identifier_exists=no when the brand is our own store). Exported for tests.
 */
export function buildMerchantFeed(site: string, locale: 'en' | 'ar', pages: FeedPage[]): string {
  const first = pages[0];
  const money = (minor: string) => `${minorToDecimalString(minor, first?.minorUnits ?? 2)} ${first?.currencyCode ?? 'QAR'}`;
  const items = pages.flatMap((p) => p.items).filter((i) => i.imageUrl).map((i) => {
    const name = locale === 'ar' ? i.titleAr || i.title : i.title;
    const variant = [i.color, i.size].filter(Boolean).join(' / ');
    const title = (variant && !name.includes(variant) ? `${name} — ${variant}` : name).slice(0, 150);
    const description = (locale === 'ar' ? i.descriptionAr || i.description : i.description).replace(/\s+/g, ' ').trim().slice(0, 5000);
    const link = `${site}/${locale}/p/${i.productSlug}`;
    const shipping = first ? `<g:shipping><g:country>${esc(first.shipping.countryCode)}</g:country><g:price>${esc(money(first.shipping.flatFeeMinor))}</g:price></g:shipping>` : '';
    return [
      '<item>',
      tag('id', i.id),
      `<title>${esc(title)}</title>`, `<g:title>${esc(title)}</g:title>`,
      `<description>${esc(description)}</description>`, `<g:description>${esc(description)}</g:description>`,
      `<link>${esc(link)}</link>`, tag('link', link),
      tag('image_link', i.imageUrl),
      ...i.additionalImages.slice(0, 10).map((u) => tag('additional_image_link', u)),
      tag('availability', i.availability),
      tag('price', money(i.priceMinor)),
      i.salePriceMinor ? tag('sale_price', money(i.salePriceMinor)) : '',
      i.salePriceMinor && i.saleStartsAt && i.saleEndsAt ? tag('sale_price_effective_date', `${i.saleStartsAt}/${i.saleEndsAt}`) : '',
      tag('condition', 'new'),
      tag('brand', i.brand),
      i.gtin ? tag('gtin', i.gtin) : tag('identifier_exists', 'no'),
      tag('mpn', i.mpn),
      tag('item_group_id', i.itemGroupId),
      tag('color', i.color), tag('size', i.size),
      tag('product_type', locale === 'ar' ? i.productTypeAr : i.productType),
      shipping,
      first?.shipping.freeOverMinor ? `<g:free_shipping_threshold><g:country>${esc(first.shipping.countryCode)}</g:country><g:price_threshold>${esc(money(first.shipping.freeOverMinor))}</g:price_threshold></g:free_shipping_threshold>` : '',
      '</item>',
    ].join('');
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>FastMoveX${locale === 'ar' ? ' — فاست موف إكس' : ''}</title><link>${esc(`${site}/${locale}`)}</link><description>FastMoveX products (${locale})</description>${items.join('')}</channel></rss>`;
}
