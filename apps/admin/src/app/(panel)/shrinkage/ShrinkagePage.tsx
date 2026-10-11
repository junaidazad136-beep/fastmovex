'use client';

import { TrendingDown } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Stat, Table } from '@/components/ui';
import { formatMoney, todayInQatar } from '@/lib/format';
import { qs, useApi } from '@/lib/use-api';

interface Report {
  from: string; to: string; totalLostUnits: number; totalLostValueMinor: string;
  byReason: { reason: string; units: number; valueMinor: string }[];
  topProducts: { reason: string; variantId: string; sku: string; title: string; units: number; valueMinor: string }[];
}
export const LOSS_REASON: Record<string, string> = { DAMAGED: 'Damaged', EXPIRED: 'Expired', LOST: 'Lost / stolen', COUNT: 'Stocktake difference', FOUND: 'Found', ADJUSTMENT: 'Manual correction' };

const daysAgo = (n: number) => { const d = new Date(`${todayInQatar()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

/** Stock that left other than by selling: damaged, expired, lost, stocktake differences — in units and money at cost. */
export function ShrinkagePage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayInQatar());
  const r = useApi<Report>(`/admin/inventory/shrinkage${qs({ from, to })}`);
  const d = r.data;
  return (
    <>
      <PageHeader title="Losses" description="Stock that left the shelves without being sold, valued at cost. Watch for products that keep going missing." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm"><span className="label">To</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="loss-totals">
        <Stat label="Units lost" value={d ? d.totalLostUnits : '—'} tone={d?.totalLostUnits ? 'danger' : undefined} />
        <Stat label="Value lost (cost)" value={d ? formatMoney(d.totalLostValueMinor) : '—'} tone={d && d.totalLostValueMinor !== '0' ? 'danger' : undefined} />
        {d?.byReason.filter((b) => b.units < 0).slice(0, 2).map((b) => <Stat key={b.reason} label={LOSS_REASON[b.reason] ?? b.reason} value={formatMoney((-BigInt(b.valueMinor)).toString())} sub={`${-b.units} units`} />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card title="By reason" bodyClassName="p-0">
          <Table>
            <thead><tr><th className="th">Reason</th><th className="th text-end">Units</th><th className="th text-end">Value</th></tr></thead>
            <tbody>
              {!d && !r.error ? <SkeletonRows cols={3} rows={4} /> : null}
              {d?.byReason.map((b) => (
                <tr key={b.reason}><td className="td">{LOSS_REASON[b.reason] ?? b.reason}</td><td className={`td text-end tabular ${b.units < 0 ? 'text-danger-600' : 'text-success-600'}`}>{b.units > 0 ? '+' : ''}{b.units}</td><td className="td text-end tabular">{formatMoney(b.valueMinor)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Products losing the most" bodyClassName="p-0">
          <Table>
            <thead><tr><th className="th">Product</th><th className="th">Reason</th><th className="th text-end">Units</th><th className="th text-end">Value</th></tr></thead>
            <tbody>
              {!d && !r.error ? <SkeletonRows cols={4} rows={4} /> : null}
              {d?.topProducts.map((p) => (
                <tr key={`${p.variantId}-${p.reason}`} data-testid="loss-row"><td className="td"><p className="font-medium">{p.title}</p><p className="text-xs text-ink-500">{p.sku}</p></td><td className="td"><Badge tone={p.reason === 'LOST' ? 'red' : 'gray'}>{LOSS_REASON[p.reason] ?? p.reason}</Badge></td><td className="td text-end tabular text-danger-600">{p.units}</td><td className="td text-end tabular">{formatMoney(p.valueMinor)}</td></tr>
              ))}
            </tbody>
          </Table>
          {d && !d.topProducts.length ? <EmptyState icon={<TrendingDown className="size-6" aria-hidden />} title="No losses in this period" /> : null}
        </Card>
      </div>
    </>
  );
}
