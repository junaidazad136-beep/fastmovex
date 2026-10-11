'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { VariantPicker, type PickedVariant } from '@/components/products/VariantPicker';
import { Badge, Card, Dialog, EmptyState, ErrorState, Loading, MoneyField, PageHeader, Spinner, Switch, Table, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { decimalToMinor, formatDateTime, formatMoney, fromQatarLocalInput, humanize, percentOffLabel, toQatarLocalInput } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';
import { campaignState, type Campaign } from '../CampaignsPage';

interface Deal { campaignId: string; variantId: string; dealPriceMinor: string; stockLimit: number | null; soldCount: number; variant: { sku: string; priceMinor: string; product: { title: string; slug: string } } }

export function CampaignDetail({ id }: { id: string }) {
  const toast = useToast();
  const all = useApi<Campaign[]>('/admin/campaigns');
  const deals = useApi<Deal[]>(/^[0-9a-f-]{36}$/i.test(id) ? `/admin/campaigns/${id}/products` : null);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState<PickedVariant | null>(null);
  const [picker, setPicker] = useState(false);
  const [deal, setDeal] = useState({ price: '', limit: '' });
  const [edit, setEdit] = useState<{ name: string; endsAt: string; isActive: boolean } | null>(null);

  const c = all.data?.find((x) => x.id === id);
  if (all.error) return <ErrorState error={all.error} onRetry={all.reload} />;
  if (!all.data) return <Loading />;
  if (!c) return <EmptyState title="Sale not found" action={<Link href="/campaigns" className="btn-secondary">Back</Link>} />;
  const s = campaignState(c);

  async function add() {
    if (!adding) return;
    const price = decimalToMinor(deal.price);
    if (!price || price === '0') return toast.error('Enter the deal price');
    if (BigInt(price) >= BigInt(adding.priceMinor)) return toast.error(`The deal price must be lower than the normal price (${formatMoney(adding.priceMinor, adding.currencyCode)})`);
    const r = await run('add', () => api(`/admin/campaigns/${id}/products`, { method: 'POST', body: { variantId: adding.variantId, dealPriceMinor: price, stockLimit: deal.limit ? Number(deal.limit) : undefined } }), 'Added to the sale');
    if (r !== undefined) {
      setAdding(null);
      deals.reload();
      all.reload();
    }
  }

  async function remove(d: Deal) {
    const r = await run(`rm-${d.variantId}`, () => api(`/admin/campaigns/${id}/products/${d.variantId}`, { method: 'DELETE' }), 'Removed from the sale');
    if (r !== undefined) deals.setData((list) => (list ?? []).filter((x) => x.variantId !== d.variantId));
  }

  async function saveEdit() {
    if (!edit || !c) return;
    const r = await run('edit', () => api(`/admin/campaigns/${id}`, { method: 'PATCH', body: { name: edit.name.trim(), endsAt: fromQatarLocalInput(edit.endsAt), isActive: edit.isActive } }), 'Sale saved');
    if (r !== undefined) {
      setEdit(null);
      all.reload();
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/campaigns', label: 'Flash sales' }}
        title={<span className="flex items-center gap-3">{c.name} <Badge tone={s.tone}>{s.label}</Badge></span>}
        description={`${humanize(c.type)} · ${formatDateTime(c.startsAt)} → ${formatDateTime(c.endsAt)} (Qatar time)`}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEdit({ name: c.name, endsAt: toQatarLocalInput(c.endsAt), isActive: c.isActive })}>Edit sale</button>
            <button type="button" className="btn-primary" onClick={() => { setPicker(true); setAdding(null); }}><Plus className="size-4" aria-hidden /> Add product</button>
          </>
        }
      />
      <Card bodyClassName="p-0">
        {deals.error ? <ErrorState error={deals.error} onRetry={deals.reload} /> : !deals.data ? <Loading /> : deals.data.length === 0 ? (
          <EmptyState title="No products in this sale" description="Add products and set their deal price." />
        ) : (
          <Table>
            <thead><tr><th className="th">Product</th><th className="th text-end">Normal price</th><th className="th text-end">Deal price</th><th className="th text-end">Sold / limit</th><th className="th w-10"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {deals.data.map((d) => (
                <tr key={d.variantId} className="hover:bg-ink-25">
                  <td className="td"><p className="font-medium">{d.variant.product.title}</p><p className="text-xs text-ink-500">{d.variant.sku}</p></td>
                  <td className="td text-end text-ink-500 tabular line-through">{formatMoney(d.variant.priceMinor)}</td>
                  <td className="td text-end font-semibold text-deal-600 tabular">{formatMoney(d.dealPriceMinor)} <span className="text-xs font-normal">({percentOffLabel(d.variant.priceMinor, d.dealPriceMinor)})</span></td>
                  <td className="td text-end tabular">{d.soldCount}{d.stockLimit ? ` / ${d.stockLimit}` : ''}</td>
                  <td className="td"><button type="button" className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50" disabled={!!busy} onClick={() => remove(d)} aria-label={`Remove ${d.variant.product.title}`}><Trash2 className="size-4" aria-hidden /></button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={picker}
        onClose={() => setPicker(false)}
        title={adding ? 'Deal price' : 'Add product to the sale'}
        description={adding ? `${adding.title} · ${adding.sku} · normal price ${formatMoney(adding.priceMinor, adding.currencyCode)}` : undefined}
        size="lg"
        footer={adding ? <><button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Back</button><button type="button" className="btn-primary" onClick={async () => { await add(); }} disabled={busy === 'add'}>{busy === 'add' ? <Spinner /> : null} Add to sale</button></> : undefined}
      >
        {adding ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField label="Deal price" value={deal.price} onChange={(e) => setDeal({ ...deal, price: e.target.value })} autoFocus />
            <TextField label="Units at this price" inputMode="numeric" value={deal.limit} onChange={(e) => setDeal({ ...deal, limit: e.target.value.replace(/\D/g, '') })} hint="Empty = no limit" />
          </div>
        ) : (
          <VariantPicker exclude={deals.data?.map((d) => d.variantId)} onPick={(v) => { setAdding(v); setDeal({ price: '', limit: '' }); }} />
        )}
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Edit sale"
        size="sm"
        footer={<><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" onClick={saveEdit} disabled={busy === 'edit'}>{busy === 'edit' ? <Spinner /> : null} Save</button></>}
      >
        {edit ? (
          <div className="space-y-4">
            <TextField label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={100} />
            <TextField label="Ends (Qatar time)" type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} />
            <Switch checked={edit.isActive} onChange={(isActive) => setEdit({ ...edit, isActive })} label="Active" />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
