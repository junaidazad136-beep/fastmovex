'use client';

import { CalendarClock, History, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { Address, AddressField, OrderDetail } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useMoney, useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { E164, FormError, normalizePhone } from '../auth/fields';
import { SLOT_REASONS, SlotPicker, useDeliverySlots } from '../checkout/SlotPicker';
import { Spinner } from '../ui/Spinner';
import { formatAddress } from './AddressForm';

/**
 * Before the order is packed the customer can move it to another delivery window or another address
 * (signed in: one of their saved addresses; guests: type the new address). Limited to a few changes per order.
 */
export function ChangeDelivery({ order, guestToken, onChanged }: { order: OrderDetail; guestToken?: string; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState<'time' | 'address' | null>(null);
  const slots = useDeliverySlots();
  const opts = order.changeOptions;
  if (!opts?.canChange) return null;
  const base = guestToken ? `/orders/guest/${encodeURIComponent(order.orderNumber)}` : `/orders/${encodeURIComponent(order.orderNumber)}`;
  const req = guestToken ? { auth: 'none' as const, headers: { 'x-order-token': guestToken } } : {};
  const done = () => { setOpen(null); onChanged(); };
  return (
    <section className="card space-y-3 p-4 text-sm" data-testid="change-delivery">
      <div>
        <h2 className="font-bold">{t('order.change.title')}</h2>
        <p className="text-ink-600">{t('order.change.intro')}</p>
        <p className="mt-0.5 text-xs text-ink-400">{t.plural('order.change.left', opts.changesLeft)}</p>
      </div>
      {open === null && (
        <div className="flex flex-wrap gap-2">
          {slots.data?.enabled && <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen('time')} data-testid="change-time"><CalendarClock className="size-4" aria-hidden />{t('order.change.time')}</button>}
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen('address')} data-testid="change-address"><MapPin className="size-4" aria-hidden />{t('order.change.address')}</button>
        </div>
      )}
      {open === 'time' && <TimeForm base={base} req={req} slots={slots} onCancel={() => setOpen(null)} onDone={done} />}
      {open === 'address' && (guestToken ? <GuestAddressForm base={base} req={req} onCancel={() => setOpen(null)} onDone={done} /> : <SavedAddressForm base={base} current={order.shippingAddress} onCancel={() => setOpen(null)} onDone={done} />)}
    </section>
  );
}

type Req = { auth?: 'none'; headers?: Record<string, string> };

function TimeForm({ base, req, slots, onCancel, onDone }: { base: string; req: Req; slots: ReturnType<typeof useDeliverySlots>; onCancel: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [slot, setSlot] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!slot) return;
    setBusy(true); setError('');
    try {
      await api(`${base}/slot`, { ...req, method: 'PUT', body: { deliverySlot: slot } });
      toast({ tone: 'success', message: t('order.change.savedTime') });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && (SLOT_REASONS as readonly string[]).includes(e.reason ?? '')) { setSlot(''); slots.reload(); setError(t('slot.taken')); } else setError(errorMessage(e, t));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3" data-testid="change-time-form">
      <FormError message={error} />
      <SlotPicker data={slots.data} value={slot} onChange={setSlot} />
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!slot || busy} onClick={save} data-testid="change-time-save">{busy && <Spinner className="size-4" />}{t('order.change.save')}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('order.change.cancel')}</button>
      </div>
    </div>
  );
}

