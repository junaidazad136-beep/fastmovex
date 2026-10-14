import type { Locale } from './i18n/config';

export const paths = {
  home: (l: Locale) => `/${l}`,
  product: (l: Locale, slug: string) => `/${l}/p/${slug}`,
  category: (l: Locale, slug: string) => `/${l}/c/${slug}`,
  store: (l: Locale, slug: string) => `/${l}/store/${slug}`,
  brand: (l: Locale, slug: string) => `/${l}/brand/${slug}`,
  search: (l: Locale, params: Record<string, string | number | undefined | null> = {}) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
    const s = u.toString();
    return `/${l}/search${s ? `?${s}` : ''}`;
  },
  cart: (l: Locale) => `/${l}/cart`,
  checkout: (l: Locale) => `/${l}/checkout`,
  login: (l: Locale, next?: string) => `/${l}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`,
  register: (l: Locale, next?: string) => `/${l}/register${next ? `?next=${encodeURIComponent(next)}` : ''}`,
  account: (l: Locale) => `/${l}/account`,
  seller: (l: Locale) => `/${l}/seller`,
  sellerOrders: (l: Locale) => `/${l}/seller/orders`,
  sellerOrder: (l: Locale, id: string) => `/${l}/seller/orders/${id}`,
  sellerProducts: (l: Locale) => `/${l}/seller/products`,
  sellerProduct: (l: Locale, id: string) => `/${l}/seller/products/${id}`,
  sellerNewProduct: (l: Locale) => `/${l}/seller/products/new`,
  sellerBulk: (l: Locale) => `/${l}/seller/products/import`,
  sellerPayments: (l: Locale) => `/${l}/seller/payments`,
  sellerStore: (l: Locale) => `/${l}/seller/store`,
  sellerReturns: (l: Locale) => `/${l}/seller/returns`,
  sellerQuestions: (l: Locale) => `/${l}/seller/questions`,
  sellerReviews: (l: Locale) => `/${l}/seller/reviews`,
  sellerCoupons: (l: Locale) => `/${l}/seller/coupons`,
  sellerReports: (l: Locale) => `/${l}/seller/reports`,
  orders: (l: Locale) => `/${l}/account/orders`,
  order: (l: Locale, number: string) => `/${l}/account/orders/${number}`,
  addresses: (l: Locale) => `/${l}/account/addresses`,
  wishlist: (l: Locale) => `/${l}/account/wishlist`,
  notifications: (l: Locale) => `/${l}/account/notifications`,
  returns: (l: Locale) => `/${l}/account/returns`,
  reviews: (l: Locale) => `/${l}/account/reviews`,
  help: (l: Locale) => `/${l}/help`,
  tickets: (l: Locale) => `/${l}/help/tickets`,
  ticket: (l: Locale, number: string) => `/${l}/help/tickets/${number}`,
  newTicket: (l: Locale, order?: string) => `/${l}/help/tickets/new${order ? `?order=${encodeURIComponent(order)}` : ''}`,
  returnsPolicy: (l: Locale) => `/${l}/help/returns`,
  policies: (l: Locale) => `/${l}/policies`,
  terms: (l: Locale) => `/${l}/terms`,
  privacy: (l: Locale) => `/${l}/privacy`,
  sellerPolicy: (l: Locale) => `/${l}/seller-policy`,
  deliveryInfo: (l: Locale) => `/${l}/help/delivery`,
  offers: (l: Locale) => `/${l}/offers`,
  contact: (l: Locale, order?: string) => `/${l}/contact${order ? `?order=${encodeURIComponent(order)}` : ''}`,
  track: (l: Locale, order?: string, token?: string) => {
    const u = new URLSearchParams();
    if (order) u.set('order', order);
    if (token) u.set('t', token);
    const s = u.toString();
    return `/${l}/track${s ? `?${s}` : ''}`;
  },
  page: (l: Locale, slug: string) => `/${l}/${slug}`,
  forgot: (l: Locale) => `/${l}/forgot-password`,
};

/** A home section's "View all" target on the website. */
export function viewAllHref(l: Locale, v: { category?: string; q?: string; sort?: string; offers?: boolean } | null | undefined): string | undefined {
  if (!v) return undefined;
  if (v.offers) return paths.offers(l);
  if (v.category) return `${paths.category(l, v.category)}${v.sort ? `?sort=${encodeURIComponent(v.sort)}` : ''}`;
  if (v.q || v.sort) return paths.search(l, { q: v.q, sort: v.sort });
  return undefined;
}

/**
 * Admin-entered banner links: site paths get the visitor's language prefix; only https links may leave the site.
 * Anything else (javascript:, data:, protocol-relative) is dropped.
 */
export function bannerHref(l: Locale, link: string | null | undefined): { href: string; external: boolean } | null {
  if (!link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return { href: `/${l}${link}`, external: false };
  if (/^https:\/\//i.test(link)) return { href: link, external: true };
  return null;
}

/** Only same-site relative paths are allowed as a post-login destination (no open redirects). */
export function safeNext(next: string | null | undefined, l: Locale): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return paths.home(l);
  return next;
}

/** Swaps the language prefix of a path, keeping the rest (including the query string). */
export function switchLocalePath(pathname: string, search: string, to: Locale): string {
  const parts = pathname.split('/');
  if (parts[1] === 'en' || parts[1] === 'ar') parts[1] = to;
  else parts.splice(1, 0, to);
  return `${parts.join('/') || `/${to}`}${search}`;
}

/** Localized name: Arabic when available, English otherwise. */
export function pick(l: Locale, en: string, ar?: string | null): string {
  return l === 'ar' && ar ? ar : en;
}
