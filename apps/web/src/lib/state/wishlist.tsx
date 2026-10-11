'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { WishlistItem, WishlistSummary } from '../api/types';
import { useSession } from './session';

interface WishlistValue {
  ready: boolean;
  listId: string | null;
  /** how many products are saved (the dot on the header heart) */
  count: number;
  has: (productId: string) => boolean;
  /** Returns the new saved state. Throws when signed out (the caller shows a sign-in prompt). */
  toggle: (productId: string) => Promise<boolean>;
  reload: () => Promise<void>;
}

const WishlistContext = createContext<WishlistValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [listId, setListId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (status !== 'user') { setIds(new Set()); setListId(null); setReady(status === 'guest'); return; }
    const lists = await api<WishlistSummary[]>('/wishlists');
    const def = lists.find((l) => l.isDefault) ?? lists[0];
    if (!def) { setIds(new Set()); setListId(null); setReady(true); return; }
    const items = await api<WishlistItem[]>(`/wishlists/${def.id}`);
    setListId(def.id);
    setIds(new Set(items.map((i) => i.productId)));
    setReady(true);
  }, [status]);

  useEffect(() => { reload().catch(() => setReady(true)); }, [reload]);

  const toggle = useCallback(async (productId: string) => {
    if (status !== 'user') throw new Error('SIGN_IN_REQUIRED');
    const saved = ids.has(productId);
    // Optimistic: the heart reacts instantly, and rolls back if the request fails.
    setIds((prev) => { const n = new Set(prev); if (saved) n.delete(productId); else n.add(productId); return n; });
    try {
      if (saved) await api(`/wishlists/items/${productId}${listId ? `?wishlistId=${listId}` : ''}`, { method: 'DELETE' });
      else {
        const r = await api<{ wishlistId: string }>('/wishlists/items', { method: 'POST', body: { productId } });
        if (!listId) setListId(r.wishlistId);
      }
      return !saved;
    } catch (e) {
      setIds((prev) => { const n = new Set(prev); if (saved) n.add(productId); else n.delete(productId); return n; });
      throw e;
    }
  }, [status, ids, listId]);

  const value = useMemo(() => ({ ready, listId, count: ids.size, has: (id: string) => ids.has(id), toggle, reload }), [ready, listId, ids, toggle, reload]);
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistValue {
  const v = useContext(WishlistContext);
  if (!v) throw new Error('useWishlist must be used inside <WishlistProvider>');
  return v;
}
