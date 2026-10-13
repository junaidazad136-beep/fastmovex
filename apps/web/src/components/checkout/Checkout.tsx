'use client';

import { Banknote, CalendarClock, CreditCard, Lock, MapPin, Plus, Smartphone } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { track, trafficForCheckout } from '@/lib/analytics';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { Address, CheckoutResult, PaymentMethod } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { initialMethod, paylaterFits, PAYLATER_MAX_MINOR, PAYLATER_MIN_MINOR, rememberMethod, useCheckoutCart } from '@/lib/state/checkout-cart';
import { useMoney, useShop } from '@/lib/state/shop';
import { paths, pick } from '@/lib/urls';
import { AddressForm, formatAddress } from '../account/AddressForm';
import { Totals } from '../cart/CartView';
import { SLOT_REASONS, SlotPicker, useDeliverySlots } from './SlotPicker';
import { COD_REASONS, codAvailability, codErrorMessage } from './cod';
import { WhatsAppIcon } from '../ui/WhatsApp';
import { useSession } from '@/lib/state/session';
import { FormError } from '../auth/fields';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { PolicyLinks } from '../content/PolicyLinks';

export const PENDING_ORDER_KEY = 'fmx_pending_order';
/** Guest checkout: the order's access token, so the payment return page can open the order without an account. */
export const PENDING_TOKEN_KEY = 'fmx_pending_order_token';
const ICON: Record<PaymentMethod, typeof CreditCard> = { CARD: CreditCard, APPLE_PAY: Smartphone, GOOGLE_PAY: Smartphone, COD: Banknote, PAYLATER: CalendarClock };

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Checkout() {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const { market } = useShop();
  const { cart, loading, refresh, buyToken } = useCheckoutCart();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState<string>('');
  const [method, setMethod] = useState<PaymentMethod | ''>(() => (typeof window === 'undefined' ? '' : initialMethod(market)));
  useEffect(() => { setMethod((m) => m || initialMethod(market)); }, [market]);
  const [note, setNote] = useState('');
  const slots = useDeliverySlots();
  const [slot, setSlot] = useState('');
  const [slotMissing, setSlotMissing] = useState(false);
  const { user } = useSession();
  const [whatsapp, setWhatsapp] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One key per checkout attempt: a double tap or a retried request returns the same order, never a second one.
  const idemKey = useRef(newKey());
  useEffect(() => { track('checkout_start'); }, []);
  const money = useMoney();
  const cod = codAvailability(market, cart?.totals.totalMinor, false);
  useEffect(() => {
    if (method === 'COD' && !cod.ok) setMethod(market.paymentMethods.find((m) => m !== 'COD') ?? '');
  }, [method, cod.ok, market.paymentMethods]);

  useEffect(() => {
    api<Address[]>('/addresses').then((list) => {
      setAddresses(list);
      setAddressId((cur) => cur || (list.find((a) => a.isDefault) ?? list[0])?.id || '');
      if (!list.length) setAdding(true);
    }).catch((e) => setError(errorMessage(e, t)));
  }, [t]);

  useEffect(() => {
    if (!loading && cart && cart.groups.length === 0 && !busy) router.replace(paths.cart(l));
  }, [loading, cart, busy, router, l]);

  async function place() {
    if (!addressId || !method || busy) return;
    if (slots.data?.enabled && slots.data.required && !slot) {
      setSlotMissing(true);
      setError(t('slot.required'));
      document.querySelector('[data-testid="slot-picker"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    setError('');
    rememberMethod(method);
    try {
      const res = await api<CheckoutResult>('/checkout', {
        method: 'POST',
        body: { addressId, paymentMethod: method, ...(buyToken && { buyNowToken: buyToken }), note: note.trim() || undefined, deliverySlot: slot || undefined, whatsappOptIn: whatsapp || undefined, returnUrl: `${window.location.origin}/${l}/checkout/return`, traffic: trafficForCheckout() },
        headers: { 'idempotency-key': idemKey.current },
      });
      if (res.payment.status === 'FAILED') {
        idemKey.current = newKey(); // the failed order is closed; the next attempt is a new order
        await refresh();
        setError(t('checkout.paymentFailed'));
        setBusy(false);
        return;
      }
      if (res.payment.redirectUrl) {
        try { sessionStorage.setItem(PENDING_ORDER_KEY, res.orderNumber); } catch { /* the return page falls back to the orders list */ }
        window.location.assign(res.payment.redirectUrl);
        return;
      }
      await refresh();
      router.replace(`${paths.order(l, res.orderNumber)}?placed=1`);
    } catch (e) {
      if (e instanceof ApiError && (SLOT_REASONS as readonly string[]).includes(e.reason ?? '')) {
        setSlot('');
        setSlotMissing(true);
        slots.reload();
        setError(e.reason === 'SLOT_REQUIRED' ? t('slot.required') : t('slot.taken'));
      } else if ((COD_REASONS as readonly string[]).includes((e instanceof ApiError && e.reason) || '')) {
        setError(codErrorMessage(e, t, money));
      } else if (e instanceof ApiError && e.status === 409) {
        idemKey.current = newKey();
        await refresh();
        setError(t('checkout.cartChanged'));
      } else {
        setError(errorMessage(e, t));
      }
      setBusy(false);
    }
  }

  if (!cart || loading || addresses === null) {
    return <div className="space-y-4"><div className="skeleton h-8 w-48" /><div className="skeleton h-40" /><div className="skeleton h-40" /></div>;
  }

  const selected = addresses.find((a) => a.id === addressId);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('checkout.title')}</h1>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-600"><Lock className="size-3.5" aria-hidden />{t('checkout.secure')}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-5">
          <section className="card p-5" aria-labelledby="co-address">
            <h2 id="co-address" className="mb-4 flex items-center gap-2 font-bold"><MapPin className="size-5 text-brand-600" aria-hidden />{t('checkout.address')}</h2>
            {addresses.length === 0 ? (
              <p className="text-sm text-ink-500">{t('checkout.noAddress')}</p>
            ) : (
              <ul className="space-y-2" role="radiogroup" aria-labelledby="co-address">
                {addresses.map((a) => (
                  <li key={a.id}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${addressId === a.id ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : 'border-ink-200 hover:border-ink-300'}`}>
                      <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1 size-4 accent-brand-600" />
                      <span className="min-w-0 text-sm">
                        <span className="flex items-center gap-2 font-semibold text-ink-900">{a.label ?? a.recipientName}{a.isDefault && <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">{t('address.isDefault')}</span>}</span>
                        <span className="mt-0.5 block text-ink-600">{a.recipientName} · <span dir="ltr">{a.phone}</span></span>
                        <span className="block text-ink-500">{formatAddress(a, t)}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setAdding(true)} className="btn-ghost mt-3 text-brand-700"><Plus className="size-4" aria-hidden />{t('checkout.addAddress')}</button>
          </section>

          <SlotPicker data={slots.data} value={slot} onChange={(v) => { setSlot(v); setSlotMissing(false); }} invalid={slotMissing} />

          <section className="card p-5" aria-labelledby="co-pay">
            <h2 id="co-pay" className="mb-4 flex items-center gap-2 font-bold"><CreditCard className="size-5 text-brand-600" aria-hidden />{t('checkout.payment')}</h2>
            <ul className="space-y-2" role="radiogroup" aria-labelledby="co-pay">
              {market.paymentMethods.map((m) => {
                const I = ICON[m];
                const tooSmallOrBig = m === 'PAYLATER' && !paylaterFits(cart?.totals.totalMinor);
                const off = (m === 'COD' && !cod.ok) || tooSmallOrBig;
                return (
                  <li key={m}>
                    <label className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${off ? 'cursor-not-allowed border-ink-100 opacity-60' : 'cursor-pointer'} ${method === m ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : off ? '' : 'border-ink-200 hover:border-ink-300'}`}>
                      <input type="radio" name="payment" value={m} checked={method === m} disabled={off} onChange={() => setMethod(m)} className="mt-1 size-4 accent-brand-600" data-testid={`pay-${m}`} />
                      <I className="mt-0.5 size-5 shrink-0 text-ink-500" aria-hidden />
                      <span className="text-sm">
                        <span className="block font-semibold text-ink-900">{m === 'CARD' && market.cardProvider === 'dibsy' ? t('checkout.hostedCard') : t(`checkout.method.${m}`)}</span>
                        <span className="block text-ink-500">
                          {tooSmallOrBig
                            ? t('checkout.paylaterRange', { min: money(PAYLATER_MIN_MINOR.toString()), max: money(PAYLATER_MAX_MINOR.toString()) })
                            : off && !cod.ok && cod.why === 'limit'
                            ? t('cod.limit', { amount: money(cod.maxMinor!) })
                            : m === 'CARD' && market.cardProvider === 'dibsy' ? t('checkout.hostedCardHint') : t(`checkout.methodHint.${m}`)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {market.testPayments && method && method !== 'COD' && (
              <p className="mt-3 rounded-xl bg-sand-50 px-3.5 py-2.5 text-xs text-sand-700" data-testid="test-mode">{t('checkout.testMode')}</p>
            )}
          </section>

          {market.whatsapp?.updates && !user?.whatsappOptIn && (
            <label className="card flex items-center gap-2.5 p-4 text-sm text-ink-700">
              <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} className="size-4 accent-brand-600" data-testid="whatsapp-opt-in" />
              <WhatsAppIcon className="size-5 text-[#25D366]" />{t('whatsapp.optIn')}
            </label>
          )}

          <section className="card p-5">
            <label htmlFor="co-note" className="label">{t('checkout.note')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></label>
            <textarea id="co-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={t('checkout.notePlaceholder')} className="input resize-y" />
          </section>

          <section className="card p-5" aria-labelledby="co-items">
            <h2 id="co-items" className="mb-3 font-bold">{t('checkout.items')} ({t.plural('common.items', cart.totals.itemCount)})</h2>
            {cart.groups.map((g) => (
              <div key={g.store.slug} className="border-t border-ink-100 py-3 first:border-0 first:pt-0">
                <p className="mb-2 text-xs font-medium text-ink-500">{t('cart.soldBy', { store: pick(l, g.store.name, g.store.nameAr) })}</p>
                <ul className="space-y-2">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 text-sm">
                      <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-ink-50">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="48px" className="object-contain p-1" />}</span>
                      <span className="line-clamp-1 flex-1 text-ink-800">{pick(l, i.title, i.titleAr)}</span>
                      <span className="tabular text-ink-500">×{i.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <aside className="card sticky top-36 space-y-4 p-5">
          <h2 className="text-base font-bold">{t('cart.summary')}</h2>
          {selected && <p className="text-xs text-ink-500"><MapPin className="me-1 inline size-3.5" aria-hidden />{formatAddress(selected, t)}</p>}
          <Totals cart={cart} />
          <FormError message={error} />
          {!cart.canCheckout && <p className="text-sm text-warning-600"><Link href={paths.cart(l)} className="link">{t('cart.attention')}</Link></p>}
          <button type="button" onClick={place} disabled={busy || !addressId || !method || !cart.canCheckout} className="btn-primary btn-lg w-full" data-testid="place-order">
            {busy && <Spinner />}{busy ? t('checkout.placing') : t('checkout.placeOrder')}
          </button>
          <p className="text-xs leading-5 text-ink-500">{t('checkout.agree')} <PolicyLinks returns /></p>
        </aside>
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title={t('address.add')} closeLabel={t('common.close')} wide>
        <AddressForm
          onSaved={(a) => {
            setAddresses((list) => [...(list ?? []).map((x) => (a.isDefault ? { ...x, isDefault: false } : x)), a]);
            setAddressId(a.id);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
    </div>
  );
}
