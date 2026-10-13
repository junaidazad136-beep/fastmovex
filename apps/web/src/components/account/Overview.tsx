'use client';

import { Privacy } from './Privacy';
import { BadgeCheck, CircleAlert, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { LinkedSignIn, OrderListItem, Paged, Reviewable } from '@/lib/api/types';
import { providerLabel } from '@/lib/social';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useMoney, useShop } from '@/lib/state/shop';
import { WhatsAppIcon } from '../ui/WhatsApp';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { Field, FormError, PASSWORD_RULE, PasswordInput } from '../auth/fields';
import { Spinner } from '../ui/Spinner';
import { StatusBadge } from './StatusBadge';

function Verified({ at, channel }: { at: string | null; channel: 'email' | 'phone' }) {
  const t = useT();
  if (at) return <span className="inline-flex items-center gap-1 text-xs font-medium text-success-600"><BadgeCheck className="size-3.5" aria-hidden />{t('account.verified')}</span>;
  return (
    <Link href={`/${t.locale}/account/verify?channel=${channel}`} className="inline-flex items-center gap-1 text-xs font-medium text-warning-600 hover:underline">
      <CircleAlert className="size-3.5" aria-hidden />{t('account.notVerified')} · {t('account.verify')}
    </Link>
  );
}

