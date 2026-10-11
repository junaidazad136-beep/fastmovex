'use client';

import { useState } from 'react';
import { Card, Dialog, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, Table } from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { qs, useCursorList, useUrlState } from '@/lib/use-api';

interface Log { id: string; actorId: string | null; actorName: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown; ip: string | null; createdAt: string }

const AREAS = ['', 'product', 'variant', 'order', 'refund', 'return', 'coupon', 'campaign', 'banner', 'category', 'country', 'user', 'staff', 'role', 'auth', 'seller', 'payout'];

/** Every change made through the API, who made it and when. Read-only. */
export function AuditPage() {
  const [f, setF, ready] = useUrlState({ action: '', entityId: '' });
  const list = useCursorList<Log>(ready ? `/admin/audit-logs${qs({ action: f.action, entityId: f.entityId })}` : null);
  const [open, setOpen] = useState<Log | null>(null);
  return (
    <>
      <PageHeader title="Audit log" description="Every change in the admin panel and the API, with who made it. Entries cannot be edited or deleted." />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3">
          <select className="input w-auto" value={f.action} onChange={(e) => setF({ action: e.target.value })} aria-label="Area">
            {AREAS.map((a) => <option key={a} value={a}>{a ? humanize(a) : 'Everything'}</option>)}
          </select>
          <input className="input max-w-xs" value={f.entityId} onChange={(e) => setF({ entityId: e.target.value.trim() })} placeholder="Record id (optional)" aria-label="Record id" />
        </div>
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <Table>
            <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">What</th><th className="th">Record</th></tr></thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={4} /> : null}
              {list.items?.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-ink-25" onClick={() => setOpen(l)}>
                  <td className="td whitespace-nowrap text-ink-600">{formatDateTime(l.createdAt)}</td>
                  <td className="td">{l.actorName ?? (l.actorId ? 'Deleted user' : 'System')}</td>
                  <td className="td"><button type="button" className="text-start font-medium hover:text-brand-700" onClick={() => setOpen(l)}>{humanize(l.action)}</button></td>
                  <td className="td text-xs text-ink-500">{humanize(l.entityType)}{l.entityId ? ` · ${l.entityId.slice(0, 8)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No entries" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? humanize(open.action) : ''} description={open ? `${open.actorName ?? 'System'} · ${formatDateTime(open.createdAt)}${open.ip ? ` · ${open.ip}` : ''}` : undefined} size="lg">
        {open ? (
          <div className="space-y-3 text-sm">
            <p className="text-ink-600">{humanize(open.entityType)} <code className="rounded bg-ink-100 px-1 text-xs">{open.entityId}</code></p>
            {open.before ? <div><p className="label">Before</p><pre className="overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs">{JSON.stringify(open.before, null, 2)}</pre></div> : null}
            {open.after ? <div><p className="label">After</p><pre className="overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs">{JSON.stringify(open.after, null, 2)}</pre></div> : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
