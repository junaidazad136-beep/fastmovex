'use client';

import Link from 'next/link';
import { Card, EmptyState, ErrorState, LoadMore, PageHeader, SearchInput, SkeletonRows, StatusBadge, Table, Tabs } from '@/components/ui';
import { SlotSchedule } from './SlotSchedule';
import type { OrderRow } from '@/lib/api/types';
import { deliveryMethodLabel, formatDateTime, formatMoney, formatSlot, humanize, paymentMethodLabel, timeAgo, todayInQatar } from '@/lib/format';
import { TagBadges } from '@/components/customers/tags';
import { qs, useCursorList, useUrlState } from '@/lib/use-api';
import { useSession } from '@/lib/state/session';

const TABS = [
  { value: '', label: 'All' },
  { value: 'to_fulfil', label: 'To ship' },
  { value: 'PENDING', label: 'Awaiting payment' },
  { value: 'SHIPPED', label: 'Shipped' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'RETURN_REQUESTED', label: 'Return requested' },
  { value: 'CANCELLED', label: 'Cancelled' },
];


export function OrdersList() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ tab: '', q: '', view: '', status: '', date: '' });
  // Links from the dashboard use ?view=to_fulfil or ?status=…; the tabs keep one value.
  const tab = f.tab || (f.view === 'to_fulfil' ? 'to_fulfil' : f.status);
  const list = useCursorList<OrderRow>(
    ready ? `/admin/orders${qs({ q: f.q, view: tab === 'to_fulfil' ? 'to_fulfil' : undefined, status: tab && tab !== 'to_fulfil' ? tab : undefined, slotDate: f.date || undefined })}` : null,
  );

  return (
    <>
      <PageHeader title="Orders" actions={can('orders.create') ? <Link href="/orders/new" className="btn-primary" data-testid="new-phone-order">New phone order</Link> : undefined} />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onChange={(v) => setF({ tab: v, view: '', status: '' })} tabs={TABS} />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <div className="min-w-[240px] flex-1"><SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Order number, customer name, email or phone" /></div>
          <label className="flex items-center gap-2 text-sm text-ink-600">
            Delivery date
            <input type="date" className="input w-auto py-1.5" value={f.date} onChange={(e) => setF({ date: e.target.value })} aria-label="Delivery date" />
          </label>
          {f.date ? <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ date: '' })}>Clear</button> : <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ date: todayInQatar() })}>Today&apos;s deliveries</button>}
        </div>
        {f.date ? <SlotSchedule date={f.date} /> : null}
        {list.error && !list.items ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="th">Order</th>
                <th className="th">Date</th>
                <th className="th">Customer</th>
                <th className="th">Status</th>
                <th className="th">Payment</th>
                <th className="th">Delivery</th>
                <th className="th text-end">Items</th>
                <th className="th text-end">Total</th>
              </tr>
            </thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={8} /> : null}
              {list.items?.map((o) => (
                <tr key={o.id} className="relative hover:bg-ink-25">
                  <td className="td">
                    <Link href={`/orders/${o.orderNumber}`} className="font-medium text-ink-900 after:absolute after:inset-0 hover:text-brand-700">{o.orderNumber}</Link>
                  </td>
                  <td className="td whitespace-nowrap text-ink-600" title={formatDateTime(o.placedAt ?? o.createdAt)}>{timeAgo(o.placedAt ?? o.createdAt)}</td>
                  <td className="td">
                    {o.user?.fullName ?? 'Guest'}
                    <TagBadges tags={o.user?.tags} className="ms-1.5 align-middle" />
                    {o.user?.phone ? <p className="text-xs text-ink-500">{o.user.phone}</p> : null}
                  </td>
                  <td className="td"><StatusBadge status={o.status} /></td>
                  <td className="td text-xs">
                    {o.payment ? (
                      <>
                        <span className="font-medium text-ink-700">{paymentMethodLabel(o.payment.method)}</span>
                        <p className="text-ink-500">{humanize(o.payment.status)}</p>
                      </>
                    ) : '—'}
                  </td>
                  <td className="td text-xs text-ink-600">
                    {o.deliverySlotStart ? <p className="font-medium text-brand-700" data-testid="row-slot">{formatSlot(o.deliverySlotStart, o.deliverySlotEnd)}</p> : null}
                    {[...new Set(o.sellerOrders.map((s) => deliveryMethodLabel(s.deliveryMethod)))].join(', ')}
                    {o._count.sellerOrders > 1 ? <p className="text-ink-400">{o._count.sellerOrders} shipments</p> : null}
                  </td>
                  <td className="td text-end tabular">{o._count.items}</td>
                  <td className="td text-end font-medium tabular">{formatMoney(o.totalMinor, o.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items && list.items.length === 0 ? <EmptyState title="No orders here" description={f.q ? 'Try another search.' : undefined} /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
    </>
  );
}
