'use client';

import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VariantPicker } from '@/components/products/VariantPicker';
import { Badge, Card, Dialog, EmptyState, ErrorState, PageHeader, SelectField, SkeletonRows, Spinner, Table, Tabs, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { decimalToMinor, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';
import type { Supplier } from '../suppliers/SuppliersPage';

interface Row {
  id: string; number: string; status: string; totalMinor: string; currencyCode: string; expectedOn: string | null; createdAt: string;
  supplier: { id: string; name: string }; warehouse: { name: string; code: string }; units: number; receivedUnits: number; lineCount: number;
}
interface Warehouse { id: string; name: string; isActive: boolean; isDefault: boolean }

export const PO_STATUS: Record<string, { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red' }> = {
  DRAFT: { label: 'Draft', tone: 'gray' }, ORDERED: { label: 'Ordered', tone: 'blue' }, PARTIAL: { label: 'Part received', tone: 'amber' },
  RECEIVED: { label: 'Received', tone: 'green' }, CANCELLED: { label: 'Cancelled', tone: 'red' },
};

export interface DraftLine { variantId: string; sku: string; title: string; quantity: string; cost: string }

/** Lines editor shared by "new order" and editing a draft. */
export function PoLinesEditor({ lines, onChange, currency = 'QAR' }: { lines: DraftLine[]; onChange: (l: DraftLine[]) => void; currency?: string }) {
  const total = lines.reduce((n, l) => n + BigInt(decimalToMinor(l.cost) ?? '0') * BigInt(Number.parseInt(l.quantity, 10) || 0), 0n);
  const set = (i: number, patch: Partial<DraftLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      {lines.length ? (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-ink-500"><th className="py-1 text-start font-medium">Product</th><th className="w-24 py-1 text-end font-medium">Qty</th><th className="w-32 py-1 text-end font-medium">Unit cost</th><th className="w-10" /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((l, i) => (
              <tr key={l.variantId} data-testid="po-line">
                <td className="py-2 pe-2"><p className="font-medium">{l.title}</p><p className="text-xs text-ink-500">{l.sku}</p></td>
                <td className="py-2"><input className="input text-end tabular" inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/\D/g, '').slice(0, 7) })} aria-label={`Quantity ${l.sku}`} /></td>
                <td className="py-2 ps-2"><input className="input text-end tabular" inputMode="decimal" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} placeholder="0.00" aria-label={`Unit cost ${l.sku}`} /></td>
                <td className="py-2 text-end"><button type="button" className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-danger-600" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Remove ${l.sku}`}><Trash2 className="size-4" aria-hidden /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <VariantPicker exclude={lines.map((l) => l.variantId)} onPick={(v) => onChange([...lines, { variantId: v.variantId, sku: v.sku, title: v.title, quantity: '1', cost: '' }])} />
      <p className="text-end text-sm">Total <strong className="tabular" data-testid="po-total">{formatMoney(total.toString(), currency)}</strong></p>
    </div>
  );
}

export function linesPayload(lines: DraftLine[]): { error: string } | { lines: { variantId: string; quantity: number; unitCostMinor: string }[] } {
  if (!lines.length) return { error: 'Add at least one product' };
  const out = [];
  for (const l of lines) {
    const q = Number.parseInt(l.quantity, 10);
    const c = decimalToMinor(l.cost);
    if (!q || q < 1) return { error: `${l.sku}: enter a quantity` };
    if (c === null) return { error: `${l.sku}: enter the unit cost, like 12.50` };
    out.push({ variantId: l.variantId, quantity: q, unitCostMinor: c });
  }
  return { lines: out };
}

