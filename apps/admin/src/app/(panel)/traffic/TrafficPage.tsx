'use client';

import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { Card, ErrorState, PageHeader, SkeletonRows, Stat, Table } from '@/components/ui';
import { formatMoney, formatNumber } from '@/lib/format';
import { useApi, useUrlState } from '@/lib/use-api';

interface Report {
  currencyCode: string;
  totals: { sessions: number; pageViews: number; orders: number; conversionPercent: number; pagesPerSession: number };
  funnel: { step: 'visit' | 'product' | 'cart' | 'checkout' | 'purchase'; sessions: number; percentOfVisits: number; dropOffPercent: number }[];
  sources: { source: string; medium: string; sessions: number; carts: number; purchases: number; orders: number; revenueMinor: string; conversionPercent: number }[];
  devices: { device: string; sessions: number; purchases: number; conversionPercent: number }[];
  landingPages: { path: string; sessions: number; purchases: number; conversionPercent: number }[];
  daily: { day: string; sessions: number; orders: number }[];
}

const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['3m', '3 months']] as const;
const STEP: Record<Report['funnel'][number]['step'], string> = {
  visit: 'Visited the shop', product: 'Looked at a product', cart: 'Added to cart', checkout: 'Started checkout', purchase: 'Placed an order',
};
const MEDIUM: Record<string, string> = {
  organic: 'Search', social: 'Social', messaging: 'Messaging', cpc: 'Paid ads', referral: 'Website link', email: 'Email', none: 'Direct', campaign: 'Campaign', unknown: 'App / not tracked',
};
const SOURCE: Record<string, string> = { direct: 'Direct (typed or bookmark)', unknown: 'App / before tracking' };
const DEVICE = { mobile: Smartphone, tablet: Tablet, desktop: Monitor } as Record<string, typeof Monitor>;

/** Where visitors come from and where they drop out. Anonymous: no cookies, no personal data (see the API docs). */
export function TrafficPage() {
  const [f, setF] = useUrlState({ range: '30d' });
  const r = useApi<Report>(`/admin/analytics/traffic?range=${f.range}`);
  const d = r.data;
  const maxDay = Math.max(1, ...(d?.daily.map((x) => x.sessions) ?? [1]));

  return (
    <>
      <PageHeader
        title="Traffic & funnel"
        description="Visits to the website, the steps shoppers take before ordering, and which sources bring sales. Anonymous counts: no cookies and nothing about who visited."
        actions={
          <div className="flex gap-1 rounded-xl bg-ink-100 p-1" role="group" aria-label="Period">
            {RANGES.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setF({ range: v })} aria-pressed={f.range === v} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${f.range === v ? 'bg-white shadow-sm' : 'text-ink-600'}`}>{l}</button>
            ))}
          </div>
        }
      />
      {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="traffic-stats">
        <Stat label="Visits" value={d ? formatNumber(d.totals.sessions) : '…'} sub={d ? `${d.totals.pagesPerSession} pages per visit` : undefined} />
        <Stat label="Orders" value={d ? formatNumber(d.totals.orders) : '…'} sub="all channels" />
        <Stat label="Visits that ordered" value={d ? `${d.totals.conversionPercent}%` : '…'} sub="conversion rate" />
        <Stat label="Page views" value={d ? formatNumber(d.totals.pageViews) : '…'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card title="Shopping funnel" description="How many visits reached each step, and how many left at it." className="xl:col-span-3">
          {!d ? <SkeletonRows cols={1} rows={5} /> : (
            <ol className="space-y-3" data-testid="funnel">
              {d.funnel.map((s, i) => (
                <li key={s.step}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-ink-800">{STEP[s.step]}</span>
                    <span className="tabular text-ink-600">
                      {formatNumber(s.sessions)} <span className="text-ink-400">· {s.percentOfVisits}%</span>
                      {i > 0 && s.dropOffPercent > 0 ? <span className="ms-2 text-xs text-danger-600">−{s.dropOffPercent}% left here</span> : null}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(s.percentOfVisits, s.sessions ? 1 : 0)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Devices" className="xl:col-span-2">
          {!d ? <SkeletonRows cols={1} rows={3} /> : d.devices.length === 0 ? <p className="text-sm text-ink-500">No visits yet.</p> : (
            <ul className="space-y-3">
              {d.devices.map((x) => {
                const I = DEVICE[x.device] ?? Monitor;
                return (
                  <li key={x.device} className="flex items-center gap-3 text-sm">
                    <I className="size-5 text-ink-400" aria-hidden />
                    <span className="flex-1 font-medium capitalize">{x.device}</span>
                    <span className="tabular">{formatNumber(x.sessions)} visits</span>
                    <span className="tabular w-28 whitespace-nowrap text-end text-ink-500">{x.conversionPercent}% ordered</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Where sales come from" description="Visits by source, and the orders and sales each source brought. Orders from the app or placed before tracking started show as “App / before tracking”." className="mt-6" bodyClassName="p-0">
        <Table>
          <thead>
            <tr><th className="th">Source</th><th className="th">Type</th><th className="th text-end">Visits</th><th className="th text-end">Added to cart</th><th className="th text-end">Orders</th><th className="th text-end">Sales</th><th className="th text-end">Conversion</th></tr>
          </thead>
          <tbody data-testid="sources">
            {!d ? <SkeletonRows cols={7} /> : d.sources.map((s) => (
              <tr key={`${s.source}|${s.medium}`}>
                <td className="td font-medium">{SOURCE[s.source] ?? s.source}</td>
                <td className="td text-ink-600">{MEDIUM[s.medium] ?? s.medium}</td>
                <td className="td text-end tabular">{formatNumber(s.sessions)}</td>
                <td className="td text-end tabular">{formatNumber(s.carts)}</td>
                <td className="td text-end tabular">{formatNumber(s.orders)}</td>
                <td className="td text-end tabular">{formatMoney(s.revenueMinor, d.currencyCode)}</td>
                <td className="td text-end tabular">{s.sessions ? `${s.conversionPercent}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {d && !d.sources.length ? <p className="px-5 py-6 text-sm text-ink-500">No visits in this period yet.</p> : null}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Visits per day" description="Bars: visits. Number on top: orders that day.">
          {!d ? <SkeletonRows cols={1} rows={3} /> : (
            <div className="flex h-40 items-end gap-1" role="img" aria-label="Visits per day">
              {d.daily.map((x) => (
                <div key={x.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${x.day}: ${x.sessions} visits, ${x.orders} orders`}>
                  {x.orders ? <span className="mb-0.5 text-center text-[10px] font-semibold text-brand-700 tabular">{x.orders}</span> : null}
                  <div className="rounded-t bg-brand-200 group-hover:bg-brand-400" style={{ height: `${Math.max(2, (x.sessions / maxDay) * 100)}%` }} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Landing pages" description="The first page of each visit." bodyClassName="p-0">
          <Table className="[&_table]:min-w-0">
            <thead><tr><th className="th">Page</th><th className="th text-end">Visits</th><th className="th text-end">Ordered</th></tr></thead>
            <tbody>
              {!d ? <SkeletonRows cols={3} /> : d.landingPages.map((l) => (
                <tr key={l.path}><td className="td max-w-[280px] truncate font-mono text-xs">{l.path}</td><td className="td text-end tabular">{formatNumber(l.sessions)}</td><td className="td text-end tabular">{l.conversionPercent}%</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
