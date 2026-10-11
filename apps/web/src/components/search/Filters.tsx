'use client';

import { SlidersHorizontal, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { SearchResult } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { toUrlParams, type ListingQuery } from '@/lib/listing';
import { decimalToMinor } from '@/lib/money';
import { useShop } from '@/lib/state/shop';
import { pick } from '@/lib/urls';
import { Dialog } from '../ui/Dialog';

interface Props {
  query: ListingQuery;
  facets: SearchResult['facets'];
  basePath: string;
  /** Keys fixed by the page itself (e.g. the category on a category page). */
  fixed?: (keyof ListingQuery)[];
  categoryBase?: string;
}

function href(basePath: string, q: Partial<ListingQuery>, fixed: (keyof ListingQuery)[]) {
  const params = new URLSearchParams(toUrlParams(q, fixed));
  const s = params.toString();
  return s ? `${basePath}?${s}` : basePath;
}

function Panel({ query, facets, basePath, fixed = [], categoryBase, onNavigate }: Props & { onNavigate: (url: string) => void }) {
  const t = useT();
  const { market } = useShop();
  const [min, setMin] = useState(query.min ?? '');
  const [max, setMax] = useState(query.max ?? '');
  const [priceError, setPriceError] = useState('');
  // Checkboxes react at once; the URL (and the results) follow when navigation completes.
  const [local, setLocal] = useState({ brands: query.brands, rating: query.rating, inStock: query.inStock });
  useEffect(() => { setMin(query.min ?? ''); setMax(query.max ?? ''); }, [query.min, query.max]);
  useEffect(() => { setLocal({ brands: query.brands, rating: query.rating, inStock: query.inStock }); }, [query.brands, query.rating, query.inStock]);

  const go = (patch: Partial<ListingQuery>) => {
    setLocal((x) => ({ ...x, ...(patch.brands ? { brands: patch.brands } : {}), ...('rating' in patch ? { rating: patch.rating } : {}), ...('inStock' in patch ? { inStock: !!patch.inStock } : {}) }));
    onNavigate(href(basePath, { ...query, ...patch, page: 1 }, fixed));
  };

  function applyPrice(e: React.FormEvent) {
    e.preventDefault();
    const a = min.trim() ? decimalToMinor(min, market.currency.minorUnits) : null;
    const b = max.trim() ? decimalToMinor(max, market.currency.minorUnits) : null;
    if ((min.trim() && a === null) || (max.trim() && b === null) || (a && b && BigInt(a) > BigInt(b))) {
      setPriceError(t('search.priceInvalid'));
      return;
    }
    setPriceError('');
    go({ min: min.trim() || undefined, max: max.trim() || undefined });
  }

  const showCategories = !fixed.includes('category') && facets.categories.length > 0;
  return (
    <div className="space-y-6 text-sm">
      {showCategories && (
        <fieldset>
          <legend className="mb-2 font-bold text-ink-900">{t('search.filterCategory')}</legend>
          <ul className="space-y-1">
            {facets.categories.slice(0, 12).map((c) => (
              <li key={c.slug}>
                <Link
                  href={categoryBase ? `${categoryBase}${c.slug}` : href(basePath, { ...query, category: c.slug, page: 1 }, fixed)}
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-ink-100 ${query.category === c.slug ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700'}`}
                >
                  <span>{pick(t.locale, c.name, c.nameAr)}</span>
                  <span className="tabular text-xs text-ink-400">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {facets.brands.length > 0 && (
        <fieldset>
          <legend className="mb-2 font-bold text-ink-900">{t('search.filterBrand')}</legend>
          <ul className="space-y-1">
            {facets.brands.slice(0, 15).map((b) => {
              const checked = local.brands.includes(b.slug);
              return (
                <li key={b.slug}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-100">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => go({ brands: checked ? local.brands.filter((x) => x !== b.slug) : [...local.brands, b.slug] })}
                      className="size-4 rounded border-ink-300 accent-brand-600"
                    />
                    <span className="flex-1 text-ink-700">{b.name}</span>
                    <span className="tabular text-xs text-ink-400">{b.count}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <form onSubmit={applyPrice}>
        <fieldset>
          <legend className="mb-2 font-bold text-ink-900">{t('search.filterPrice', { currency: market.currency.code })}</legend>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={t('search.minPrice')}
              aria-label={t('search.minPrice')} className="input py-2 text-sm" aria-invalid={!!priceError}
            />
            <span className="text-ink-400">–</span>
            <input
              inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder={t('search.maxPrice')}
              aria-label={t('search.maxPrice')} className="input py-2 text-sm" aria-invalid={!!priceError}
            />
            <button type="submit" className="btn-secondary px-3 py-2">{t('common.apply')}</button>
          </div>
          {priceError && <p className="field-error" role="alert">{priceError}</p>}
        </fieldset>
      </form>

      <fieldset>
        <legend className="mb-2 font-bold text-ink-900">{t('search.filterRating')}</legend>
        <ul className="space-y-1">
          {[4, 3, 2].map((r) => (
            <li key={r}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-100">
                <input type="radio" name="rating" checked={local.rating === r} onChange={() => go({ rating: r })} className="size-4 accent-brand-600" />
                <span className="inline-flex items-center gap-1 text-ink-700">
                  <Star className="size-3.5 fill-sand-500 text-sand-500" aria-hidden />
                  {t('search.ratingAndUp', { n: r })}
                </span>
              </label>
            </li>
          ))}
          {local.rating && (
            <li><button type="button" onClick={() => go({ rating: undefined })} className="link px-2 text-xs">{t('common.clear')}</button></li>
          )}
        </ul>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2.5 px-2">
        <input type="checkbox" checked={local.inStock} onChange={() => go({ inStock: !local.inStock })} className="size-4 rounded accent-brand-600" />
        <span className="font-medium text-ink-800">{t('search.inStockOnly')}</span>
      </label>
    </div>
  );
}

export function Filters(props: Props & { total: number }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const navigate = (url: string) => { setOpen(false); start(() => router.push(url, { scroll: false })); };
  const activeCount = props.query.brands.length + (props.query.min || props.query.max ? 1 : 0) + (props.query.rating ? 1 : 0) + (props.query.inStock ? 1 : 0);
  return (
    <>
      <aside className={`hidden w-60 shrink-0 lg:block ${pending ? 'opacity-60' : ''}`} aria-label={t('search.filters')}>
        <Panel {...props} onNavigate={navigate} />
      </aside>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary lg:hidden" data-testid="open-filters">
        <SlidersHorizontal className="size-4" aria-hidden />
        {t('search.filters')}
        {activeCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{activeCount}</span>}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('search.filters')} closeLabel={t('common.close')}>
        {open && <Panel {...props} onNavigate={navigate} />}
        <button type="button" onClick={() => setOpen(false)} className="btn-primary mt-6 w-full">{t('search.showResults')} · {t.plural('search.count', props.total)}</button>
      </Dialog>
    </>
  );
}
