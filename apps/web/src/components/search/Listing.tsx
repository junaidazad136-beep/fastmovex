import { X } from 'lucide-react';
import Link from 'next/link';
import type { SearchResult } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { toUrlParams, type ListingQuery } from '@/lib/listing';
import { ProductGrid } from '../product/ProductCard';
import { NoResults, SpellingNote } from './SearchHelp';
import { SearchLogger } from './SearchLogger';
import { Filters } from './Filters';
import { SortSelect } from './SortSelect';

function url(basePath: string, q: Partial<ListingQuery>, fixed: (keyof ListingQuery)[]) {
  const s = new URLSearchParams(toUrlParams(q, fixed)).toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function Listing({
  t, result, query, basePath, fixed = [], minorUnits, heading, categoryBase,
}: {
  t: T;
  result: SearchResult;
  query: ListingQuery;
  basePath: string;
  fixed?: (keyof ListingQuery)[];
  minorUnits: number;
  heading: React.ReactNode;
  categoryBase?: string;
}) {
  const chips: { label: string; href: string }[] = [
    ...query.brands.map((b) => ({ label: result.facets.brands.find((x) => x.slug === b)?.name ?? b, href: url(basePath, { ...query, brands: query.brands.filter((x) => x !== b), page: 1 }, fixed) })),
    ...(query.min || query.max ? [{ label: `${query.min ?? '0'} – ${query.max ?? '∞'}`, href: url(basePath, { ...query, min: undefined, max: undefined, page: 1 }, fixed) }] : []),
    ...(query.rating ? [{ label: t('search.ratingAndUp', { n: query.rating }), href: url(basePath, { ...query, rating: undefined, page: 1 }, fixed) }] : []),
    ...(query.inStock ? [{ label: t('search.inStockOnly'), href: url(basePath, { ...query, inStock: false, page: 1 }, fixed) }] : []),
  ];

  return (
    <div className="lg:flex lg:gap-8">
      <Filters variant="sidebar" query={query} facets={result.facets} basePath={basePath} fixed={fixed} total={result.total} categoryBase={categoryBase} />
      <div className="min-w-0 flex-1">
        {heading}
        {result.spelling && query.q && (
          <SpellingNote
            t={t}
            spelling={result.spelling}
            exactHref={url(basePath, { ...query, q: result.spelling.original, exact: true, page: 1 }, fixed)}
            correctedHref={url(basePath, { ...query, q: result.spelling.corrected, exact: undefined, page: 1 }, fixed)}
          />
        )}
        {/* Phones: [Filters] [Sort] side by side, count below. Large screens: count … sort (filters are in the sidebar). */}
        <div className="mb-4 flex flex-wrap items-center gap-2 lg:flex-nowrap lg:gap-3">
          <Filters variant="button" className="min-w-0 flex-1" query={query} facets={result.facets} basePath={basePath} fixed={fixed} total={result.total} categoryBase={categoryBase} />
          <SortSelect query={query} basePath={basePath} fixed={fixed} className="min-w-0 flex-1 lg:order-last lg:flex-none" />
          <p className="w-full text-sm text-ink-500 lg:w-auto lg:flex-1" data-testid="result-count">{t.plural('search.count', result.total)}</p>
        </div>
        {chips.length > 0 && (
          <ul className="mb-4 flex flex-wrap items-center gap-2" aria-label={t('search.activeFilters')}>
            {chips.map((c) => (
              <li key={c.label}>
                <Link href={c.href} scroll={false} className="chip chip-active" aria-label={t('search.removeFilter', { name: c.label })}>
                  {c.label} <X className="size-3.5" aria-hidden />
                </Link>
              </li>
            ))}
            <li><Link href={url(basePath, { q: query.q, category: query.category, store: query.store, brands: [] }, fixed)} scroll={false} className="link text-sm">{t('common.clearAll')}</Link></li>
          </ul>
        )}
        {query.q && result.page === 1 && <SearchLogger q={query.q} total={result.total} corrected={!!result.spelling?.auto} />}
        {result.query.matchMode === 'any' && result.total > 0 && !result.spelling?.auto && (
          <p className="mb-4 rounded-xl bg-sand-50 px-4 py-3 text-sm text-sand-700">{t('search.broadMatch')}</p>
        )}
        {result.items.length ? (
          <ProductGrid items={result.items} t={t} minorUnits={minorUnits} priorityCount={4} />
        ) : (
          <NoResults t={t} help={result.noResults} minorUnits={minorUnits} />
        )}
        {result.pageCount > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-2" aria-label={t('common.page', { page: result.page, pages: result.pageCount })}>
            {result.page > 1 && <Link rel="prev" href={url(basePath, { ...query, page: result.page - 1 }, fixed)} className="btn-secondary">{t('common.previous')}</Link>}
            <span className="tabular px-3 text-sm text-ink-500">{t('common.page', { page: result.page, pages: result.pageCount })}</span>
            {result.page < result.pageCount && <Link rel="next" href={url(basePath, { ...query, page: result.page + 1 }, fixed)} className="btn-secondary">{t('common.next')}</Link>}
          </nav>
        )}
      </div>
    </div>
  );
}
