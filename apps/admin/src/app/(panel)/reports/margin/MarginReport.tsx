'use client';

import { AlertTriangle, Download } from 'lucide-react';
import Link from 'next/link';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Spinner, Stat, Table, Tabs } from '@/components/ui';
import { download } from '@/lib/api/client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';
import { RANGES } from '../../deliveries/DriverPerformance';

type Group = 'day' | 'product' | 'category';
interface Row { key: string; label: string; units: number; revenueMinor: string; costMinor: string; profitMinor: string; marginPct: number | null; uncostedUnits: number; refundedMinor: string }
interface Margin {
  from: string; to: string; group: Group; currencyCode: string;
  totals: {
    units: number; revenueMinor: string; costMinor: string; profitMinor: string; marginPct: number | null; refundedMinor: string;
    uncostedUnits: number; uncostedRevenueMinor: string; deliveryFeesMinor: string; marketplaceCommissionMinor: string;
  };
  rows: Row[];
  missingCost: { id: string; title: string; sku: string; units: number; revenueMinor: string }[];
}

const GROUPS: { value: Group; label: string }[] = [{ value: 'day', label: 'By day' }, { value: 'product', label: 'By product' }, { value: 'category', label: 'By category' }];

/**
 * What our own store really earned: sales without VAT, minus the cost price frozen at the moment of each sale, after
 * refunds. Products sold without a cost price are left out of the margin and listed so someone can fill them in.
 */
export function MarginReport() {
  const [f, setF, ready] = useUrlState({ range: '30d', group: 'day' });
  const group = (GROUPS.some((g) => g.value === f.group) ? f.group : 'day') as Group;
  const r = useApi<Margin>(ready ? `/admin/reports/margin${qs({ range: f.range, group })}` : null);
  const { busy, run } = useAction();
  const cur = r.data?.currencyCode ?? 'QAR';
  const m = (v: string) => formatMoney(v, cur);
  const t = r.data?.totals;

  return (
    <>
      <PageHeader
        title="Profit & margin"
        description="Our own store’s sales (without VAT) against the cost price saved when each item was sold. Refunded units are taken out."
        actions={
          <div className="flex items-center gap-2">
            <select className="input w-auto py-1.5" value={f.range} onChange={(e) => setF({ range: e.target.value })} aria-label="Period">
              {RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            <button type="button" className="btn-secondary" disabled={busy === 'csv'} data-testid="margin-csv"
              onClick={() => run('csv', () => download(`/admin/reports/margin.csv${qs({ range: f.range, group })}`, 'fastmovex-margin.csv'))}>
              {busy === 'csv' ? <Spinner /> : <Download className="size-4" aria-hidden />} CSV
            </button>
          </div>
        }
      />
      {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="margin-totals">
        <Stat label="Sales (excl. VAT)" value={t ? m(t.revenueMinor) : '…'} sub={t ? `${formatNumber(t.units)} units · ${m(t.refundedMinor)} refunded` : undefined} />
        <Stat label="Cost of goods" value={t ? m(t.costMinor) : '…'} sub={t && t.uncostedUnits ? `${formatNumber(t.uncostedUnits)} units have no cost price` : 'At the cost when sold'} tone={t && t.uncostedUnits ? 'warn' : undefined} />
        <Stat label="Gross profit" value={t ? m(t.profitMinor) : '…'} sub={t?.marginPct != null ? `${t.marginPct}% margin on costed sales` : 'No costed sales'} tone={t && BigInt(t.profitMinor) < 0n ? 'danger' : undefined} />
        <Stat label="Other income" value={t ? m((BigInt(t.deliveryFeesMinor) + BigInt(t.marketplaceCommissionMinor)).toString()) : '…'} sub={t ? `${m(t.deliveryFeesMinor)} delivery fees · ${m(t.marketplaceCommissionMinor)} marketplace commission` : undefined} />
      </div>

      {r.data?.missingCost.length ? (
        <Card className="mb-6 border-warning-200" title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning-600" aria-hidden />Sold without a cost price</span>}
          description="Their sales are not in the margin. Add the cost price on the product (Products → variant → Cost). Future sales use it; past sales keep no cost.">
          <ul className="divide-y divide-ink-100 text-sm" data-testid="missing-cost">
            {r.data.missingCost.slice(0, 8).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/products/${x.id}`} className="min-w-0 truncate font-medium hover:text-brand-700">{x.title} <span className="font-mono text-xs text-ink-500">{x.sku}</span></Link>
                <span className="shrink-0 text-ink-600 tabular">{x.units} sold · {m(x.revenueMinor)}</span>
              </li>
            ))}
          </ul>
          {r.data.missingCost.length > 8 ? <p className="pt-2 text-xs text-ink-500">and {r.data.missingCost.length - 8} more…</p> : null}
        </Card>
      ) : null}

      <Card bodyClassName="p-0">
        <Tabs value={group} onChange={(v) => setF({ group: v })} tabs={GROUPS} />
        <Table>
          <thead>
            <tr>
              <th className="th">{group === 'day' ? 'Date' : group === 'product' ? 'Product' : 'Category'}</th>
              <th className="th text-end">Units</th><th className="th text-end">Sales</th><th className="th text-end">Cost</th><th className="th text-end">Profit</th><th className="th text-end">Margin</th><th className="th text-end">Refunded</th>
            </tr>
          </thead>
          <tbody>
            {!r.data && !r.error ? <SkeletonRows cols={7} /> : null}
            {r.data?.rows.map((x) => (
              <tr key={x.key} data-testid="margin-row">
                <td className="td text-sm font-medium">{group === 'day' ? formatDate(x.key) : group === 'product' ? <Link href={`/products/${x.key}`} className="hover:text-brand-700">{x.label}</Link> : x.label}
                  {x.uncostedUnits ? <p className="text-xs font-normal text-warning-700">{x.uncostedUnits} unit{x.uncostedUnits > 1 ? 's' : ''} without cost</p> : null}
                </td>
                <td className="td text-end tabular">{formatNumber(x.units)}</td>
                <td className="td text-end tabular">{m(x.revenueMinor)}</td>
                <td className="td text-end tabular">{m(x.costMinor)}</td>
                <td className={`td text-end tabular font-medium ${BigInt(x.profitMinor) < 0n ? 'text-danger-600' : ''}`}>{m(x.profitMinor)}</td>
                <td className={`td text-end tabular ${x.marginPct === null ? 'text-ink-400' : x.marginPct < 15 ? 'text-danger-600' : x.marginPct < 30 ? 'text-warning-700' : 'text-success-700'}`}>{x.marginPct === null ? '—' : `${x.marginPct}%`}</td>
                <td className="td text-end tabular text-ink-600">{BigInt(x.refundedMinor) > 0n ? m(x.refundedMinor) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {r.data?.rows.length === 0 ? <EmptyState title="No sales in this period" /> : null}
      </Card>
    </>
  );
}
