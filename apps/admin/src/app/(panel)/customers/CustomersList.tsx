'use client';

import Link from 'next/link';
import { Card, EmptyState, ErrorState, LoadMore, PageHeader, SearchInput, SkeletonRows, StatusBadge, Table, Tabs } from '@/components/ui';
import { formatDate, formatNumber, timeAgo } from '@/lib/format';
import { TagBadges, tagLabel } from '@/components/customers/tags';
import { qs, useApi, useCursorList, useUrlState } from '@/lib/use-api';

interface Customer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { orders: number };
  roles: string[];
  isGuest?: boolean;
  tags?: string[];
}
interface TagsInUse { suggested: string[]; inUse: { tag: string; customers: number }[] }

export function CustomersList() {
  const [f, setF, ready] = useUrlState({ q: '', status: '', tag: '' });
  const list = useCursorList<Customer>(ready ? `/admin/users${qs({ q: f.q, status: f.status, tag: f.tag })}` : null);
  const tags = useApi<TagsInUse>('/admin/customer-tags');
  const options = [...new Set([...(tags.data?.inUse.map((t) => t.tag) ?? []), ...(tags.data?.suggested ?? []), ...(f.tag ? [f.tag] : [])])];
  return (
    <>
      <PageHeader title="Customers" />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={[{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Name, email or phone" className="min-w-[220px] flex-1" />
          <select className="input w-auto py-1.5" value={f.tag} onChange={(e) => setF({ tag: e.target.value })} aria-label="Tag" data-testid="tag-filter">
            <option value="">All tags</option>
            {options.map((t) => {
              const n = tags.data?.inUse.find((x) => x.tag === t)?.customers;
              return <option key={t} value={t}>{tagLabel(t)}{n ? ` (${n})` : ''}</option>;
            })}
          </select>
        </div>
        {list.error && !list.items ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead>
              <tr><th className="th">Customer</th><th className="th">Contact</th><th className="th">Status</th><th className="th text-end">Orders</th><th className="th">Joined</th><th className="th">Last sign-in</th></tr>
            </thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={6} /> : null}
              {list.items?.map((c) => (
                <tr key={c.id} className="relative hover:bg-ink-25">
                  <td className="td">
                    <Link href={`/customers/${c.id}`} className="font-medium after:absolute after:inset-0 hover:text-brand-700">{c.fullName}</Link>
                    {c.isGuest ? <span className="ms-2 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">Guest</span> : null}
                    <TagBadges tags={c.tags} className="ms-2 align-middle" />
                    {c.roles.some((r) => r !== 'CUSTOMER') ? <p className="text-xs text-ink-500">{c.roles.filter((r) => r !== 'CUSTOMER').map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}</p> : null}
                  </td>
                  <td className="td text-ink-600">{c.email}{c.phone ? <p className="text-xs">{c.phone}</p> : null}</td>
                  <td className="td"><StatusBadge status={c.status} /></td>
                  <td className="td text-end tabular">{formatNumber(c._count.orders)}</td>
                  <td className="td text-ink-600">{formatDate(c.createdAt)}</td>
                  <td className="td text-ink-600">{c.isGuest ? '—' : c.lastLoginAt ? timeAgo(c.lastLoginAt) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No customers found" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
    </>
  );
}
