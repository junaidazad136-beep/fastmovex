'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Dialog, EmptyState, ErrorState, Loading, PageHeader, SelectField, Spinner, Switch, Table, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime, fromQatarLocalInput, humanize, toQatarLocalInput } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';

export interface Campaign { id: string; name: string; nameAr: string | null; type: string; startsAt: string; endsAt: string; isActive: boolean; _count?: { products: number } }

export function campaignState(c: Campaign): { label: string; tone: 'green' | 'gray' | 'amber' } {
  const now = Date.now();
  if (!c.isActive) return { label: 'Off', tone: 'gray' };
  if (new Date(c.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'amber' };
  if (new Date(c.endsAt).getTime() < now) return { label: 'Ended', tone: 'gray' };
  return { label: 'Live', tone: 'green' };
}

export const CAMPAIGN_TYPES = [
  { value: 'FLASH_DEAL', label: 'Flash deal (countdown on the home page)' },
  { value: 'SEASONAL', label: 'Seasonal sale (Eid, Ramadan, National Day…)' },
  { value: 'JOVIA_EXCLUSIVE', label: 'FastMoveX exclusive' },
  { value: 'PRICE_CAMPAIGN', label: 'Price campaign' },
];

export function CampaignsPage() {
  const toast = useToast();
  const list = useApi<Campaign[]>('/admin/campaigns');
  const { busy, run } = useAction();
  const [form, setForm] = useState<{ name: string; nameAr: string; type: string; startsAt: string; endsAt: string; isActive: boolean } | null>(null);

  async function create() {
    if (!form) return;
    const startsAt = fromQatarLocalInput(form.startsAt);
    const endsAt = fromQatarLocalInput(form.endsAt);
    if (!startsAt || !endsAt || endsAt <= startsAt) return toast.error('The end must be after the start');
    const r = await run('create', () => api<Campaign>('/admin/campaigns', { method: 'POST', body: { name: form.name.trim(), nameAr: form.nameAr.trim() || undefined, type: form.type, startsAt, endsAt, isActive: form.isActive } }), 'Sale created. Now add products to it.');
    if (r) window.location.assign(`/campaigns/${r.id}`);
  }

  return (
    <>
      <PageHeader
        title="Flash sales"
        description="Time-limited deal prices. Products in a live sale show the deal price and a countdown."
        actions={<button type="button" className="btn-primary" onClick={() => { const now = new Date(); setForm({ name: '', nameAr: '', type: 'FLASH_DEAL', startsAt: toQatarLocalInput(now.toISOString()), endsAt: toQatarLocalInput(new Date(now.getTime() + 2 * 86_400_000).toISOString()), isActive: true }); }}><Plus className="size-4" aria-hidden /> New sale</button>}
      />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
        <Card><EmptyState title="No sales yet" description="Create a flash sale, then add products with their deal price." /></Card>
      ) : (
        <Card bodyClassName="p-0">
          <Table>
            <thead><tr><th className="th">Sale</th><th className="th">Type</th><th className="th">Runs</th><th className="th text-end">Products</th><th className="th">Status</th></tr></thead>
            <tbody>
              {list.data.map((c) => {
                const s = campaignState(c);
                return (
                  <tr key={c.id} className="relative hover:bg-ink-25">
                    <td className="td"><Link href={`/campaigns/${c.id}`} className="font-medium after:absolute after:inset-0 hover:text-brand-700">{c.name}</Link>{c.nameAr ? <p dir="rtl" lang="ar" className="text-xs text-ink-500">{c.nameAr}</p> : null}</td>
                    <td className="td text-ink-600">{humanize(c.type)}</td>
                    <td className="td whitespace-nowrap text-ink-600">{formatDateTime(c.startsAt)} → {formatDateTime(c.endsAt)}</td>
                    <td className="td text-end tabular">{c._count?.products ?? 0}</td>
                    <td className="td"><Badge tone={s.tone}>{s.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title="New sale"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={create} disabled={busy === 'create' || (form?.name.trim().length ?? 0) < 3}>{busy === 'create' ? <Spinner /> : null} Create</button></>}
      >
        {form ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Name (English)" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekend Flash Deals" maxLength={100} autoFocus />
              <TextField label="Name (Arabic)" dir="rtl" lang="ar" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} maxLength={100} />
            </div>
            <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {CAMPAIGN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </SelectField>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Starts (Qatar time)" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              <TextField label="Ends (Qatar time)" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </div>
            <Switch checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} label="Active" description="Turn off to prepare the sale without showing it" />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
