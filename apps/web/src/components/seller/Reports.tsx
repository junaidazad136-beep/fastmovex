'use client';

import { BarChart3 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { Empty, Tabs } from './kit';

interface Overview { orders: number; unitsSold: number; gmvMinor: string; averageOrderValueMinor: string; commissionMinor: string; netEarningsMinor: string; cancelledOrders: number; cancellationRateBps: number }
interface Series { bucket: 'hour' | 'day' | 'week' | 'month'; points: { t: string; orders: number; gmvMinor: string }[] }
interface Top { items: { id: string; name: string; units: number; orders: number; gmvMinor: string }[] }

const RANGES = ['7d', '30d', '3m', '12m'] as const;
type Range = (typeof RANGES)[number];

/** Sales in one place: what sold, what the store earns after commission, the trend, and the best sellers. */
export function SellerReports() {
  const t = useT();
  const toast = useToast();
  const money = useMoney();
  const [range, setRange] = useState<Range>('30d');
  const [data, setData] = useState<{ o: Overview; s: Series; top: Top } | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      const [o, s, top] = await Promise.all([
        api<Overview>(`/seller/analytics/overview?range=${range}`),
        api<Series>(`/seller/analytics/timeseries?range=${range}`),
        api<Top>(`/seller/analytics/top-products?range=${range}&limit=10`),
      ]);
      setData({ o, s, top });
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
  }, [range, toast, t]);
  useEffect(() => { void load(); }, [load]);

  const o = data?.o;
  const tiles = o ? [
    { k: 'sales', v: money(o.gmvMinor), strong: true },
    { k: 'earnings', v: money(o.netEarningsMinor), good: true },
    { k: 'orders', v: o.orders.toLocaleString('en-GB') },
    { k: 'units', v: o.unitsSold.toLocaleString('en-GB') },
    { k: 'average', v: money(o.averageOrderValueMinor) },
    { k: 'commission', v: money(o.commissionMinor) },
    { k: 'cancelled', v: `${o.cancelledOrders} (${(o.cancellationRateBps / 100).toFixed(1)}%)`, warn: o.cancellationRateBps > 500 },
  ] : [];
  const points = data?.s.points ?? [];
  const max = points.reduce((m, p) => (BigInt(p.gmvMinor) > m ? BigInt(p.gmvMinor) : m), 0n);
  const label = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    const fmt: Intl.DateTimeFormatOptions = data?.s.bucket === 'month' ? { month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' };
    return d.toLocaleDateString(t.locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', fmt);
  };

  return (
    <div className="space-y-5" data-testid="seller-reports">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.reports.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('seller.reports.lead')}</p>
      </div>
      <Tabs tabs={RANGES} value={range} onChange={setRange} label={(k) => t(`seller.reports.range.${k}`)} />
      {!data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="report-tiles">
            {tiles.map((x) => (
              <div key={x.k} className={`rounded-2xl border p-4 ${x.strong ? 'border-brand-200 bg-brand-50' : 'border-ink-100 bg-white'}`}>
                <dt className="text-xs text-ink-500">{t(`seller.reports.tile.${x.k}` as 'seller.reports.tile.sales')}</dt>
                <dd className={`tabular mt-1 text-lg font-extrabold ${x.good ? 'text-success-700' : x.warn ? 'text-danger-600' : 'text-ink-900'}`}>{x.v}</dd>
              </div>
            ))}
          </dl>
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">{t('seller.reports.trend')}</h2>
            {max === 0n ? <p className="text-sm text-ink-500">{t('seller.reports.noSales')}</p> : (
              <div className="no-scrollbar overflow-x-auto">
                <ol className="flex h-44 min-w-full items-end gap-1" style={{ minWidth: points.length > 31 ? points.length * 10 : undefined }} aria-label={t('seller.reports.trend')}>
                  {points.map((p) => {
                    const h = Number((BigInt(p.gmvMinor) * 1000n) / max) / 10;
                    return (
                      <li key={p.t} className="group relative flex h-full flex-1 flex-col justify-end" title={`${label(p.t)}: ${money(p.gmvMinor)} · ${p.orders}`}>
                        <span className={`block w-full rounded-t-md ${h > 0 ? 'bg-brand-500 group-hover:bg-brand-700' : 'bg-ink-100'}`} style={{ height: `${Math.max(h, 1.5)}%` }} />
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-2 flex justify-between text-[11px] text-ink-500"><span>{label(points[0].t)}</span><span>{label(points[points.length - 1].t)}</span></div>
              </div>
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">{t('seller.reports.best')}</h2>
            {data.top.items.length === 0 ? (
              <Empty icon={<BarChart3 className="size-6" aria-hidden />} title={t('seller.reports.noSales')} />
            ) : (
              <ol className="divide-y divide-ink-100" data-testid="report-top">
                {data.top.items.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="tabular w-6 shrink-0 text-center font-bold text-ink-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{p.name}</span>
                    <span className="tabular shrink-0 text-ink-500">{t.plural('seller.reports.units', p.units)}</span>
                    <span className="tabular w-24 shrink-0 text-end font-semibold">{money(p.gmvMinor)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <p className="text-xs text-ink-500">{t('seller.reports.note')}</p>
        </>
      )}
    </div>
  );
}
