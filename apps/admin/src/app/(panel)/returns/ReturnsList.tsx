'use client';

import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, Spinner, StatusBadge, Table, Tabs, TextArea } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { formatMoney, timeAgo } from '@/lib/format';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';
import { DoorReturns, PickupBadge, PickupDialog, type Pickup } from './ReturnsLogistics';

interface ReturnRow {
  id: string;
  quantity: number;
  reason: string;
  status: string;
  resolution: string | null;
  condition?: 'SELLABLE' | 'DAMAGED' | 'NOT_ACCEPTED' | null;
  inspectionNote?: string | null;
  receivedAt?: string | null;
  createdAt: string;
  pickup?: Pickup | null;
  user: { id: string; fullName: string; phone: string | null } | null;
  orderItem: {
    productTitle: string;
    sku: string;
    quantity: number;
    unitPriceMinor: string;
    order: { orderNumber: string; currencyCode: string };
    sellerOrder: { seller: { businessName: string; isHouse: boolean } };
  };
}

const TABS = [
  { value: 'REQUESTED', label: 'New requests' },
  { value: 'APPROVED', label: 'Waiting for item' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All' },
  { value: 'DOOR', label: 'Back from the door' },
];

const CONDITION = { SELLABLE: 'Sellable', DAMAGED: 'Damaged', NOT_ACCEPTED: 'Not accepted' } as const;
const CONDITION_HINT = {
  SELLABLE: 'As new: back on the shelf, refund created.',
  DAMAGED: 'Refund created, but kept off sellable stock.',
  NOT_ACCEPTED: 'Not the item sold, or used: no refund, no restock. The customer is told.',
} as const;

/**
 * Return flow: the customer asks → staff approve or reject → the item comes back → "Received" restocks it and
 * creates the refund, which finance approves in Refunds.
 */
export function ReturnsList() {
  const [f, setF, ready] = useUrlState({ status: 'REQUESTED' });
  const door = f.status === 'DOOR';
  const list = useCursorList<ReturnRow>(ready && !door ? `/admin/returns${qs({ status: f.status })}` : null);
  const [pickupFor, setPickupFor] = useState<ReturnRow | null>(null);
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState<{ row: ReturnRow; kind: 'approve' | 'reject' } | null>(null);
  // receiving: what the item looked like decides stock and refund
  const [receiving, setReceiving] = useState<ReturnRow | null>(null);
  const [condition, setCondition] = useState<'SELLABLE' | 'DAMAGED' | 'NOT_ACCEPTED' | ''>('');
  const [inspection, setInspection] = useState('');

  async function receive() {
    if (!receiving || !condition) return;
    const row = receiving;
    const r = await run(
      'received',
      () => api(`/admin/returns/${row.id}/received`, { method: 'POST', body: { condition, note: inspection.trim() || undefined } }),
      condition === 'SELLABLE' ? 'Back in stock; refund created for approval' : condition === 'DAMAGED' ? 'Kept off stock; refund created for approval' : 'Not accepted: no refund, the customer has been told',
    );
    if (r !== undefined) {
      setReceiving(null);
      list.setItems((items) => items?.filter((x) => x.id !== row.id));
      summaryStale();
    }
  }

  async function act(reason: string) {
    if (!confirm) return;
    const { row, kind } = confirm;
    const r = await run(
      kind,
      () => api(`/admin/returns/${row.id}/decision`, { method: 'POST', body: { decision: kind === 'approve' ? 'APPROVED' : 'REJECTED', resolution: reason || undefined } }),
      kind === 'approve' ? 'Return approved. The customer has been told how to send it back.' : 'Return rejected',
    );
    if (r !== undefined) {
      setConfirm(null);
      list.setItems((items) => items?.filter((x) => x.id !== row.id));
      summaryStale();
    }
  }

  return (
    <>
      <PageHeader title="Returns" description="Approve requests, then mark items as received when they are back. Receiving creates the refund." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={TABS} />
        {door ? <DoorReturns /> : <>
        {list.error && !list.items ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table>
            <thead>
              <tr><th className="th">Item</th><th className="th">Customer</th><th className="th">Reason</th><th className="th">Status</th><th className="th text-end">Value</th><th className="th text-end">Actions</th></tr>
            </thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={6} /> : null}
              {list.items?.map((r) => (
                <tr key={r.id} className="align-top hover:bg-ink-25">
                  <td className="td">
                    <p className="font-medium">{r.orderItem.productTitle}</p>
                    <p className="text-xs text-ink-500">
                      {r.orderItem.sku} · {r.quantity} of {r.orderItem.quantity} ·{' '}
                      <Link href={`/orders/${r.orderItem.order.orderNumber}`} className="link">{r.orderItem.order.orderNumber}</Link>
                    </p>
                    {!r.orderItem.sellerOrder.seller.isHouse ? <Badge tone="violet" className="mt-1">{r.orderItem.sellerOrder.seller.businessName}</Badge> : null}
                  </td>
                  <td className="td">{r.user ? <Link href={`/customers/${r.user.id}`} className="hover:text-brand-700">{r.user.fullName}</Link> : '—'}<p className="text-xs text-ink-500">{timeAgo(r.createdAt)}</p></td>
                  <td className="td max-w-xs text-ink-700">
                    {r.reason}{r.resolution ? <p className="mt-1 text-xs text-ink-500">Reply: {r.resolution}</p> : null}
                    {r.condition ? <p className="mt-1 text-xs"><Badge tone={r.condition === 'SELLABLE' ? 'green' : r.condition === 'DAMAGED' ? 'amber' : 'red'}>{CONDITION[r.condition]}</Badge>{r.inspectionNote ? <span className="ms-1 text-ink-500">{r.inspectionNote}</span> : null}</p> : null}
                  </td>
                  <td className="td"><StatusBadge status={r.status} /><PickupBadge p={r.pickup} /></td>
                  <td className="td text-end tabular">{formatMoney((BigInt(r.orderItem.unitPriceMinor) * BigInt(r.quantity)).toString(), r.orderItem.order.currencyCode)}</td>
                  <td className="td text-end">
                    <div className="flex justify-end gap-2">
                      {r.status === 'REQUESTED' ? (
                        <>
                          <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm({ row: r, kind: 'reject' })}>Reject</button>
                          <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => setConfirm({ row: r, kind: 'approve' })}>Approve</button>
                        </>
                      ) : null}
                      {r.status === 'APPROVED' && (!r.pickup || ['FAILED', 'CANCELLED'].includes(r.pickup.status)) ? <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setPickupFor(r)} data-testid="arrange-pickup">Arrange pickup</button> : null}
                      {r.status === 'APPROVED' ? <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => { setReceiving(r); setCondition(''); setInspection(''); }}>Item received</button> : null}
                      {r.receivedAt ? (
                        <button type="button" className="btn-ghost btn-sm" disabled={!!busy} data-testid="return-receipt"
                          onClick={() => run(`rr-${r.id}`, () => openPdf(`/admin/returns/${r.id}/receipt.pdf`, `return-receipt-${r.id.slice(0, 8)}.pdf`))}>
                          <FileText className="size-4" aria-hidden /> Receipt
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="Nothing here" description={f.status === 'REQUESTED' ? 'No new return requests.' : undefined} /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
        </>}
      </Card>
      {pickupFor ? <PickupDialog returnId={pickupFor.id} item={`${pickupFor.quantity} × ${pickupFor.orderItem.productTitle}`} onClose={() => setPickupFor(null)} onDone={() => { setPickupFor(null); list.reload(); }} /> : null}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={confirm?.kind === 'approve' ? 'Approve this return?' : 'Reject this return?'}
        description={confirm?.kind === 'approve' ? 'The customer is told to send the item back.' : undefined}
        reason={confirm?.kind === 'reject' ? { label: 'Reason (sent to the customer)', required: true } : confirm?.kind === 'approve' ? { label: 'Message to the customer (optional)', placeholder: 'e.g. Our courier will collect it on Sunday' } : undefined}
        confirmLabel={confirm?.kind === 'approve' ? 'Approve' : 'Reject'}
        danger={confirm?.kind === 'reject'}
        busy={!!busy}
      />
      <Dialog
        open={!!receiving}
        onClose={() => setReceiving(null)}
        title="Item received back"
        description={receiving ? `${receiving.quantity} × ${receiving.orderItem.productTitle} — check it before choosing.` : undefined}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReceiving(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!condition || (condition !== 'SELLABLE' && inspection.trim().length < 5) || !!busy} onClick={receive} data-testid="receive-confirm">
              {busy ? <Spinner /> : null} Save
            </button>
          </>
        }
      >
        <fieldset className="space-y-2" data-testid="return-condition">
          <legend className="label">What condition is it in?</legend>
          {(Object.keys(CONDITION) as (keyof typeof CONDITION)[]).map((c) => (
            <label key={c} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${condition === c ? 'border-brand-600 bg-brand-50/50' : 'border-ink-200'}`}>
              <input type="radio" name="condition" value={c} checked={condition === c} onChange={() => setCondition(c)} className="mt-0.5 accent-brand-600" />
              <span className="text-sm"><span className="block font-medium">{CONDITION[c]}</span><span className="block text-ink-500">{CONDITION_HINT[c]}</span></span>
            </label>
          ))}
        </fieldset>
        {condition && condition !== 'SELLABLE' ? (
          <TextArea className="mt-3" label="What is wrong with it? (required)" value={inspection} onChange={(e) => setInspection(e.target.value)} rows={2} maxLength={300} placeholder={condition === 'DAMAGED' ? 'e.g. Lid cracked, box crushed' : 'e.g. A different, used item was sent back'} />
        ) : null}
      </Dialog>
    </>
  );
}
