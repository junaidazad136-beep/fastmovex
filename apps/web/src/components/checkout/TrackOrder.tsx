'use client';

import { PackageSearch } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/errors';
import { guestOrders, rememberGuestOrder, type GuestOrderRef } from '@/lib/guest-orders';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { paths } from '@/lib/urls';
import { OrderDetailView } from '../account/OrderDetail';
import { Field, FormError } from '../auth/fields';
import { Spinner } from '../ui/Spinner';

/**
 * Order tracking without an account. With `order` + `token` (checkout, email link) the order opens directly;
 * otherwise the shopper looks it up with the order number and the email or mobile number used.
 */
export function TrackOrder({ order, token, placed }: { order?: string; token?: string; placed: boolean }) {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const { status } = useSession();
  const [number, setNumber] = useState(order ?? '');
  const [contact, setContact] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<GuestOrderRef[]>([]);

  useEffect(() => {
    setRecent(guestOrders());
    if (order && token) rememberGuestOrder(order, token);
  }, [order, token]);

  if (order && token) return <OrderDetailView number={order} placed={placed} guestToken={token} />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!number.trim() || !contact.trim()) { setError(t('errors.required')); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api<{ orderNumber: string; token: string }>('/orders/guest/lookup', {
        method: 'POST', auth: 'none', body: { orderNumber: number.trim().toUpperCase(), contact: contact.trim().replace(/\s/g, '') },
      });
      rememberGuestOrder(res.orderNumber, res.token);
      router.push(paths.track(l, res.orderNumber, res.token));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('track.notFound') : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="card p-6 sm:p-8">
        <PackageSearch className="size-9 text-brand-600" aria-hidden />
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{t('track.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('track.intro')}</p>
        {order && !token && <p className="mt-3 rounded-xl bg-warning-50 px-3.5 py-2.5 text-sm text-warning-600">{t('track.linkInvalid')}</p>}
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <FormError message={error} />
          <Field label={t('track.orderNumber')} hint={t('track.orderNumberHint')}>
            {(a) => <input {...a} value={number} onChange={(e) => setNumber(e.target.value)} className="input uppercase" dir="ltr" autoComplete="off" maxLength={40} placeholder="FMX-QA-…" data-testid="track-order" />}
          </Field>
          <Field label={t('track.contact')}>
            {(a) => <input {...a} value={contact} onChange={(e) => setContact(e.target.value)} className="input" dir="ltr" autoComplete="email" maxLength={200} data-testid="track-contact" />}
          </Field>
          <button type="submit" disabled={busy} className="btn-primary w-full" data-testid="track-submit">{busy && <Spinner className="size-4" />}{t('track.submit')}</button>
        </form>
        {status === 'user' && <p className="mt-4 text-sm text-ink-600">{t('track.signedIn')} <Link href={paths.orders(l)} className="link">{t('order.myOrders')}</Link></p>}
      </div>
      {recent.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-bold">{t('track.recent')}</h2>
          <ul className="divide-y divide-ink-100 text-sm">
            {recent.map((o) => (
              <li key={o.orderNumber} className="flex items-center justify-between py-2.5">
                <Link href={paths.track(l, o.orderNumber, o.token)} className="font-medium hover:text-brand-700" dir="ltr">{o.orderNumber}</Link>
                <span className="text-xs text-ink-500">{formatDateTime(o.placedAt, l)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
