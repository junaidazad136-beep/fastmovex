'use client';

import { ChevronRight, Package, Search } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { OrderListItem, OrderStatus, Paged } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { paths } from '@/lib/urls';
import { BuyAgain } from './BuyAgain';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { StatusBadge } from './StatusBadge';

const FILTERS: (OrderStatus | '')[] = ['', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export function OrdersList() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<OrderListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (after: string | null) => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (q.trim()) qs.set('q', q.trim());
      if (after) qs.set('cursor', after);
      const page = await api<Paged<OrderListItem>>(`/orders?${qs}`);
      setItems((prev) => (after ? [...(prev ?? []), ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) { setError(errorMessage(e, t)); if (!after) setItems([]); } finally { setLoading(false); }
  }, [status, q, t]);

  useEffect(() => { const id = window.setTimeout(() => load(null), q ? 300 : 0); return () => window.clearTimeout(id); }, [load, q]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('order.myOrders')}</h1>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ul className="no-scrollbar flex gap-2 overflow-x-auto">
          {FILTERS.map((s) => (
            <li key={s || 'all'}>
              <button type="button" onClick={() => setStatus(s)} aria-pressed={status === s} className={`chip whitespace-nowrap ${status === s ? 'chip-active' : ''}`}>
                {s ? t(`order.status.${s}`) : t('order.allStatuses')}
              </button>
            </li>
          ))}
        </ul>
        <label className="relative sm:w-64">
          <span className="sr-only">{t('order.searchPlaceholder')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('order.searchPlaceholder')} className="input py-2 ps-9 text-sm" dir="ltr" />
        </label>
      </div>
      {error && <p className="field-error mb-3" role="alert">{error}</p>}
      {items === null ? (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-24" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Package className="size-7" aria-hidden />} title={t('order.empty')} action={<Link href={paths.home(l)} className="btn-primary">{t('cart.startShopping')}</Link>} />
      ) : (
        <ul className="space-y-3">
          {items.map((o) => (
            <li key={o.id}>
              <Link href={paths.order(l, o.orderNumber)} className="card flex flex-col gap-3 p-4 transition hover:border-brand-200 sm:flex-row sm:items-center" data-testid="order-row">
                <div className="flex -space-x-3 rtl:space-x-reverse">
                  {o.preview.slice(0, 3).map((p, i) => (
                    <span key={i} className="relative size-14 overflow-hidden rounded-xl bg-ink-50 ring-2 ring-white">{p.imageUrl && <Image src={p.imageUrl} alt="" fill sizes="56px" className="object-contain p-1" />}</span>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" dir="ltr">{o.orderNumber}</p>
                  <p className="text-xs text-ink-500">{t('order.placedOn', { date: formatDate(o.placedAt, l) })} · {t.plural('common.items', o.itemCount)}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-400">{o.preview.map((p) => p.title).join(' · ')}</p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <StatusBadge status={o.status} label={t(`order.status.${o.status}`)} />
                  <span className="tabular font-semibold">{money(o.totalMinor, { currency: o.currencyCode })}</span>
                  <ChevronRight className="hidden size-4 text-ink-300 rtl:rotate-180 sm:block" aria-hidden />
                </div>
              </Link>
              {['DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELLED'].includes(o.status) && (
                <div className="mt-1 flex justify-end"><BuyAgain orderNumber={o.orderNumber} className="btn-ghost px-2 py-1 text-sm" /></div>
              )}
            </li>
          ))}
        </ul>
      )}
      {cursor && <button type="button" onClick={() => load(cursor)} disabled={loading} className="btn-secondary mt-4">{loading && <Spinner className="size-4" />}{t('common.loadMore')}</button>}
    </div>
  );
}
