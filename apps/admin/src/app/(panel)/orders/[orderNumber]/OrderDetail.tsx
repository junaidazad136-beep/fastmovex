'use client';

import { Ban, FileText, PackageCheck, Printer, Receipt, Tag, Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { ShipmentWarehouse } from '@/components/orders/ShipmentWarehouse';
import { OrderNotesCard, PinnedCustomerNote } from '@/components/orders/OrderNotes';
import { OrderChangeActions, OrderChangesCard, PlacedByBadge, type OrderChangeRow } from '@/components/orders/OrderChanges';
import { TagBadges } from '@/components/customers/tags';
import { Badge, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, KeyValue, Loading, MoneyField, PageHeader, Spinner, StatusBadge, TextArea, TextField, Thumb } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { errorMessage, isNotFound } from '@/lib/api/errors';
import { decimalToMinor, deliveryMethodLabel, formatAddress, formatDateTime, formatMoney, formatSlot, humanize, paymentMethodLabel } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';

export interface OrderItem {
  id: string;
  productTitle: string;
  sku: string;
  imageUrl: string | null;
  unitPriceMinor: string;
  quantity: number;
  discountMinor: string;
  lineTotalMinor: string;
  commissionMinor: string;
  refundedQty: number;
  status: string;
}

export interface Shipment {
  id: string;
  status: string;
  deliveryMethod: string;
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  taxMinor: string;
  commissionMinor: string;
  sellerNetMinor: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  seller: { id: string; businessName: string; legalName: string | null; commercialRegNo: string | null; taxNumber: string | null; isHouse: boolean; store: { slug: string; name: string; nameAr: string | null } | null };
  items: OrderItem[];
  delivery: {
    status: string; method?: string; courierName: string | null; courierPhone: string | null; trackingUrl: string | null; etaAt: string | null; deliveredAt: string | null; failureReason: string | null; attempts: number;
    /** FastMoveX driver delivery: the customer holds a code (staff never see it) */ hasCode?: boolean; overrideReason?: string | null;
  } | null;
}

export interface OrderDetailData {
  id: string;
  orderNumber: string;
  status: string;
  currencyCode: string;
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  taxMinor: string;
  totalMinor: string;
  shippingAddress: Record<string, unknown> | null;
  deliverySlotStart?: string | null;
  deliverySlotEnd?: string | null;
  customerNote: string | null;
  placedAt: string | null;
  createdAt: string;
  user: { id: string; fullName: string; email: string | null; phone: string | null; tags?: string[] } | null;
  sellerOrders: Shipment[];
  payments: { id: string; provider: string; method: string; status: string; amountMinor: string; refundedMinor: string; providerRef: string | null; failureReason: string | null; createdAt: string }[];
  refunds: { id: string; status: string; amountMinor: string; reason: string | null; createdAt: string; creditNoteNo?: string | null }[];
  coupon: { code: string } | null;
  history: { id: string; sellerOrderId: string | null; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
  changes?: OrderChangeRow[];
  placedBy?: { id: string; name: string | null } | null;
  editable?: boolean;
}

/** Next steps staff can take for a shipment, in the order they happen (cancel is a separate, confirmed action). */
const NEXT: Record<string, { to: string; label: string }[]> = {
  CONFIRMED: [{ to: 'PREPARING', label: 'Start preparing' }],
  PREPARING: [{ to: 'SHIPPED', label: 'Mark as shipped' }, { to: 'READY_FOR_PICKUP', label: 'Ready for pickup' }],
  READY_FOR_PICKUP: [{ to: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }, { to: 'SHIPPED', label: 'Mark as shipped' }],
  SHIPPED: [{ to: 'DELIVERED', label: 'Mark as delivered' }, { to: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }],
  OUT_FOR_DELIVERY: [{ to: 'DELIVERED', label: 'Mark as delivered' }],
};
const CANCELLABLE = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];

export function OrderDetail({ orderNumber }: { orderNumber: string }) {
  const { can } = useSession();
  const toast = useToast();
  const order = useApi<OrderDetailData>(`/admin/orders/${encodeURIComponent(orderNumber)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const docs = useAction();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [step, setStep] = useState<{ shipment: Shipment; to: string; label: string } | null>(null);
  const [note, setNote] = useState('');
  // closing a FastMoveX-driver delivery: the customer's code, or (managers) a written reason
  const [code, setCode] = useState('');
  const [noCode, setNoCode] = useState(false);
  const [refundFor, setRefundFor] = useState<Shipment | null>(null);
  const [refund, setRefund] = useState({ amount: '', reason: '' });

  if (isNotFound(order.error)) return <EmptyState title="Order not found" action={<Link href="/orders" className="btn-secondary">Back to orders</Link>} />;
  if (order.error && !order.data) return <ErrorState error={order.error} onRetry={order.reload} />;
  if (!order.data) return <Loading />;
  const o = order.data;
  const cur = o.currencyCode;
  const payment = o.payments[0];
  const canCancelOrder = can('orders.cancel') && o.sellerOrders.some((s) => CANCELLABLE.includes(s.status));

  const needsCode = !!step && step.to === 'DELIVERED' && step.shipment.delivery?.method === 'JOVIA';
  async function setStatus() {
    if (!step) return;
    if (needsCode && !noCode && !/^\d{4}$/.test(code)) { toast.error('Enter the 4-digit code the customer received'); return; }
    if (needsCode && noCode && note.trim().length < 10) { toast.error('Write why the code is not available (at least 10 characters)'); return; }
    setBusy('status');
    try {
      const body = needsCode
        ? (noCode ? { status: step.to, overrideReason: note.trim() } : { status: step.to, code })
        : { status: step.to, note: note.trim() || undefined };
      const next = await api<OrderDetailData>(`/admin/orders/shipments/${step.shipment.id}/status`, { method: 'POST', body });
      order.setData(next);
      toast.success(`Shipment ${humanize(step.to).toLowerCase()}`);
      summaryStale();
      setStep(null);
      setNote('');
      setCode('');
      setNoCode(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(reason: string) {
    setBusy('cancel');
    try {
      await api(`/admin/orders/${encodeURIComponent(o.orderNumber)}/cancel`, { method: 'POST', body: { reason } });
      toast.success('Order cancelled. Stock was released and any payment is being refunded.');
      setCancelOpen(false);
      summaryStale();
      order.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function createRefund() {
    if (!refundFor) return;
    const amountMinor = decimalToMinor(refund.amount);
    if (!amountMinor || amountMinor === '0') return toast.error('Enter the amount to refund, e.g. 49.50');
    if (refund.reason.trim().length < 3) return toast.error('Give a reason for the refund');
    setBusy('refund');
    try {
      await api('/admin/refunds', { method: 'POST', body: { orderNumber: o.orderNumber, sellerOrderId: refundFor.id, amountMinor, reason: refund.reason.trim() } });
      toast.success(can('refunds.approve') ? 'Refund created. Approve it in Refunds to pay it out.' : 'Refund created and sent for approval');
      setRefundFor(null);
      summaryStale();
      order.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/orders', label: 'Orders' }}
        title={<span className="flex flex-wrap items-center gap-3">{o.orderNumber} <StatusBadge status={o.status} /><PlacedByBadge placedBy={o.placedBy} /></span>}
        description={`Placed ${formatDateTime(o.placedAt ?? o.createdAt)} · ${o.sellerOrders.reduce((n, s) => n + s.items.reduce((m, i) => m + (i.status === 'CANCELLED' && s.status !== 'CANCELLED' ? 0 : i.quantity), 0), 0)} items`}
        actions={
          <>
            {can('orders.update') ? <OrderChangeActions order={o} onChanged={order.reload} /> : null}
            <button type="button" className="btn-secondary" disabled={o.status === 'PENDING' || docs.busy === 'invoice'} title={o.status === 'PENDING' ? 'The invoice is ready once the order is confirmed' : undefined}
              onClick={() => docs.run('invoice', () => openPdf(`/admin/orders/${encodeURIComponent(o.orderNumber)}/invoice.pdf`, `FastMoveX-invoice-${o.orderNumber}.pdf`))}>
              <Printer className="size-4" aria-hidden /> Invoice
            </button>
            {canCancelOrder ? (
              <button type="button" className="btn-danger" onClick={() => setCancelOpen(true)}><Ban className="size-4" aria-hidden /> Cancel order</button>
            ) : null}
          </>
        }
      />
      <PinnedCustomerNote orderNumber={o.orderNumber} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {o.sellerOrders.map((s, idx) => {
            const next = NEXT[s.status] ?? [];
            return (
              <Card
                key={s.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Truck className="size-4 text-ink-400" aria-hidden />
                    {o.sellerOrders.length > 1 ? `Shipment ${idx + 1} of ${o.sellerOrders.length}` : 'Shipment'}
                    <StatusBadge status={s.status} />
                    {!s.seller.isHouse ? <Badge tone="violet">{s.seller.store?.name ?? s.seller.businessName}</Badge> : null}
                  </span>
                }
                description={`${deliveryMethodLabel(s.deliveryMethod)}${s.deliveredAt ? ` · delivered ${formatDateTime(s.deliveredAt)}` : ''}${s.cancelledAt ? ` · cancelled ${formatDateTime(s.cancelledAt)}` : ''}`}
                bodyClassName="p-0"
              >
                <ul className="divide-y divide-ink-100">
                  {s.items.map((i) => (
                    <li key={i.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${i.status === 'CANCELLED' && s.status !== 'CANCELLED' ? 'opacity-50' : ''}`}>
                      <Thumb src={i.imageUrl} alt="" size={48} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{i.productTitle}</p>
                        <p className="text-xs text-ink-500">
                          {i.sku} · {formatMoney(i.unitPriceMinor, cur)} × {i.quantity}
                          {i.refundedQty ? <span className="text-violet-700"> · {i.refundedQty} refunded</span> : null}
                          {i.status === 'CANCELLED' && s.status !== 'CANCELLED' ? <span className="text-danger-600"> · removed</span> : null}
                        </p>
                      </div>
                      <p className="text-sm font-medium tabular">{formatMoney(i.lineTotalMinor, cur)}</p>
                    </li>
                  ))}
                </ul>
                {s.status !== 'CANCELLED' ? <ShipmentWarehouse key={`${s.id}-${s.status}`} shipmentId={s.id} canChange={can('orders.update')} /> : null}
                {s.cancelReason ? <p className="border-t border-ink-100 px-5 py-2.5 text-sm text-danger-600">Cancelled: {s.cancelReason}</p> : null}
                {s.delivery && (s.delivery.courierName || s.delivery.trackingUrl || s.delivery.failureReason || s.delivery.overrideReason) ? (
                  <div className="border-t border-ink-100 px-5 py-3 text-sm text-ink-600">
                    {s.delivery.courierName ? <p>Courier: {s.delivery.courierName}{s.delivery.courierPhone ? ` · ${s.delivery.courierPhone}` : ''}</p> : null}
                    {s.delivery.trackingUrl ? <a href={s.delivery.trackingUrl} target="_blank" rel="noopener noreferrer" className="link">Tracking</a> : null}
                    {s.delivery.failureReason ? <p className="text-danger-600">Delivery problem: {s.delivery.failureReason} ({s.delivery.attempts} attempts)</p> : null}
                    {s.delivery.overrideReason ? <p className="text-warning-600" data-testid="override-reason">Closed without the customer’s code: {s.delivery.overrideReason}</p> : null}
                  </div>
                ) : null}
                {s.status !== 'CANCELLED' || (can('orders.update') && next.length) ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 bg-ink-25 px-5 py-3">
                    {s.status !== 'CANCELLED' ? (
                      <button type="button" className="btn-ghost btn-sm" disabled={docs.busy === `slip-${s.id}`} data-testid="packing-slip"
                        onClick={() => docs.run(`slip-${s.id}`, () => openPdf(`/admin/orders/shipments/${s.id}/packing-slip.pdf`, `packing-slip-${o.orderNumber}.pdf`))}>
                        <PackageCheck className="size-4" aria-hidden /> Packing slip
                      </button>
                    ) : null}
                    {s.status !== 'CANCELLED' ? (
                      <button type="button" className="btn-ghost btn-sm" disabled={docs.busy === `label-${s.id}`} data-testid="shipping-label"
                        onClick={() => docs.run(`label-${s.id}`, () => openPdf(`/admin/orders/shipments/${s.id}/label.pdf`, `label-${o.orderNumber}.pdf`))}>
                        <Tag className="size-4" aria-hidden /> Label 10×15
                      </button>
                    ) : null}
                    {can('refunds.create') && ['DELIVERED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'RETURNED', 'RETURN_REQUESTED'].includes(s.status) ? (
                      <button type="button" className="btn-ghost btn-sm me-auto" onClick={() => { setRefundFor(s); setRefund({ amount: '', reason: '' }); }}>
                        <Receipt className="size-4" aria-hidden /> Refund
                      </button>
                    ) : null}
                    {can('orders.update')
                      ? next.map((n, k) => (
                          <button key={n.to} type="button" className={k === 0 ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => { setStep({ shipment: s, ...n }); setNote(''); setCode(''); setNoCode(false); }} disabled={!!busy}>
                            {n.label}
                          </button>
                        ))
                      : null}
                  </div>
                ) : null}
              </Card>
            );
          })}

          <OrderChangesCard changes={o.changes} currency={cur} />

          <Card title="Payment">
            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatMoney(o.subtotalMinor, cur)} />
              {o.discountMinor !== '0' ? <Row label={`Discount${o.coupon ? ` (${o.coupon.code})` : ''}`} value={`−${formatMoney(o.discountMinor, cur)}`} /> : null}
              <Row label="Delivery" value={o.deliveryFeeMinor === '0' ? 'Free' : formatMoney(o.deliveryFeeMinor, cur)} />
              {o.taxMinor !== '0' ? <Row label="VAT" value={formatMoney(o.taxMinor, cur)} /> : null}
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{formatMoney(o.totalMinor, cur)}</dd></div>
            </dl>
            {payment ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
                <span className="font-medium">{paymentMethodLabel(payment.method)}</span>
                <StatusBadge status={payment.status} />
                {payment.refundedMinor !== '0' ? <span className="text-violet-700">{formatMoney(payment.refundedMinor, cur)} refunded</span> : null}
                {payment.providerRef ? <span className="ms-auto truncate text-xs text-ink-500" title={payment.providerRef}>Ref {payment.providerRef}</span> : null}
                {payment.failureReason ? <p className="w-full text-danger-600">{payment.failureReason}</p> : null}
              </div>
            ) : null}
            {o.refunds.length ? (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">Refunds</h3>
                <ul className="space-y-1.5 text-sm">
                  {o.refunds.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <span className="tabular">{formatMoney(r.amountMinor, cur)}</span>
                      <span className="truncate text-ink-500">{r.reason}</span>
                      <span className="ms-auto text-xs text-ink-400">{formatDateTime(r.createdAt)}</span>
                      {r.creditNoteNo && can('payments.read') ? (
                        <button type="button" className="btn-ghost btn-sm" data-testid="credit-note" disabled={docs.busy === `cn-${r.id}`}
                          onClick={() => docs.run(`cn-${r.id}`, () => openPdf(`/admin/refunds/${r.id}/credit-note.pdf`, `${r.creditNoteNo}.pdf`))}>
                          <FileText className="size-4" aria-hidden /> {r.creditNoteNo}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card title="Timeline">
            <ol className="relative space-y-4 border-s border-ink-100 ps-5">
              {[...o.history].reverse().filter((h) => h.sellerOrderId === null || o.sellerOrders.length > 1).map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full border-2 border-white bg-brand-500" aria-hidden />
                  <p className="text-sm font-medium">{humanize(h.toStatus)}{h.sellerOrderId && o.sellerOrders.length > 1 ? <span className="font-normal text-ink-500"> · shipment {o.sellerOrders.findIndex((s) => s.id === h.sellerOrderId) + 1}</span> : null}</p>
                  {h.note ? <p className="text-sm text-ink-600">{h.note}</p> : null}
                  <p className="text-xs text-ink-400">{formatDateTime(h.createdAt)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Customer">
            {o.user ? (
              <div className="space-y-1 text-sm">
                {can('users.read') ? <Link href={`/customers/${o.user.id}`} className="link">{o.user.fullName}</Link> : <p className="font-medium">{o.user.fullName}</p>}
                <TagBadges tags={o.user.tags} className="mt-1" />
                {o.user.email ? <p><a href={`mailto:${o.user.email}`} className="text-ink-600 hover:underline">{o.user.email}</a></p> : null}
                {o.user.phone ? <p><a href={`tel:${o.user.phone}`} className="text-ink-600 hover:underline">{o.user.phone}</a></p> : null}
              </div>
            ) : <p className="text-sm text-ink-500">Guest</p>}
          </Card>
          <Card title="Delivery address">
            {o.deliverySlotStart ? <p className="mb-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-sm font-medium text-brand-800" data-testid="order-slot">Deliver: {formatSlot(o.deliverySlotStart, o.deliverySlotEnd)}</p> : null}
            {o.shippingAddress ? (
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">{String(o.shippingAddress.recipientName ?? '')}</p>
                {formatAddress(o.shippingAddress).map((l) => <p key={l} className="text-ink-700">{l}</p>)}
                {o.shippingAddress.phone ? <p><a href={`tel:${String(o.shippingAddress.phone)}`} className="text-ink-600 hover:underline">{String(o.shippingAddress.phone)}</a></p> : null}
                {typeof o.shippingAddress.lat === 'number' && typeof o.shippingAddress.lng === 'number' ? (
                  <a href={`https://www.google.com/maps?q=${o.shippingAddress.lat},${o.shippingAddress.lng}`} target="_blank" rel="noopener noreferrer" className="link text-xs">Open in Maps</a>
                ) : null}
              </div>
            ) : <p className="text-sm text-ink-500">No address (pickup)</p>}
          </Card>
          <OrderNotesCard orderNumber={o.orderNumber} />
          {o.customerNote ? (
            <Card title="Customer note"><p className="text-sm whitespace-pre-line text-ink-700">{o.customerNote}</p></Card>
          ) : null}
          {o.sellerOrders.some((s) => !s.seller.isHouse) ? (
            <Card title="Marketplace">
              <KeyValue items={o.sellerOrders.map((s) => [s.seller.store?.name ?? s.seller.businessName, `Commission ${formatMoney(s.commissionMinor, cur)} · seller gets ${formatMoney(s.sellerNetMinor, cur)}`])} />
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog
        open={!!step}
        onClose={() => setStep(null)}
        title={step?.label ?? ''}
        description="The customer is notified of the new status."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setStep(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={setStatus} disabled={busy === 'status'}>{busy === 'status' ? <Spinner /> : null} {step?.label}</button>
          </>
        }
      >
        {needsCode ? (
          <div className="space-y-3">
            {!noCode ? (
              <TextField
                label="Customer’s delivery code" hint="The 4-digit code the customer received by SMS. Ask them for it — staff cannot see it."
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" maxLength={4} className="max-w-[12rem]" data-testid="delivery-code-input"
              />
            ) : null}
            {can('delivery.override') ? (
              <>
                <Checkbox label="The customer cannot give the code (manager)" checked={noCode} onChange={(e) => setNoCode(e.target.checked)} data-testid="no-code" />
                {noCode ? <TextArea label="Why? (recorded and audited)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="e.g. Customer lost their phone; ID checked at the door" required /> : null}
              </>
            ) : <p className="text-xs text-ink-500">No code? Ask a manager — only they can close a delivery without it.</p>}
          </div>
        ) : (
          <TextArea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder={step?.to === 'SHIPPED' ? 'e.g. courier and tracking number' : undefined} />
        )}
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={cancel}
        title="Cancel this order?"
        description="Shipments that have not left the store are cancelled, stock is released and a paid order is refunded. This cannot be undone."
        reason={{ label: 'Reason (shown to the customer)', required: true, placeholder: 'e.g. Out of stock, customer asked to cancel' }}
        confirmLabel="Cancel order"
        danger
        busy={busy === 'cancel'}
      />

      <Dialog
        open={!!refundFor}
        onClose={() => setRefundFor(null)}
        title="Refund"
        description={refundFor ? `Up to ${formatMoney((BigInt(refundFor.subtotalMinor) - BigInt(refundFor.discountMinor) + BigInt(refundFor.deliveryFeeMinor) + BigInt(refundFor.taxMinor)).toString(), cur)} for this shipment. Returned items are usually refunded from Returns.` : undefined}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRefundFor(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={createRefund} disabled={busy === 'refund'}>{busy === 'refund' ? <Spinner /> : null} Create refund</button>
          </>
        }
      >
        <div className="space-y-4">
          <MoneyField label="Amount" value={refund.amount} onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} currency={cur} autoFocus />
          <TextArea label="Reason" value={refund.reason} onChange={(e) => setRefund((r) => ({ ...r, reason: e.target.value }))} maxLength={300} rows={2} placeholder="e.g. Item arrived damaged, goodwill" />
        </div>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
