'use client';

import { AlertTriangle, ArrowRight, Banknote, Boxes, LifeBuoy, Truck, MessageCircleQuestion, MessageSquareText, Package, Receipt, RotateCcw, ShoppingBag, Store, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SalesChart } from '@/components/charts/SalesChart';
import { Card, ErrorState, PageHeader, Stat, StatusBadge, Table } from '@/components/ui';
import type { SummaryKey } from '@/components/layout/nav';
import type { CursorPage, OrderRow, Overview, Timeseries, TopItems } from '@/lib/api/types';
import { formatBps, formatMoney, formatNumber, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useApi } from '@/lib/use-api';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '3m', label: '3 months' },
  { value: '12m', label: '12 months' },
] as const;

type Summary = Partial<Record<SummaryKey | 'ordersToday' | 'draftProducts' | 'customers' | 'newCustomers7d', number>>;

const ATTENTION: { key: SummaryKey; label: (n: number) => string; href: string; icon: LucideIcon; tone?: 'danger' }[] = [
  { key: 'shipmentsToFulfil', label: (n) => `${n} ${n === 1 ? 'shipment' : 'shipments'} to prepare and send`, href: '/orders?view=to_fulfil', icon: ShoppingBag },
  { key: 'cashOverdue', label: (n) => `${n} ${n === 1 ? 'person has' : 'people have'} held cash for over a day`, href: '/cash', icon: Banknote, tone: 'danger' },
  { key: 'outOfStockVariants', label: (n) => `${n} ${n === 1 ? 'item is' : 'items are'} out of stock`, href: '/inventory?stock=out', icon: Boxes, tone: 'danger' },
  { key: 'lowStockVariants', label: (n) => `${n} ${n === 1 ? 'item is' : 'items are'} running low`, href: '/inventory?stock=low', icon: AlertTriangle },
  { key: 'openReturns', label: (n) => `${n} ${n === 1 ? 'return' : 'returns'} to handle`, href: '/returns', icon: RotateCcw },
  { key: 'refundsToApprove', label: (n) => `${n} ${n === 1 ? 'refund' : 'refunds'} waiting for approval`, href: '/refunds?status=PENDING', icon: Receipt },
  { key: 'openTickets', label: (n) => `${n} open support ${n === 1 ? 'ticket' : 'tickets'}`, href: '/tickets', icon: LifeBuoy },
  { key: 'reviewsPending', label: (n) => `${n} ${n === 1 ? 'review' : 'reviews'} to moderate`, href: '/reviews', icon: MessageSquareText },
  { key: 'deliveriesToAssign', label: (n) => `${n} ${n === 1 ? 'delivery needs' : 'deliveries need'} a driver`, href: '/deliveries', icon: Truck },
  { key: 'questionsPending', label: (n) => `${n} product ${n === 1 ? 'question' : 'questions'} to answer`, href: '/questions', icon: MessageCircleQuestion },
  { key: 'productsPendingReview', label: (n) => `${n} ${n === 1 ? 'product' : 'products'} waiting for approval`, href: '/products?status=PENDING_REVIEW', icon: Package },
  { key: 'ordersAwaitingPayment', label: (n) => `${n} ${n === 1 ? 'order' : 'orders'} awaiting payment`, href: '/orders?status=PENDING', icon: Receipt },
  { key: 'sellersPending', label: (n) => `${n} seller ${n === 1 ? 'application' : 'applications'}`, href: '/sellers?status=PENDING', icon: Store },
];

