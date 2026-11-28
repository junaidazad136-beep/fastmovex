import { Star } from 'lucide-react';
import Link from 'next/link';
import type { SearchResult } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { toUrlParams, type ListingQuery } from '@/lib/listing';
import { Filters } from './Filters';
import { SortSelect } from './SortSelect';

const UNDER = 100; // "Under QAR 100" quick chip

/** Phones: one swipeable row of small chips (Filters, Sort, 4★+, In stock, Under 100, top brands); one tap each. */
export function QuickChips({ t, result, query, basePath, fixed = [], minorUnits, categoryBase }: { t: T; result: SearchResult; query: ListingQuery; basePath: string; fixed?: (keyof ListingQuery)[]; minorUnits: number; categoryBase?: string }) {
  const href = (q: Partial<ListingQuery>) => { const s = new URLSearchParams(toUrlParams({ ...query, ...q, page: 1 }, fixed)).toString(); return s ? `${basePath}?${s}` : basePath; };
  const currency = result.items[0]?.currencyCode ?? 'QAR';
  const under = query.max === String(UNDER) && !query.min;
  const chips = [
    { key: 'rating', on: query.rating === 4, to: href({ rating: query.rating === 4 ? undefined : 4 }), label: <><Star className="size-3.5 fill-current" aria-hidden />4+</> },
    { key: 'stock', on: query.inStock, to: href({ inStock: !query.inStock }), label: t('search.inStockOnly') },
    { key: 'under', on: under, to: href(under ? { max: undefined } : { max: String(UNDER), min: undefined }), label: t('search.under', { amount: formatMoney(String(UNDER * 10 ** minorUnits), currency, t.locale, { minorUnits, compact: true }) }) },
    ...result.facets.brands.slice(0, 3).map((b) => {
      const on = query.brands.includes(b.slug);
      return { key: `b-${b.slug}`, on, to: href({ brands: on ? query.brands.filter((x) => x !== b.slug) : [...query.brands, b.slug] }), label: <>{b.name}</> };
    }),
  ];
  return (
    <div className="no-scrollbar -mx-4 mb-2 flex items-center gap-2 overflow-x-auto px-4 pb-1 lg:hidden" role="group" aria-label={t('search.quickFilters')} data-testid="quick-chips">
      <Filters variant="chip" query={query} facets={result.facets} basePath={basePath} fixed={fixed} total={result.total} categoryBase={categoryBase} />
      <SortSelect chip query={query} basePath={basePath} fixed={fixed} className="shrink-0" />
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.to}
          scroll={false}
          aria-pressed={c.on}
          className={`inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${c.on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-900'}`}
          data-testid={`chip-${c.key}`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
