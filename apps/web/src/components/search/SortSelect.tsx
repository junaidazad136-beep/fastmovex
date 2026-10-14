'use client';

import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { SearchSort } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { SORTS, toUrlParams, type ListingQuery } from '@/lib/listing';
import { startNav } from '@/components/layout/NavProgress';

export function SortSelect({ query, basePath, fixed = [], className = '' }: { query: ListingQuery; basePath: string; fixed?: (keyof ListingQuery)[]; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [, start] = useTransition();
  const options = query.q ? SORTS : SORTS.filter((s) => s !== 'relevance');
  return (
    <label className={`relative flex items-center gap-2 text-sm ${className}`}>
      <span className="hidden shrink-0 text-ink-500 lg:inline">{t('search.sortBy')}</span>
      <ArrowUpDown className="pointer-events-none absolute start-2.5 size-4 text-ink-600 lg:hidden" aria-hidden />
      <select
        value={query.sort}
        onChange={(e) => {
          const params = new URLSearchParams(toUrlParams({ ...query, sort: e.target.value as SearchSort, page: 1 }, fixed));
          const s = params.toString();
          startNav();
          start(() => router.push(s ? `${basePath}?${s}` : basePath, { scroll: false }));
        }}
        className="input h-11 w-full appearance-none truncate rounded-xl py-2 ps-8 pe-7 text-[13px] font-semibold text-ink-900 lg:h-auto lg:w-auto lg:ps-3 lg:pe-9 lg:text-sm lg:font-normal"
        aria-label={t('search.sortBy')}
        data-testid="sort-select"
      >
        {options.map((s) => <option key={s} value={s}>{t(`search.sort.${s}`)}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 size-4 text-ink-500" aria-hidden />
    </label>
  );
}
