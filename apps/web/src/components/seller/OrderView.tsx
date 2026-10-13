'use client';

import { ArrowLeft, Banknote, CheckCircle2, MapPin, PackageCheck, PackageOpen, Phone, Printer, Truck, XCircle } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { OrderStatus } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { StatusBadge } from '../account/StatusBadge';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { usePrint } from './Orders';
import { useSeller } from './SellerShell';
import type { SellerOrderDetail } from './types';

/**
 * The next steps a seller can take. Packed parcels normally wait for a FastMoveX driver ("ready for pickup" makes it a
 * fleet delivery); a seller may also deliver it themselves (shipped → out for delivery → delivered). The first step is
 * the main button.
 */
function nextSteps(o: SellerOrderDetail): { to: OrderStatus; key: 'start' | 'ready' | 'shipped' | 'out' | 'delivered' }[] {
  const fleet = o.deliveryMethod === 'JOVIA' && !!o.delivery;
  switch (o.status) {
    case 'CONFIRMED': return [{ to: 'PREPARING', key: 'start' }];
    case 'PREPARING': return [{ to: 'READY_FOR_PICKUP', key: 'ready' }, { to: 'SHIPPED', key: 'shipped' }];
    case 'SHIPPED': return fleet ? [] : [{ to: 'OUT_FOR_DELIVERY', key: 'out' }];
    case 'OUT_FOR_DELIVERY': return fleet ? [] : [{ to: 'DELIVERED', key: 'delivered' }];
    default: return [];
  }
}

