'use client';

import { Factory, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Dialog, EmptyState, ErrorState, PageHeader, SearchInput, SkeletonRows, Spinner, Switch, Table, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';

export interface Supplier {
  id: string; name: string; contactName: string | null; phone: string | null; email: string | null; crNumber: string | null; address: string | null;
  paymentTerms: string | null; notes: string | null; isActive: boolean; _count?: { orders: number };
}
type Form = { id?: string; name: string; contactName: string; phone: string; email: string; crNumber: string; address: string; paymentTerms: string; notes: string; isActive: boolean };

const blank: Form = { name: '', contactName: '', phone: '', email: '', crNumber: '', address: '', paymentTerms: '', notes: '', isActive: true };
const toForm = (s: Supplier): Form => ({ id: s.id, name: s.name, contactName: s.contactName ?? '', phone: s.phone ?? '', email: s.email ?? '', crNumber: s.crNumber ?? '', address: s.address ?? '', paymentTerms: s.paymentTerms ?? '', notes: s.notes ?? '', isActive: s.isActive });

/** The companies FastMoveX buys stock from. */
export function SuppliersPage() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ q: '', all: '' });
  const list = useApi<Supplier[]>(ready ? `/admin/suppliers${qs({ q: f.q, all: f.all === '1' })}` : null);
  const [form, setForm] = useState<Form | null>(null);
  const { busy, run } = useAction();
  const canEdit = can('purchasing.manage');

  async function save() {
    if (!form) return;
    const { id, isActive, ...rest } = form;
    const body = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim() || undefined]));
    const r = await run('save', () => api(id ? `/admin/suppliers/${id}` : '/admin/suppliers', { method: id ? 'PATCH' : 'POST', body: id ? { ...body, isActive } : body }), id ? 'Supplier saved' : 'Supplier added');
    if (r) { setForm(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Suppliers" description="Who you buy stock from. Raise purchase orders to them and receive the goods against those orders."
        actions={canEdit ? <button type="button" className="btn-primary" onClick={() => setForm({ ...blank })}><Plus className="size-4" aria-hidden /> Add supplier</button> : null} />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Search name, contact or phone" className="min-w-[220px] flex-1" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={f.all === '1'} onChange={(e) => setF({ all: e.target.checked ? '1' : '' })} /> Show inactive</label>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Supplier</th><th className="th">Contact</th><th className="th">Payment terms</th><th className="th">Orders</th><th className="th" /></tr></thead>
          <tbody>
            {!list.data && !list.error ? <SkeletonRows cols={5} /> : null}
            {list.data?.map((s) => (
              <tr key={s.id} data-testid="supplier-row">
                <td className="td"><p className="font-medium">{s.name} {!s.isActive ? <Badge>Inactive</Badge> : null}</p>{s.crNumber ? <p className="text-xs text-ink-500">CR {s.crNumber}</p> : null}</td>
                <td className="td text-sm">{s.contactName ?? '—'}<p className="text-xs text-ink-500" dir="ltr">{[s.phone, s.email].filter(Boolean).join(' · ')}</p></td>
                <td className="td text-sm">{s.paymentTerms ?? '—'}</td>
                <td className="td"><Link className="link" href={`/purchase-orders?supplierId=${s.id}`}>{s._count?.orders ?? 0}</Link></td>
                <td className="td text-end">{canEdit ? <button type="button" className="btn-secondary btn-sm" onClick={() => setForm(toForm(s))}>Edit</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.data && !list.data.length ? <EmptyState icon={<Factory className="size-6" aria-hidden />} title="No suppliers yet" /> : null}
      </Card>

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit supplier' : 'Add supplier'} size="lg"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'save' || (form?.name.trim().length ?? 0) < 2} onClick={save}>{busy === 'save' ? <Spinner /> : null} Save</button></>}>
        {form ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Company name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} autoFocus className="sm:col-span-2" />
            <TextField label="Contact person" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} maxLength={120} />
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+974 …" dir="ltr" />
            <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
            <TextField label="CR number" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} maxLength={40} />
            <TextField label="Payment terms" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. 30 days, cash on delivery" maxLength={120} />
            <TextField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={300} />
            <TextArea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={2000} className="sm:col-span-2" />
            {form.id ? <div className="sm:col-span-2"><Switch checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} label="Active" description="Inactive suppliers cannot get new orders." /></div> : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
