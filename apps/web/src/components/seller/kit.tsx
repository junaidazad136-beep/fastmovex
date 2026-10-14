'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import { Spinner } from '../ui/Spinner';

/** Small pieces shared by the Seller Center pages (tabs, empty state, "load more", dates). */

export function useDate() {
  const t = useT();
  return (d: string) => new Date(d).toLocaleDateString(t.locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Tabs<K extends string>({ tabs, value, onChange, label, counts = {} }: { tabs: readonly K[]; value: K; onChange: (k: K) => void; label: (k: K) => string; counts?: Partial<Record<K, number>> }) {
  return (
    <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="tablist">
      {tabs.map((k) => (
        <li key={k} className="shrink-0">
          <button type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`chip ${value === k ? 'chip-active' : ''}`} data-testid={`tab-${k}`}>
            {label(k)}{!!counts[k] && <span className="tabular rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{counts[k]}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon}</span>
      <p className="font-semibold text-ink-900">{title}</p>
      {text && <p className="max-w-sm text-sm text-ink-500">{text}</p>}
    </div>
  );
}

export function MoreButton({ cursor, busy, onMore }: { cursor: string | null; busy: boolean; onMore: () => void }) {
  const t = useT();
  if (!cursor) return null;
  return (
    <div className="flex justify-center">
      <button type="button" className="btn-secondary" onClick={onMore} disabled={busy}>{busy && <Spinner className="size-4" />}{t('seller.more')}</button>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>;
}
