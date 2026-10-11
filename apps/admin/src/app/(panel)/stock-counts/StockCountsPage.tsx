'use client';

import { ClipboardCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Card, Dialog, EmptyState, ErrorState, PageHeader, SelectField, SkeletonRows, Spinner, Switch, Table, Tabs, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { categoryOptionLabel, useCategoryOptions } from '@/lib/catalog';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';

interface Count { id: string; number: string; status: string; blind: boolean; note: string | null; createdAt: string; submittedAt: string | null; approvedAt: string | null; warehouse: { name: string; code: string }; _count: { lines: number } }
interface Warehouse { id: string; name: string; isActive: boolean; isDefault: boolean }

export const COUNT_STATUS: Record<string, { label: string; tone: 'blue' | 'amber' | 'green' | 'gray' }> = {
  OPEN: { label: 'Counting', tone: 'blue' }, SUBMITTED: { label: 'Waiting for approval', tone: 'amber' }, APPROVED: { label: 'Approved', tone: 'green' }, CANCELLED: { label: 'Cancelled', tone: 'gray' },
};

/** Stocktakes: count the shelves (blind), submit, and a second person approves the differences. */
export function StockCountsPage() {
  const { can } = useSession();
  const router = useRouter();
  const [f, setF, ready] = useUrlState({ status: '' });
  const list = useApi<Count[]>(ready ? `/admin/stock-counts${qs({ status: f.status })}` : null);
  const warehouses = useApi<{ items: Warehouse[] }>('/admin/warehouses');
  const cats = useCategoryOptions();
  const [form, setForm] = useState<{ warehouseId: string; categoryId: string; blind: boolean; note: string } | null>(null);
  const { busy, run } = useAction();
  const open = (warehouses.data?.items ?? []).filter((w) => w.isActive);

  async function create() {
    if (!form) return;
    const wid = form.warehouseId || open.find((w) => w.isDefault)?.id || open[0]?.id;
    const r = await run('create', () => api<{ id: string }>('/admin/stock-counts', { method: 'POST', body: { warehouseId: wid, categoryId: form.categoryId || undefined, blind: form.blind, note: form.note.trim() || undefined } }), 'Stocktake started');
    if (r) router.push(`/stock-counts/${r.id}`);
  }

  return (
    <>
      <PageHeader title="Stocktake" description="Count what is really on the shelves. Counters do not see the expected numbers; a different person approves, and the differences are posted with your names."
        actions={can('inventory.manage') ? <button type="button" className="btn-primary" onClick={() => setForm({ warehouseId: '', categoryId: '', blind: true, note: '' })}><Plus className="size-4" aria-hidden /> New stocktake</button> : null} />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Counting' }, { value: 'SUBMITTED', label: 'To approve' }, { value: 'APPROVED', label: 'Approved' }]} />
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Stocktake</th><th className="th">Warehouse</th><th className="th">Products</th><th className="th">Status</th><th className="th">Started</th></tr></thead>
          <tbody>
            {!list.data && !list.error ? <SkeletonRows cols={5} /> : null}
            {list.data?.map((c) => (
              <tr key={c.id} className="hover:bg-ink-25" data-testid="count-row">
                <td className="td"><Link href={`/stock-counts/${c.id}`} className="font-mono text-sm font-semibold hover:text-brand-700">{c.number}</Link>{c.note ? <p className="text-xs text-ink-500">{c.note}</p> : null}</td>
                <td className="td">{c.warehouse.name}</td>
                <td className="td tabular">{c._count.lines}</td>
                <td className="td"><Badge tone={COUNT_STATUS[c.status]?.tone ?? 'gray'}>{COUNT_STATUS[c.status]?.label ?? c.status}</Badge>{c.blind ? <span className="ms-1 text-xs text-ink-500">blind</span> : null}</td>
                <td className="td text-ink-600">{formatDateTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.data && !list.data.length ? <EmptyState icon={<ClipboardCheck className="size-6" aria-hidden />} title="No stocktakes yet" description="Count one shelf or category at a time, ideally every month." /> : null}
      </Card>

      <Dialog open={!!form} onClose={() => setForm(null)} title="New stocktake"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'create'} onClick={create}>{busy === 'create' ? <Spinner /> : null} Start counting</button></>}>
        {form ? (
          <div className="space-y-4">
            {open.length > 1 ? (
              <SelectField label="Warehouse" value={form.warehouseId || open.find((w) => w.isDefault)?.id || ''} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                {open.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </SelectField>
            ) : null}
            <SelectField label="What to count" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} hint="Products with stock there or on sale">
              <option value="">Everything</option>
              {cats?.map((c) => <option key={c.id} value={c.id}>{categoryOptionLabel(c)}</option>)}
            </SelectField>
            <Switch checked={form.blind} onChange={(blind) => setForm({ ...form, blind })} label="Blind count" description="Counters do not see how many the system expects — they count what is there." />
            <TextField label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} placeholder="e.g. Aisle 3, monthly count" />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
