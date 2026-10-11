import { LOCALES } from './i18n/config';

export interface UrlEntry { path: string; lastmod?: string | null; priority?: number; changefreq?: 'daily' | 'weekly' | 'monthly'; images?: { url: string; title?: string }[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One <url> per language, each listing every language version (hreflang), as Google recommends. */
export function urlset(site: string, entries: UrlEntry[]): string {
  const rows = entries.flatMap((e) =>
    LOCALES.map((l) => {
      const alts = LOCALES.map((a) => `<xhtml:link rel="alternate" hreflang="${a === 'ar' ? 'ar-QA' : 'en-QA'}" href="${esc(`${site}/${a}${e.path}`)}"/>`).join('');
      // product photos: Google Images is a real source of shoppers (absolute https addresses only)
      const imgs = (e.images ?? []).filter((i) => /^https?:\/\//.test(i.url)).slice(0, 5).map((i) => `<image:image><image:loc>${esc(i.url)}</image:loc>${i.title ? `<image:title>${esc(i.title)}</image:title>` : ''}</image:image>`).join('');
      return `<url><loc>${esc(`${site}/${l}${e.path}`)}</loc>${alts}<xhtml:link rel="alternate" hreflang="x-default" href="${esc(`${site}/en${e.path}`)}"/>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ''}${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ''}${e.priority !== undefined ? `<priority>${e.priority.toFixed(1)}</priority>` : ''}${imgs}</url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${rows.join('')}</urlset>`;
}

export function sitemapIndex(site: string, files: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((f) => `<sitemap><loc>${esc(`${site}/sitemaps/${f}`)}</loc></sitemap>`).join('')}</sitemapindex>`;
}

export const XML_HEADERS = { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900, s-maxage=900' };
