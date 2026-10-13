'use client';

import { BadgeCheck, Banknote, Check, ChevronDown, ExternalLink, LogIn, Package, ShieldCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api, refreshSession } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { policy, POLICY_UPDATED } from '@/lib/policies';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { PolicyBody } from '../content/PolicyBody';
import { Spinner } from '../ui/Spinner';

/**
 * "Sell on FastMoveX": why, the seller policy (in short, and in full right here), and a short form that opens the
 * seller account (the rest is in the application). Signed-out visitors see everything except the form.
 */
export function BecomeSeller({ onCreated, guest = false }: { onCreated?: () => Promise<void>; guest?: boolean }) {
  const t = useT();
  const l = t.locale;
  const { user, reload } = useSession();
  const toast = useToast();
  const [f, setF] = useState({
    businessName: '', storeName: '', storeNameAr: '', contactEmail: user?.email ?? '', contactPhone: user?.phone ?? '+974', commercialRegNo: '',
  });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agree) { setError(t('seller.join.agreeFirst')); return; }
    setBusy(true);
    setError('');
    try {
      const phone = f.contactPhone.replace(/[\s-]/g, '');
      await api('/seller/apply', {
        method: 'POST',
        body: {
          businessName: f.businessName, storeName: f.storeName, contactEmail: f.contactEmail, contactPhone: phone,
          ...(f.storeNameAr.trim() && { storeNameAr: f.storeNameAr }), ...(f.commercialRegNo.trim() && { commercialRegNo: f.commercialRegNo }),
          acceptedPolicy: POLICY_UPDATED,
        },
      });
      await refreshSession(true); // the new SELLER role is in the next token
      await reload();
      toast({ tone: 'success', message: t('seller.join.created') });
      await onCreated?.();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const points = [
    { Icon: Package, text: t('seller.join.point1') },
    { Icon: Truck, text: t('seller.join.point2') },
    { Icon: BadgeCheck, text: t('seller.join.point3') },
    { Icon: Banknote, text: t('seller.join.point4') },
  ];
  const sp = policy('seller', l);
  const rules = [t('seller.join.rule1'), t('seller.join.rule2'), t('seller.join.rule3'), t('seller.join.rule4'), t('seller.join.rule5')];
  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10" data-testid="become-seller">
      <div className="min-w-0 space-y-6">
        <section className="rounded-3xl bg-gradient-to-br from-brand-700 to-brand-500 p-6 text-white sm:p-8">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-3xl">{t('seller.join.title')}</h1>
          <p className="mt-3 text-white/90">{t('seller.join.lead')}</p>
          <ul className="mt-6 space-y-3">
            {points.map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15"><Icon className="size-5" aria-hidden /></span><span className="pt-1.5 text-[15px]">{text}</span></li>
            ))}
          </ul>
        </section>

        <section className="card p-5 sm:p-6" data-testid="seller-policy-summary">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900"><ShieldCheck className="size-5 text-brand-600" aria-hidden />{t('seller.join.rulesTitle')}</h2>
          <ul className="mt-4 space-y-2.5">
            {rules.map((r) => <li key={r} className="flex items-start gap-2.5 text-[15px] text-ink-700"><Check className="mt-1 size-4 shrink-0 text-success-600" aria-hidden />{r}</li>)}
          </ul>
          <details className="group mt-5 rounded-xl border border-ink-200" data-testid="seller-policy-full">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-brand-700">
              {t('seller.join.readAll')}<ChevronDown className="size-5 transition group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-ink-100 px-4 py-5">
              <p className="mb-6 text-sm text-ink-500">{sp.intro}</p>
              <PolicyBody sections={sp.sections} locale={l} headingLevel={3} />
            </div>
          </details>
          <Link href={paths.sellerPolicy(l)} target="_blank" className="link mt-3 inline-flex items-center gap-1.5 text-sm">{t('seller.join.openPage')}<ExternalLink className="size-3.5" aria-hidden /></Link>
        </section>
      </div>

      <div className="lg:sticky lg:top-36 lg:self-start">
        {guest ? (
          <section className="card space-y-4 p-5 sm:p-6" data-testid="become-seller-guest">
            <h2 className="text-lg font-bold text-ink-900">{t('seller.join.guestTitle')}</h2>
            <p className="text-[15px] text-ink-600">{t('seller.join.guestText')}</p>
            <Link href={paths.login(l, paths.seller(l))} className="btn-primary btn-lg w-full" data-testid="become-seller-signin"><LogIn className="size-5 rtl:rotate-180" aria-hidden />{t('seller.join.signInButton')}</Link>
          </section>
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6" noValidate>
            <Field id="bs-business" label={t('seller.join.businessName')}><input id="bs-business" className="input" required minLength={2} maxLength={120} value={f.businessName} onChange={set('businessName')} autoComplete="organization" /></Field>
            <Field id="bs-store" label={t('seller.join.storeName')}><input id="bs-store" className="input" required minLength={2} maxLength={60} value={f.storeName} onChange={set('storeName')} /></Field>
            <Field id="bs-store-ar" label={t('seller.join.storeNameAr')}><input id="bs-store-ar" className="input" dir="rtl" maxLength={60} value={f.storeNameAr} onChange={set('storeNameAr')} /></Field>
            <Field id="bs-email" label={t('seller.join.email')}><input id="bs-email" type="email" className="input" required value={f.contactEmail} onChange={set('contactEmail')} autoComplete="email" dir="ltr" /></Field>
            <Field id="bs-phone" label={t('seller.join.phone')} hint={t('seller.join.phoneHint')}><input id="bs-phone" type="tel" className="input" required value={f.contactPhone} onChange={set('contactPhone')} autoComplete="tel" dir="ltr" /></Field>
            <Field id="bs-cr" label={t('seller.join.cr')}><input id="bs-cr" className="input" maxLength={40} value={f.commercialRegNo} onChange={set('commercialRegNo')} dir="ltr" /></Field>
            <div className="rounded-xl bg-sand-50 p-3.5">
              <label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-ink-800">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand-600" checked={agree} onChange={(e) => { setAgree(e.target.checked); setError(''); }} data-testid="seller-agree" />
                <span>{t('seller.join.agree')}</span>
              </label>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 ps-8 text-xs">
                <Link href={paths.sellerPolicy(l)} target="_blank" className="link">{t('footer.sellerPolicy')}</Link>
                <Link href={paths.terms(l)} target="_blank" className="link">{t('footer.terms')}</Link>
                <Link href={paths.privacy(l)} target="_blank" className="link">{t('footer.privacy')}</Link>
              </p>
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button type="submit" className="btn-primary btn-lg w-full" disabled={busy || !agree || !f.businessName.trim() || !f.storeName.trim()} data-testid="become-seller-submit">
              {busy && <Spinner />}{t('seller.join.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
