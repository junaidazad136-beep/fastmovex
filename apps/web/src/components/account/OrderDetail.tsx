'use client';

import { WhatsAppAsk } from '../ui/WhatsApp';
import { Check, CheckCircle2, Clock, Copy, ExternalLink, KeyRound, LifeBuoy, MapPin, Navigation, RotateCcw, ShieldCheck, Star, Truck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError, isNotFound } from '@/lib/api/errors';
import type { OrderDetail as Order, OrderItem, OrderStatus, SellerOrder } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { FormError } from '../auth/fields';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { formatAddress } from './AddressForm';
import { BuyAgain } from './BuyAgain';
import { ChangeDelivery, OrderUpdates } from './ChangeDelivery';
import { MissedDelivery } from './MissedDelivery';
import { OrderDocuments } from './OrderDocuments';
import { StatusBadge } from './StatusBadge';

const STEP_OF: Partial<Record<OrderStatus, number>> = {
  PENDING: 0, CONFIRMED: 0, PREPARING: 1, READY_FOR_PICKUP: 1, SHIPPED: 2, OUT_FOR_DELIVERY: 2, DELIVERED: 3,
  RETURN_REQUESTED: 3, RETURNED: 3, REFUNDED: 3,
};

function Steps({ status }: { status: OrderStatus }) {
  const t = useT();
  const at = STEP_OF[status];
  if (at === undefined) return null;
  const steps = [t('order.steps.placed'), t('order.steps.preparing'), t('order.steps.onTheWay'), t('order.steps.delivered')];
  return (
    <ol className="flex items-center" aria-label={t(`order.status.${status}`)}>
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 items-center last:flex-none">
          <span className="flex flex-col items-center gap-1.5">
            <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${i <= at ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-400'}`} aria-current={i === at ? 'step' : undefined}>
              {i < at ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={`whitespace-nowrap text-[11px] font-medium ${i <= at ? 'text-ink-800' : 'text-ink-400'}`}>{s}</span>
          </span>
          {i < steps.length - 1 && <span className={`mx-2 mb-5 h-0.5 flex-1 rounded ${i < at ? 'bg-brand-600' : 'bg-ink-100'}`} />}
        </li>
      ))}
    </ol>
  );
}