export function SellerOrderView({ id }: { id: string }) {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const toast = useToast();
  const { reloadSummary } = useSeller();
  const [o, setO] = useState<SellerOrderDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { print, busy: printing } = usePrint();

  const load = useCallback(async () => {
    try { setO(await api<SellerOrderDetail>(`/seller/orders/${id}`)); } catch (e) { setError(errorMessage(e, t)); }
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function move(to: OrderStatus) {
    setBusy(true);
    try {
      setO(await api<SellerOrderDetail>(`/seller/orders/${id}/status`, { method: 'POST', body: { status: to } }));
      toast({ tone: 'success', message: to === 'READY_FOR_PICKUP' ? t('seller.order.readyDone') : t('seller.order.updated') });
      void reloadSummary();
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(false); }
  }
  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setO(await api<SellerOrderDetail>(`/seller/orders/${id}/cancel`, { method: 'POST', body: { reason: reason.trim() } }));
      setCancelOpen(false);
      toast({ tone: 'success', message: t('seller.order.cancelled') });
      void reloadSummary();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(false); }
  }

  if (error) return <p className="card p-6 text-danger-600" role="alert">{error}</p>;
  if (!o) return <div className="space-y-3"><div className="skeleton h-8 w-64" /><div className="skeleton h-48" /><div className="skeleton h-48" /></div>;

  const a = o.shippingAddress;
  const address = [[a.zone && `Zone ${a.zone}`, a.street && `Street ${a.street}`, a.building && `Building ${a.building}`, a.unit && `Unit ${a.unit}`].filter(Boolean).join(', '), a.line1, a.city].filter(Boolean);
  const steps = nextSteps(o);
  const printable = !['CANCELLED', 'PENDING'].includes(o.status);
  const cancellable = ['CONFIRMED', 'PREPARING'].includes(o.status);
  const cur = o.order.currencyCode;
  const fmt = (d: string) => new Date(d).toLocaleString(l === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const icon = { start: PackageOpen, ready: PackageCheck, shipped: Truck, out: Truck, delivered: CheckCircle2 } as const;
  const label = { start: t('seller.order.start'), ready: t('seller.order.ready'), shipped: t('seller.order.shipped'), out: t('order.status.OUT_FOR_DELIVERY'), delivered: t('order.status.DELIVERED') } as const;

  return (
    <div className="space-y-4" data-testid="seller-order">
      <Link href={`${paths.sellerOrders(l)}?tab=all`} className="link inline-flex items-center gap-1 text-sm"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t('seller.order.back')}</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold" dir="ltr">{o.order.orderNumber}</h1>
        <StatusBadge status={o.status} label={t(`order.status.${o.status}`)} />
        <span className="text-sm text-ink-500">{fmt(o.order.placedAt)}</span>
      </div>

      {/* the actions, at the top where the packer's thumb is */}
      <section className="card space-y-3 p-4">
        {printable && (
          <>
            <button type="button" className="btn-secondary btn-lg w-full" disabled={printing} onClick={() => print(`/seller/orders/${o.id}/label.pdf`, `label-${o.order.orderNumber}.pdf`)} data-testid="print-label">
              {printing ? <Spinner /> : <Printer className="size-5" aria-hidden />}{t('seller.order.print')}
            </button>
            <p className="hint">{t('seller.order.printHint')}</p>
          </>
        )}
        {steps.map((s, i) => {
          const Icon = icon[s.key];
          return (
            <button key={s.to} type="button" className={i === 0 ? 'btn-primary btn-lg w-full' : 'btn-ghost w-full text-sm'} disabled={busy} onClick={() => void move(s.to)} data-testid={`step-${s.key}`}>
              {busy ? <Spinner /> : <Icon className="size-5" aria-hidden />}{label[s.key]}
            </button>
          );
        })}
        {o.status === 'READY_FOR_PICKUP' && (
          <p className="flex items-center gap-2 rounded-xl bg-sky-50 p-3 text-sm font-medium text-sky-800"><Truck className="size-5 shrink-0" aria-hidden />{t('seller.order.readyDone')}</p>
        )}
        {o.delivery && <p className="text-sm text-ink-600">{t('seller.order.driverStatus')}: <strong>{t(`order.deliveryStatus.${o.delivery.status}` as 'order.deliveryStatus.CREATED')}</strong></p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><MapPin className="size-4 text-brand-600" aria-hidden />{t('seller.order.deliverTo')}</h2>
          <p className="font-semibold">{a.recipientName ?? o.customer.name}</p>
          {address.map((x) => <p key={x} className="text-sm text-ink-700">{x}</p>)}
          {a.phone && <a href={`tel:${a.phone}`} className="btn-secondary mt-3 px-3 py-2 text-sm" dir="ltr"><Phone className="size-4" aria-hidden />{a.phone}</a>}
          {o.order.customerNote && (
            <div className="mt-3 rounded-xl bg-sand-50 p-3 text-sm"><p className="text-xs font-semibold text-sand-700">{t('seller.order.note')}</p><p className="text-ink-800">{o.order.customerNote}</p></div>
          )}
          <p className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${o.cashToCollectMinor ? 'bg-warning-50 text-warning-600' : 'bg-success-50 text-success-700'}`} data-testid="order-cash">
            <Banknote className="size-5 shrink-0" aria-hidden />
            {o.cashToCollectMinor ? t('seller.order.cash', { amount: money(o.cashToCollectMinor, { currency: cur }) }) : t('seller.order.paid')}
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 font-semibold">{t('seller.order.items')}</h2>
          <ul className="divide-y divide-ink-100">
            {o.items.filter((i) => i.status !== 'CANCELLED').map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="56px" className="object-cover" unoptimized />}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{i.productTitle}</p>
                  <p className="text-xs text-ink-500" dir="ltr">{i.sku}</p>
                </div>
                <span className="tabular shrink-0 text-lg font-bold">× {i.quantity - i.refundedQty}</span>
              </li>
            ))}
          </ul>
          <h3 className="mb-1 mt-4 text-sm font-semibold">{t('seller.order.money')}</h3>
          <dl className="space-y-1 text-sm">
            <Row k={t('seller.order.subtotal')} v={money(o.subtotalMinor, { currency: cur })} />
            {o.discountMinor !== '0' && <Row k={t('seller.order.discount')} v={`−${money(o.discountMinor, { currency: cur })}`} />}
            <Row k={t('seller.order.commission')} v={`−${money(o.commissionMinor, { currency: cur })}`} />
            <Row k={t('seller.order.youGet')} v={money(o.sellerNetMinor, { currency: cur })} strong />
          </dl>
        </section>
      </div>

      {o.history.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">{t('seller.order.history')}</h2>
          <ol className="space-y-1.5 text-sm">
            {o.history.map((h, i) => <li key={i} className="flex flex-wrap gap-2"><span className="text-ink-500">{fmt(h.createdAt)}</span><span className="font-medium">{t(`order.status.${h.toStatus}`)}</span>{h.note && <span className="text-ink-500">· {h.note}</span>}</li>)}
          </ol>
        </section>
      )}

      {cancellable && (
        <button type="button" className="btn-ghost text-danger-600" onClick={() => setCancelOpen(true)} data-testid="seller-cancel"><XCircle className="size-4" aria-hidden />{t('seller.order.cancel')}</button>
      )}
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('seller.order.cancelTitle')} closeLabel={t('common.close')}>
        <form onSubmit={cancel} className="space-y-3">
          <p className="text-sm text-ink-600">{t('seller.order.cancelHint')}</p>
          <label htmlFor="so-reason" className="label">{t('seller.order.cancelReason')}</label>
          <textarea id="so-reason" className="input min-h-20" minLength={3} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="btn-danger w-full" disabled={busy || reason.trim().length < 3}>{busy && <Spinner />}{t('seller.order.cancel')}</button>
        </form>
      </Dialog>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-3 ${strong ? 'border-t border-ink-100 pt-1.5 font-bold text-success-700' : ''}`}><dt className={strong ? '' : 'text-ink-600'}>{k}</dt><dd className="tabular">{v}</dd></div>;
}
