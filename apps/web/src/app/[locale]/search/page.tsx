import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Listing } from '@/components/search/Listing';
import { serverApi } from '@/lib/api/server';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { parseListing, toApiParams } from '@/lib/listing';
import { alternatesFor } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';
import { ArrowRight, Tag } from 'lucide-react';
import Link from 'next/link';

export async function generateMetadata({ params, searchParams }: PageProps<'/[locale]/search'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  const q = parseListing(await searchParams).q;
  return {
    title: q ? t('meta.searchTitle', { q }) : t('meta.searchTitleEmpty'),
    // Internal search results are not landing pages; category pages are.
    robots: { index: false, follow: true },
    alternates: alternatesFor(locale, '/search'),
  };
}

export default async function SearchPage({ params, searchParams }: PageProps<'/[locale]/search'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const query = parseListing(await searchParams);
  const market = await serverApi.market();
  const result = await serverApi.search(toApiParams(query, market.currency.minorUnits));
  // a search for a brand ("samsung", "سامسونج") offers its own page; categories with matches help narrow it down
  const words = (query.q ?? '').trim().toLowerCase();
  const brand = words && !query.brands.length ? result.facets.brands.find((b) => b.name.toLowerCase() === words || words.startsWith(`${b.name.toLowerCase()} `)) : undefined;
  const cats = result.facets.categories.slice(0, 8);
  return (
    <div className="container-page py-6">
      <Listing
        t={t}
        result={result}
        query={query}
        basePath={`/${locale}/search`}
        minorUnits={market.currency.minorUnits}
        heading={
          <div className="mb-2">
            <h1 className="text-2xl font-bold tracking-tight">{query.q ? t('search.resultsFor', { q: result.spelling?.auto ? result.spelling.corrected : query.q }) : t('search.allProducts')}</h1>
            {brand ? (
              <Link href={paths.brand(locale, brand.slug)} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2 text-sm font-medium text-brand-800 hover:bg-brand-100" data-testid="search-brand-link">
                <Tag className="size-4" aria-hidden />{t('search.brandPage', { name: brand.name })}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            ) : null}
            {query.q && cats.length > 1 ? (
              <div className="mt-3" data-testid="search-categories">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{t('search.inCategories')}</p>
                <ul className="no-scrollbar flex gap-2 overflow-x-auto">
                  {cats.map((c) => (
                    <li key={c.slug}><Link href={`${paths.category(locale, c.slug)}?q=${encodeURIComponent(query.q!)}`} className="chip whitespace-nowrap">{pick(locale, c.name, c.nameAr)} <span className="text-ink-400 tabular">{c.count}</span></Link></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
