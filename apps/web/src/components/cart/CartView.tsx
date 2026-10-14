'use client';

import { AlertTriangle, CircleCheck, Minus, Plus, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import type { Cart, CartGroup, CartItem, CouponReason } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useSession } from '@/lib/state/session';
import { useMoney, useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { CartSkeleton } from '../ui/Skeletons';
import { haptic } from '@/lib/haptics';

function Line({ item, onQty, onRemove }: { item: CartItem; onQty: (q: number) => void; onRemove: () => void }) {
  const t = useT();
  const money = useMoney();
  const title = pick(t.locale, item.title, item.titleAr);
  const options = Object.entries((t.locale === 'ar' && item.optionsAr) || item.options || {});
  const blocking = item.issues.filter((i) => i !== 'PRICE_CHANGED');
  const maxQ = Math.max(1, Math.min(item.maxQuantity, 99));
  return (
    <li className="flex gap-3 py-4 sm:gap-4" data-testid="cart-line">
      <Link href={paths.product(t.locale, item.productSlug)} className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-ink-50 sm:size-24">
        {item.imageUrl && <Image src={item.imageUrl} alt="" fill sizes="96px" className="object-contain p-1.5" />}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={paths.product(t.locale, item.productSlug)} className="line-clamp-2 text-sm font-medium text-ink-900 hover:text-brand-700">{title}</Link>
            {options.length > 0 && <p className="mt-0.5 text-xs text-ink-500">{options.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
          </div>
          <div className="shrink-0 text-end">
            <p className="tabular text-sm font-bold text-ink-900">{money(item.lineSubtotalMinor)}</p>
            {item.quantity > 1 && <p className="tabular text-xs text-ink-500">{t('cart.unitPrice', { price: money(item.unitPriceMinor) })}</p>}
            {item.onDeal && <p className="text-xs font-semibold text-deal-600">{t('cart.onDeal')}</p>}
          </div>
        </div>
        {item.priceChangedFromMinor && (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-600">
            <AlertTriangle className="size-3.5" aria-hidden />{t('cart.issue.PRICE_CHANGED', { from: money(item.priceChangedFromMinor) })}
          </p>
        )}
        {blocking.map((i) => (
          <p key={i} className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger-600" role="alert">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {i === 'INSUFFICIENT_STOCK' ? t.plural('cart.issue.INSUFFICIENT_STOCK', item.available) : t(`cart.issue.${i}`)}
          </p>
        ))}
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-ink-200 bg-white">
            <button type="button" disabled={item.quantity <= 1} onClick={() => onQty(item.quantity - 1)} aria-label={t('product.decrease')} className="flex size-8 items-center justify-center text-ink-700 disabled:text-ink-300"><Minus className="size-3.5" aria-hidden /></button>
            <span className="tabular w-8 text-center text-sm font-semibold" aria-label={t('cart.quantity', { title })}>{item.quantity}</span>
            <button type="button" disabled={item.quantity >= maxQ} onClick={() => onQty(item.quantity + 1)} aria-label={t('product.increase')} className="flex size-8 items-center justify-center text-ink-700 disabled:text-ink-300"><Plus className="size-3.5" aria-hidden /></button>
          </div>
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-danger-600" aria-label={t('cart.remove', { title })}>
            <Trash2 className="size-3.5" aria-hidden />{t('common.remove')}
          </button>
        </div>
      </div>
    </li>
  );
}

export function couponMessage(t: ReturnType<typeof useT>, money: ReturnType<typeof useMoney>, reason: CouponReason | undefined, shortBy?: string | null, fallback?: string) {
  if (reason === 'MIN_ORDER' && shortBy) return t('cart.coupon.MIN_ORDER', { amount: money(shortBy) });
  if (reason) return t(`cart.coupon.${reason}`, { amount: '' });
  return fallback ?? t('errors.generic');
}

function Coupon({ cart }: { cart: Cart }) {
  const t = useT();
  const money = useMoney();
  const { status } = useSession();
  const { applyCoupon, removeCoupon } = useCart();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (status !== 'user') {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-600">
        <Tag className="size-4 text-ink-400" aria-hidden />
        <Link href={paths.login(t.locale, paths.cart(t.locale))} className="link">{t('cart.signInForCode')}</Link>
      </p>
    );
  }

  if (cart.coupon) {
    const c = cart.coupon;
    return (
      <div className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-sm ${c.applied ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-600'}`} data-testid="coupon-state">
        <div>
          <p className="font-semibold"><span dir="ltr">{c.code}</span></p>
          <p className="text-xs">
            {c.applied
              ? c.freeDelivery && c.discountMinor === '0' ? t('cart.codeFreeDelivery', { code: c.code }) : t('cart.codeSaves', { amount: money(c.discountMinor) })
              : couponMessage(t, money, c.reason, c.shortByMinor, c.message)}
          </p>
        </div>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await removeCoupon(); } finally { setBusy(false); } }} aria-label={t('cart.removeCode')} className="rounded-lg p-1 hover:bg-black/5">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(v)) { setError(t('cart.coupon.NOT_FOUND')); return; }
    setBusy(true);
    setError('');
    try {
      await applyCoupon(v);
      setCode('');
    } catch (err) {
      const reason = err instanceof ApiError ? (err.reason as CouponReason | undefined) : undefined;
      setError(reason ? couponMessage(t, money, reason) : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="promo" className="label">{t('cart.promoCode')}</label>
      <div className="flex gap-2">
        <input id="promo" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('cart.promoPlaceholder')} className="input uppercase" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? 'promo-err' : undefined} maxLength={40} />
        <button type="submit" disabled={busy || !code.trim()} className="btn-secondary">{busy ? <Spinner className="size-4" /> : t('cart.applyCode')}</button>
      </div>
      {error && <p id="promo-err" className="field-error" role="alert">{error}</p>}
    </form>
  );
}

