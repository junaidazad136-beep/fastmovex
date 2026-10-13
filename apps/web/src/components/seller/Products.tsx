'use client';

import { AlertTriangle, ChevronRight, ImageOff, Plus, Search } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { paths } from '@/lib/urls';
import type { ProductStatus, SellerProductRow } from './types';

const FILTERS: (ProductStatus | 'ALL')[] = ['ALL', 'ACTIVE', 'PENDING_REVIEW', 'DRAFT', 'REJECTED'];
export const PRODUCT_TONE: Record<ProductStatus, string> = {
  DRAFT: 'bg-ink-100 text-ink-700',
  PENDING_REVIEW: 'bg-sky-50 text-sky-700',
  ACTIVE: 'bg-success-50 text-success-700',
  REJECTED: 'bg-danger-50 text-danger-600',
  ARCHIVED: 'bg-ink-100 text-ink-500',
};

export function SellerProducts() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const [status, setStatus] = useState<ProductStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SellerProductRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const load = useCallback(async (more?: string) => {
    const qs = new URLSearchParams({ limit: '30', ...(status !== 'ALL' && { status }), ...(q.trim() && { q: q.trim() }), ...(more && { cursor: more }) });
    const r = await api<{ items: SellerProductRow[]; nextCursor: string | null }>(`/seller/products?${qs}`);
    setRows((x) => (more ? [...(x ?? []), ...r.items] : r.items));
    setCursor(r.nextCursor);
  }, [status, q]);
  useEffect(() => { setRows(null); void load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4" data-testid="seller-products">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('seller.products.title')}</h1>
        <Link href={paths.sellerNewProduct(l)} className="btn-primary px-3 py-2 text-sm" data-testid="add-product"><Plus className="size-4" aria-hidden />{t('seller.products.add')}</Link>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
        <input className="input ps-9" placeholder={t('seller.products.search')} aria-label={t('seller.products.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((f) => (
          <li key={f} className="shrink-0"><button type="button" onClick={() => setStatus(f)} aria-pressed={status === f} className={`chip ${status === f ? 'chip-active' : ''}`}>{f === 'ALL' ? t('seller.products.all') : t(`seller.products.status.${f}`)}</button></li>
        ))}
      </ul>
      {rows === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20" />)}</div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-ink-500">{t('seller.products.empty')}</p>
          <Link href={paths.sellerNewProduct(l)} className="btn-primary mt-4"><Plus className="size-4" aria-hidden />{t('seller.products.add')}</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={paths.sellerProduct(l, p.id)} className="card flex items-center gap-3 p-3 hover:shadow-sm" data-testid="seller-product-row">
                <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-ink-50">
                  {p.imageUrl ? <Image src={p.imageUrl} alt="" fill sizes="64px" className="object-cover" unoptimized /> : <ImageOff className="size-5 text-ink-300" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold text-ink-900">{p.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${PRODUCT_TONE[p.status]}`}>{t(`seller.products.status.${p.status}`)}</span>
                    {p.minPriceMinor && <span className="tabular font-semibold text-brand-700">{money(p.minPriceMinor)}</span>}
                    <span className={p.availableStock <= 0 ? 'font-semibold text-danger-600' : p.lowStock ? 'inline-flex items-center gap-1 font-semibold text-warning-600' : 'text-ink-500'}>
                      {p.availableStock <= 0 ? t('seller.products.outOfStock') : <>{p.lowStock && <AlertTriangle className="size-3.5" aria-hidden />}{t('seller.products.stock', { count: p.availableStock })}</>}
                    </span>
                    {p.soldCount > 0 && <span className="text-ink-500">· {t('seller.products.sold', { count: p.soldCount })}</span>}
                  </div>
                </div>
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
