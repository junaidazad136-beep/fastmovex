'use client';

import { Plus, TicketPercent } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { decimalToMinor } from '@/lib/money';
import { useMoney, useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { Field } from './BecomeSeller';
import { Empty, ListSkeleton, MoreButton, useDate } from './kit';

type CouponType = 'PERCENTAGE' | 'FIXED' | 'FREE_DELIVERY';
interface Coupon {
  id: string; code: string; type: CouponType; valueBps: number | null; valueMinor: string | null; maxDiscountMinor: string | null; minOrderMinor: string;
  startsAt: string; endsAt: string; usageLimit: number | null; usedCount: number; perUserLimit: number; isActive: boolean; firstOrderOnly: boolean;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The store's own discount codes. The store pays the discount (it comes off its earnings, not FastMoveX's), and a code
 * works only on this store's products. Customers type the code in the cart.
 */
export function SellerCoupons() {
  const t = useT();
  const toast = useToast();
  const money = useMoney();
  const date = useDate();
  const [items, setItems] = useState<Coupon[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (more?: string) => {
    try {
      const r = await api<{ items: Coupon[]; nextCursor: string | null }>(`/seller/coupons${more ? `?cursor=${encodeURIComponent(more)}` : ''}`);
      setItems((x) => (more && x ? [...x, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
  }, [toast, t]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(c: Coupon) {
    setBusy(c.id);
    try {
      const u = await api<Coupon>(`/seller/coupons/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
      setItems((x) => x?.map((y) => (y.id === c.id ? { ...y, isActive: u.isActive } : y)) ?? null);
      toast({ tone: 'success', message: u.isActive ? t('seller.coupons.turnedOn') : t('seller.coupons.turnedOff') });
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(null); }
  }

  const value = (c: Coupon) => (c.type === 'PERCENTAGE' ? `${(c.valueBps ?? 0) / 100}%` : c.type === 'FIXED' ? money(c.valueMinor) : t('seller.coupons.freeDelivery'));
  const state = (c: Coupon): 'on' | 'off' | 'soon' | 'ended' | 'used' => {
    const now = Date.now();
    if (!c.isActive) return 'off';
    if (new Date(c.endsAt).getTime() < now) return 'ended';
    if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'used';
    if (new Date(c.startsAt).getTime() > now) return 'soon';
    return 'on';
  };
  const TONE = { on: 'bg-success-50 text-success-700', soon: 'bg-sky-50 text-sky-700', off: 'bg-ink-100 text-ink-600', ended: 'bg-ink-100 text-ink-600', used: 'bg-warning-50 text-warning-600' };

  return (
    <div className="space-y-5" data-testid="seller-coupons">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.coupons.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">{t('seller.coupons.lead')}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)} data-testid="coupon-new"><Plus className="size-4" aria-hidden />{t('seller.coupons.new')}</button>
      </div>
      {!items ? <ListSkeleton /> : items.length === 0 ? (
        <Empty icon={<TicketPercent className="size-6" aria-hidden />} title={t('seller.coupons.empty')} text={t('seller.coupons.emptyHint')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => {
            const s = state(c);
            return (
              <li key={c.id} className="card flex flex-col gap-2 p-4" data-testid="seller-coupon">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-lg font-bold tracking-wide text-brand-700" dir="ltr">{c.code}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[s]}`}>{t(`seller.coupons.state.${s}`)}</span>
                </div>
                <p className="text-sm font-semibold text-ink-900">
                  {t('seller.coupons.off', { value: value(c) })}
                  {c.minOrderMinor !== '0' && <span className="font-normal text-ink-600"> · {t('seller.coupons.minOrderShort', { amount: money(c.minOrderMinor) })}</span>}
                </p>
                <p className="text-xs text-ink-500">
                  {date(c.startsAt)} – {date(c.endsAt)} · {t('seller.coupons.used', { n: c.usedCount, of: c.usageLimit ?? '∞' })}
                  {c.firstOrderOnly && ` · ${t('seller.coupons.firstOrder')}`}
                </p>
                {s !== 'ended' && (
                  <button type="button" className="btn-secondary mt-1 self-start px-3 py-1.5 text-sm" disabled={busy === c.id} onClick={() => toggle(c)} data-testid="coupon-toggle">
                    {busy === c.id && <Spinner className="size-4" />}{c.isActive ? t('seller.coupons.turnOff') : t('seller.coupons.turnOn')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <MoreButton cursor={cursor} busy={false} onMore={() => load(cursor!)} />
      <NewCoupon open={open} onClose={() => setOpen(false)} onCreated={(c) => { setOpen(false); setItems((x) => [c, ...(x ?? [])]); }} />
    </div>
  );
}

function NewCoupon({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Coupon) => void }) {
  const t = useT();
  const toast = useToast();
  const { market } = useShop();
  const mu = market.currency.minorUnits;
  const blank = () => ({ code: '', type: 'PERCENTAGE' as CouponType, value: '10', max: '', min: '', starts: day(new Date()), ends: day(new Date(Date.now() + 30 * 86_400_000)), limit: '', perUser: '1', first: false });
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank()); setError(''); } }, [open]);
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError('');
    const pct = Number(f.value);
    if (f.type === 'PERCENTAGE' && !(pct >= 1 && pct <= 90)) { setError(t('seller.coupons.badPercent')); return; }
    const amount = f.type === 'FIXED' ? decimalToMinor(f.value, mu) : null;
    if (f.type === 'FIXED' && (!amount || BigInt(amount) <= 0n)) { setError(t('seller.form.invalidPrice')); return; }
    const min = f.min.trim() ? decimalToMinor(f.min, mu) : null;
    const max = f.type === 'PERCENTAGE' && f.max.trim() ? decimalToMinor(f.max, mu) : null;
    if ((f.min.trim() && !min) || (f.max.trim() && !max)) { setError(t('seller.form.invalidPrice')); return; }
    setBusy(true);
    try {
      const c = await api<Coupon>('/seller/coupons', {
        method: 'POST',
        body: {
          code: f.code.trim().toUpperCase(), type: f.type,
          ...(f.type === 'PERCENTAGE' && { valueBps: Math.round(pct * 100) }), ...(amount && { valueMinor: amount }),
          ...(max && { maxDiscountMinor: max }), ...(min && { minOrderMinor: min }),
          startsAt: new Date(`${f.starts}T00:00:00`).toISOString(), endsAt: new Date(`${f.ends}T23:59:59`).toISOString(),
          ...(f.limit.trim() && { usageLimit: Math.max(1, Math.round(Number(f.limit))) }), perUserLimit: Math.max(1, Math.round(Number(f.perUser) || 1)), firstOrderOnly: f.first,
        },
      });
      toast({ tone: 'success', message: t('seller.coupons.created', { code: c.code }) });
      onCreated(c);
    } catch (e) { setError(errorMessage(e, t)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('seller.coupons.new')} closeLabel={t('common.close')}>
      <div className="space-y-3">
        <Field id="cp-code" label={t('seller.coupons.code')} hint={t('seller.coupons.codeHint')}>
          <input id="cp-code" className="input font-mono uppercase" dir="ltr" maxLength={40} value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="EID20" />
        </Field>
        <Field id="cp-type" label={t('seller.coupons.type')}>
          <select id="cp-type" className="input" value={f.type} onChange={(e) => set('type', e.target.value as CouponType)}>
            <option value="PERCENTAGE">{t('seller.coupons.types.PERCENTAGE')}</option>
            <option value="FIXED">{t('seller.coupons.types.FIXED', { currency: market.currency.code })}</option>
            <option value="FREE_DELIVERY">{t('seller.coupons.types.FREE_DELIVERY')}</option>
          </select>
        </Field>
        {f.type !== 'FREE_DELIVERY' && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="cp-value" label={f.type === 'PERCENTAGE' ? t('seller.coupons.percent') : t('seller.coupons.amount', { currency: market.currency.code })}>
              <input id="cp-value" className="input" inputMode="decimal" dir="ltr" value={f.value} onChange={(e) => set('value', e.target.value)} />
            </Field>
            {f.type === 'PERCENTAGE' && (
              <Field id="cp-max" label={t('seller.coupons.maxOff', { currency: market.currency.code })}>
                <input id="cp-max" className="input" inputMode="decimal" dir="ltr" value={f.max} onChange={(e) => set('max', e.target.value)} placeholder={t('seller.coupons.optional')} />
              </Field>
            )}
          </div>
        )}
        <Field id="cp-min" label={t('seller.coupons.minOrder', { currency: market.currency.code })}>
          <input id="cp-min" className="input" inputMode="decimal" dir="ltr" value={f.min} onChange={(e) => set('min', e.target.value)} placeholder={t('seller.coupons.optional')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="cp-from" label={t('seller.coupons.from')}><input id="cp-from" type="date" className="input" value={f.starts} onChange={(e) => set('starts', e.target.value)} /></Field>
          <Field id="cp-to" label={t('seller.coupons.to')}><input id="cp-to" type="date" className="input" value={f.ends} min={f.starts} onChange={(e) => set('ends', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="cp-limit" label={t('seller.coupons.limit')}><input id="cp-limit" className="input" inputMode="numeric" dir="ltr" value={f.limit} onChange={(e) => set('limit', e.target.value.replace(/\D/g, ''))} placeholder={t('seller.coupons.noLimit')} /></Field>
          <Field id="cp-per" label={t('seller.coupons.perCustomer')}><input id="cp-per" className="input" inputMode="numeric" dir="ltr" value={f.perUser} onChange={(e) => set('perUser', e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={f.first} onChange={(e) => set('first', e.target.checked)} />{t('seller.coupons.firstOrderOnly')}</label>
        <p className="rounded-xl bg-sand-50 px-3 py-2 text-xs text-sand-700">{t('seller.coupons.youPay')}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={busy || f.code.length < 3 || !f.ends} onClick={save} data-testid="coupon-save">{busy && <Spinner className="size-4" />}{t('seller.coupons.create')}</button>
        </div>
      </div>
    </Dialog>
  );
}
