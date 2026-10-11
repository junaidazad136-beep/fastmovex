'use client';

import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, ConfirmDialog, EmptyState, ErrorState, LoadMore, PageHeader, SearchInput, SkeletonRows, StatusBadge, Table, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

interface Seller { id: string; businessName: string; contactEmail: string | null; contactPhone: string | null; status: string; createdAt: string; isHouse?: boolean; store: { name: string; slug: string } | null; _count: { documents: number } }

/**
 * FastMoveX launches as a single store; this screen is for when other sellers join the marketplace.
 * Approving lets a seller publish products; suspending hides their store.
 */
export function SellersPage() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ status: '', q: '' });
  const list = useCursorList<Seller>(ready ? `/admin/sellers${qs({ status: f.status, q: f.q })}` : null);
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState<{ s: Seller; kind: 'approve' | 'reject' | 'suspend' | 'reinstate' } | null>(null);

  async function act(reason: string) {
    if (!confirm) return;
    const { s, kind } = confirm;
    const r = await run(kind, () => api(`/admin/sellers/${s.id}/${kind}`, { method: 'POST', body: kind === 'reject' || kind === 'suspend' ? { reason } : undefined }), `Seller ${kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : kind === 'suspend' ? 'suspended' : 'reinstated'}`);
    if (r !== undefined) { setConfirm(null); list.reload(); summaryStale(); }
  }

  return (
    <>
      <PageHeader title="Sellers" description="Other businesses selling on FastMoveX. Your own store is marked FastMoveX." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={[{ value: '', label: 'All' }, { value: 'PENDING', label: 'New' }, { value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'REJECTED', label: 'Rejected' }]} />
        <div className="border-b border-ink-100 p-3"><SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Business name or email" /></div>
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <Table>
            <thead><tr><th className="th">Business</th><th className="th">Contact</th><th className="th">Status</th><th className="th">Applied</th><th className="th text-end">Actions</th></tr></thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={5} /> : null}
              {list.items?.map((s) => (
                <tr key={s.id} className="hover:bg-ink-25">
                  <td className="td"><p className="font-medium">{s.businessName} {s.isHouse ? <Badge tone="brand">FastMoveX</Badge> : null}</p><p className="text-xs text-ink-500">{s.store?.name}{s._count.documents ? ` · ${s._count.documents} documents` : ''}</p></td>
                  <td className="td text-ink-600">{s.contactEmail}<p className="text-xs">{s.contactPhone}</p></td>
                  <td className="td"><StatusBadge status={s.status} /></td>
                  <td className="td text-ink-600">{formatDate(s.createdAt)}</td>
                  <td className="td text-end">
                    <div className="flex justify-end gap-2">
                      {can('sellers.approve') && ['PENDING', 'UNDER_REVIEW'].includes(s.status) ? (
                        <>
                          <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm({ s, kind: 'reject' })}>Reject</button>
                          <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => setConfirm({ s, kind: 'approve' })}>Approve</button>
                        </>
                      ) : null}
                      {can('sellers.suspend') && s.status === 'APPROVED' && !s.isHouse ? <button type="button" className="btn-danger btn-sm" disabled={!!busy} onClick={() => setConfirm({ s, kind: 'suspend' })}>Suspend</button> : null}
                      {can('sellers.suspend') && s.status === 'SUSPENDED' ? <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm({ s, kind: 'reinstate' })}>Reinstate</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No sellers here" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={confirm ? `${confirm.kind.charAt(0).toUpperCase()}${confirm.kind.slice(1)} ${confirm.s.businessName}?` : ''}
        description={confirm?.kind === 'suspend' ? 'Their store and products are hidden at once. Open orders stay.' : confirm?.kind === 'approve' ? 'They can publish products and receive orders.' : undefined}
        reason={confirm?.kind === 'reject' || confirm?.kind === 'suspend' ? { label: 'Reason (sent to the seller)', required: true } : undefined}
        confirmLabel={confirm ? `${confirm.kind.charAt(0).toUpperCase()}${confirm.kind.slice(1)}` : ''}
        danger={confirm?.kind === 'reject' || confirm?.kind === 'suspend'}
        busy={!!busy}
      />
    </>
  );
}
