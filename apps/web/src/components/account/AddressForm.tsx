'use client';

import { LocateFixed } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { Address, AddressField } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useShop } from '@/lib/state/shop';
import { E164, Field, FormError, normalizePhone } from '../auth/fields';
import { Spinner } from '../ui/Spinner';

type Form = Record<AddressField | 'label' | 'recipientName' | 'phone', string> & { isDefault: boolean; lat: number | null; lng: number | null };

/** Address form driven by the market's address format (Qatar: zone / street / building numbers). */
export function AddressForm({ initial, onSaved, onCancel }: { initial?: Address | null; onSaved: (a: Address) => void; onCancel?: () => void }) {
  const t = useT();
  const { market } = useShop();
  const { user } = useSession();
  const fields = market.addressFormat.fields;
  const required = new Set<string>(['recipientName', 'phone', 'city', ...market.addressFormat.required]);
  const [f, setF] = useState<Form>(() => ({
    label: initial?.label ?? t('address.labelHome'),
    recipientName: initial?.recipientName ?? user?.fullName ?? '',
    phone: initial?.phone ?? user?.phone ?? '',
    city: initial?.city ?? '',
    zone: initial?.zone ?? '',
    street: initial?.street ?? '',
    building: initial?.building ?? '',
    unit: initial?.unit ?? '',
    line1: initial?.line1 ?? '',
    postalCode: initial?.postalCode ?? '',
    isDefault: initial?.isDefault ?? false,
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState('');
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  function locate() {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setF((x) => ({ ...x, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) })); setLocNote(t('address.locationSaved')); setLocating(false); },
      () => { setLocNote(t('address.locationDenied')); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const k of required) if (!String(f[k as keyof Form] ?? '').trim()) errs[k] = t('errors.required');
    if (f.phone && !E164.test(normalizePhone(f.phone))) errs.phone = t('errors.invalidPhone');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    const body: Record<string, unknown> = {
      label: f.label.trim() || undefined,
      recipientName: f.recipientName.trim(),
      phone: normalizePhone(f.phone),
      countryCode: market.code,
      isDefault: f.isDefault,
      ...(f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : {}),
    };
    for (const k of fields) if (f[k].trim()) body[k] = f[k].trim();
    try {
      const saved = initial
        ? await api<Address>(`/addresses/${initial.id}`, { method: 'PATCH', body })
        : await api<Address>('/addresses', { method: 'POST', body });
      onSaved(saved);
    } catch (err) {
      const missing = err instanceof ApiError && Array.isArray(err.body?.missing) ? (err.body!.missing as string[]) : [];
      if (missing.length) setErrors(Object.fromEntries(missing.map((m) => [m, t('errors.required')])));
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  const labels = [t('address.labelHome'), t('address.labelWork'), t('address.labelOther')];
  const label = (k: AddressField) => t(`address.${k}`);
  const numeric: AddressField[] = ['zone', 'street', 'building'];

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="address-form">
      <FormError message={error} />
      <fieldset>
        <legend className="label">{t('address.label')}</legend>
        <div className="flex flex-wrap gap-2">
          {labels.map((x) => (
            <button key={x} type="button" onClick={() => setF((v) => ({ ...v, label: x }))} aria-pressed={f.label === x} className={`chip ${f.label === x ? 'chip-active' : ''}`}>{x}</button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('address.recipientName')} error={errors.recipientName}>
          {(a) => <input {...a} value={f.recipientName} onChange={set('recipientName')} className="input" autoComplete="name" maxLength={100} />}
        </Field>
        <Field label={t('address.phone')} error={errors.phone}>
          {(a) => <input {...a} type="tel" value={f.phone} onChange={set('phone')} className="input" autoComplete="tel" dir="ltr" placeholder="+974" />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((k) => (
          <Field key={k} label={<>{label(k)}{!required.has(k) && <span className="ms-1 text-xs font-normal text-ink-400">({t('common.optional')})</span>}</>} error={errors[k]}>
            {(a) => (
              <input {...a} name={k} value={f[k]} onChange={set(k)} className="input" maxLength={k === 'line1' ? 200 : 60} inputMode={market.code === 'QA' && numeric.includes(k) ? 'numeric' : undefined} autoComplete={k === 'city' ? 'address-level2' : k === 'postalCode' ? 'postal-code' : k === 'line1' ? 'address-line1' : 'off'} />
            )}
          </Field>
        ))}
      </div>
      {market.code === 'QA' && <p className="hint">{t('address.qatarHint')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={locate} disabled={locating} className="btn-secondary">
          {locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" aria-hidden />}{t('address.useLocation')}
        </button>
        {locNote && <p className="text-xs text-ink-500" role="status">{locNote}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.isDefault} onChange={(e) => setF((x) => ({ ...x, isDefault: e.target.checked }))} className="size-4 accent-brand-600" />
        {t('address.makeDefault')}
      </label>
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={busy} className="btn-primary flex-1" data-testid="address-save">{busy && <Spinner className="size-4" />}{t('common.save')}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>}
      </div>
    </form>
  );
}

/** One-line address in the page language, e.g. "Flat 4, Building 12, Street 901, Zone 66, Doha". */
export function formatAddress(a: Partial<Address>, t: ReturnType<typeof useT>): string {
  const parts = [
    a.unit,
    a.building && `${t('address.building')} ${a.building}`,
    a.street && `${t('address.street')} ${a.street}`,
    a.zone && `${t('address.zone')} ${a.zone}`,
    a.line1,
    a.city,
    a.postalCode,
  ];
  return parts.filter(Boolean).join(t.locale === 'ar' ? '، ' : ', ');
}
