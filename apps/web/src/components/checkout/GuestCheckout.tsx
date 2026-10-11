'use client';

import { Banknote, CreditCard, LocateFixed, Lock, MapPin, Smartphone, UserRound } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { track, trafficForCheckout } from '@/lib/analytics';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { AddressField, CheckoutResult, PaymentMethod } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { rememberGuestOrder } from '@/lib/guest-orders';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useShop } from '@/lib/state/shop';
import { paths, pick } from '@/lib/urls';
import { E164, EMAIL, Field, FormError, normalizePhone } from '../auth/fields';
import { Totals } from '../cart/CartView';
import { SLOT_REASONS, SlotPicker, useDeliverySlots } from './SlotPicker';
import { WhatsAppIcon } from '../ui/WhatsApp';
import { Spinner } from '../ui/Spinner';
import { PENDING_ORDER_KEY, PENDING_TOKEN_KEY } from './Checkout';
import { COD_REASONS, codAvailability, codErrorMessage, GuestPhoneCheck } from './cod';
import { useMoney } from '@/lib/state/shop';

const ICON: Record<PaymentMethod, typeof CreditCard> = { CARD: CreditCard, APPLE_PAY: Smartphone, GOOGLE_PAY: Smartphone, COD: Banknote };
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

type Form = Record<AddressField | 'fullName' | 'email' | 'phone', string> & { marketing: boolean; whatsapp: boolean; lat: number | null; lng: number | null };

/**
 * Checkout without an account: contact details + one delivery address + payment, on one page.
 * The API creates (or reuses) a guest profile for the email; the order page opens with the order's access token.
 */