export function Totals({ cart, children }: { cart: Cart; children?: React.ReactNode }) {
  const t = useT();
  const money = useMoney();
  const tt = cart.totals;
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between"><dt className="text-ink-600">{t('cart.subtotal')} ({t.plural('common.items', tt.itemCount)})</dt><dd className="tabular font-medium">{money(tt.subtotalMinor)}</dd></div>
      {tt.discountMinor !== '0' && <div className="flex justify-between text-success-600"><dt>{t('cart.discount')}</dt><dd className="tabular font-medium">−{money(tt.discountMinor)}</dd></div>}
      <div className="flex justify-between"><dt className="text-ink-600">{t('cart.deliveryTotal')}</dt><dd className="tabular font-medium">{tt.deliveryFeeMinor === '0' ? t('common.free') : money(tt.deliveryFeeMinor)}</dd></div>
      {!tt.taxIncluded && tt.taxMinor !== '0' && <div className="flex justify-between"><dt className="text-ink-600">{t('cart.vat')}</dt><dd className="tabular font-medium">{money(tt.taxMinor)}</dd></div>}
      {children}
      <div className="flex items-baseline justify-between border-t border-ink-100 pt-3">
        <dt className="text-base font-bold">{t('cart.total')}</dt>
        <dd className="tabular text-xl font-bold" data-testid="cart-total">{money(tt.totalMinor)}</dd>
      </div>
      {tt.taxIncluded && tt.taxMinor !== '0' && <p className="text-end text-xs text-ink-500">{t('cart.vatIncluded', { amount: money(tt.taxMinor) })}</p>}
    </dl>
  );
}

