'use client';

import { useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows, Table } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { qs, useApi } from '@/lib/use-api';

interface Row {
  id: string; name: string; phone: string | null; assigned: number; delivered: number; failed: number; refused: number;
  successPct: number | null; onTimePct: number | null; withSlot: number; avgMinutes: number | null; farFromAddress: number; wrongCodes: number;
  cashCollectedMinor: string; cashShortMinor: string; cashOverMinor: string;
}
interface Perf { from: string; to: string; currencyCode: string; farMetres: number; drivers: Row[] }

export const RANGES = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' }, { value: '3m', label: 'Last 3 months' }, { value: '12m', label: 'Last 12 months' },
] as const;

const pctTone = (v: number | null, good: number, ok: number) => (v === null ? 'text-ink-400' : v >= good ? 'text-success-700' : v >= ok ? 'text-warning-700' : 'text-danger-600');

/** One line per driver: what they delivered, how reliably and on time, and whether the cash and the proof add up. */
export function DriverPerformance() {
  const [range, setRange] = useState<string>('7d');
  const r = useApi<Perf>(`/admin/deliveries/performance${qs({ range })}`);
  const cur = r.data?.currencyCode ?? 'QAR';
  return (
    <div data-testid="driver-performance">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3">
        <select className="input w-auto py-1.5" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Period">
          {RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <p className="text-xs text-ink-500">On time = delivered before the end of the promised window. Far = marked “not delivered” more than {r.data?.farMetres ?? 500} m from the customer’s pin.</p>
      </div>
      {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null}
      <Table>
        <thead>
          <tr>
            <th className="th">Driver</th><th className="th text-end">Delivered</th><th className="th text-end">Not delivered</th><th className="th text-end">Success</th>
            <th className="th text-end">On time</th><th className="th text-end">Avg. drop</th><th className="th text-end">Cash collected</th><th className="th text-end">Cash short</th><th className="th">Check</th>
          </tr>
        </thead>
        <tbody>
          {!r.data && !r.error ? <SkeletonRows cols={9} /> : null}
          {r.data?.drivers.map((d) => (
            <tr key={d.id} data-testid="perf-row">
              <td className="td"><p className="text-sm font-semibold text-ink-900">{d.name}</p><p className="text-xs text-ink-500">{d.assigned} assigned</p></td>
              <td className="td text-end tabular">{d.delivered}</td>
              <td className="td text-end tabular">{d.failed}{d.refused ? <p className="text-xs text-ink-500">{d.refused} refused</p> : null}</td>
              <td className={`td text-end tabular font-medium ${pctTone(d.successPct, 90, 75)}`}>{d.successPct === null ? '—' : `${d.successPct}%`}</td>
              <td className={`td text-end tabular font-medium ${pctTone(d.onTimePct, 90, 75)}`}>{d.onTimePct === null ? '—' : `${d.onTimePct}%`}{d.withSlot ? <p className="text-xs font-normal text-ink-500">of {d.withSlot}</p> : null}</td>
              <td className="td text-end tabular">{d.avgMinutes === null ? '—' : `${d.avgMinutes} min`}</td>
              <td className="td text-end tabular">{formatMoney(d.cashCollectedMinor, cur)}</td>
              <td className={`td text-end tabular ${BigInt(d.cashShortMinor) > 0n ? 'font-semibold text-danger-600' : 'text-ink-400'}`}>{BigInt(d.cashShortMinor) > 0n ? formatMoney(d.cashShortMinor, cur) : '—'}</td>
              <td className="td text-xs">
                {d.farFromAddress ? <p className="text-danger-600">{d.farFromAddress} failed far from address</p> : null}
                {d.wrongCodes ? <p className="text-warning-700">{d.wrongCodes} wrong code{d.wrongCodes > 1 ? 's' : ''}</p> : null}
                {!d.farFromAddress && !d.wrongCodes ? <span className="text-ink-400">—</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {r.data?.drivers.length === 0 ? <EmptyState title="No drivers yet" /> : null}
    </div>
  );
}
