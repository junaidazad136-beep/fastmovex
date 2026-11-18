'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, ConfirmDialog, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, StatusBadge, Table, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

type Status = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'IN_REPAIR' | 'RESOLVED';
type Resolution = 'REPAIRED' | 'REPLACED' | 'REFUNDED';
interface Claim {
  id: string; status: Status; resolution: Resolution | null; note: string | null; description: string; images: string[];
  warrantyEndsOn: string; dueAt: string | null; createdAt: string; overdue: boolean;
  orderItem: { productTitle: string; sku: string; order: { orderNumber: string } };
  seller?: { businessName: string }; user?: { fullName: string; phone: string | null };
}

const TABS = [
  { value: 'REQUESTED', label: 'New' },
  { value: 'ACCEPTED', label: 'To collect' },
  { value: 'IN_REPAIR', label: 'In repair' },
  { value: 'RESOLVED', label: 'Closed' },
  { value: '', label: 'All' },
];
const LABEL: Record<Status, string> = { REQUESTED: 'New', ACCEPTED: 'Accepted', REJECTED: 'Not covered', IN_REPAIR: 'In repair', RESOLVED: 'Closed' };

/**
 * Warranty claims across all sellers (policy: after the first 7 days, during the warranty; repaired within 14 days).
 * Staff can take every step a seller can, e.g. for FastMoveX's own store or when a seller does not answer.
 * A refund outcome is recorded here; the money itself goes through Refunds (manual refund) as usual.
 */
export function WarrantyList() {
  const [f, setF, ready] = useUrlState({ status: 'REQUESTED' });
  const list = useCursorList<Claim>(ready ? `/admin/warranty${qs({ status: f.status })}` : null);
  const { busy, run } = useAction();
  const [dlg, setDlg] = useState<{ c: Claim; to: 'REJECTED' | 'REPAIRED' | 'REPLACED' | 'REFUNDED' } | null>(null);

  async function step(c: Claim, body: { status: Status; resolution?: Resolution; note?: string }) {
    const r = await run(c.id, () => api(`/admin/warranty/${c.id}/step`, { method: 'POST', body }), 'Saved — the customer is told');
    if (r) { setDlg(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Warranty" description="Faults reported after the first 7 days, during the warranty. Accept → collect → repaired, replaced or refunded within 14 days." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={TABS} />
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <Table>
            <thead>
              <tr><th className="th">Order</th><th className="th">Item and fault</th><th className="th">Seller / customer</th><th className="th">Status</th><th className="th text-end">Actions</th></tr>
            </thead>
            <tbody>
            {!list.items ? <SkeletonRows cols={5} /> : null}
            {list.items?.map((c) => (
              <tr key={c.id} className={c.overdue ? 'bg-danger-50/40' : undefined}>
                <td className="td"><Link href={`/orders/${c.orderItem.order.orderNumber}`} className="font-medium hover:text-brand-700">{c.orderItem.order.orderNumber}</Link><p className="text-xs text-ink-500" title={formatDateTime(c.createdAt)}>{timeAgo(c.createdAt)}</p></td>
                <td className="td max-w-sm">
                  <p className="font-medium text-ink-800">{c.orderItem.productTitle}</p>
                  <p className="text-sm text-ink-600" dir="auto">{c.description}</p>
                  <div className="mt-1 flex gap-1.5">{c.images.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="link text-xs">photo</a>)}{!c.images.length && <span className="text-xs text-warning-600">no photos yet</span>}</div>
                  {c.note && <p className="mt-1 text-xs text-ink-500">Told the customer: {c.note}</p>}
                </td>
                <td className="td text-sm text-ink-600">{c.seller?.businessName}<p className="text-xs text-ink-500">{c.user?.fullName} {c.user?.phone ?? ''}</p><p className="text-xs text-ink-400">Warranty until {formatDate(c.warrantyEndsOn)}</p></td>
                <td className="td">
                  <StatusBadge status={c.status} label={c.status === 'RESOLVED' && c.resolution ? c.resolution.charAt(0) + c.resolution.slice(1).toLowerCase() : LABEL[c.status]} />
                  {c.dueAt && (c.status === 'ACCEPTED' || c.status === 'IN_REPAIR') && <p className={`mt-1 text-xs ${c.overdue ? 'font-semibold text-danger-600' : 'text-ink-500'}`}>{c.overdue ? 'Late (over 14 days)' : `Due ${formatDate(c.dueAt)}`}</p>}
                </td>
                <td className="td text-end">
                  <div className="flex flex-wrap justify-end gap-2">
                    {c.status === 'REQUESTED' && <>
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setDlg({ c, to: 'REJECTED' })}>Not covered</button>
                      <button type="button" className="btn-primary btn-sm" disabled={!!busy || !c.images.length} title={c.images.length ? undefined : 'Wait for photos'} onClick={() => void step(c, { status: 'ACCEPTED' })}>Accept</button>
                    </>}
                    {c.status === 'ACCEPTED' && <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => void step(c, { status: 'IN_REPAIR' })}>Collected</button>}
                    {(c.status === 'ACCEPTED' || c.status === 'IN_REPAIR') && <>
                      <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => setDlg({ c, to: 'REPAIRED' })}>Repaired</button>
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setDlg({ c, to: 'REPLACED' })}>Replaced</button>
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setDlg({ c, to: 'REFUNDED' })}>Refunded</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No warranty claims here" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
      <ConfirmDialog
        open={!!dlg} onClose={() => setDlg(null)} busy={!!busy}
        title={dlg?.to === 'REJECTED' ? 'Not covered by the warranty' : `Mark as ${dlg?.to.toLowerCase()}`}
        description={dlg?.to === 'REFUNDED' ? 'Records the outcome. Send the money from Refunds (manual refund) as usual.' : 'The customer is told by message.'}
        reason={{ label: dlg?.to === 'REJECTED' ? 'Why (the customer reads this)' : 'Note for the customer (optional)', required: dlg?.to === 'REJECTED' }}
        danger={dlg?.to === 'REJECTED'}
        confirmLabel={dlg?.to === 'REJECTED' ? 'Not covered' : 'Save'}
        onConfirm={(text) => dlg && void step(dlg.c, dlg.to === 'REJECTED' ? { status: 'REJECTED', note: text } : { status: 'RESOLVED', resolution: dlg.to as Resolution, ...(text.trim() && { note: text.trim() }) })}
      />
    </>
  );
}