/** Google / Apple sign-ins linked to the account, with "Remove" (the API refuses removing the only way in). */
function SignIns({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const toast = useToast();
  const [list, setList] = useState<LinkedSignIn[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<LinkedSignIn[]>('/auth/social').then(setList).catch(() => setList([])); }, []);
  if (!list?.length) return null;
  async function remove(p: LinkedSignIn['provider']) {
    setErr('');
    try {
      setList(await api<LinkedSignIn[]>(`/auth/social/${p.toLowerCase()}`, { method: 'DELETE' }));
      toast({ tone: 'success', message: t('account.unlinked') });
    } catch (e) { setErr(errorMessage(e, t)); }
  }
  return (
    <div className="border-t border-ink-100 pt-4" data-testid="sign-ins">
      <h3 className="text-sm font-semibold">{t('account.signIns')}</h3>
      <p className="text-sm text-ink-500">{t('account.signInsHint')}</p>
      <FormError message={err} />
      <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-100">
        {list.map((s) => (
          <li key={s.provider} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{providerLabel[s.provider]}</span>
              {s.email && <span className="ms-2 truncate text-ink-500" dir="ltr">{s.email}</span>}
              <span className="block text-xs text-ink-400">{t('account.linkedOn', { date: formatDate(s.createdAt, t.locale) })}</span>
            </span>
            <button type="button" className="btn-ghost text-sm" onClick={() => remove(s.provider)} disabled={!hasPassword && list.length === 1} data-testid={`unlink-${s.provider.toLowerCase()}`}>{t('account.unlink')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangePassword() {
  const t = useT();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!PASSWORD_RULE.test(next)) { setErr(t('errors.passwordRule')); return; }
    setBusy(true); setErr('');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      setCur(''); setNext('');
      toast({ tone: 'success', message: t('account.passwordChanged') });
    } catch (e2) { setErr(errorMessage(e2, t)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError message={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('account.currentPassword')}>{(a) => <PasswordInput {...a} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />}</Field>
        <Field label={t('account.newPassword')} hint={t('auth.passwordHint')}>{(a) => <PasswordInput {...a} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}</Field>
      </div>
      <button type="submit" disabled={busy || !cur || !next} className="btn-secondary">{busy && <Spinner className="size-4" />}{t('account.changePassword')}</button>
    </form>
  );
}

export function Overview() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const toast = useToast();
  const { user, reload, logout } = useSession();
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [toReview, setToReview] = useState<Reviewable[]>([]);
  const [optIn, setOptIn] = useState(!!user?.marketingOptIn);

  useEffect(() => {
    api<Paged<OrderListItem>>('/orders').then((p) => setOrders(p.items.slice(0, 3))).catch(() => setOrders([]));
    api<Reviewable[]>('/me/reviewable').then((r) => setToReview(r.slice(0, 4))).catch(() => {});
  }, []);
  useEffect(() => { setOptIn(!!user?.marketingOptIn); }, [user?.marketingOptIn]);
  const { market } = useShop();
  const [wa, setWa] = useState(!!user?.whatsappOptIn);
  useEffect(() => { setWa(!!user?.whatsappOptIn); }, [user?.whatsappOptIn]);
  if (!user) return null;

  async function toggleWhatsApp(v: boolean) {
    setWa(v);
    try {
      await api('/me/notification-settings', { method: 'PATCH', body: { whatsappOptIn: v } });
      await reload();
      toast({ tone: 'success', message: v ? t('whatsapp.on') : t('whatsapp.off') });
    } catch (e) { setWa(!v); toast({ tone: 'error', message: errorMessage(e, t) }); }
  }

  async function toggleMarketing(v: boolean) {
    setOptIn(v);
    try {
      await api('/me/notification-settings', { method: 'PATCH', body: { marketingOptIn: v } });
      await reload();
      toast({ tone: 'success', message: t('account.marketingSaved') });
    } catch (e) { setOptIn(!v); toast({ tone: 'error', message: errorMessage(e, t) }); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('account.title')}</h1>
      <section className="card p-5" aria-labelledby="acc-profile">
        <h2 id="acc-profile" className="mb-3 font-bold">{t('account.profile')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-ink-500">{t('auth.fullName')}</dt><dd className="font-medium">{user.fullName}</dd></div>
          {user.email && <div><dt className="text-ink-500">{t('account.email')}</dt><dd className="font-medium" dir="ltr">{user.email}</dd><dd><Verified at={user.emailVerifiedAt} channel="email" /></dd></div>}
          {user.phone && <div><dt className="text-ink-500">{t('account.phone')}</dt><dd className="font-medium" dir="ltr">{user.phone}</dd><dd><Verified at={user.phoneVerifiedAt} channel="phone" /></dd></div>}
        </dl>
        <p className="mt-3 text-xs text-ink-400">{t('account.memberSince', { date: formatDate(user.createdAt, l, { month: 'long', year: 'numeric' }) })}</p>
        <Link href={paths.seller(l)} className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100" data-testid="seller-center-link">
          <span>{user.seller ? t('seller.title') : t('seller.sellWithUs')}</span><span aria-hidden className="rtl:rotate-180">→</span>
        </Link>
      </section>

      <section className="card p-5" aria-labelledby="acc-orders">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="acc-orders" className="font-bold">{t('account.recentOrders')}</h2>
          <Link href={paths.orders(l)} className="link text-sm">{t('common.seeAll')}</Link>
        </div>
        {orders === null ? <div className="skeleton h-16" /> : orders.length === 0 ? <p className="text-sm text-ink-500">{t('order.empty')}</p> : (
          <ul className="divide-y divide-ink-100">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={paths.order(l, o.orderNumber)} className="flex items-center gap-3 py-3 hover:bg-ink-25">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" dir="ltr">{o.orderNumber}</p>
                    <p className="text-xs text-ink-500">{formatDate(o.placedAt, l)} · {t.plural('common.items', o.itemCount)}</p>
                  </div>
                  <StatusBadge status={o.status} label={t(`order.status.${o.status}`)} />
                  <span className="tabular text-sm font-semibold">{money(o.totalMinor, { currency: o.currencyCode })}</span>
                  <ChevronRight className="size-4 text-ink-300 rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toReview.length > 0 && (
        <section className="card p-5" aria-labelledby="acc-review">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="acc-review" className="font-bold">{t('account.toReview')}</h2>
            <Link href={paths.reviews(l)} className="link text-sm">{t('common.seeAll')}</Link>
          </div>
          <ul className="flex gap-3 overflow-x-auto no-scrollbar">
            {toReview.map((r) => (
              <li key={r.orderItemId} className="w-28 shrink-0">
                <Link href={`${paths.reviews(l)}?item=${r.orderItemId}`} className="block text-center text-xs text-ink-700 hover:text-brand-700">
                  <span className="relative mb-1.5 block aspect-square overflow-hidden rounded-xl bg-ink-50">{r.imageUrl && <Image src={r.imageUrl} alt="" fill sizes="112px" className="object-contain p-2" />}</span>
                  <span className="line-clamp-2">{r.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-5 p-5" aria-labelledby="acc-sec">
        <h2 id="acc-sec" className="font-bold">{t('account.security')}</h2>
        {user.hasPassword === false
          ? <p className="rounded-xl bg-warning-50 px-3.5 py-2.5 text-sm text-warning-600" data-testid="no-password">{t('account.noPassword')} <Link href={paths.forgot(l)} className="link">{t('auth.forgot')}</Link></p>
          : <ChangePassword />}
        <SignIns hasPassword={user.hasPassword !== false} />
        <div className="border-t border-ink-100 pt-4">
          <p className="text-sm text-ink-600">{t('account.signOutEverywhereHint')}</p>
          <button type="button" onClick={async () => { await logout(true); window.location.assign(paths.login(l)); }} className="btn-danger mt-3">{t('account.signOutEverywhere')}</button>
        </div>
      </section>

      <Privacy />

      {market.whatsapp?.updates && (
        <section className="card p-5">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={wa} disabled={!user.phone} onChange={(e) => toggleWhatsApp(e.target.checked)} className="mt-1 size-4 accent-brand-600" data-testid="whatsapp-setting" />
            <span>
              <span className="flex items-center gap-1.5 font-semibold"><WhatsAppIcon className="size-4 text-[#25D366]" />{t('whatsapp.setting')}</span>
              <span className="block text-sm text-ink-500">{user.phone ? t('whatsapp.settingHint', { phone: user.phone }) : t('whatsapp.needPhone')}</span>
            </span>
          </label>
        </section>
      )}

      <section className="card p-5">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={optIn} onChange={(e) => toggleMarketing(e.target.checked)} className="mt-1 size-4 accent-brand-600" data-testid="marketing-opt-in" />
          <span>
            <span className="block font-semibold">{t('account.marketing')}</span>
            <span className="block text-sm text-ink-500">{t('account.marketingHint')}</span>
          </span>
        </label>
      </section>
    </div>
  );
}
