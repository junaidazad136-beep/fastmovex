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
  /** Changes shown on screen are still on their way to the server (totals may move a little). */
  syncing: boolean;
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
  /** items added on screen whose request has not come back yet: the cart badge counts them at once */
  const [pendingAdds, setPendingAdds] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const lastStatus = useRef<string>('loading');
  /** cart changes go to the server one after another, in the order they were tapped */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef(0);

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

  /**
   * Every cart change shows on screen at once (`optimistic`) and is then sent. Changes queue up in tap order (a
   * guest's first add creates the cart; later ones must use it), and only the answer to the LAST one is put on
   * screen, so tapping + three times does not count 2, 3, 4 back at the shopper. If a change fails, the cart is
   * read again from the server, which puts the screen back to the truth.
   */
  const mutate = useCallback((path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, opts: { optimistic?: (c: Cart) => Cart | null; adds?: number } = {}) => {
    const id = ++seq.current;
    if (opts.optimistic) setCartState((c) => (c ? opts.optimistic!(c) ?? c : c));
    if (opts.adds) setPendingAdds((n) => n + opts.adds!);
    setInFlight((n) => n + 1);
    const send = async () => {
      try {
        const c = await api<Cart>(path, { method, body, auth, cart: true });
        if (id === seq.current) { setCart(c); setPendingAdds(0); }
        return c;
      } catch (e) {
        if (id === seq.current) { await refresh().catch(() => {}); setPendingAdds(0); }
        else if (opts.adds) setPendingAdds((n) => Math.max(0, n - opts.adds!));
        throw e;
      } finally {
        setInFlight((n) => n - 1);
      }
    };
    const p = queue.current.then(send, send);
    queue.current = p.catch(() => {});
    return p;
  }, [auth, setCart, refresh]);

  const value = useMemo<CartValue>(() => ({
    cart,
    loading,
    merged,
    syncing: inFlight > 0,
    count: (cart?.totals.itemCount ?? 0) + pendingAdds,
    refresh,
    add: (variantId, quantity) => mutate('/cart/items', 'POST', { variantId, quantity }, { adds: quantity }).then((c) => { track('add_to_cart'); return c; }),
    update: (itemId, quantity) => mutate(`/cart/items/${itemId}`, 'PATCH', { quantity }, { optimistic: (c) => withQuantity(c, itemId, quantity) }),
    remove: (itemId) => mutate(`/cart/items/${itemId}`, 'DELETE', undefined, { optimistic: (c) => withQuantity(c, itemId, 0) }),
    applyCoupon: (code) => mutate('/cart/coupon', 'POST', { code }),
    removeCoupon: () => mutate('/cart/coupon', 'DELETE'),
    acknowledgePrices: () => mutate('/cart/acknowledge-prices', 'POST'),
    setCart,
  }), [cart, loading, merged, inFlight, pendingAdds, refresh, mutate, setCart]);

  // lets tests (and a page reload) know a tapped change has not reached the server yet
  useEffect(() => {
    if (inFlight > 0) document.documentElement.dataset.cartSync = '1';
    else delete document.documentElement.dataset.cartSync;
  }, [inFlight]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * The cart as it will look once the server has the new quantity (0 = removed): the line, its price and the item
 * count change; the money totals stay until the server's answer (the summary shows they are updating).
 */
export function withQuantity(c: Cart, itemId: string, quantity: number): Cart | null {
  const item = c.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
  if (!item) return null;
  const groups = c.groups
    .map((g) => ({
      ...g,
      items: quantity <= 0
        ? g.items.filter((i) => i.id !== itemId)
        : g.items.map((i) => (i.id === itemId ? { ...i, quantity, lineSubtotalMinor: (BigInt(i.unitPriceMinor) * BigInt(quantity)).toString() } : i)),
    }))
    .filter((g) => g.items.length > 0);
  return { ...c, groups, totals: { ...c.totals, itemCount: Math.max(0, c.totals.itemCount - item.quantity + Math.max(0, quantity)) } };
}

export function useCart(): CartValue {
  const v = useContext(CartContext);
  if (!v) throw new Error('useCart must be used inside <CartProvider>');
  return v;
}