function ReturnDialog({ order, item, onClose, onDone }: { order: Order; item: OrderItem | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQty(1); setReason(''); setError(''); }, [item]);
  if (!item) return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) { setError(t('errors.minLength', { n: 3 })); return; }
    setBusy(true); setError('');
    try {
      await api(`/orders/${encodeURIComponent(order.orderNumber)}/returns`, { method: 'POST', body: { orderItemId: item!.id, quantity: qty, reason: reason.trim() } });
      toast({ tone: 'success', message: t('order.returnRequested') });
      onDone();
    } catch (err) { setError(errorMessage(err, t)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!item} onClose={onClose} title={t('order.returnTitle', { title: item.productTitle })} closeLabel={t('common.close')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <label className="block">
          <span className="label">{t('order.returnQty')}</span>
          <select value={qty} onChange={(e) => setQty(Number(e.target.value))} className="input">
            {Array.from({ length: item.returnableQty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('order.returnReason')}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={t('order.returnReasonPlaceholder')} className="input" data-testid="return-reason" />
        </label>
        {item.returnDeadline && <p className="hint">{t('order.returnBy', { date: formatDate(item.returnDeadline, t.locale) })}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full" data-testid="return-submit">{busy && <Spinner className="size-4" />}{t('order.returnSubmit')}</button>
      </form>
    </Dialog>
  );
}

function Shipment({ so, order, index, total, onReturn, guest, guestToken, canReschedule, onChanged }: {
  so: SellerOrder; order: Order; index: number; total: number; onReturn: (i: OrderItem) => void; guest: boolean;
  guestToken?: string; canReschedule: boolean; onChanged: () => void;
}) {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const d = so.delivery;
  return (
    <section className="card overflow-hidden" data-testid="shipment">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-ink-25 px-4 py-3">
        <div className="text-sm">
          {total > 1 && <span className="me-2 text-xs text-ink-400">{t('cart.shipment', { n: index + 1, total })}</span>}
          <Link href={paths.store(l, so.seller.store.slug)} className="font-semibold hover:text-brand-700">{t('order.shipmentFrom', { store: pick(l, so.seller.store.name, so.seller.store.nameAr) })}</Link>
          <span className="ms-2 text-xs text-ink-500">· {t(`order.deliveredBy.${so.deliveryMethod}`)}</span>
        </div>
        {d?.status === 'FAILED'
          // the shipment is still with the driver, but this attempt failed: say so instead of "On the way"
          ? <span className="inline-flex items-center rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-semibold text-warning-600" data-testid="order-status">{t('order.missed.badge')}</span>
          : <StatusBadge status={so.status} label={t(`order.status.${so.status}`)} />}
      </header>
      {(d || so.deliveredAt || so.cancelledAt) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-100 px-4 py-2.5 text-xs text-ink-600">
          {d && <span className="inline-flex items-center gap-1 font-medium"><Truck className="size-3.5" aria-hidden />{t(`order.deliveryStatus.${d.status}`)}</span>}
          {d?.courierName && <span>{t('order.courier', { name: d.courierName })}</span>}
          {d?.etaAt && !so.deliveredAt && <span>{t('order.eta', { date: formatDateTime(d.etaAt, l) })}</span>}
          {d?.trackingUrl && /^https:\/\//.test(d.trackingUrl) && <a href={d.trackingUrl} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">{t('order.trackingLink')}<ExternalLink className="size-3" aria-hidden /></a>}
          {so.deliveredAt && <span className="font-medium text-success-600">{t('order.deliveredOn', { date: formatDate(so.deliveredAt, l) })}</span>}
          {so.cancelledAt && <span>{t('order.cancelledOn', { date: formatDate(so.cancelledAt, l) })}{so.cancelReason ? ` · ${t('order.cancelledReason', { reason: so.cancelReason })}` : ''}</span>}
        </div>
      )}
      {d?.status === 'FAILED' && d.attempt && (
        <MissedDelivery attempt={d.attempt} request={d.request} orderNumber={order.orderNumber} guestToken={guestToken} canAct={canReschedule} onSaved={onChanged} />
      )}
      {d?.deliveryCode && (
        <div className="flex flex-wrap items-center gap-4 border-b border-brand-100 bg-brand-50/60 px-4 py-3" data-testid="delivery-code">
          <ShieldCheck className="size-6 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">{t('order.code.title')}</p>
            <p className="text-xs text-ink-600">{t('order.code.hint')}</p>
          </div>
          <p className="rounded-xl bg-white px-4 py-2 font-mono text-2xl font-bold tracking-[0.35em] text-ink-900 shadow-sm ring-1 ring-brand-100" dir="ltr" aria-label={t('order.code.aria', { code: d.deliveryCode.split('').join(' ') })} data-testid="delivery-code-value">{d.deliveryCode}</p>
        </div>
      )}
      {d?.location && (
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-2.5 text-sm" data-testid="driver-location">
          <Navigation className="size-4 text-brand-600" aria-hidden />
          <span className="text-ink-700">{t('order.code.onTheWay', { name: d.courierName ?? '' })}</span>
          <a href={d.location.mapUrl} target="_blank" rel="noopener noreferrer" className="link ms-auto inline-flex items-center gap-1">{t('order.code.seeOnMap')}<ExternalLink className="size-3" aria-hidden /></a>
        </div>
      )}
      {d?.eta && (
        <div className="flex items-start gap-2 border-b border-ink-100 bg-brand-50/50 px-4 py-2.5 text-sm" data-testid="delivery-eta">
          <Clock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
          <div>
            <p className="font-semibold text-ink-900">{t('order.arrival.arriving', { time: new Intl.DateTimeFormat(l === 'ar' ? 'ar-QA' : 'en-QA', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Qatar' }).format(new Date(d.eta.at)) })}</p>
            <p className="text-ink-600">{t.plural('order.arrival.minutes', d.eta.minutes)} · {t.plural('order.arrival.stops', d.eta.stopsBefore)}</p>
            <p className="text-xs text-ink-400">{t('order.arrival.hint')}</p>
          </div>
        </div>
      )}
      <ul className="divide-y divide-ink-100 px-4">
        {/* lines removed after checkout are explained under Order updates */}
        {so.items.filter((i) => so.status === 'CANCELLED' || i.status !== 'CANCELLED').map((i) => (
          <li key={i.id} className="flex gap-3 py-3.5">
            <Link href={paths.product(l, i.productSlug)} className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-ink-50">
              {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-contain p-1" />}
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={paths.product(l, i.productSlug)} className="line-clamp-2 text-sm font-medium hover:text-brand-700">{i.productTitle}</Link>
              <p className="mt-0.5 text-xs text-ink-500">{t('order.qty', { n: i.quantity })} · <span className="tabular">{money(i.unitPriceMinor, { currency: order.currencyCode })}</span></p>
              {i.openReturnQty > 0 && <p className="mt-1 text-xs font-medium text-warning-600">{t.plural('order.returnOpen', i.openReturnQty)}</p>}
              {i.refundedQty > 0 && <p className="mt-1 text-xs font-medium text-ink-500">{t('order.status.REFUNDED')} × {i.refundedQty}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {!guest && i.returnableQty > 0 && (
                  <button type="button" onClick={() => onReturn(i)} className="btn-secondary px-3 py-1.5 text-xs" data-testid="return-item">
                    <RotateCcw className="size-3.5" aria-hidden />{t('order.returnItem')}
                  </button>
                )}
                {!guest && so.deliveredAt && (
                  <Link href={`${paths.reviews(l)}?item=${i.id}`} className="btn-ghost px-3 py-1.5 text-xs"><Star className="size-3.5" aria-hidden />{t('order.review')}</Link>
                )}
              </div>
              {!guest && i.returnableQty > 0 && i.returnDeadline && <p className="mt-1 text-[11px] text-ink-400">{t('order.returnBy', { date: formatDate(i.returnDeadline, l) })}</p>}
            </div>
            <p className="tabular shrink-0 text-sm font-semibold">{money(i.lineTotalMinor, { currency: order.currencyCode })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One order. Signed-in shoppers load it with their account; guests with the order's access token
 * (from checkout, the email link or "Track order") — then returns and reviews, which need an account, are hidden.
 */
export function OrderDetailView({ number, placed, guestToken }: { number: string; placed: boolean; guestToken?: string }) {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState('');
  const [returnItem, setReturnItem] = useState<OrderItem | null>(null);
  const [copied, setCopied] = useState(false);

  const guest = !!guestToken;
  const base = guest ? `/orders/guest/${encodeURIComponent(number)}` : `/orders/${encodeURIComponent(number)}`;
  const opts = guest ? { auth: 'none' as const, headers: { 'x-order-token': guestToken! } } : {};

  const load = useCallback(async () => {
    try { setOrder(await api<Order>(base, opts)); }
    catch (e) {
      if (isNotFound(e) || (guest && e instanceof ApiError && e.status === 401)) setMissing(true);
      else toast({ tone: 'error', message: errorMessage(e, t) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, guestToken, t, toast]);

  useEffect(() => { void load(); }, [load]);
  // While a driver is on the way, refresh so the location and status stay current.
  useEffect(() => {
    if (!order || !order.sellerOrders.some((so) => so.delivery?.status === 'OUT_FOR_DELIVERY' || so.delivery?.status === 'PICKED_UP')) return;
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [order, load]);
  // While a card payment is still being confirmed, keep the page live.
  useEffect(() => {
    if (!order || order.payments[0]?.status !== 'PENDING' || order.payments[0]?.method === 'COD' || order.status === 'CANCELLED') return;
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [order, load]);

  if (missing) {
    return guest
      ? <EmptyState title={t('track.linkInvalid')} action={<Link href={paths.track(l)} className="btn-primary">{t('track.title')}</Link>} />
      : <EmptyState title={t('order.notFound')} action={<Link href={paths.orders(l)} className="btn-primary">{t('order.myOrders')}</Link>} />;
  }
  if (!order) return <div className="space-y-4"><div className="skeleton h-10 w-64" /><div className="skeleton h-48" /><div className="skeleton h-48" /></div>;

  const pay = order.payments[0];
  const address = order.shippingAddress;
  // a missed delivery the customer can rearrange: the API acts on the first failed one
  const missedId = order.sellerOrders.find((so) => so.delivery?.status === 'FAILED')?.id;

  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) { setCancelErr(t('errors.minLength', { n: 3 })); return; }
    setBusy(true); setCancelErr('');
    try {
      setOrder(await api<Order>(`${base}/cancel`, { ...opts, method: 'POST', body: { reason: reason.trim() } }));
      setCancelOpen(false);
      toast({ tone: 'success', message: t('order.cancelled') });
    } catch (err) { setCancelErr(errorMessage(err, t)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {placed && (
        <div className="flex items-start gap-3 rounded-2xl border border-success-600/20 bg-success-50 p-4 text-success-700" role="status" data-testid="order-placed">
          <CheckCircle2 className="size-6 shrink-0" aria-hidden />
          <div>
            <p className="font-bold">{t('order.thankYou')}</p>
            <p className="text-sm">{t('order.confirmationSent')}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <span dir="ltr" data-testid="order-number">{order.orderNumber}</span>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(order.orderNumber); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} aria-label={copied ? t('common.copied') : t('common.copy')} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            </button>
          </h1>
          <p className="text-sm text-ink-500">{t('order.placedOn', { date: formatDateTime(order.placedAt, l) })}</p>
        </div>
        <StatusBadge status={order.status} label={t(`order.status.${order.status}`)} />
      </div>

      {order.status !== 'CANCELLED' && <div className="card p-4 sm:p-5"><Steps status={order.status} /></div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          {order.sellerOrders.map((so, i) => (
            <Shipment key={so.id} so={so} order={order} index={i} total={order.sellerOrders.length} onReturn={setReturnItem} guest={guest}
              guestToken={guestToken} canReschedule={so.id === missedId} onChanged={() => void load()} />
          ))}
        </div>
        <aside className="space-y-4">
          <ChangeDelivery order={order} guestToken={guestToken} onChanged={() => void load()} />
          <OrderUpdates order={order} />
          {order.documents && <OrderDocuments docs={order.documents} orderNumber={order.orderNumber} currency={order.currencyCode} guestToken={guestToken} />}
          <section className="card p-4 text-sm">
            <h2 className="mb-3 font-bold">{t('order.payment')}</h2>
            {pay && (
              <p className="mb-3 flex items-center justify-between">
                <span>{t(`checkout.method.${pay.method}`)}</span>
                <span className={`text-xs font-semibold ${pay.status === 'CAPTURED' ? 'text-success-600' : pay.status === 'FAILED' ? 'text-danger-600' : 'text-ink-600'}`}>
                  {pay.method === 'COD' && pay.status === 'PENDING' && order.status !== 'CANCELLED' ? t('order.codDue') : t(`order.paymentStatus.${pay.status}`)}
                </span>
              </p>
            )}
            <dl className="space-y-1.5">
              <div className="flex justify-between"><dt className="text-ink-600">{t('cart.subtotal')}</dt><dd className="tabular">{money(order.subtotalMinor, { currency: order.currencyCode })}</dd></div>
              {order.discountMinor !== '0' && <div className="flex justify-between text-success-600"><dt>{t('cart.discount')}</dt><dd className="tabular">−{money(order.discountMinor, { currency: order.currencyCode })}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-600">{t('cart.deliveryTotal')}</dt><dd className="tabular">{order.deliveryFeeMinor === '0' ? t('common.free') : money(order.deliveryFeeMinor, { currency: order.currencyCode })}</dd></div>
              {order.taxMinor !== '0' && <div className="flex justify-between"><dt className="text-ink-600">{t('cart.vat')}</dt><dd className="tabular">{money(order.taxMinor, { currency: order.currencyCode })}</dd></div>}
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-bold"><dt>{t('order.total')}</dt><dd className="tabular" data-testid="order-total">{money(order.totalMinor, { currency: order.currencyCode })}</dd></div>
            </dl>
          </section>
          <section className="card p-4 text-sm">
            <h2 className="mb-2 flex items-center gap-2 font-bold"><MapPin className="size-4 text-brand-600" aria-hidden />{t('order.address')}</h2>
            <p className="font-medium">{address.recipientName} · <span dir="ltr">{address.phone}</span></p>
            <p className="text-ink-600">{formatAddress(address, t)}</p>
            {order.deliverySlotStart && order.deliverySlotEnd && (
              <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800" data-testid="order-slot">
                <Clock className="size-3.5" aria-hidden />{t('slot.yours')}: {slotText(order.deliverySlotStart, order.deliverySlotEnd, l)}
              </p>
            )}
            {order.customerNote && <p className="mt-2 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">{order.customerNote}</p>}
          </section>
          <div className="flex flex-col gap-2">
            {order.canCancel && <button type="button" onClick={() => setCancelOpen(true)} className="btn-danger w-full" data-testid="cancel-order">{t('order.cancel')}</button>}
            {!guest && <BuyAgain orderNumber={order.orderNumber} />}
            <Link href={guest ? paths.contact(l, order.orderNumber) : paths.newTicket(l, order.orderNumber)} className="btn-secondary w-full"><LifeBuoy className="size-4" aria-hidden />{t('order.help')}</Link>
            <WhatsAppAsk text={t('whatsapp.aboutOrder', { order: order.orderNumber })} label={t('whatsapp.askOrder')} className="justify-center py-1" />
          </div>
          {guest && (
            <section className="card space-y-2 p-4 text-sm" data-testid="guest-save">
              <h2 className="flex items-center gap-2 font-bold"><KeyRound className="size-4 text-brand-600" aria-hidden />{t('track.saveDetails')}</h2>
              <p className="text-ink-600">{t('track.saveDetailsText')}</p>
              <Link href={paths.forgot(l)} className="link inline-block">{t('track.setPassword')}</Link>
            </section>
          )}
          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-bold">{t('order.history')}</summary>
            <ol className="mt-3 space-y-2 border-s border-ink-200 ps-4">
              {order.history.map((h, i) => (
                <li key={i}>
                  <p className="font-medium">{t(`order.status.${h.toStatus}`)}</p>
                  <p className="text-xs text-ink-500">{formatDateTime(h.createdAt, l)}</p>
                </li>
              ))}
            </ol>
          </details>
        </aside>
      </div>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('order.cancelTitle')} closeLabel={t('common.close')}>
        <form onSubmit={cancel} className="space-y-4" noValidate>
          <p className="text-sm text-ink-600">{t('order.cancelHint')}</p>
          <FormError message={cancelErr} />
          <label className="block">
            <span className="label">{t('order.cancelReason')}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={t('order.cancelReasonPlaceholder')} className="input" data-testid="cancel-reason" />
          </label>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn-primary flex-1 bg-danger-600 hover:bg-danger-600/90" data-testid="cancel-confirm">{busy && <Spinner className="size-4" />}{t('order.cancel')}</button>
            <button type="button" onClick={() => setCancelOpen(false)} className="btn-secondary">{t('order.cancelKeep')}</button>
          </div>
        </form>
      </Dialog>
      <ReturnDialog order={order} item={returnItem} onClose={() => setReturnItem(null)} onDone={() => { setReturnItem(null); void load(); }} />
    </div>
  );
}

/** "Sat 3 Oct, 13:00 – 17:00" in Qatar time. */
function slotText(start: string, end: string, locale: string) {
  const loc = locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB';
  const day = new Intl.DateTimeFormat(loc, { timeZone: 'Asia/Qatar', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(start));
  const time = new Intl.DateTimeFormat(loc, { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day}, ${time.format(new Date(start))} – ${time.format(new Date(end))}`;
}
