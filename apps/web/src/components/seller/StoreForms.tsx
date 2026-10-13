'use client';

import { Check, ImagePlus, Landmark, Upload } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { Spinner } from '../ui/Spinner';
import { Field } from './BecomeSeller';
import type { SellerMe } from './types';

/** IBAN as typed (spaces allowed), sent without spaces and upper-case. */
export const cleanIban = (v: string) => v.replace(/\s+/g, '').toUpperCase();

export function BankForm({ me, onSaved }: { me: SellerMe; onSaved: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [f, setF] = useState({ bankName: me.bankName ?? '', accountHolder: me.accountHolder ?? '', iban: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/seller/me/bank', { method: 'PUT', body: { bankName: f.bankName, accountHolder: f.accountHolder, iban: cleanIban(f.iban) } });
      setF((x) => ({ ...x, iban: '' }));
      toast({ tone: 'success', message: t('seller.onboarding.saved') });
      await onSaved();
    } catch (err) { setError(errorMessage(err, t)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="space-y-3" data-testid="bank-form">
      {me.ibanLast4 && <p className="flex items-center gap-2 text-sm font-medium text-success-700"><Landmark className="size-4" aria-hidden />{me.bankName} · {t('seller.onboarding.ibanSaved', { last4: me.ibanLast4 })}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="bk-name" label={t('seller.onboarding.bankName')}><input id="bk-name" className="input" required value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
        <Field id="bk-holder" label={t('seller.onboarding.accountHolder')}><input id="bk-holder" className="input" required value={f.accountHolder} onChange={(e) => setF({ ...f, accountHolder: e.target.value })} /></Field>
      </div>
      <Field id="bk-iban" label={t('seller.onboarding.iban')} hint={t('seller.onboarding.ibanHint')}>
        <input id="bk-iban" className="input font-mono" dir="ltr" required placeholder="QA00 XXXX 0000 0000 0000 0000 0000 0" value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} autoComplete="off" />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn-secondary" disabled={busy || cleanIban(f.iban).length < 15 || !f.bankName.trim() || !f.accountHolder.trim()}>{busy && <Spinner />}{t('seller.onboarding.save')}</button>
    </form>
  );
}

/** One file to the API (multipart): a CR document or the store logo. */
export function UploadButton({ path, field = 'file', extra, accept, label, onDone, testId }: {
  path: string; field?: string; extra?: Record<string, string>; accept: string; label: string; onDone: () => Promise<void>; testId?: string;
}) {
  const t = useT();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
      fd.append(field, file);
      await api(path, { method: 'POST', body: fd });
      toast({ tone: 'success', message: t('seller.onboarding.uploaded') });
      await onDone();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(false); }
  }
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="sr-only" onChange={pick} tabIndex={-1} aria-hidden data-testid={testId ? `${testId}-input` : undefined} />
      <button type="button" className="btn-secondary" onClick={() => ref.current?.click()} disabled={busy} data-testid={testId}>
        {busy ? <Spinner /> : <Upload className="size-4" aria-hidden />}{label}
      </button>
    </>
  );
}

export function LogoBlock({ me, onDone }: { me: SellerMe; onDone: () => Promise<void> }) {
  const t = useT();
  return (
    <div className="flex items-center gap-4">
      <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-ink-50 ring-1 ring-ink-100">
        {me.store?.logoUrl ? <Image src={me.store.logoUrl} alt="" fill sizes="64px" className="object-cover" unoptimized /> : <ImagePlus className="size-6 text-ink-400" aria-hidden />}
      </span>
      <UploadButton path="/seller/me/logo" accept="image/jpeg,image/png,image/webp" label={t('seller.onboarding.uploadLogo')} onDone={onDone} testId="logo-upload" />
    </div>
  );
}

export function StoreProfileForm({ me, onSaved }: { me: SellerMe; onSaved: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [f, setF] = useState({
    storeName: me.store?.name ?? '', storeNameAr: me.store?.nameAr ?? '', contactPhone: me.contactPhone, contactEmail: me.contactEmail,
    description: me.store?.description ?? '', descriptionAr: me.store?.descriptionAr ?? '', city: me.store?.city ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/seller/me', {
        method: 'PATCH',
        body: {
          storeName: f.storeName, contactPhone: f.contactPhone.replace(/[\s-]/g, ''), contactEmail: f.contactEmail,
          ...(f.storeNameAr.trim() && { storeNameAr: f.storeNameAr }), ...(f.city.trim() && { city: f.city }),
          description: f.description, descriptionAr: f.descriptionAr,
        },
      });
      toast({ tone: 'success', message: t('seller.onboarding.saved') });
      await onSaved();
    } catch (err) { setError(errorMessage(err, t)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={save} className="space-y-3" data-testid="store-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="st-name" label={t('seller.join.storeName')}><input id="st-name" className="input" required value={f.storeName} onChange={set('storeName')} /></Field>
        <Field id="st-name-ar" label={t('seller.join.storeNameAr')}><input id="st-name-ar" className="input" dir="rtl" value={f.storeNameAr} onChange={set('storeNameAr')} /></Field>
        <Field id="st-phone" label={t('seller.join.phone')}><input id="st-phone" type="tel" className="input" dir="ltr" required value={f.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field id="st-email" label={t('seller.join.email')}><input id="st-email" type="email" className="input" dir="ltr" required value={f.contactEmail} onChange={set('contactEmail')} /></Field>
        <Field id="st-city" label={t('seller.store.city')}><input id="st-city" className="input" value={f.city} onChange={set('city')} /></Field>
      </div>
      <Field id="st-desc" label={t('seller.store.description')}><textarea id="st-desc" className="input min-h-24" maxLength={2000} value={f.description} onChange={set('description')} /></Field>
      <Field id="st-desc-ar" label={t('seller.store.descriptionAr')}><textarea id="st-desc-ar" className="input min-h-24" dir="rtl" maxLength={2000} value={f.descriptionAr} onChange={set('descriptionAr')} /></Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn-secondary" disabled={busy}>{busy ? <Spinner /> : <Check className="size-4" aria-hidden />}{t('seller.onboarding.save')}</button>
    </form>
  );
}
