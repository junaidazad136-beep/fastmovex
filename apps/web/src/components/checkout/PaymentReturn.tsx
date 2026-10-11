'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { OrderDetail } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { paths } from '@/lib/urls';
import { RequireAuth } from '../auth/RequireAuth';
import { Spinner } from '../ui/Spinner';
import { PENDING_ORDER_KEY, PENDING_TOKEN_KEY } from './Checkout';

/** Back from the payment page: wait for the result (the API asks the gateway directly if its webhook is late), then show the order. */
export function PaymentReturn() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useCart();
  const [state, setState] = useState<'waiting' | 'failed'>('waiting');

  useEffect(() => {
    let number: string | null = null;
    let token: string | null = null;
    try {
      number = sessionStorage.getItem(PENDING_ORDER_KEY);
      token = sessionStorage.getItem(PENDING_TOKEN_KEY);
    } catch { /* ignore */ }
    if (!number) { router.replace(token ? paths.track(t.locale) : paths.orders(t.locale)); return; }
    // Guests open the order with its access token; account holders with their session.
    const orderPath = token ? `/orders/guest/${encodeURIComponent(number)}` : `/orders/${encodeURIComponent(number)}`;
    const opts = token ? { auth: 'none' as const, headers: { 'x-order-token': token } } : {};
    const orderPage = (placed: boolean) => (token ? `${paths.track(t.locale, number!, token)}${placed ? '&placed=1' : ''}` : `${paths.order(t.locale, number!)}${placed ? '?placed=1' : ''}`);
    const clear = () => { try { sessionStorage.removeItem(PENDING_ORDER_KEY); sessionStorage.removeItem(PENDING_TOKEN_KEY); } catch { /* ignore */ } };
    let stop = false;
    const started = Date.now();
    const poll = async () => {
      if (stop) return;
      try {
        const o = await api<OrderDetail>(orderPath, opts);
        const p = o.payments[0]?.status;
        if (p === 'CAPTURED' || p === 'AUTHORIZED') {
          clear();
          await refresh();
          router.replace(orderPage(true));
          return;
        }
        if (p === 'FAILED' || o.status === 'CANCELLED') {
          clear();
          // Account carts are refilled by the API; a guest's cart lives on this device, so put the items back here.
          if (token) {
            for (const i of o.sellerOrders.flatMap((so) => so.items)) {
              await api('/cart/items', { method: 'POST', auth: 'none', cart: true, body: { variantId: i.variantId, quantity: i.quantity } }).catch(() => undefined);
            }
          }
          await refresh();
          setState('failed');
          return;
        }
      } catch { /* keep waiting */ }
      // Still pending: the order page keeps showing the live status if the bank takes longer.
      if (Date.now() - started > 60_000) { router.replace(orderPage(false)); return; }
      window.setTimeout(poll, 2000);
    };
    void poll();
    return () => { stop = true; };
  }, [router, t.locale, refresh]);

  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      {state === 'waiting' ? (
        <>
          <Spinner className="mx-auto size-8 text-brand-600" />
          <p className="mt-4 font-medium">{t('checkout.paymentPending')}</p>
        </>
      ) : (
        <>
          <p className="font-medium text-danger-600" role="alert">{t('checkout.paymentFailed')}</p>
          <button type="button" onClick={() => router.replace(paths.cart(t.locale))} className="btn-primary mt-6">{t('cart.title')}</button>
        </>
      )}
    </div>
  );
}

/** Guests come back with an order token saved on this device and need no sign-in; everyone else does. */
export function PaymentReturnGate() {
  const [guest, setGuest] = useState<boolean | null>(null);
  useEffect(() => {
    let token: string | null = null;
    try { token = sessionStorage.getItem(PENDING_TOKEN_KEY); } catch { /* storage blocked */ }
    setGuest(!!token);
  }, []);
  if (guest === null) return <div className="card mx-auto max-w-md p-8 text-center"><Spinner className="mx-auto size-8 text-brand-600" /></div>;
  return guest ? <PaymentReturn /> : <RequireAuth><PaymentReturn /></RequireAuth>;
}
