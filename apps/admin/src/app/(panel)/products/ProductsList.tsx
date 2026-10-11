'use client';

import { Copy, Download, FileUp, Plus, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, Checkbox, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, SkeletonRows, StatusBadge, Table, Tabs, Thumb } from '@/components/ui';
import { download, api } from '@/lib/api/client';
import type { NumberedPage } from '@/lib/api/types';
import { categoryOptionLabel, useCategoryOptions } from '@/lib/catalog';
import { formatMoney, formatNumber, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';

export interface ProductRow {
  id: string;
  title: string;
  titleAr: string | null;
  slug: string;
  status: string;
  minPriceMinor: string | null;
  soldCount: number;
  isFeatured: boolean;
  updatedAt: string;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  currencyCode: string;
  imageUrl: string | null;
  store: { id: string; name: string; isHouse: boolean; sellerStatus: string };
  variantCount: number;
  skus: string[];
  available: number;
  lowStock: boolean;
  outOfStock: boolean;
}

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_REVIEW', label: 'Pending review' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'best_selling', label: 'Best selling' },
];

export function ProductsList() {
  const { can } = useSession();
  const router = useRouter();
  const [f, setF, ready] = useUrlState({ status: '', q: '', categoryId: '', stock: '', featured: '', sort: 'newest', page: '1', store: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const categories = useCategoryOptions();
  const { busy, run } = useAction();
  const manage = can('products.manage');

  const path = ready
    ? `/admin/products${qs({ status: f.status, q: f.q, categoryId: f.categoryId, stock: f.stock, featured: f.featured, sort: f.sort, page: f.page, limit: 25, house: f.store === 'house' ? true : f.store === 'sellers' ? 'false' : undefined })}`
    : null;
  const list = useApi<NumberedPage<ProductRow>>(path);
  const rows = list.data?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const showStore = useMemo(() => rows.some((r) => !r.store.isHouse), [rows]);

  const change = (patch: Partial<typeof f>) => {
    setSelected(new Set());
    setF({ page: '1', ...patch });
  };

  async function bulk(action: 'publish' | 'draft' | 'archive' | 'feature' | 'unfeature') {
    const ids = [...selected];
    const r = await run(`bulk-${action}`, () => api<{ ok: number; failed: { id: string; error?: string }[] }>('/admin/products/bulk', { method: 'POST', body: { ids, action } }), (res) =>
      res.failed.length ? `${res.ok} updated. ${res.failed.length} could not be changed: ${res.failed[0].error ?? 'error'}` : `${res.ok} updated`,
    );
    if (r) {
      setSelected(new Set());
      list.reload();
      summaryStale();
    }
  }

  async function duplicate(id: string) {
    const r = await run(`dup-${id}`, () => api<{ id: string }>(`/admin/products/${id}/duplicate`, { method: 'POST' }), 'Copy created as a draft');
    if (r) router.push(`/products/${r.id}`);
  }

  return (
    <>
      <PageHeader
        title="Products"
        description={list.data ? `${formatNumber(list.data.total)} products` : undefined}
        actions={
          <>
            {manage ? (
              <Link href="/products/import" className="btn-secondary"><FileUp className="size-4" aria-hidden /> Import</Link>
            ) : null}
            <button type="button" className="btn-secondary" disabled={busy === 'export'} onClick={() => run('export', () => download('/admin/products/export.csv', 'products.csv'))}>
              <Download className="size-4" aria-hidden /> Export
            </button>
            {manage ? (
              <Link href="/products/new" className="btn-primary"><Plus className="size-4" aria-hidden /> Add product</Link>
            ) : null}
          </>
        }
      />

      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => change({ status })} tabs={STATUS_TABS} />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <SearchInput value={f.q} onChange={(q) => change({ q })} placeholder="Search title, SKU or barcode" className="min-w-[220px] flex-1" />
          <select className="input w-auto" value={f.categoryId} onChange={(e) => change({ categoryId: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{categoryOptionLabel(c)}</option>)}
          </select>
          <select className="input w-auto" value={f.stock} onChange={(e) => change({ stock: e.target.value })} aria-label="Stock">
            <option value="">Any stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <select className="input w-auto" value={f.store} onChange={(e) => change({ store: e.target.value })} aria-label="Store">
            <option value="">All stores</option>
            <option value="house">FastMoveX store</option>
            <option value="sellers">Other sellers</option>
          </select>
          <select className="input w-auto" value={f.sort} onChange={(e) => change({ sort: e.target.value })} aria-label="Sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-brand-50/60 px-4 py-2.5 text-sm">
            <span className="font-medium text-brand-800">{selected.size} selected</span>
            <span className="flex-1" />
            {manage ? (
              <>
                <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => bulk('publish')}>Publish</button>
                <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => bulk('draft')}>Set as draft</button>
                <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => bulk('archive')}>Archive</button>
              </>
            ) : null}
            {can('featured.manage') ? (
              <>
                <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => bulk('feature')}>Feature</button>
                <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => bulk('unfeature')}>Unfeature</button>
              </>
            ) : null}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        ) : null}

        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="th w-10">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
                <th className="th">Product</th>
                <th className="th">Status</th>
                <th className="th">Stock</th>
                <th className="th">Category</th>
                {showStore ? <th className="th">Store</th> : null}
                <th className="th text-end">Price</th>
                <th className="th text-end">Sold</th>
                <th className="th w-10"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={list.loading && list.data ? 'opacity-60' : undefined}>
              {!list.data ? <SkeletonRows cols={8} /> : null}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-ink-25">
                  <td className="td">
                    <Checkbox
                      aria-label={`Select ${r.title}`}
                      checked={selected.has(r.id)}
                      onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                    />
                  </td>
                  <td className="td">
                    <Link href={`/products/${r.id}`} className="flex items-center gap-3">
                      <Thumb src={r.imageUrl} alt="" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-ink-900 hover:text-brand-700">
                          <span className="line-clamp-1">{r.title}</span>
                          {r.isFeatured ? <Star className="size-3.5 shrink-0 fill-sand-400 text-sand-500" aria-label="Featured" /> : null}
                        </span>
                        <span className="block text-xs text-ink-500">
                          {r.variantCount > 1 ? `${r.variantCount} variants` : r.skus[0] ?? '—'} · updated {timeAgo(r.updatedAt)}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                  <td className="td">
                    {r.outOfStock ? <Badge tone="red">Out of stock</Badge> : r.lowStock ? <Badge tone="amber">{r.available} left</Badge> : <span className="tabular">{formatNumber(r.available)}</span>}
                  </td>
                  <td className="td text-ink-600">{r.category?.name ?? '—'}</td>
                  {showStore ? <td className="td text-ink-600">{r.store.name}</td> : null}
                  <td className="td text-end tabular">{formatMoney(r.minPriceMinor, r.currencyCode)}{r.variantCount > 1 ? <span className="text-xs text-ink-400">+</span> : null}</td>
                  <td className="td text-end tabular">{formatNumber(r.soldCount)}</td>
                  <td className="td">
                    {manage ? (
                      <button type="button" className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-800" onClick={() => duplicate(r.id)} disabled={!!busy} aria-label={`Duplicate ${r.title}`} title="Duplicate">
                        <Copy className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && rows.length === 0 ? (
          <EmptyState
            title={f.q || f.status || f.categoryId || f.stock ? 'No products match these filters' : 'No products yet'}
            description={f.q || f.status || f.categoryId || f.stock ? 'Try another search or clear the filters.' : 'Add your first product, or import a spreadsheet.'}
            action={manage && !f.q ? <Link href="/products/new" className="btn-primary"><Plus className="size-4" aria-hidden /> Add product</Link> : undefined}
          />
        ) : null}
        {list.data ? <Pagination page={list.data.page} pageCount={list.data.pageCount} total={list.data.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      </Card>
    </>
  );
}
