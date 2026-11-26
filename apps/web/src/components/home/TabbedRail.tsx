'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

export type RailTab = { key: string; label: string; href?: string; extra?: ReactNode; node: ReactNode };

/** One product row with Hot / New / Deals tabs. The panels are drawn on the server; this only switches which one shows. */
export function TabbedRail({ tabs, seeAll }: { tabs: RailTab[]; seeAll: string }) {
  const [key, setKey] = useState(tabs[0]?.key);
  const cur = tabs.find((x) => x.key === key) ?? tabs[0];
  if (!cur) return null;
  return (
    <section className="container-page mt-7" aria-label={tabs.map((x) => x.label).join(' / ')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div role="tablist" className="no-scrollbar flex min-w-0 items-center gap-5 overflow-x-auto">
          {tabs.map((x) => {
            const on = x.key === cur.key;
            return (
              <button
                key={x.key}
                id={`tab-${x.key}`}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls={`panel-${x.key}`}
                onClick={() => setKey(x.key)}
                data-testid={`home-tab-${x.key}`}
                className={`relative shrink-0 pb-1.5 text-[17px] font-bold tracking-tight sm:text-xl ${on ? 'text-ink-900' : 'text-ink-400'}`}
              >
                {x.label}
                {on ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-600" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cur.extra}
          {cur.href ? <Link href={cur.href} className="text-[12.5px] font-semibold text-brand-600 hover:text-brand-700 sm:text-[13.5px]">{seeAll}</Link> : null}
        </div>
      </div>
      {tabs.map((x) => (
        <div key={x.key} id={`panel-${x.key}`} role="tabpanel" aria-labelledby={`tab-${x.key}`} hidden={x.key !== cur.key}>{x.node}</div>
      ))}
    </section>
  );
}
