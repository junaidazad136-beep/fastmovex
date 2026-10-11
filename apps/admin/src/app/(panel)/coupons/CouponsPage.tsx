'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, Checkbox, Dialog, EmptyState, ErrorState, LoadMore, MoneyField, PageHeader, SearchInput, SelectField, SkeletonRows, Spinner, Table, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { categoryOptionLabel, useCategoryOptions } from '@/lib/catalog';
import { decimalToMinor, formatBps, formatDate, formatMoney, fromQatarLocalInput, toQatarLocalInput } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

interface Coupon {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED' | 'FREE_DELIVERY';
  scope: string;
  valueBps: number | null;
  valueMinor: string | null;
  maxDiscountMinor: string | null;
  minOrderMinor: string | null;
  categoryId: string | null;
  firstOrderOnly: boolean;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  perUserLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

interface Form {
  code: string;
  type: Coupon['type'];
  percent: string;
  amount: string;
  maxDiscount: string;
  minOrder: string;
  categoryId: string;
  firstOrderOnly: boolean;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
}

function describe(c: Coupon): string {
  const v = c.type === 'PERCENTAGE' ? `${formatBps(c.valueBps)} off` : c.type === 'FIXED' ? `${formatMoney(c.valueMinor, 'QAR', { compact: true })} off` : 'Free delivery';
  const cap = c.maxDiscountMinor ? `, up to ${formatMoney(c.maxDiscountMinor, 'QAR', { compact: true })}` : '';
  const min = c.minOrderMinor && c.minOrderMinor !== '0' ? ` on orders over ${formatMoney(c.minOrderMinor, 'QAR', { compact: true })}` : '';
  return `${v}${cap}${min}`;
}

function state(c: Coupon): { label: string; tone: 'green' | 'gray' | 'amber' | 'red' } {
  const now = Date.now();
  if (!c.isActive) return { label: 'Off', tone: 'gray' };
  if (new Date(c.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'amber' };
  if (new Date(c.endsAt).getTime() < now) return { label: 'Expired', tone: 'gray' };
  if (c.usageLimit && c.usedCount >= c.usageLimit) return { label: 'Used up', tone: 'red' };
  return { label: 'Active', tone: 'green' };
}

const blank = (): Form => {
  const now = new Date();
  return {
    code: '', type: 'PERCENTAGE', percent: '10', amount: '', maxDiscount: '', minOrder: '', categoryId: '', firstOrderOnly: false,
    startsAt: toQatarLocalInput(now.toISOString()), endsAt: toQatarLocalInput(new Date(now.getTime() + 30 * 86_400_000).toISOString()), usageLimit: '', perUserLimit: '1',
  };
};

export function CouponsPage() {
  const toast = useToast();
  const [f, setF, ready] = useUrlState({ q: '' });
  const list = useCursorList<Coupon>(ready ? `/admin/coupons${qs({ q: f.q })}` : null);
  const categories = useCategoryOptions();
  const [form, setForm] = useState<Form | null>(null);
  const [edit, setEdit] = useState<{ c: Coupon; endsAt: string; usageLimit: string } | null>(null);
  const { busy, run } = useAction();

  async function create() {
    if (!form) return;
    const code = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return toast.error('Code: 3–30 letters, digits, - or _');
    const body: Record<string, unknown> = {
      code, type: form.type, scope: form.categoryId ? 'CATEGORY' : 'PLATFORM', categoryId: form.categoryId || undefined, firstOrderOnly: form.firstOrderOnly || undefined,
      startsAt: fromQatarLocalInput(form.startsAt), endsAt: fromQatarLocalInput(form.endsAt),
      usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined, perUserLimit: form.perUserLimit ? Number(form.perUserLimit) : undefined,
    };
    if (form.type === 'PERCENTAGE') {
      const p = Number(form.percent);
      if (!(p > 0 && p <= 100)) return toast.error('Percentage must be between 1 and 100');
      body.valueBps = Math.round(p * 100);
      if (form.maxDiscount) body.maxDiscountMinor = decimalToMinor(form.maxDiscount) ?? undefined;
    } else if (form.type === 'FIXED') {
      const a = decimalToMinor(form.amount);
      if (!a || a === '0') return toast.error('Enter the discount amount');
      body.valueMinor = a;
    }
    if (form.minOrder) {
      const m = decimalToMinor(form.minOrder);
      if (!m) return toast.error('Minimum order is not a valid amount');
      body.minOrderMinor = m;
    }
    if (!body.startsAt || !body.endsAt) return toast.error('Choose start and end dates');
    const r = await run('create', () => api('/admin/coupons', { method: 'POST', body }), `Coupon ${code} created`);
    if (r !== undefined) {
      setForm(null);
      list.reload();
    }
  }

  async function patch(c: Coupon, body: Record<string, unknown>, msg: string) {
    const r = await run(`p-${c.id}`, () => api<Coupon>(`/admin/coupons/${c.id}`, { method: 'PATCH', body }), msg);
    if (r) list.setItems((items) => items?.map((x) => (x.id === c.id ? { ...x, ...r } : x)));
    return r;
  }

  return (
    <>
      <PageHeader title="Coupons" description="Discount codes customers type at checkout." actions={<button type="button" className="btn-primary" onClick={() => setForm(blank())}><Plus className="size-4" aria-hidden /> Create coupon</button>} />
      <Card bodyClassName="p-0">
        <div className="border-b border-ink-100 p-3"><SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Search code" /></div>
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <Table>
            <thead><tr><th className="th">Code</th><th className="th">Discount</th><th className="th">Valid</th><th className="th text-end">Used</th><th className="th">Status</th><th className="th text-end">Actions</th></tr></thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={6} /> : null}
              {list.items?.map((c) => {
                const s = state(c);
                return (
                  <tr key={c.id} className="hover:bg-ink-25">
                    <td className="td"><span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-sm font-semibold">{c.code}</span></td>
                    <td className="td text-ink-700">{describe(c)}{c.firstOrderOnly ? <p className="text-xs text-ink-500">First order only</p> : null}{c.scope !== 'PLATFORM' ? <p className="text-xs text-ink-500">{c.scope === 'SELLER' ? 'One seller only' : 'One category only'}</p> : null}</td>
                    <td className="td whitespace-nowrap text-ink-600">{formatDate(c.startsAt)} – {formatDate(c.endsAt)}</td>
                    <td className="td text-end tabular">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</td>
                    <td className="td"><Badge tone={s.tone}>{s.label}</Badge></td>
                    <td className="td text-end">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setEdit({ c, endsAt: toQatarLocalInput(c.endsAt), usageLimit: c.usageLimit ? String(c.usageLimit) : '' })}>Edit</button>
                        <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => patch(c, { isActive: !c.isActive }, c.isActive ? `${c.code} turned off` : `${c.code} turned on`)}>{c.isActive ? 'Turn off' : 'Turn on'}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No coupons yet" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>

      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title="Create coupon"
        size="lg"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={create} disabled={busy === 'create'}>{busy === 'create' ? <Spinner /> : null} Create</button></>}
      >
        {form ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="e.g. EID25" maxLength={30} autoFocus />
              <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Form['type'] })}>
                <option value="PERCENTAGE">Percentage off</option>
                <option value="FIXED">Fixed amount off</option>
                <option value="FREE_DELIVERY">Free delivery</option>
              </SelectField>
            </div>
            {form.type === 'PERCENTAGE' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Percentage" inputMode="decimal" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} hint="e.g. 15 for 15% off" />
                <MoneyField label="Maximum discount" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} hint="Optional cap" />
              </div>
            ) : form.type === 'FIXED' ? (
              <MoneyField label="Amount off" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField label="Minimum order" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} hint="Optional" />
              <SelectField label="Applies to" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Whole store</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{categoryOptionLabel(c)}</option>)}
              </SelectField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Starts (Qatar time)" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              <TextField label="Ends (Qatar time)" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Total uses" inputMode="numeric" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value.replace(/\D/g, '') })} hint="Empty = unlimited" />
              <TextField label="Uses per customer" inputMode="numeric" value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: e.target.value.replace(/\D/g, '') })} />
            </div>
            <Checkbox label="Only for a customer's first order" checked={form.firstOrderOnly} onChange={(e) => setForm({ ...form, firstOrderOnly: e.target.checked })} />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit ${edit?.c.code ?? ''}`}
        description="Discount and conditions cannot change once a coupon exists (customers may already have it). Create a new one instead."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!!busy}
              onClick={async () => {
                if (!edit) return;
                const r = await patch(edit.c, { endsAt: fromQatarLocalInput(edit.endsAt), usageLimit: edit.usageLimit ? Number(edit.usageLimit) : undefined }, 'Coupon saved');
                if (r) setEdit(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {edit ? (
          <div className="space-y-4">
            <TextField label="Ends (Qatar time)" type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} />
            <TextField label="Total uses" inputMode="numeric" value={edit.usageLimit} onChange={(e) => setEdit({ ...edit, usageLimit: e.target.value.replace(/\D/g, '') })} hint="Empty = keep the current limit" />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
