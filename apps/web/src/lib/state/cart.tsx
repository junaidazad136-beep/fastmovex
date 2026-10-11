'use client';

import { track } from '../analytics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, getCartToken, setCartToken } from '../api/client';
import type { Cart } from '../api/types';
import { useSession } from './session';

interface CartValue {
  cart: Cart | null;
  loading: boolean;
  count: number;
  /** True right after sign-in when the guest cart was merged into the account cart. */
  merged: boolean;
  refresh: () => Promise<Cart | null>;
  add: (variantId: string, quantity: number) => Promise<Cart>;
  update: (itemId: string, quantity: number) => Promise<Cart>;
  remove: (itemId: string) => Promise<Cart>;
  applyCoupon: (code: string) => Promise<Cart>;
  removeCoupon: () => Promise<Cart>;
  acknowledgePrices: () => Promise<Cart>;
  setCart: (c: Cart) => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [cart, setCartState] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [merged, setMerged] = useState(false);
  const lastStatus = useRef<string>('loading');

  const setCart = useCallback((c: Cart) => {
    // Guests get a token on their first add; keep it so the cart survives reloads.
    if (c.cartToken) setCartToken(c.cartToken);
    setCartState(c);
  }, []);

  const signedIn = status === 'user';
  const auth = signedIn ? 'required' : 'none';

  const refresh = useCallback(async () => {
    if (!signedIn && !getCartToken()) {
      setCartState(null);
      return null;
    }
    const c = await api<Cart>('/cart', { auth, cart: true });
    setCart(c);
    return c;
  }, [auth, signedIn, setCart]);

  useEffect(() => {
    if (status === 'loading') return;
    const prev = lastStatus.current;
    lastStatus.current = status;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const guestToken = getCartToken();
        if (status === 'user' && guestToken) {
          // Signed in with items in a guest cart: fold them into the account cart, once.
          const c = await api<Cart>('/cart/merge', { method: 'POST', body: { guestToken } });
          setCartToken(null);
          if (!cancelled) { setCart(c); setMerged(prev === 'guest' && c.totals.itemCount > 0); }
        } else if (status === 'guest' && prev === 'user') {
          setCartState(null); // signed out: the account cart stays with the account
        } else if (!cancelled) {
          await refresh();
        }
      } catch {
        if (!cancelled) setCartState(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, refresh, setCart]);

  const mutate = useCallback(async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
    const c = await api<Cart>(path, { method, body, auth, cart: true });
    setCart(c);
    return c;
  }, [auth, setCart]);

  const value = useMemo<CartValue>(() => ({
    cart,
    loading,
    merged,
    count: cart?.totals.itemCount ?? 0,
    refresh,
    add: (variantId, quantity) => mutate('/cart/items', 'POST', { variantId, quantity }).then((c) => { track('add_to_cart'); return c; }),
    update: (itemId, quantity) => mutate(`/cart/items/${itemId}`, 'PATCH', { quantity }),
    remove: (itemId) => mutate(`/cart/items/${itemId}`, 'DELETE'),
    applyCoupon: (code) => mutate('/cart/coupon', 'POST', { code }),
    removeCoupon: () => mutate('/cart/coupon', 'DELETE'),
    acknowledgePrices: () => mutate('/cart/acknowledge-prices', 'POST'),
    setCart,
  }), [cart, loading, merged, refresh, mutate, setCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const v = useContext(CartContext);
  if (!v) throw new Error('useCart must be used inside <CartProvider>');
  return v;
}
