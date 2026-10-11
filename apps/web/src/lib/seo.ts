import { LOCALES, type Locale } from './i18n/config';

/** hreflang map for a path that exists in every language, e.g. "/p/slug" → { en: "/en/p/slug", ar: "/ar/p/slug", x-default }. */
export function languageAlternates(pathWithoutLocale: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LOCALES) out[l === 'ar' ? 'ar-QA' : 'en-QA'] = `/${l}${pathWithoutLocale}`;
  out['x-default'] = `/en${pathWithoutLocale}`;
  return out;
}

export function alternatesFor(locale: Locale, pathWithoutLocale: string) {
  return { canonical: `/${locale}${pathWithoutLocale}`, languages: languageAlternates(pathWithoutLocale) };
}

/** Plain-text description of at most `max` characters, cut on a word boundary. */
export function clip(text: string | null | undefined, max = 158): string {
  if (!text) return '';
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

/** The products on a listing page, in order, for search engines (ItemList of product URLs). */
export function itemListJsonLd(site: string, locale: Locale, items: { slug: string; title: string; titleAr: string | null }[], name: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}/${locale}/p/${p.slug}`, name: locale === 'ar' ? p.titleAr || p.title : p.title })),
  };
}

/** The title shown in Google: the one written in the admin panel for this language, else the generated one. */
export function seoTitleOf(locale: Locale, own: { seoTitle?: string | null; seoTitleAr?: string | null }, fallback: string): string {
  return (locale === 'ar' ? own.seoTitleAr : own.seoTitle)?.trim() || fallback;
}
export function seoDescriptionOf(locale: Locale, own: { seoDescription?: string | null; seoDescriptionAr?: string | null; description?: string | null; descriptionAr?: string | null }, fallback: string): string {
  const written = (locale === 'ar' ? own.seoDescriptionAr : own.seoDescription)?.trim();
  if (written) return written;
  const intro = (locale === 'ar' ? own.descriptionAr : own.description)?.trim();
  return intro ? clip(intro) : fallback;
}