export function GuestCheckout() {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const { market } = useShop();
  const { cart, loading, refresh } = useCart();
  const fields = market.addressFormat.fields;
  const required = new Set<string>(['fullName', 'email', 'phone', 'city', ...market.addressFormat.required]);
  const [f, setF] = useState<Form>({
    fullName: '', email: '', phone: '', city: market.code === 'QA' ? 'Doha' : '', zone: '', street: '', building: '', unit: '', line1: '', postalCode: '',
    marketing: false, whatsapp: false, lat: null, lng: null,
  });
  const [method, setMethod] = useState<PaymentMethod | ''>(market.paymentMethods.includes('COD') ? 'COD' : market.paymentMethods[0] ?? '');
  const [note, setNote] = useState('');
  const slots = useDeliverySlots();
  const [slot, setSlot] = useState('');
  const [slotMissing, setSlotMissing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<React.ReactNode>('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const idemKey = useRef(newKey());
  const money = useMoney();
  // cash on delivery: the mobile number is confirmed by a texted code (market rule)
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [codeError, setCodeError] = useState('');
  const cod = codAvailability(market, cart?.totals.totalMinor, true);
  const needsCode = method === 'COD' && !!market.cod?.guestPhoneCheck && !phoneVerified;
  useEffect(() => {
    if (method === 'COD' && !cod.ok) setMethod(market.paymentMethods.find((m) => m !== 'COD') ?? '');
  }, [method, cod.ok, market.paymentMethods]);
  useEffect(() => { track('checkout_start'); }, []);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    if (k === 'phone' || k === 'email') { setPhoneVerified(false); setPhoneCode(''); } // a code proves one number
  };
  /** Contact details for the code, once they are valid (the same checks as the form). */
  const codeContact = () => {
    const phone = normalizePhone(f.phone);
    if (!f.fullName.trim() || !EMAIL.test(f.email.trim()) || !E164.test(phone)) { validate(); return null; }
    return { fullName: f.fullName.trim(), email: f.email.trim().toLowerCase(), phone, locale: l };
  };

  useEffect(() => {
    if (!loading && cart && cart.groups.length === 0 && !busy) router.replace(paths.cart(l));
  }, [loading, cart, busy, router, l]);

  function locate() {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setF((x) => ({ ...x, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) })); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const k of required) if (!String(f[k as keyof Form] ?? '').trim()) errs[k] = t('errors.required');
    if (f.email && !EMAIL.test(f.email.trim())) errs.email = t('errors.invalidEmail');
    if (f.phone && !E164.test(normalizePhone(f.phone))) errs.phone = t('errors.invalidPhone');
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`gc-${Object.keys(errs)[0]}`)?.focus();
      return false;
    }
    return true;
  }

  async function place(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !method || !validate()) return;
    if (slots.data?.enabled && slots.data.required && !slot) {
      setSlotMissing(true);
      setError(t('slot.required'));
      document.querySelector('[data-testid="slot-picker"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (needsCode && phoneCode.length !== 6) {
      setCodeError(t('cod.enterCode'));
      document.querySelector('[data-testid="cod-phone-check"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    setError('');
    setCodeError('');
    const phone = normalizePhone(f.phone);
    const address: Record<string, unknown> = {
      recipientName: f.fullName.trim(), phone, countryCode: market.code,
      ...(f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : {}),
    };
    for (const k of fields) if (f[k].trim()) address[k] = f[k].trim();
    try {
      const res = await api<CheckoutResult>('/checkout/guest', {
        method: 'POST',
        auth: 'none',
        cart: true,
        headers: { 'idempotency-key': idemKey.current },
        body: {
          contact: {
            fullName: f.fullName.trim(), email: f.email.trim().toLowerCase(), phone, marketingOptIn: f.marketing || undefined, whatsappOptIn: f.whatsapp || undefined, locale: l,
            phoneCode: needsCode ? phoneCode : undefined,
          },
          address,
          paymentMethod: method,
          deliverySlot: slot || undefined,
          note: note.trim() || undefined,
          returnUrl: `${window.location.origin}/${l}/checkout/return`,
          traffic: trafficForCheckout(),
        },
      });
      const token = res.orderAccessToken!;
      rememberGuestOrder(res.orderNumber, token);
      if (res.payment.status === 'FAILED') {
        idemKey.current = newKey();
        await refresh();
        setError(t('checkout.paymentFailed'));
        setBusy(false);
        return;
      }
      if (res.payment.redirectUrl) {
        try {
          sessionStorage.setItem(PENDING_ORDER_KEY, res.orderNumber);
          sessionStorage.setItem(PENDING_TOKEN_KEY, token);
        } catch { /* the email link still opens the order */ }
        window.location.assign(res.payment.redirectUrl);
        return;
      }
      await refresh();
      router.replace(`${paths.track(l, res.orderNumber, token)}&placed=1`);
    } catch (err) {
      const reason = err instanceof ApiError ? err.reason : undefined;
      if (reason === 'ACCOUNT_EXISTS') {
        setErrors({ email: ' ' });
        setError(<>{t('guest.accountExists')} <Link href={paths.login(l, paths.checkout(l))} className="link">{t('auth.signIn')}</Link></>);
      } else if (reason === 'GUEST_CHECKOUT_OFF') {
        setError(<>{t('guest.off')} <Link href={paths.login(l, paths.checkout(l))} className="link">{t('auth.signIn')}</Link></>);
      } else if (reason === 'COD_PHONE_CODE') {
        setPhoneCode('');
        setCodeError(codErrorMessage(err, t, money));
      } else if ((COD_REASONS as readonly string[]).includes(reason ?? '')) {
        setError(codErrorMessage(err, t, money));
      } else if (err instanceof ApiError && (SLOT_REASONS as readonly string[]).includes(reason ?? '')) {
        setSlot('');
        setSlotMissing(true);
        slots.reload();
        setError(reason === 'SLOT_REQUIRED' ? t('slot.required') : t('slot.taken'));
      } else if (err instanceof ApiError && err.status === 409) {
        idemKey.current = newKey();
        await refresh();
        setError(t('checkout.cartChanged'));
      } else {
        const missing = err instanceof ApiError && Array.isArray(err.body?.missing) ? (err.body!.missing as string[]) : [];
        if (missing.length) setErrors(Object.fromEntries(missing.map((m) => [m, t('errors.required')])));
        setError(errorMessage(err, t));
      }
      setBusy(false);
    }
  }

  if (!cart || loading) {
    return <div className="space-y-4"><div className="skeleton h-8 w-48" /><div className="skeleton h-40" /><div className="skeleton h-40" /></div>;
  }

  const numeric: AddressField[] = ['zone', 'street', 'building'];
  const opt = <span className="ms-1 text-xs font-normal text-ink-400">({t('common.optional')})</span>;

  return (
    <form onSubmit={place} noValidate data-testid="guest-checkout">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('checkout.title')}</h1>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-600"><Lock className="size-3.5" aria-hidden />{t('checkout.secure')}</span>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm">
        <span className="text-ink-700">{t('guest.haveAccount')} {t('guest.signInFaster')}</span>
        <Link href={paths.login(l, paths.checkout(l))} className="btn-secondary px-3 py-1.5" data-testid="guest-sign-in">{t('auth.signIn')}</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-5">
          <section className="card p-5" aria-labelledby="gc-details-h">
            <h2 id="gc-details-h" className="flex items-center gap-2 font-bold"><UserRound className="size-5 text-brand-600" aria-hidden />{t('guest.details')}</h2>
            <p className="mb-4 mt-1 text-sm text-ink-500">{t('guest.subtitle')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="gc-fullName" label={t('guest.fullName')} error={errors.fullName}>
                {(a) => <input {...a} value={f.fullName} onChange={set('fullName')} className="input" autoComplete="name" maxLength={100} />}
              </Field>
              <Field id="gc-phone" label={t('guest.phone')} hint={t('guest.phoneHint')} error={errors.phone}>
                {(a) => <input {...a} type="tel" value={f.phone} onChange={set('phone')} className="input" autoComplete="tel" dir="ltr" placeholder="+974" />}
              </Field>
              <div className="sm:col-span-2">
                <Field id="gc-email" label={t('guest.email')} hint={t('guest.emailHint')} error={errors.email?.trim() ? errors.email : undefined}>
                  {(a) => <input {...a} aria-invalid={!!errors.email || undefined} type="email" value={f.email} onChange={set('email')} className="input" autoComplete="email" dir="ltr" maxLength={200} />}
                </Field>
              </div>
            </div>
            {market.whatsapp?.updates && (
              <label className="mt-4 flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={f.whatsapp} onChange={(e) => setF((x) => ({ ...x, whatsapp: e.target.checked }))} className="size-4 accent-brand-600" data-testid="whatsapp-opt-in" />
                <WhatsAppIcon className="size-4 text-[#25D366]" />{t('whatsapp.optIn')}
              </label>
            )}
            <label className="mt-2 flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={f.marketing} onChange={(e) => setF((x) => ({ ...x, marketing: e.target.checked }))} className="size-4 accent-brand-600" />
              {t('guest.marketing')}
            </label>
          </section>

          <section className="card p-5" aria-labelledby="gc-address-h">
            <h2 id="gc-address-h" className="mb-4 flex items-center gap-2 font-bold"><MapPin className="size-5 text-brand-600" aria-hidden />{t('checkout.address')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((k) => (
                <Field key={k} id={`gc-${k}`} label={<>{t(`address.${k}`)}{!required.has(k) && opt}</>} error={errors[k]}>
                  {(a) => (
                    <input
                      {...a}
                      name={k}
                      value={f[k]}
                      onChange={set(k)}
                      className="input"
                      maxLength={k === 'line1' ? 200 : 60}
                      inputMode={market.code === 'QA' && numeric.includes(k) ? 'numeric' : undefined}
                      autoComplete={k === 'city' ? 'address-level2' : k === 'postalCode' ? 'postal-code' : k === 'line1' ? 'address-line1' : 'off'}
                    />
                  )}
                </Field>
              ))}
            </div>
            {market.code === 'QA' && <p className="hint mt-2">{t('address.qatarHint')}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={locate} disabled={locating} className="btn-secondary">
                {locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" aria-hidden />}{t('address.useLocation')}
              </button>
              {f.lat !== null && <p className="text-xs text-ink-500" role="status">{t('address.locationSaved')}</p>}
            </div>
          </section>

          <SlotPicker data={slots.data} value={slot} onChange={(v) => { setSlot(v); setSlotMissing(false); }} invalid={slotMissing} />

          <section className="card p-5" aria-labelledby="gc-pay">
            <h2 id="gc-pay" className="mb-4 flex items-center gap-2 font-bold"><CreditCard className="size-5 text-brand-600" aria-hidden />{t('checkout.payment')}</h2>
            <ul className="space-y-2" role="radiogroup" aria-labelledby="gc-pay">
              {market.paymentMethods.map((m) => {
                const I = ICON[m];
                const off = m === 'COD' && !cod.ok;
                return (
                  <li key={m}>
                    <label className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${off ? 'cursor-not-allowed border-ink-100 opacity-60' : 'cursor-pointer'} ${method === m ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : off ? '' : 'border-ink-200 hover:border-ink-300'}`}>
                      <input type="radio" name="payment" value={m} checked={method === m} disabled={off} onChange={() => setMethod(m)} className="mt-1 size-4 accent-brand-600" data-testid={`pay-${m}`} />
                      <I className="mt-0.5 size-5 shrink-0 text-ink-500" aria-hidden />
                      <span className="text-sm">
                        <span className="block font-semibold text-ink-900">{m === 'CARD' && market.cardProvider === 'dibsy' ? t('checkout.hostedCard') : t(`checkout.method.${m}`)}</span>
                        <span className="block text-ink-500">
                          {off && !cod.ok
                            ? (cod.why === 'limit' ? t('cod.limit', { amount: money(cod.maxMinor!) }) : t('cod.signInForCash'))
                            : m === 'CARD' && market.cardProvider === 'dibsy' ? t('checkout.hostedCardHint') : t(`checkout.methodHint.${m}`)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {method === 'COD' && market.cod?.guestPhoneCheck && (
              <GuestPhoneCheck t={t} contact={codeContact} code={phoneCode} onCode={(v) => { setPhoneCode(v); setCodeError(''); }} verified={phoneVerified} onVerified={setPhoneVerified} invalid={codeError} />
            )}
            {market.testPayments && method && method !== 'COD' && <p className="mt-3 rounded-xl bg-sand-50 px-3.5 py-2.5 text-xs text-sand-700">{t('checkout.testMode')}</p>}
          </section>

          <section className="card p-5">
            <label htmlFor="gc-note" className="label">{t('checkout.note')} {opt}</label>
            <textarea id="gc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={t('checkout.notePlaceholder')} className="input resize-y" />
          </section>

          <section className="card p-5" aria-labelledby="gc-items">
            <h2 id="gc-items" className="mb-3 font-bold">{t('checkout.items')} ({t.plural('common.items', cart.totals.itemCount)})</h2>
            <ul className="space-y-2">
              {cart.groups.flatMap((g) => g.items).map((i) => (
                <li key={i.id} className="flex items-center gap-3 text-sm">
                  <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-ink-50">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="48px" className="object-contain p-1" />}</span>
                  <span className="line-clamp-1 flex-1 text-ink-800">{pick(l, i.title, i.titleAr)}</span>
                  <span className="tabular text-ink-500">×{i.quantity}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="card sticky top-36 space-y-4 p-5">
          <h2 className="text-base font-bold">{t('cart.summary')}</h2>
          <Totals cart={cart} />
          <FormError message={error} />
          {!cart.canCheckout && <p className="text-sm text-warning-600"><Link href={paths.cart(l)} className="link">{t('cart.attention')}</Link></p>}
          <button type="submit" disabled={busy || !method || !cart.canCheckout} className="btn-primary btn-lg w-full" data-testid="place-order">
            {busy && <Spinner />}{busy ? t('checkout.placing') : t('checkout.placeOrder')}
          </button>
          <p className="text-xs leading-5 text-ink-500">{t('checkout.agree')}</p>
          <p className="text-xs leading-5 text-ink-500">{t('guest.saveLater')}</p>
        </aside>
      </div>
    </form>
  );
}