export function CartView() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const toast = useToast();
  const { status } = useSession();
  const { market } = useShop();
  const { cart, loading, syncing, update, remove, acknowledgePrices } = useCart();
  const [acking, setAcking] = useState(false);

  /** the line changes on screen at once (see the cart state); a failure puts it back and says why */
  function run(fn: () => Promise<unknown>, done?: string) {
    haptic('tap');
    if (done) toast({ tone: 'success', message: done });
    fn().catch((e) => { haptic('error'); toast({ tone: 'error', message: errorMessage(e, t) }); });
  }

  if (loading && !cart) return <CartSkeleton />;
  /** checkout waits the moment it takes for a just-tapped change to reach the server */
  const wait = syncing ? 'pointer-events-none opacity-80' : '';
  if (!cart || cart.groups.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState icon={<ShoppingBag className="size-7" aria-hidden />} title={t('cart.empty')} text={t('cart.emptyHint')} action={<Link href={paths.home(l)} className="btn-primary">{t('cart.startShopping')}</Link>} />
      </div>
    );
  }

  const lines = cart.groups.flatMap((g) => g.items);
  const priceChanged = lines.some((i) => i.issues.includes('PRICE_CHANGED'));
  const blocked = lines.some((i) => i.issues.some((x) => x !== 'PRICE_CHANGED'));

  return (
    <div className="container-page py-6">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('cart.title')} <span className="text-sm font-normal text-ink-500 sm:text-base">({t.plural('common.items', cart.totals.itemCount)})</span></h1>
      {cart.groups.length > 1 && <p className="mt-2 text-sm text-ink-500">{t('cart.separateDelivery')}</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          {(priceChanged || blocked) && (
            <div className="flex flex-col gap-3 rounded-2xl border border-warning-600/20 bg-warning-50 p-4 text-sm text-warning-600 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 shrink-0" aria-hidden />{blocked ? t('cart.attention') : t('cart.pricesChanged')}</p>
              {priceChanged && (
                <button type="button" disabled={acking} className="btn-secondary shrink-0" onClick={async () => { setAcking(true); try { await acknowledgePrices(); } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setAcking(false); } }} data-testid="accept-prices">
                  {acking && <Spinner className="size-4" />}{t('cart.acceptPrices')}
                </button>
              )}
            </div>
          )}
          {cart.groups.map((g, gi) => (
            <section key={g.store.slug} className="card px-4 sm:px-5" aria-label={t('cart.soldBy', { store: pick(l, g.store.name, g.store.nameAr) })}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 py-3 text-sm">
                <p>
                  {cart.groups.length > 1 && <span className="me-2 text-xs text-ink-400">{t('cart.shipment', { n: gi + 1, total: cart.groups.length })}</span>}
                  <Link href={paths.store(l, g.store.slug)} className="font-semibold text-ink-900 hover:text-brand-700">{t('cart.soldBy', { store: pick(l, g.store.name, g.store.nameAr) })}</Link>
                </p>
                <p className="text-xs text-ink-500">
                  {t('cart.delivery')}: <span className="tabular font-semibold text-ink-700">{g.deliveryWaived ? t('cart.deliveryWaived') : g.deliveryFeeMinor === '0' ? t('cart.deliveryFree') : money(g.deliveryFeeMinor)}</span>
                </p>
              </header>
              <FreeDeliveryBar group={g} />
              <ul className="divide-y divide-ink-100">
                {g.items.map((item) => (
                  <Line
                    key={item.id}
                    item={item}
                    onQty={(q) => run(() => update(item.id, q))}
                    onRemove={() => run(() => remove(item.id), t('cart.removed'))}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <aside className="card sticky top-36 space-y-5 p-5">
          <h2 className="text-base font-bold">{t('cart.summary')}</h2>
          <Coupon cart={cart} />
          <div className={`transition-opacity ${syncing ? 'opacity-50' : ''}`} aria-busy={syncing || undefined} data-testid="cart-totals"><Totals cart={cart} /></div>
          {status === 'user' ? (
            cart.canCheckout ? (
              <Link href={paths.checkout(l)} className={`btn-primary btn-lg w-full ${wait}`} aria-disabled={syncing || undefined} data-testid="go-checkout">{t('cart.checkout')}</Link>
            ) : (
              <button type="button" disabled className="btn-primary btn-lg w-full">{t('cart.checkout')}</button>
            )
          ) : market.guestCheckout ? (
            <div className="space-y-2">
              {cart.canCheckout ? (
                <Link href={paths.checkout(l)} className={`btn-primary btn-lg w-full ${wait}`} aria-disabled={syncing || undefined} data-testid="go-checkout">{t('cart.checkout')}</Link>
              ) : (
                <button type="button" disabled className="btn-primary btn-lg w-full">{t('cart.checkout')}</button>
              )}
              <Link href={paths.login(l, paths.checkout(l))} className="btn-secondary w-full" data-testid="sign-in-checkout">{t('cart.signInToCheckout')}</Link>
            </div>
          ) : (
            <Link href={paths.login(l, paths.checkout(l))} className="btn-primary btn-lg w-full" data-testid="go-checkout">{t('cart.signInToCheckout')}</Link>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * "Add QAR 23.00 more from Store for FREE delivery" with a bar that fills up — delivery is free per store above the
 * market's threshold. Hidden when delivery costs nothing anyway or a coupon already waived it.
 */
function FreeDeliveryBar({ group }: { group: CartGroup }) {
  const t = useT();
  const money = useMoney();
  const { market } = useShop();
  const flat = BigInt(market.delivery.flatFeeMinor ?? '0');
  const freeOver = market.delivery.freeOverMinor ? BigInt(market.delivery.freeOverMinor) : null;
  if (!freeOver || flat === 0n || group.deliveryWaived) return null;
  const goods = BigInt(group.subtotalMinor) - BigInt(group.discountMinor);
  const store = pick(t.locale, group.store.name, group.store.nameAr);
  const done = goods >= freeOver;
  const pct = done ? 100 : Math.max(4, Math.min(100, Number((goods * 100n) / freeOver)));
  return (
    <div className="border-b border-ink-100 py-3" data-testid="free-delivery-bar">
      <p className={`flex items-start gap-1.5 text-sm leading-5 ${done ? 'font-medium text-success-600' : 'text-ink-800'}`}>
        {done && <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span>{done ? t('cart.freeDone', { store }) : t('cart.freeLeft', { amount: money(freeOver - goods), store })}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('cart.delivery')}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${done ? 'bg-success-600' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