export function Dashboard() {
  const { user, can } = useSession();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d');
  const analytics = can('analytics.read');
  const summary = useApi<Summary>('/admin/dashboard/summary');
  const overview = useApi<Overview>(analytics ? `/admin/analytics/overview?range=${range}` : null);
  const series = useApi<Timeseries>(analytics ? `/admin/analytics/timeseries?range=${range}` : null);
  const top = useApi<TopItems>(analytics ? `/admin/analytics/top?range=${range}&kind=products&limit=5` : null);
  const topCats = useApi<TopItems>(analytics ? `/admin/analytics/top?range=${range}&kind=categories&limit=5` : null);
  const orders = useApi<CursorPage<OrderRow>>(can('orders.read') ? '/admin/orders' : null);

  const s = summary.data ?? {};
  const o = overview.data;
  const cur = o?.currencyCode ?? 'QAR';
  const attention = ATTENTION.filter((a) => (s[a.key] ?? 0) > 0);
  const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Qatar' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.fullName.split(' ')[0] ?? ''}`}
        description="Here is how the store is doing."
        actions={
          analytics ? (
            <div className="flex rounded-lg border border-ink-200 bg-white p-0.5" role="group" aria-label="Period">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  aria-pressed={range === r.value}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${range === r.value ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null
        }
      />

      {analytics ? (
        overview.error ? (
          <ErrorState error={overview.error} onRetry={overview.reload} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={o ? formatMoney(o.gmvMinor, cur, { compact: true }) : '…'} sub={o ? `${formatNumber(o.orders)} ${o.orders === 1 ? 'order' : 'orders'}` : undefined} />
            <Stat label="Average order" value={o ? formatMoney(o.averageOrderValueMinor, cur) : '…'} sub={o ? `${formatNumber(o.buyers)} ${o.buyers === 1 ? 'buyer' : 'buyers'}` : undefined} />
            <Stat label="New customers" value={o ? formatNumber(o.newCustomers) : '…'} sub={s.customers !== undefined ? `${formatNumber(s.customers)} in total` : undefined} href={can('users.read') ? '/customers' : undefined} />
            <Stat
              label="Refunds"
              value={o ? formatMoney(o.refunds.amountMinor, cur, { compact: true }) : '…'}
              sub={o ? `${o.refunds.count} · ${formatBps(o.refunds.rateBps)} of sales` : undefined}
              tone={o && o.refunds.rateBps > 500 ? 'warn' : undefined}
            />
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {s.ordersToday !== undefined ? <Stat label="Orders today" value={formatNumber(s.ordersToday)} href="/orders" /> : null}
          {s.shipmentsToFulfil !== undefined ? <Stat label="To ship" value={formatNumber(s.shipmentsToFulfil)} href="/orders?view=to_fulfil" /> : null}
          {s.lowStockVariants !== undefined ? <Stat label="Low stock" value={formatNumber(s.lowStockVariants)} href="/inventory?stock=low" tone={s.lowStockVariants ? 'warn' : undefined} /> : null}
          {s.outOfStockVariants !== undefined ? <Stat label="Out of stock" value={formatNumber(s.outOfStockVariants)} href="/inventory?stock=out" tone={s.outOfStockVariants ? 'danger' : undefined} /> : null}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {analytics ? (
            <Card title="Sales" description={series.data ? `Revenue per ${series.data.bucket}, Qatar time` : undefined}>
              {series.data ? <SalesChart points={series.data.points} bucket={series.data.bucket} currency={series.data.currencyCode} /> : <div className="skeleton h-[220px] w-full" />}
            </Card>
          ) : null}

          {can('orders.read') ? (
            <Card title="Latest orders" actions={<Link href="/orders" className="link text-sm">All orders</Link>} bodyClassName="p-0">
              <Table>
                <thead>
                  <tr><th className="th">Order</th><th className="th">Customer</th><th className="th">Status</th><th className="th">Payment</th><th className="th text-end">Total</th></tr>
                </thead>
                <tbody>
                  {(orders.data?.items ?? []).slice(0, 6).map((r) => (
                    <tr key={r.id} className="hover:bg-ink-25">
                      <td className="td">
                        <Link href={`/orders/${r.orderNumber}`} className="font-medium text-ink-900 hover:text-brand-700">{r.orderNumber}</Link>
                        <p className="text-xs text-ink-500">{timeAgo(r.placedAt ?? r.createdAt)}</p>
                      </td>
                      <td className="td">{r.user?.fullName ?? 'Guest'}</td>
                      <td className="td"><StatusBadge status={r.status} /></td>
                      <td className="td text-xs text-ink-600">{r.payment ? `${r.payment.method.replace('_', ' ')} · ${r.payment.status.toLowerCase()}` : '—'}</td>
                      <td className="td text-end font-medium tabular">{formatMoney(r.totalMinor, r.currencyCode)}</td>
                    </tr>
                  ))}
                  {orders.data && orders.data.items.length === 0 ? (
                    <tr><td className="td py-10 text-center text-ink-500" colSpan={5}>No orders yet.</td></tr>
                  ) : null}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card title="Needs your attention" bodyClassName="p-2">
            {summary.data && attention.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-500">All caught up. Nothing is waiting.</p>
            ) : (
              <ul>
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link href={a.href} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-ink-50">
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${a.tone === 'danger' ? 'bg-danger-50 text-danger-600' : 'bg-brand-50 text-brand-600'}`}>
                        <a.icon className="size-4" aria-hidden />
                      </span>
                      <span className="flex-1 text-ink-800">{a.label(s[a.key] ?? 0)}</span>
                      <ArrowRight className="size-4 text-ink-300 group-hover:text-ink-600" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {analytics ? (
            <>
              <TopList title="Best-selling products" data={top.data} hrefBase="/products/" />
              <TopList title="Top categories" data={topCats.data} />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function TopList({ title, data, hrefBase }: { title: string; data: TopItems | undefined; hrefBase?: string }) {
  const max = Math.max(1, ...(data?.items ?? []).map((i) => Number(BigInt(i.gmvMinor) / 100n)));
  return (
    <Card title={title}>
      {!data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-8" />)}</div>
      ) : data.items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">No sales in this period.</p>
      ) : (
        <ol className="space-y-3">
          {data.items.map((i) => (
            <li key={i.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {hrefBase ? <Link href={`${hrefBase}${i.id}`} className="truncate text-ink-800 hover:text-brand-700">{i.name}</Link> : <span className="truncate text-ink-800">{i.name}</span>}
                <span className="shrink-0 font-medium tabular">{formatMoney(i.gmvMinor, data.currencyCode, { compact: true })}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(Number(BigInt(i.gmvMinor) / 100n) / max) * 100}%` }} />
                </div>
                <span className="w-16 text-end text-xs text-ink-500 tabular">{formatNumber(i.units)} sold</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