/** Purchase orders to suppliers: draft → send → receive the goods (once or in parts). */
export function PurchaseOrdersPage() {
  const { can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [f, setF, ready] = useUrlState({ status: '', supplierId: '' });
  const list = useApi<Row[]>(ready ? `/admin/purchase-orders${qs({ status: f.status, supplierId: f.supplierId })}` : null);
  const suppliers = useApi<Supplier[]>('/admin/suppliers');
  const warehouses = useApi<{ items: Warehouse[] }>('/admin/warehouses');
  const [form, setForm] = useState<{ supplierId: string; warehouseId: string; expectedOn: string; note: string; lines: DraftLine[] } | null>(null);
  const { busy, run } = useAction();
  const open = (warehouses.data?.items ?? []).filter((w) => w.isActive);

  async function create() {
    if (!form) return;
    const p = linesPayload(form.lines);
    if ('error' in p) return toast.error(p.error);
    if (!form.supplierId) return toast.error('Choose a supplier');
    const wid = form.warehouseId || open.find((w) => w.isDefault)?.id || open[0]?.id;
    const r = await run('create', () => api<{ id: string }>('/admin/purchase-orders', {
      method: 'POST', body: { supplierId: form.supplierId, warehouseId: wid, expectedOn: form.expectedOn || undefined, note: form.note.trim() || undefined, lines: p.lines },
    }), 'Draft purchase order saved');
    if (r) router.push(`/purchase-orders/${r.id}`);
  }

  return (
    <>
      <PageHeader title="Purchase orders" description="What you ordered from suppliers and what has arrived. Goods are received against the order by someone other than the person who raised it."
        actions={can('purchasing.manage') ? <button type="button" className="btn-primary" onClick={() => setForm({ supplierId: '', warehouseId: '', expectedOn: '', note: '', lines: [] })}><Plus className="size-4" aria-hidden /> New purchase order</button> : null} />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'ORDERED', label: 'Ordered' }, { value: 'PARTIAL', label: 'Part received' }, { value: 'RECEIVED', label: 'Received' }]} />
        {suppliers.data?.length ? (
          <div className="border-b border-ink-100 p-3">
            <select className="input w-auto" value={f.supplierId} onChange={(e) => setF({ supplierId: e.target.value })} aria-label="Supplier">
              <option value="">All suppliers</option>
              {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ) : null}
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Order</th><th className="th">Supplier</th><th className="th">Deliver to</th><th className="th">Expected</th><th className="th">Received</th><th className="th">Status</th><th className="th text-end">Total</th></tr></thead>
          <tbody>
            {!list.data && !list.error ? <SkeletonRows cols={7} /> : null}
            {list.data?.map((p) => (
              <tr key={p.id} className="hover:bg-ink-25" data-testid="po-row">
                <td className="td"><Link href={`/purchase-orders/${p.id}`} className="font-mono text-sm font-semibold hover:text-brand-700">{p.number}</Link><p className="text-xs text-ink-500">{formatDateTime(p.createdAt)}</p></td>
                <td className="td">{p.supplier.name}</td>
                <td className="td text-sm">{p.warehouse.name}</td>
                <td className="td text-sm">{p.expectedOn ? formatDate(p.expectedOn) : '—'}</td>
                <td className="td tabular text-sm">{p.receivedUnits} / {p.units}</td>
                <td className="td"><Badge tone={PO_STATUS[p.status]?.tone ?? 'gray'}>{PO_STATUS[p.status]?.label ?? p.status}</Badge></td>
                <td className="td text-end tabular">{formatMoney(p.totalMinor, p.currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.data && !list.data.length ? <EmptyState icon={<ClipboardList className="size-6" aria-hidden />} title="No purchase orders" description={suppliers.data?.length ? undefined : <>Add your <Link href="/suppliers" className="link">suppliers</Link> first.</>} /> : null}
      </Card>

      <Dialog open={!!form} onClose={() => setForm(null)} title="New purchase order" size="xl"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'create'} onClick={create} data-testid="po-create">{busy === 'create' ? <Spinner /> : null} Save draft</button></>}>
        {form ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Supplier" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">Choose…</option>
                {suppliers.data?.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
              <SelectField label="Deliver to" value={form.warehouseId || open.find((w) => w.isDefault)?.id || ''} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                {open.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </SelectField>
              <TextField label="Expected by" type="date" value={form.expectedOn} onChange={(e) => setForm({ ...form, expectedOn: e.target.value })} />
            </div>
            <PoLinesEditor lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} />
            <TextField label="Note to supplier" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
