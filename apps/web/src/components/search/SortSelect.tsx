'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { SearchSort } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { SORTS, toUrlParams, type ListingQuery } from '@/lib/listing';

export function SortSelect({ query, basePath, fixed = [] }: { query: ListingQuery; basePath: string; fixed?: (keyof ListingQuery)[] }) {
  const t = useT();
  const router = useRouter();
  const [, start] = useTransition();
  const options = query.q ? SORTS : SORTS.filter((s) => s !== 'relevance');
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-ink-500 sm:inline">{t('search.sortBy')}</span>
      <select
        value={query.sort}
        onChange={(e) => {
          const params = new URLSearchParams(toUrlParams({ ...query, sort: e.target.value as SearchSort, page: 1 }, fixed));
          const s = params.toString();
          start(() => router.push(s ? `${basePath}?${s}` : basePath, { scroll: false }));
        }}
        className="input w-auto py-2 pe-8 text-sm"
        aria-label={t('search.sortBy')}
        data-testid="sort-select"
      >
        {options.map((s) => <option key={s} value={s}>{t(`search.sort.${s}`)}</option>)}
      </select>
    </label>
  );
}
