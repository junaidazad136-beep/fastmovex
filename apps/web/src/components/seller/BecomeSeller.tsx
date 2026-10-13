'use client';

import { BadgeCheck, Banknote, Package, Truck } from 'lucide-react';
import { useState } from 'react';
import { api, refreshSession } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { Spinner } from '../ui/Spinner';

/** "Sell on FastMoveX": why, and a short form that opens the seller account (the rest is in the application). */
export function BecomeSeller({ onCreated }: { onCreated: () => Promise<void> }) {
  const t = useT();
  const { user, reload } = useSession();
  const toast = useToast();
  const [f, setF] = useState({
    businessName: '', storeName: '', storeNameAr: '', contactEmail: user?.email ?? '', contactPhone: user?.phone ?? '+974', commercialRegNo: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const phone = f.contactPhone.replace(/[\s-]/g, '');
      await api('/seller/apply', {
        method: 'POST',
        body: {
          businessName: f.businessName, storeName: f.storeName, contactEmail: f.contactEmail, contactPhone: phone,
          ...(f.storeNameAr.trim() && { storeNameAr: f.storeNameAr }), ...(f.commercialRegNo.trim() && { commercialRegNo: f.commercialRegNo }),
        },
      });
      await refreshSession(true); // the new SELLER role is in the next token
      await reload();
      toast({ tone: 'success', message: t('seller.join.created') });
      await onCreated();
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
  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2 lg:gap-10" data-testid="become-seller">
      <section className="rounded-3xl bg-gradient-to-br from-brand-700 to-brand-500 p-6 text-white sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('seller.join.title')}</h1>
        <p className="mt-3 text-white/90">{t('seller.join.lead')}</p>
        <ul className="mt-6 space-y-3">
          {points.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15"><Icon className="size-5" aria-hidden /></span><span className="pt-1.5 text-[15px]">{text}</span></li>
          ))}
        </ul>
      </section>
      <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6" noValidate>
        <Field id="bs-business" label={t('seller.join.businessName')}><input id="bs-business" className="input" required minLength={2} maxLength={120} value={f.businessName} onChange={set('businessName')} autoComplete="organization" /></Field>
        <Field id="bs-store" label={t('seller.join.storeName')}><input id="bs-store" className="input" required minLength={2} maxLength={60} value={f.storeName} onChange={set('storeName')} /></Field>
        <Field id="bs-store-ar" label={t('seller.join.storeNameAr')}><input id="bs-store-ar" className="input" dir="rtl" maxLength={60} value={f.storeNameAr} onChange={set('storeNameAr')} /></Field>
        <Field id="bs-email" label={t('seller.join.email')}><input id="bs-email" type="email" className="input" required value={f.contactEmail} onChange={set('contactEmail')} autoComplete="email" dir="ltr" /></Field>
        <Field id="bs-phone" label={t('seller.join.phone')} hint={t('seller.join.phoneHint')}><input id="bs-phone" type="tel" className="input" required value={f.contactPhone} onChange={set('contactPhone')} autoComplete="tel" dir="ltr" /></Field>
        <Field id="bs-cr" label={t('seller.join.cr')}><input id="bs-cr" className="input" maxLength={40} value={f.commercialRegNo} onChange={set('commercialRegNo')} dir="ltr" /></Field>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary btn-lg w-full" disabled={busy || !f.businessName.trim() || !f.storeName.trim()} data-testid="become-seller-submit">
          {busy && <Spinner />}{t('seller.join.submit')}
        </button>
      </form>
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
