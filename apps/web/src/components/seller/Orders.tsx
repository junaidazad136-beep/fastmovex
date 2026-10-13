'use client';

import { ChevronRight, Printer, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, openPdf } from '@/lib/api/client';
import type { OrderStatus } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { StatusBadge } from '../account/StatusBadge';
import { Spinner } from '../ui/Spinner';
import { useSeller } from './SellerShell';
import type { SellerOrderRow } from './types';

const TABS = {
  new: ['CONFIRMED'],
  packing: ['PREPARING'],
  ready: ['READY_FOR_PICKUP'],
  shipped: ['SHIPPED', 'OUT_FOR_DELIVERY'],
  done: ['DELIVERED'],
  all: [],
} as const satisfies Record<string, OrderStatus[]>;
type Tab = keyof typeof TABS;
const isTab = (v: string | null): v is Tab => !!v && v in TABS;

/** Print buttons open the PDF in a new tab (or save it when the tab is blocked). */
export function usePrint() {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const print = useCallback((path: string, name: string) => {
    setBusy(true);
    openPdf(path, name)
      .then((opened) => { if (!opened) toast({ tone: 'info', message: t('seller.order.popupBlocked') }); })
      .catch((e) => toast({ tone: 'error', message: errorMessage(e, t) }))
      .finally(() => setBusy(false));
  }, [t, toast]);
  return { print, busy };
}

export function SellerOrders() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const router = useRouter();
  const sp = useSearchParams();
  const tab: Tab = isTab(sp.get('tab')) ? (sp.get('tab') as Tab) : 'new';
  const { summary } = useSeller();
  const [rows, setRows] = useState<SellerOrderRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const { print, busy: printing } = usePrint();

  const load = useCallback(async (more?: string) => {
    const statuses: readonly OrderStatus[] = TABS[tab];
    const one = (status?: OrderStatus) => api<{ items: SellerOrderRow[]; nextCursor: string | null }>(`/seller/orders?${new URLSearchParams({ ...(status && { status }), ...(q.trim() && { q: q.trim() }), ...(more && { cursor: more }) })}`);
    const pages = statuses.length ? await Promise.all(statuses.map((s) => one(s))) : [await one()];
    const items = pages.flatMap((p) => p.items).sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    setRows((r) => (more ? [...(r ?? []), ...items] : items));
    setCursor(pages.length === 1 ? pages[0].nextCursor : null);
  }, [tab, q]);
  useEffect(() => { setRows(null); setPicked([]); void load(); }, [load]);
  // a new order arrived (summary polls): refresh the "New" tab
  const newest = summary?.newestNew?.id;
  useEffect(() => { if (tab === 'new' && newest) void load(); }, [newest]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts: Partial<Record<Tab, number>> = { new: summary?.orders.new, packing: summary?.orders.packing, ready: summary?.orders.ready, shipped: summary?.orders.onTheWay };
  const canPick = tab === 'new' || tab === 'packing';
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(0, 50)));

  return (
    <div className="space-y-4" data-testid="seller-orders">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('seller.orders.title')}</h1>
        <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input className="input ps-9" dir="ltr" placeholder={t('seller.orders.search')} aria-label={t('seller.orders.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="tablist">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <li key={k} className="shrink-0">
            <button type="button" role="tab" aria-selected={tab === k} onClick={() => router.replace(`${paths.sellerOrders(l)}?tab=${k}`, { scroll: false })} className={`chip ${tab === k ? 'chip-active' : ''}`} data-testid={`orders-tab-${k}`}>
              {t(`seller.orders.tabs.${k}`)}{!!counts[k] && <span className="tabular rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{counts[k]}</span>}
            </button>
          </li>
        ))}
      </ul>

      {canPick && picked.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-2xl bg-ink-900 p-3 text-white shadow-lg">
          <span className="text-sm">{picked.length}</span>
          <button type="button" className="btn-primary px-3 py-2 text-sm" disabled={printing} onClick={() => print(`/seller/labels.pdf?ids=${picked.join(',')}`, 'labels.pdf')} data-testid="print-selected">
            {printing ? <Spinner /> : <Printer className="size-4" aria-hidden />}{t('seller.orders.printSelected', { count: picked.length })}
          </button>
        </div>
      )}

      {rows === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20" />)}</div>
      ) : rows.length === 0 ? (
        <p className="card p-8 text-center text-ink-500">{t('seller.orders.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.id} className="card flex items-center gap-3 p-3 sm:p-4" data-testid="seller-order-row">
              {canPick && (
                <input type="checkbox" className="size-5 shrink-0 accent-brand-600" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} aria-label={o.orderNumber} />
              )}
              <Link href={paths.sellerOrder(l, o.id)} className="flex min-w-0 flex-1 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ink-900" dir="ltr">{o.orderNumber}</span>
                    <StatusBadge status={o.status} label={t(`order.status.${o.status}`)} />
                  </div>
                  <p className="mt-1 truncate text-sm text-ink-500">
                    {new Date(o.placedAt).toLocaleString(l === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{t.plural('seller.orders.items', o.itemCount)}{o.city ? ` · ${o.city}` : ''}
                  </p>
                </div>
                <span className="tabular hidden shrink-0 text-sm font-semibold text-success-700 sm:block">{t('seller.orders.youGet', { amount: money(o.sellerNetMinor, { currency: o.currencyCode }) })}</span>
                <ChevronRight className="size-5 shrink-0 text-ink-400 rtl:rotate-180" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && <button type="button" className="btn-secondary w-full" onClick={() => void load(cursor)}>{t('seller.orders.loadMore')}</button>}
    </div>
  );
}
