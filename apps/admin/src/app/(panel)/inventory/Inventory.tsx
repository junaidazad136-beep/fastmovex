'use client';

import clsx from 'clsx';
import { History, Save } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { StockDialog, type StockTarget } from '@/components/products/StockDialog';
import { variantLabel } from '@/components/products/VariantsBuilder';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, SkeletonRows, Spinner, StatusBadge, Table, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { NumberedPage } from '@/lib/api/types';
import { decimalToMinor, formatMoney, minorToInput, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';

interface Row {
  variantId: string;
  sku: string;
  barcode: string | null;
  optionValues: Record<string, string> | null;
  priceMinor: string;
  currencyCode: string;
  productId: string;
  title: string;
  status: string;
  storeName: string;
  isHouse: boolean;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  available: number;
  updatedAt: string;
  /** the selected warehouse's shelf (warehouse view only) */
  warehouseOnHand: number | null;
  byWarehouse: { code: string; onHand: number }[];
}
interface Warehouse { id: string; code: string; name: string; isActive: boolean; isDefault: boolean }

interface Edit { price?: string; onHand?: string }

/**
 * Stock and prices of every variant, editable like a spreadsheet: change the numbers in the table, then save them
 * all at once. Each change is checked and recorded by the API (stock differences become adjustments with your name).
 */
export function Inventory() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ q: '', stock: '', store: '', page: '1', warehouse: '' });
  const warehouses = useApi<{ items: Warehouse[] }>('/admin/warehouses');
  const openWarehouses = (warehouses.data?.items ?? []).filter((w) => w.isActive);
  const several = openWarehouses.length > 1;
  const inWarehouse = openWarehouses.find((w) => w.id === f.warehouse) ?? null;
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [note, setNote] = useState('');
  const [stock, setStock] = useState<StockTarget | null>(null);
  const { busy, run } = useAction();
  const canPrice = can('products.manage');
  const canStock = can('inventory.manage');

  const list = useApi<NumberedPage<Row>>(
    ready ? `/admin/inventory${qs({ q: f.q, stock: f.stock, page: f.page, limit: 50, house: f.store === 'house' ? true : f.store === 'sellers' ? 'false' : undefined, warehouseId: f.warehouse || undefined })}` : null,
  );
  const rows = list.data?.items ?? [];

  const changes = Object.entries(edits)
    .map(([variantId, e]) => {
      const row = rows.find((r) => r.variantId === variantId);
      if (!row) return null;
      const out: { variantId: string; priceMinor?: string; onHand?: number; error?: string } = { variantId };
      if (e.price !== undefined && e.price !== minorToInput(row.priceMinor)) {
        const m = decimalToMinor(e.price);
        if (!m || m === '0') out.error = `${row.sku}: price is not valid`;
        else out.priceMinor = m;
      }
      const base = inWarehouse ? row.warehouseOnHand ?? 0 : row.onHand;
      if (e.onHand !== undefined && e.onHand !== String(base)) {
        const n = Number.parseInt(e.onHand, 10);
        if (!Number.isInteger(n) || n < 0) out.error = `${row.sku}: stock is not valid`;
        else if (row.onHand - base + n < row.reserved) out.error = `${row.sku}: stock cannot go below ${row.reserved} in total (in open orders)`;
        else out.onHand = n;
      }
      return out.priceMinor !== undefined || out.onHand !== undefined || out.error ? out : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const invalid = changes.find((c) => c.error);

  const change = (patch: Partial<typeof f>) => {
    if (changes.length && !window.confirm('Discard unsaved changes?')) return;
    setEdits({});
    setF({ page: '1', ...patch });
  };

  async function save() {
    if (invalid) return;
    const r = await run(
      'save',
      () => api<{ ok: number; failed: { variantId: string; error?: string }[] }>('/admin/inventory/bulk', {
        method: 'POST',
        body: { changes: changes.map(({ variantId, priceMinor, onHand }) => ({ variantId, priceMinor, onHand })), note: note.trim() || undefined, warehouseId: inWarehouse?.id },
      }),
      (res) => (res.failed.length ? `${res.ok} saved, ${res.failed.length} failed: ${res.failed[0].error}` : `${res.ok} ${res.ok === 1 ? 'change' : 'changes'} saved`),
    );
    if (r) {
      const failed = new Set(r.failed.map((x) => x.variantId));
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => failed.has(id))));
      setNote('');
      list.reload();
      summaryStale();
    }
  }

  const setEdit = (id: string, patch: Edit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  return (
    <>
      <PageHeader title="Inventory" description="Change prices and stock right in the table, then save. Click a row's history icon to see every change." />
      <Card bodyClassName="p-0">
        <Tabs
          value={f.stock}
          onChange={(stock) => change({ stock })}
          tabs={[{ value: '', label: 'All' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }]}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <SearchInput value={f.q} onChange={(q) => change({ q })} placeholder="Search product, SKU or barcode" className="min-w-[220px] flex-1" />
          <select className="input w-auto" value={f.store} onChange={(e) => change({ store: e.target.value })} aria-label="Store">
            <option value="">All stores</option>
            <option value="house">FastMoveX store</option>
            <option value="sellers">Other sellers</option>
          </select>
          {several ? (
            <select className="input w-auto" value={f.warehouse} onChange={(e) => change({ warehouse: e.target.value })} aria-label="Warehouse" data-testid="inventory-warehouse">
              <option value="">All warehouses (total)</option>
              {openWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          ) : null}
        </div>

        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="th">Product</th>
                <th className="th">SKU</th>
                <th className="th">Status</th>
                <th className="th w-32">Price (QAR)</th>
                <th className="th w-28">{inWarehouse ? `In ${inWarehouse.code}` : 'In stock'}</th>
                <th className="th text-end">In orders</th>
                <th className="th text-end">Available</th>
                <th className="th w-10"><span className="sr-only">History</span></th>
              </tr>
            </thead>
            <tbody className={list.loading && list.data ? 'opacity-60' : undefined}>
              {!list.data ? <SkeletonRows cols={8} /> : null}
              {rows.map((r) => {
                const e = edits[r.variantId] ?? {};
                const priceVal = e.price ?? minorToInput(r.priceMinor);
                const base = inWarehouse ? r.warehouseOnHand ?? 0 : r.onHand;
                const stockVal = e.onHand ?? String(base);
                const priceChanged = priceVal !== minorToInput(r.priceMinor);
                const stockChanged = stockVal !== String(base);
                const avail = r.onHand - base + (stockChanged && /^\d+$/.test(stockVal) ? Number(stockVal) : base) - r.reserved;
                return (
                  <tr key={r.variantId} className="hover:bg-ink-25">
                    <td className="td">
                      <Link href={`/products/${r.productId}`} className="font-medium text-ink-900 hover:text-brand-700">{r.title}</Link>
                      <p className="text-xs text-ink-500">
                        {Object.keys(r.optionValues ?? {}).length ? variantLabel(r.optionValues) : 'Default'}
                        {!r.isHouse ? ` · ${r.storeName}` : ''}
                      </p>
                    </td>
                    <td className="td text-xs text-ink-600">{r.sku}{r.barcode ? <p className="text-ink-400">{r.barcode}</p> : null}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    <td className="td">
                      <input
                        className={clsx('input py-1.5 tabular', priceChanged && 'border-sand-500 bg-sand-50')}
                        inputMode="decimal"
                        value={priceVal}
                        disabled={!canPrice}
                        onChange={(ev) => setEdit(r.variantId, { price: ev.target.value })}
                        aria-label={`Price of ${r.sku}`}
                      />
                    </td>
                    <td className="td">
                      <input
                        className={clsx('input py-1.5 tabular', stockChanged && 'border-sand-500 bg-sand-50')}
                        inputMode="numeric"
                        value={stockVal}
                        disabled={!canStock}
                        onChange={(ev) => setEdit(r.variantId, { onHand: ev.target.value.replace(/\D/g, '') })}
                        aria-label={`Stock of ${r.sku}`}
                      />
                      {several && !inWarehouse && r.byWarehouse.length > 0 ? (
                        <p className="mt-0.5 truncate text-[11px] text-ink-500 tabular" title="On the shelf per warehouse">{r.byWarehouse.map((w) => `${w.code} ${w.onHand}`).join(' · ')}</p>
                      ) : null}
                    </td>
                    <td className="td text-end text-ink-600 tabular">{r.reserved}</td>
                    <td className="td text-end">
                      {avail <= 0 ? <Badge tone="red">0</Badge> : avail <= r.lowStockThreshold ? <Badge tone="amber">{avail}</Badge> : <span className="font-medium tabular">{avail}</span>}
                    </td>
                    <td className="td">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-800"
                        onClick={() => setStock({ variantId: r.variantId, label: r.title, sku: r.sku, onHand: r.onHand, reserved: r.reserved, lowStockThreshold: r.lowStockThreshold })}
                        aria-label={`Stock history of ${r.sku}`}
                        title={`History · updated ${timeAgo(r.updatedAt)}`}
                      >
                        <History className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {list.data && rows.length === 0 ? (
          <EmptyState title={f.stock === 'out' ? 'Nothing is out of stock' : f.stock === 'low' ? 'Nothing is running low' : 'No variants found'} />
        ) : null}
        {list.data ? <Pagination page={list.data.page} pageCount={list.data.pageCount} total={list.data.total} onPage={(p) => change({ page: String(p) })} /> : null}
      </Card>

      {changes.length > 0 ? (
        <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <span className="text-sm font-medium text-ink-800">{changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}</span>
          {invalid ? <span className="text-sm text-danger-600">{invalid.error}</span> : null}
          <input className="input ms-auto w-full max-w-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. stock count 30 Sep" maxLength={300} aria-label="Note for these changes" />
          <button type="button" className="btn-ghost" onClick={() => setEdits({})}>Discard</button>
          <button type="button" className="btn-primary" onClick={save} disabled={!!invalid || busy === 'save'}>
            {busy === 'save' ? <Spinner /> : <Save className="size-4" aria-hidden />} Save changes
          </button>
        </div>
      ) : null}

      <StockDialog target={stock} onClose={() => setStock(null)} onSaved={() => list.reload()} canAdjust={canStock} />
    </>
  );
}
