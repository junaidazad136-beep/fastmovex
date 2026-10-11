'use client';

import Link from 'next/link';
import { Card, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, StatusBadge, Table, Tabs } from '@/components/ui';
import { humanize, timeAgo } from '@/lib/format';
import { qs, useCursorList, useUrlState } from '@/lib/use-api';

interface Ticket {
  id: string;
  number: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
  user: { fullName: string };
  order: { orderNumber: string } | null;
}

const TABS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'PENDING_CUSTOMER', label: 'Waiting for customer' },
  { value: 'PENDING_SELLER', label: 'Waiting for seller' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
  { value: '', label: 'All' },
];

export function TicketsList() {
  const [f, setF, ready] = useUrlState({ status: 'OPEN', priority: '', assigned: '' });
  const list = useCursorList<Ticket>(ready ? `/admin/tickets${qs({ status: f.status, priority: f.priority, assigned: f.assigned })}` : null);
  return (
    <>
      <PageHeader title="Support tickets" />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={TABS} />
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3">
          <select className="input w-auto" value={f.priority} onChange={(e) => setF({ priority: e.target.value })} aria-label="Priority">
            <option value="">Any priority</option>
            {['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
          <select className="input w-auto" value={f.assigned} onChange={(e) => setF({ assigned: e.target.value })} aria-label="Assignment">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
          </select>
        </div>
        {list.error && !list.items ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead><tr><th className="th">Ticket</th><th className="th">Customer</th><th className="th">Topic</th><th className="th">Priority</th><th className="th">Status</th><th className="th">Updated</th></tr></thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={6} /> : null}
              {list.items?.map((t) => (
                <tr key={t.id} className="relative hover:bg-ink-25">
                  <td className="td">
                    <Link href={`/tickets/${t.id}`} className="font-medium after:absolute after:inset-0 hover:text-brand-700">{t.subject}</Link>
                    <p className="text-xs text-ink-500">{t.number}{t.order ? ` · ${t.order.orderNumber}` : ''}</p>
                  </td>
                  <td className="td">{t.user.fullName}</td>
                  <td className="td text-ink-600">{humanize(t.category)}</td>
                  <td className="td"><StatusBadge status={t.priority} /></td>
                  <td className="td"><StatusBadge status={t.status} /></td>
                  <td className="td text-ink-600">{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No tickets here" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
    </>
  );
}
