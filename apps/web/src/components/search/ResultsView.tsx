'use client';

import { LayoutGrid, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';

const KEY = 'fmx_results_view';

/** Phones: results as rows (default) or the 2-across grid; the choice is remembered on this phone. Computers: grid. */
export function ResultsView({ list, grid, count }: { list: ReactNode; grid: ReactNode; count: ReactNode }) {
  const t = useT();
  const [view, setView] = useState<'list' | 'grid'>('list');
  useEffect(() => { try { if (localStorage.getItem(KEY) === 'grid') setView('grid'); } catch { /* private mode */ } }, []);
  const pick = (v: 'list' | 'grid') => { setView(v); try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };
  const btn = (v: 'list' | 'grid', Icon: typeof List, label: string) => (
    <button type="button" onClick={() => pick(v)} aria-pressed={view === v} aria-label={label} title={label} data-testid={`view-${v}`} className={`grid size-8 place-items-center rounded-lg ${view === v ? 'bg-brand-50 text-brand-700' : 'text-ink-400'}`}>
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 lg:hidden">
        {count}
        <div className="flex items-center gap-0.5">{btn('list', List, t('search.listView'))}{btn('grid', LayoutGrid, t('search.gridView'))}</div>
      </div>
      <div className={view === 'list' ? 'lg:hidden' : 'hidden'}>{list}</div>
      <div className={view === 'list' ? 'max-lg:hidden' : ''}>{grid}</div>
    </>
  );
}
