'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Cart, Market, PaymentMethod } from '../api/types';
import { useCart } from './cart';

const BUY_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * The cart a checkout buys: normally the customer's cart; with `?buy=<token>` ("Buy now" on a product) the small
 * one-item cart made for it, so the rest of the cart stays where it is.
 */
export function useCheckoutCart(): { cart: Cart | null; loading: boolean; refresh: () => Promise<Cart | null>; buyToken: string | null } {
  const raw = useSearchParams().get('buy');
  const buyToken = raw && BUY_TOKEN.test(raw) ? raw : null;
  const main = useCart();
  const [buyCart, setBuyCart] = useState<Cart | null>(null);
  const [buyLoading, setBuyLoading] = useState(!!buyToken);

  const refreshBuy = useCallback(async () => {
    if (!buyToken) return null;
    try {
      const c = await api<Cart>('/cart/buy-now', { auth: 'none', headers: { 'x-buy-now-token': buyToken } });
      setBuyCart(c);
      return c;
    } catch {
      // gone or expired: an empty cart sends the customer back to their cart
      const empty = { cartToken: null, currencyCode: '', groups: [], coupon: null, totals: { itemCount: 0, subtotalMinor: '0', discountMinor: '0', deliveryFeeMinor: '0', taxMinor: '0', taxIncluded: true, totalMinor: '0' }, notices: [], canCheckout: false } as unknown as Cart;
      setBuyCart(empty);
      return empty;
    } finally {
      setBuyLoading(false);
    }
  }, [buyToken]);

  useEffect(() => { void refreshBuy(); }, [refreshBuy]);

  if (!buyToken) return { cart: main.cart, loading: main.loading, refresh: main.refresh, buyToken: null };
  return { cart: buyCart, loading: buyLoading, refresh: refreshBuy, buyToken };
}

/** PayLater takes orders from QAR 300 to QAR 25,000 (minor units). */
export const PAYLATER_MIN_MINOR = 30_000n;
export const PAYLATER_MAX_MINOR = 2_500_000n;
export function paylaterFits(totalMinor: string | null | undefined): boolean {
  if (!totalMinor) return false;
  const t = BigInt(totalMinor);
  return t >= PAYLATER_MIN_MINOR && t <= PAYLATER_MAX_MINOR;
}

const LAST_METHOD = 'fmx.payMethod';

/** The payment method this shopper used last time (one tap less), else cash on delivery, else the first one. */
export function initialMethod(market: Market): PaymentMethod | '' {
  let last: string | null = null;
  try { last = window.localStorage.getItem(LAST_METHOD); } catch { /* storage blocked */ }
  if (last && (market.paymentMethods as string[]).includes(last)) return last as PaymentMethod;
  return market.paymentMethods.includes('COD') ? 'COD' : market.paymentMethods[0] ?? '';
}

export function rememberMethod(m: PaymentMethod) {
  try { window.localStorage.setItem(LAST_METHOD, m); } catch { /* fine */ }
}
