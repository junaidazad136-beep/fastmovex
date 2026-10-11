'use client';

import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Card, ConfirmDialog, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, StatusBadge, Table, Tabs } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { formatDateTime, formatMoney, paymentMethodLabel, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

interface Refund {
  id: string;
  amountMinor: string;
  reason: string | null;
  status: string;
  providerRef: string | null;
  createdAt: string;
  completedAt: string | null;
  creditNoteNo?: string | null;
  order: { orderNumber: string; currencyCode: string };
  payment: { method: string; provider: string };
  createdBy?: { id: string; fullName: string } | null;
  approvedBy?: { id: string; fullName: string } | null;
}

const TABS = [
  { value: 'PENDING', label: 'To approve' },
  { value: 'PROCESSING', label: 'In progress' },
  { value: 'SUCCEEDED', label: 'Paid' },
  { value: 'FAILED', label: 'Failed' },
  { value: '', label: 'All' },
];

/**
 * Card / Apple Pay refunds go back through the payment gateway on approval. Cash-on-delivery refunds are paid by
 * bank transfer: approve, send the money, then "Mark as paid" with the transfer reference.
 */
export function RefundsList() {
  const { can, user } = useSession();
  // four-eyes: the API refuses it too; the button says why up front
  const isOwn = (r: Refund) => !!user && r.createdBy?.id === user.id && !user.roles.includes('SUPER_ADMIN');
  // per-person ceiling (Staff page); the API enforces it as well
  const overLimit = (r: Refund) => !!user?.refundLimitMinor && BigInt(r.amountMinor) > BigInt(user.refundLimitMinor);
  const [f, setF, ready] = useUrlState({ status: 'PENDING' });
  const list = useCursorList<Refund>(ready ? `/admin/refunds${qs({ status: f.status })}` : null);
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState<{ row: Refund; kind: 'approve' | 'reject' | 'paid' } | null>(null);
  const approver = can('refunds.approve');

  async function act(text: string) {
    if (!confirm) return;
    const { row, kind } = confirm;
    const r = await run(
      kind,
      () => api<Refund>(`/admin/refunds/${row.id}/${kind === 'approve' ? 'approve' : kind === 'reject' ? 'reject' : 'mark-paid'}`, {
        method: 'POST',
        body: kind === 'reject' ? { reason: text } : kind === 'paid' ? { reference: text } : undefined,
      }),
      (res) => (kind === 'approve' ? (res.status === 'SUCCEEDED' ? 'Refund sent to the customer' : 'Approved. Pay it by bank transfer, then mark it as paid.') : kind === 'reject' ? 'Refund rejected' : 'Refund marked as paid'),
    );
    if (r !== undefined) {
      setConfirm(null);
      list.reload();
      summaryStale();
    }
  }

  return (
    <>
      <PageHeader title="Refunds" description="Card payments are refunded automatically on approval. Cash-on-delivery refunds are paid by transfer and then marked as paid." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={TABS} />
        {list.error && !list.items ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead>
              <tr><th className="th">Order</th><th className="th">Reason</th><th className="th">Payment</th><th className="th">Status</th><th className="th text-end">Amount</th><th className="th text-end">Actions</th></tr>
            </thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={6} /> : null}
              {list.items?.map((r) => (
                <tr key={r.id} className="hover:bg-ink-25">
                  <td className="td"><Link href={`/orders/${r.order.orderNumber}`} className="font-medium hover:text-brand-700">{r.order.orderNumber}</Link><p className="text-xs text-ink-500" title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</p></td>
                  <td className="td max-w-xs text-ink-700">
                    {r.reason ?? '—'}
                    <p className="text-xs text-ink-400">{r.createdBy ? `Asked by ${r.createdBy.fullName}` : 'Automatic'}{r.approvedBy ? ` · approved by ${r.approvedBy.fullName}` : ''}</p>
                  </td>
                  <td className="td text-ink-600">{paymentMethodLabel(r.payment.method)}{r.providerRef ? <p className="max-w-40 truncate text-xs text-ink-400" title={r.providerRef}>{r.providerRef}</p> : null}</td>
                  <td className="td"><StatusBadge status={r.status} label={r.status === 'SUCCEEDED' ? 'Paid' : undefined} /></td>
                  <td className="td text-end font-medium tabular">{formatMoney(r.amountMinor, r.order.currencyCode)}</td>
                  <td className="td text-end">
                    {approver ? (
                      <div className="flex justify-end gap-2">
                        {r.status === 'PENDING' ? (
                          <>
                            <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm({ row: r, kind: 'reject' })}>Reject</button>
                            {isOwn(r)
                              ? <span className="self-center text-xs text-ink-500" title="Four-eyes rule: a different person approves refunds" data-testid="own-refund">Needs another approver</span>
                              : overLimit(r)
                              ? <span className="self-center text-xs text-ink-500" title={`Your approval limit is ${formatMoney(user!.refundLimitMinor!, r.order.currencyCode)}`} data-testid="over-limit">Above your limit — a manager approves</span>
                              : <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => setConfirm({ row: r, kind: 'approve' })}>Approve</button>}
                          </>
                        ) : null}
                        {r.status === 'PROCESSING' && !isOwn(r) ? <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => setConfirm({ row: r, kind: 'paid' })}>Mark as paid</button> : null}
                      </div>
                    ) : null}
                    {r.creditNoteNo ? (
                      <button type="button" className="btn-ghost btn-sm" disabled={!!busy} data-testid="credit-note"
                        onClick={() => run(`cn-${r.id}`, () => openPdf(`/admin/refunds/${r.id}/credit-note.pdf`, `${r.creditNoteNo}.pdf`))}>
                        <FileText className="size-4" aria-hidden /> {r.creditNoteNo}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title={f.status === 'PENDING' ? 'No refunds waiting' : 'Nothing here'} /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={confirm?.kind === 'approve' ? `Refund ${confirm ? formatMoney(confirm.row.amountMinor, confirm.row.order.currencyCode) : ''}?` : confirm?.kind === 'reject' ? 'Reject this refund?' : 'Mark as paid'}
        description={
          confirm?.kind === 'approve'
            ? confirm.row.payment.method === 'COD'
              ? 'Cash on delivery: after approving, send the money by bank transfer and then mark it as paid.'
              : `The money goes back to the customer's ${paymentMethodLabel(confirm.row.payment.method)} now. This cannot be undone.`
            : undefined
        }
        reason={confirm?.kind === 'reject' ? { label: 'Reason', required: true } : confirm?.kind === 'paid' ? { label: 'Transfer reference', required: true, placeholder: 'e.g. bank transfer number' } : undefined}
        confirmLabel={confirm?.kind === 'approve' ? 'Approve refund' : confirm?.kind === 'reject' ? 'Reject' : 'Mark as paid'}
        danger={confirm?.kind === 'reject'}
        busy={!!busy}
      />
    </>
  );
}