function SavedAddressForm({ base, current, onCancel, onDone }: { base: string; current: OrderDetail['shippingAddress']; onCancel: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const l = t.locale;
  const [list, setList] = useState<Address[] | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Address[] | { items: Address[] }>('/addresses').then((r) => setList(Array.isArray(r) ? r : r.items)).catch(() => setList([])); }, []);
  const currentId = (current as { addressId?: string }).addressId;
  async function save() {
    if (!pick) return;
    setBusy(true); setError('');
    try {
      await api(`${base}/address`, { method: 'PUT', body: { addressId: pick } });
      toast({ tone: 'success', message: t('order.change.savedAddress') });
      onDone();
    } catch (e) { setError(errorMessage(e, t)); setBusy(false); }
  }
  if (!list) return <div className="skeleton h-24" />;
  const choices = list.filter((a) => a.id !== currentId);
  return (
    <div className="space-y-3" data-testid="change-address-form">
      <FormError message={error} />
      <fieldset className="space-y-2">
        <legend className="label">{t('order.change.chooseAddress')}</legend>
        {choices.length === 0 && <p className="text-ink-600" data-testid="no-other-address">{t('order.change.noOther')}</p>}
        {choices.map((a) => (
          <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${pick === a.id ? 'border-brand-600 bg-brand-50' : 'border-ink-200'}`}>
            <input type="radio" name="new-address" checked={pick === a.id} onChange={() => setPick(a.id)} className="mt-0.5 accent-brand-600" />
            <span>{a.label && <span className="font-semibold">{a.label} · </span>}{formatAddress(a, t)}</span>
          </label>
        ))}
      </fieldset>
      <Link href={paths.addresses(l)} className="link inline-block text-sm">{t('order.change.addAddress')}</Link>
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!pick || busy} onClick={save} data-testid="change-address-save">{busy && <Spinner className="size-4" />}{t('order.change.save')}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('order.change.cancel')}</button>
      </div>
    </div>
  );
}

function GuestAddressForm({ base, req, onCancel, onDone }: { base: string; req: Req; onCancel: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { market } = useShop();
  const fields = market.addressFormat.fields as AddressField[];
  const required = new Set<string>(['recipientName', 'phone', 'city', ...market.addressFormat.required]);
  const [f, setF] = useState<Record<string, string>>({ recipientName: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const missing = [...required].filter((k) => !(f[k] ?? '').trim());
    if (missing.length) { setError(t('errors.required')); return; }
    if (!E164.test(normalizePhone(f.phone))) { setError(t('errors.invalidPhone')); return; }
    setBusy(true); setError('');
    const address = Object.fromEntries(Object.entries({ ...f, phone: normalizePhone(f.phone) }).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    try {
      await api(`${base}/address`, { ...req, method: 'PUT', body: { address: { ...address, countryCode: market.code } } });
      toast({ tone: 'success', message: t('order.change.savedAddress') });
      onDone();
    } catch (err) { setError(errorMessage(err, t)); setBusy(false); }
  }
  const input = (k: string, label: string, type = 'text') => (
    <label key={k} className="block"><span className="label">{label}</span>
      <input className="input" type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} dir={k === 'phone' ? 'ltr' : undefined} maxLength={k === 'line1' ? 200 : 100} name={k} />
    </label>
  );
  return (
    <form onSubmit={save} className="space-y-3" noValidate data-testid="change-address-form">
      <p className="font-medium">{t('order.change.newAddress')}</p>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {input('recipientName', t('address.recipientName'))}
        {input('phone', t('address.phone'), 'tel')}
        {fields.map((k) => input(k, t(`address.${k}`)))}
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={busy} data-testid="change-address-save">{busy && <Spinner className="size-4" />}{t('order.change.save')}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('order.change.cancel')}</button>
      </div>
    </form>
  );
}

/** What changed on the order after checkout, newest last. */
export function OrderUpdates({ order }: { order: OrderDetail }) {
  const t = useT();
  const money = useMoney();
  if (!order.changes?.length) return null;
  return (
    <section className="card p-4 text-sm" data-testid="order-updates">
      <h2 className="mb-3 flex items-center gap-2 font-bold"><History className="size-4 text-brand-600" aria-hidden />{t('order.change.updates')}</h2>
      <ol className="space-y-2.5 border-s border-ink-200 ps-4">
        {order.changes.map((c, i) => (
          <li key={i}>
            <p className="font-medium">{t(`order.change.kind.${c.kind}`)}</p>
            <p className="text-ink-600" dir="auto">{c.summary}</p>
            {c.amountMinor !== '0' && (c.kind === 'ADDED'
              ? <p className="text-ink-700">{t('order.change.more', { amount: money(c.amountMinor, { currency: order.currencyCode }) })}</p>
              : <p className="text-success-700">{t('order.change.less', { amount: money(c.amountMinor, { currency: order.currencyCode }) })}</p>)}
            <p className="text-xs text-ink-400">{formatDateTime(c.createdAt, t.locale)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
