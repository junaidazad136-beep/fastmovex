'use client';

import { ClipboardList, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Spinner, StatusBadge, Table } from '@/components/ui';
import { openPdf } from '@/lib/api/client';
import { formatSlot, todayInQatar } from '@/lib/format';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';

interface Warehouse { id: string; name: string; isActive: boolean; isDefault: boolean }
interface PickList {
  warehouse: string;
  shipments: { id: string; orderNumber: string; status: string; slotStart: string | null; slotEnd: string | null; units: number }[];
  lines: { variantId: string; sku: string; barcode: string | null; title: string; options: string | null; bin: string | null; quantity: number; orders: { orderNumber: string; quantity: number }[] }[];
}

/** Shelf walking order: by bin (A-2 before A-10), items without a bin last. Same rule as the printed list. */
const binSort = (a: { bin: string | null; sku: string }, b: { bin: string | null; sku: string }) =>
  (a.bin && !b.bin ? -1 : !a.bin && b.bin ? 1 : (a.bin ?? '').localeCompare(b.bin ?? '', 'en', { numeric: true })) || a.sku.localeCompare(b.sku);

/**
 * The warehouse's morning: everything waiting to be packed (one warehouse, one delivery day or window), picked once
 * from the shelves with the picking list, then packed with one packing slip per shipment.
 */
export function FulfilmentPage() {
  const [f, setF, ready] = useUrlState({ warehouseId: '', date: '', slot: '' });
  const warehouses = useApi<{ items: Warehouse[] }>('/admin/warehouses');
  const open = (warehouses.data?.items ?? []).filter((w) => w.isActive);
  const wid = f.warehouseId || open.find((w) => w.isDefault)?.id || '';
  const query = qs({ warehouseId: wid || undefined, date: f.date || undefined, slotStart: f.slot || undefined });
  const list = useApi<PickList>(ready && wid ? `/admin/fulfilment/pick-list${query}` : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();
  const d = list.data;
  const slots = useMemo(() => [...new Map((d?.shipments ?? []).filter((s) => s.slotStart).map((s) => [s.slotStart!, s])).values()], [d]);
  const selected = d?.shipments.filter((s) => picked.has(s.id)) ?? [];
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const printPick = () => run('pick', () => openPdf(`/admin/fulfilment/pick-list.pdf${selected.length ? qs({ ids: selected.map((s) => s.id).join(',') }) : query}`, 'picking-list.pdf'));
  const printSlips = () => run('slips', () => openPdf(`/admin/fulfilment/packing-slips.pdf${selected.length ? qs({ ids: selected.map((s) => s.id).join(',') }) : query}`, 'packing-slips.pdf'));

  return (
    <>
      <PageHeader
        title="Picking & packing"
        description="Shipments waiting to be packed. Print the picking list to collect everything from the shelves in one walk, then a packing slip for each box."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={!d?.shipments.length || !!busy} onClick={printPick} data-testid="print-pick-list">
              {busy === 'pick' ? <Spinner /> : <ClipboardList className="size-4" aria-hidden />} Picking list{selected.length ? ` (${selected.length})` : ''}
            </button>
            <button type="button" className="btn-primary" disabled={!d?.shipments.length || !!busy} onClick={printSlips} data-testid="print-slips">
              {busy === 'slips' ? <Spinner /> : <PackageCheck className="size-4" aria-hidden />} Packing slips{selected.length ? ` (${selected.length})` : ''}
            </button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {open.length > 1 ? (
          <label className="text-sm"><span className="label">Warehouse</span>
            <select className="input" value={wid} onChange={(e) => { setF({ warehouseId: e.target.value, slot: '' }); setPicked(new Set()); }}>
              {open.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="text-sm"><span className="label">Delivery date</span>
          <input type="date" className="input" value={f.date} onChange={(e) => { setF({ date: e.target.value, slot: '' }); setPicked(new Set()); }} data-testid="pack-date" />
        </label>
        {!f.date ? <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ date: todayInQatar() })}>Today</button> : <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ date: '', slot: '' })}>All days</button>}
        {f.date && slots.length ? (
          <label className="text-sm"><span className="label">Window</span>
            <select className="input" value={f.slot} onChange={(e) => { setF({ slot: e.target.value }); setPicked(new Set()); }}>
              <option value="">All windows</option>
              {slots.map((s) => <option key={s.slotStart} value={s.slotStart!}>{formatSlot(s.slotStart, s.slotEnd)}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title={`Shipments${d ? ` (${d.shipments.length})` : ''}`} description="Tick some to print only those; nothing ticked prints them all." bodyClassName="p-0">
          <Table>
            <thead><tr><th className="th w-10" /><th className="th">Order</th><th className="th">Window</th><th className="th text-end">Units</th></tr></thead>
            <tbody>
              {!d && !list.error ? <SkeletonRows cols={4} rows={4} /> : null}
              {d?.shipments.map((s) => (
                <tr key={s.id} className="hover:bg-ink-25" data-testid="pack-shipment">
                  <td className="td"><input type="checkbox" className="size-4 accent-brand-600" checked={picked.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.orderNumber}`} /></td>
                  <td className="td"><Link href={`/orders/${s.orderNumber}`} className="font-mono text-sm font-semibold hover:text-brand-700">{s.orderNumber}</Link> <StatusBadge status={s.status} /></td>
                  <td className="td text-sm">{s.slotStart ? formatSlot(s.slotStart, s.slotEnd) : <span className="text-ink-400">Any time</span>}</td>
                  <td className="td text-end tabular">{s.units}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {d && !d.shipments.length ? <EmptyState icon={<PackageCheck className="size-6" aria-hidden />} title="Nothing to pack" description="New orders appear here once confirmed." /> : null}
        </Card>
        <Card title="To pick" description={d ? `${d.lines.reduce((n, l) => n + l.quantity, 0)} units from ${d.warehouse}, in shelf order` : undefined} bodyClassName="p-0">
          <Table>
            <thead><tr><th className="th">Shelf</th><th className="th">Product</th><th className="th text-end">Qty</th><th className="th">For</th></tr></thead>
            <tbody>
              {!d && !list.error ? <SkeletonRows cols={4} rows={4} /> : null}
              {d ? [...d.lines].sort(binSort).map((l) => (
                <tr key={l.variantId} className="align-top" data-testid="pick-line">
                  <td className="td font-semibold">{l.bin ?? <span className="text-ink-400">—</span>}</td>
                  <td className="td"><p className="font-medium">{l.title}{l.options ? <span className="text-ink-500"> — {l.options}</span> : null}</p><p className="text-xs text-ink-500">{l.sku}{l.barcode ? ` · ${l.barcode}` : ''}</p></td>
                  <td className="td text-end text-base font-bold tabular">{l.quantity}</td>
                  <td className="td text-xs text-ink-500">{l.orders.length > 3 ? <Badge>{l.orders.length} orders</Badge> : l.orders.map((o) => `${o.orderNumber.slice(-6)}${o.quantity > 1 ? ` ×${o.quantity}` : ''}`).join(', ')}</td>
                </tr>
              )) : null}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
