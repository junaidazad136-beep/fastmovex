'use client';

import { CalendarClock, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, SkeletonRows, Stat, Table, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDate, formatMoney } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useAction, useApi, useUrlState } from '@/lib/use-api';

interface Lot {
  id: string; lotCode: string | null; expiresOn: string; quantity: number; daysLeft: number; expired: boolean;
  warehouse: { id: string; name: string }; variantId: string; sku: string; productId: string; title: string; valueMinor: string; currencyCode: string;
}
interface Report { days: number; expired: number; expiringSoon: number; valueAtRiskMinor: string; items: Lot[] }

/** Dated stock: what has expired (taken off sale every night) and what expires soon (sell or mark down first). */
export function ExpiryPage() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ days: '30' });
  const report = useApi<Report>(ready ? `/admin/inventory/expiry?days=${f.days}` : null);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  const r = report.data;
  const cur = r?.items[0]?.currencyCode ?? 'QAR';

  async function writeOff() {
    const res = await run('wo', () => api<{ lots: number; unitsWrittenOff: number; unitsStillOnOrders: number }>('/admin/inventory/expiry/write-off', { method: 'POST' }),
      (x) => `${x.unitsWrittenOff} expired units taken off the shelf${x.unitsStillOnOrders ? ` · ${x.unitsStillOnOrders} are in open orders — check them` : ''}`);
    setConfirm(false);
    if (res) { report.reload(); summaryStale(); }
  }

  return (
    <>
      <PageHeader
        title="Expiry dates"
        description="Stock received with an expiry date. The oldest dates are sent first, and every night at 00:10 expired units are written off so they can never be sold."
        actions={can('inventory.approve') && r?.expired ? <button type="button" className="btn-danger" onClick={() => setConfirm(true)}><Trash2 className="size-4" aria-hidden /> Write off expired now</button> : null}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Expired, still on the shelf" value={r ? r.expired : '—'} tone={r?.expired ? 'danger' : undefined} sub="batches" />
        <Stat label={`Expiring within ${f.days} days`} value={r ? r.expiringSoon : '—'} tone={r?.expiringSoon ? 'warn' : undefined} sub="batches" />
        <Stat label="Value at risk (cost)" value={r ? formatMoney(r.valueAtRiskMinor, cur) : '—'} />
      </div>
      <Card bodyClassName="p-0">
        <Tabs value={f.days} onChange={(days) => setF({ days })} tabs={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: 'All' }]} />
        {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Product</th><th className="th">Batch</th><th className="th">Warehouse</th><th className="th">Expires</th><th className="th text-end">Units</th><th className="th text-end">Value</th></tr></thead>
          <tbody>
            {!r && !report.error ? <SkeletonRows cols={6} /> : null}
            {r?.items.map((l) => (
              <tr key={l.id} data-testid="lot-row">
                <td className="td"><Link href={`/products/${l.productId}`} className="font-medium hover:text-brand-700">{l.title}</Link><p className="text-xs text-ink-500">{l.sku}</p></td>
                <td className="td font-mono text-xs">{l.lotCode ?? '—'}</td>
                <td className="td text-sm">{l.warehouse.name}</td>
                <td className="td">
                  {formatDate(l.expiresOn)}{' '}
                  {l.expired ? <Badge tone="red">Expired</Badge> : l.daysLeft <= 7 ? <Badge tone="red">{l.daysLeft === 0 ? 'Today' : `${l.daysLeft} days`}</Badge> : <Badge tone={l.daysLeft <= 30 ? 'amber' : 'gray'}>{l.daysLeft} days</Badge>}
                </td>
                <td className="td text-end tabular">{l.quantity}</td>
                <td className="td text-end tabular">{formatMoney(l.valueMinor, l.currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {r && !r.items.length ? <EmptyState icon={<CalendarClock className="size-6" aria-hidden />} title="Nothing expires soon" description="Turn on “Has an expiry date” on food and dated products, and enter the date when stock arrives." /> : null}
      </Card>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={writeOff} busy={busy === 'wo'} danger confirmLabel="Write off"
        title="Write off expired stock now?" description="Expired units leave the shelf with reason “Expired” (it also happens automatically every night). Units already in open orders are left for you to check." />
    </>
  );
}
