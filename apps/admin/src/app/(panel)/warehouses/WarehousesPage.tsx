'use client';

import { ArrowRight, Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Card, Dialog, EmptyState, ErrorState, Field, LoadMore, PageHeader, SearchInput, SkeletonRows, Spinner, Switch, Table, Tabs, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useCursorList, useUrlState } from '@/lib/use-api';

interface Warehouse {
  id: string; code: string; name: string; nameAr: string | null; city: string | null; address: string | null; zones: string[];
  priority: number; isDefault: boolean; isActive: boolean; products: number; units: number; openShipments: number;
}
interface Transfer {
  id: string; number: string; status: 'PENDING' | 'RECEIVED' | 'CANCELLED'; note: string | null; createdAt: string; receivedAt: string | null;
  fromWarehouse: { id: string; name: string; code: string }; toWarehouse: { id: string; name: string; code: string };
  items: { variantId: string; quantity: number; sku: string; title: string }[];
}
interface StockRow { variantId: string; sku: string; title: string; warehouseOnHand: number | null; onHand: number }

/** FastMoveX's warehouses: where stock is kept, which one sends which orders, and moving stock between them. */
export function WarehousesPage() {
  const { can } = useSession();
  const canEdit = can('inventory.manage');
  const list = useApi<{ items: Warehouse[]; pendingTransfers: number }>('/admin/warehouses');
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [f, setF, ready] = useUrlState({ status: 'PENDING' });
  const transfers = useCursorList<Transfer>(ready ? `/admin/stock-transfers${qs({ status: f.status === 'ALL' ? undefined : f.status })}` : null);
  const { busy, run } = useAction();
  const open = (list.data?.items ?? []).filter((w) => w.isActive);

  async function act(t: Transfer, what: 'receive' | 'cancel') {
    const ok = await run(`${t.id}-${what}`, () => api(`/admin/stock-transfers/${t.id}/${what}`, { method: 'POST' }), what === 'receive' ? `${t.number} received — stock moved` : `${t.number} cancelled`);
    if (ok !== undefined) { transfers.reload(); list.reload(); }
  }

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Where stock is kept. Each order ships from the warehouse that has everything, nearest to the customer; staff can change it on the order until it leaves."
        actions={canEdit ? (
          <div className="flex gap-2">
            {open.length > 1 ? <button type="button" className="btn-secondary" onClick={() => setTransferOpen(true)} data-testid="new-transfer"><ArrowRight className="size-4" aria-hidden />Move stock</button> : null}
            <button type="button" className="btn-primary" onClick={() => setEditing('new')} data-testid="new-warehouse"><Plus className="size-4" aria-hidden />Add warehouse</button>
          </div>
        ) : null}
      />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="warehouses">
        {!list.data ? [0, 1, 2].map((i) => <div key={i} className="skeleton h-40" />) : list.data.items.map((w) => (
          <Card key={w.id} className={w.isActive ? '' : 'opacity-60'}>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><WarehouseIcon className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                  {w.name} <span className="font-mono text-xs text-ink-500">{w.code}</span>
                  {w.isDefault ? <Badge tone="blue">Default</Badge> : null}
                  {!w.isActive ? <Badge tone="gray">Closed</Badge> : null}
                </p>
                <p className="text-sm text-ink-500">{[w.city, w.address].filter(Boolean).join(' · ') || '—'}</p>
                {w.zones.length ? <p className="mt-1 text-xs text-ink-500">Nearest for zones {w.zones.join(', ')}</p> : null}
              </div>
              {canEdit ? <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(w)} aria-label={`Edit ${w.name}`}><Pencil className="size-4" aria-hidden /></button> : null}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-ink-50 p-2"><dt className="text-xs text-ink-500">Products</dt><dd className="font-bold tabular">{formatNumber(w.products)}</dd></div>
              <div className="rounded-lg bg-ink-50 p-2"><dt className="text-xs text-ink-500">Units</dt><dd className="font-bold tabular">{formatNumber(w.units)}</dd></div>
              <div className="rounded-lg bg-ink-50 p-2"><dt className="text-xs text-ink-500">To send</dt><dd className="font-bold tabular">{formatNumber(w.openShipments)}</dd></div>
            </dl>
            <Link href={`/inventory?warehouse=${w.id}`} className="link mt-3 inline-block text-sm">See stock here</Link>
          </Card>
        ))}
      </div>

      <Card title="Stock transfers" description="Units leave one warehouse and land in the other when the transfer is received." className="mt-6" bodyClassName="p-0">
        <Tabs value={f.status as Transfer['status'] | 'ALL'} onChange={(status) => setF({ status })} tabs={[
          { value: 'PENDING', label: 'On the way', count: list.data?.pendingTransfers ?? null }, { value: 'RECEIVED', label: 'Received' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' },
        ]} />
        <Table>
          <thead><tr><th className="th">Transfer</th><th className="th">From → to</th><th className="th">Products</th><th className="th">Status</th><th className="th text-end">Actions</th></tr></thead>
          <tbody>
            {!transfers.items ? <SkeletonRows cols={5} rows={3} /> : transfers.items.map((t) => (
              <tr key={t.id} data-testid="transfer-row">
                <td className="td"><span className="font-mono text-sm font-semibold">{t.number}</span><p className="text-xs text-ink-500">{formatDateTime(t.createdAt)}</p>{t.note ? <p className="text-xs text-ink-500">{t.note}</p> : null}</td>
                <td className="td text-sm">{t.fromWarehouse.name} <ArrowRight className="inline size-3.5 rtl:rotate-180" aria-hidden /> {t.toWarehouse.name}</td>
                <td className="td text-sm">{t.items.map((i) => <p key={i.variantId}><span className="tabular font-medium">{i.quantity}×</span> {i.title} <span className="text-xs text-ink-400">{i.sku}</span></p>)}</td>
                <td className="td"><Badge tone={t.status === 'RECEIVED' ? 'green' : t.status === 'PENDING' ? 'amber' : 'gray'}>{t.status === 'PENDING' ? 'On the way' : t.status === 'RECEIVED' ? 'Received' : 'Cancelled'}</Badge></td>
                <td className="td text-end whitespace-nowrap">
                  {canEdit && t.status === 'PENDING' ? (
                    <>
                      <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => act(t, 'cancel')}>Cancel</button>
                      <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => act(t, 'receive')} data-testid="receive-transfer">{busy === `${t.id}-receive` ? <Spinner /> : null} Received</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {transfers.items?.length === 0 ? <EmptyState title="No transfers here" /> : null}
        <LoadMore hasMore={transfers.hasMore} loading={transfers.loading} onClick={transfers.loadMore} />
      </Card>

      <WarehouseDialog target={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
      <TransferDialog open={transferOpen} warehouses={open} onClose={() => setTransferOpen(false)} onSaved={() => { setTransferOpen(false); setF({ status: 'PENDING' }); transfers.reload(); list.reload(); }} />
    </>
  );
}

function WarehouseDialog({ target, onClose, onSaved }: { target: Warehouse | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new';
  const w = target && target !== 'new' ? target : null;
  const [form, setForm] = useState({ code: '', name: '', nameAr: '', city: '', address: '', zones: '', priority: '100', isActive: true, isDefault: false });
  const { busy, run } = useAction();
  useEffect(() => {
    if (!target) return;
    setForm(w
      ? { code: w.code, name: w.name, nameAr: w.nameAr ?? '', city: w.city ?? '', address: w.address ?? '', zones: w.zones.join(', '), priority: String(w.priority), isActive: w.isActive, isDefault: w.isDefault }
      : { code: '', name: '', nameAr: '', city: 'Doha', address: '', zones: '', priority: '100', isActive: true, isDefault: false });
  }, [target, w]);
  const zones = form.zones.split(/[\s,]+/).filter(Boolean);
  const set = (p: Partial<typeof form>) => setForm((x) => ({ ...x, ...p }));

  async function save() {
    const body = {
      name: form.name.trim(), nameAr: form.nameAr.trim() || undefined, city: form.city.trim() || undefined, address: form.address.trim() || undefined,
      zones, priority: Number(form.priority) || 0, isActive: form.isActive, isDefault: form.isDefault || undefined,
    };
    const r = await run('save', () => (isNew
      ? api('/admin/warehouses', { method: 'POST', body: { ...body, code: form.code.trim().toUpperCase() } })
      : api(`/admin/warehouses/${w!.id}`, { method: 'PATCH', body })), isNew ? 'Warehouse added' : 'Warehouse saved');
    if (r !== undefined) onSaved();
  }

  return (
    <Dialog open={!!target} onClose={onClose} title={isNew ? 'Add warehouse' : `Edit ${w?.name ?? ''}`} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" onClick={save} disabled={busy === 'save' || form.name.trim().length < 2 || (isNew && form.code.trim().length < 2)} data-testid="save-warehouse">{busy === 'save' ? <Spinner /> : null} Save</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} required name="name" />
        <TextField label="Code" hint="Short, for labels (e.g. WAK)" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} disabled={!isNew} maxLength={20} name="code" />
        <TextField label="Name in Arabic" value={form.nameAr} onChange={(e) => set({ nameAr: e.target.value })} dir="rtl" name="nameAr" />
        <TextField label="City" value={form.city} onChange={(e) => set({ city: e.target.value })} name="city" />
        <TextField label="Address" className="sm:col-span-2" value={form.address} onChange={(e) => set({ address: e.target.value })} name="address" />
        <TextField label="Nearest for zones" hint="Qatar zone numbers, e.g. 90, 91 — orders there come from here first" value={form.zones} onChange={(e) => set({ zones: e.target.value })} name="zones" />
        <TextField label="Priority" hint="Lower is chosen first when several warehouses have everything" value={form.priority} onChange={(e) => set({ priority: e.target.value.replace(/\D/g, '') })} inputMode="numeric" name="priority" />
      </div>
      <div className="mt-4 space-y-3">
        <Switch checked={form.isDefault} onChange={(isDefault) => set({ isDefault, isActive: isDefault ? true : form.isActive })} disabled={!!w?.isDefault} label="Default warehouse" description="New stock goes here when no warehouse is named (product import, new products)." />
        <Switch checked={form.isActive} onChange={(isActive) => set({ isActive })} disabled={form.isDefault} label="Open" description="Closed warehouses get no orders. Empty it and finish its orders first." />
      </div>
    </Dialog>
  );
}

function TransferDialog({ open, warehouses, onClose, onSaved }: { open: boolean; warehouses: Warehouse[]; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<{ variantId: string; title: string; sku: string; have: number; quantity: string }[]>([]);
  const { busy, run } = useAction();
  useEffect(() => {
    if (!open) return;
    setFrom(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '');
    setTo(warehouses.find((w) => !w.isDefault)?.id ?? '');
    setQ(''); setNote(''); setLines([]);
  }, [open, warehouses]);
  const found = useApi<{ items: StockRow[] }>(open && from && q.trim().length >= 2 ? `/admin/inventory${qs({ q: q.trim(), warehouseId: from, limit: 8 })}` : null);
  const bad = lines.find((l) => !(Number(l.quantity) > 0) || Number(l.quantity) > l.have);

  async function save() {
    const r = await run('transfer', () => api('/admin/stock-transfers', { method: 'POST', body: { fromWarehouseId: from, toWarehouseId: to, note: note.trim() || undefined, items: lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity) })) } }), 'Transfer created');
    if (r !== undefined) onSaved();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Move stock between warehouses" size="lg" footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" onClick={save} disabled={busy === 'transfer' || !from || !to || from === to || !lines.length || !!bad} data-testid="save-transfer">{busy === 'transfer' ? <Spinner /> : null} Create transfer</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" htmlFor="tr-from"><select id="tr-from" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="To" htmlFor="tr-to" error={from && from === to ? 'Choose another warehouse' : null}><select id="tr-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      <div className="mt-4">
        <SearchInput value={q} onChange={setQ} placeholder="Find a product or SKU to add" />
        {found.data?.items.length ? (
          <ul className="mt-2 max-h-48 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100 text-sm">
            {found.data.items.filter((r) => !lines.some((l) => l.variantId === r.variantId)).map((r) => (
              <li key={r.variantId}>
                <button type="button" disabled={!r.warehouseOnHand} onClick={() => setLines([...lines, { variantId: r.variantId, title: r.title, sku: r.sku, have: r.warehouseOnHand ?? 0, quantity: '1' }])}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-ink-50 disabled:opacity-50" data-testid="transfer-pick">
                  <span className="min-w-0 truncate">{r.title} <span className="text-xs text-ink-400">{r.sku}</span></span>
                  <span className="shrink-0 text-xs text-ink-500 tabular">{r.warehouseOnHand ?? 0} there</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {lines.length ? (
        <ul className="mt-4 space-y-2">
          {lines.map((l) => (
            <li key={l.variantId} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.title} <span className="text-xs text-ink-400">{l.sku} · {l.have} there</span></span>
              <input className="input w-24 tabular" inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x) => (x === l ? { ...x, quantity: e.target.value.replace(/\D/g, '') } : x)))} aria-label={`Quantity of ${l.sku}`} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setLines(lines.filter((x) => x !== l))} aria-label={`Remove ${l.sku}`}><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-ink-500">Add the products to move.</p>}
      {bad ? <p className="mt-2 text-sm text-danger-600">{bad.sku}: between 1 and {bad.have}</p> : null}
      <TextField label="Note" className="mt-4" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. for the Wakrah orders" name="note" />
    </Dialog>
  );
}
