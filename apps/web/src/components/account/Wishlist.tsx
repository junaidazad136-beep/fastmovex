'use client';

import { BellRing, Heart, ShoppingBag, TrendingDown, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { Cart, WishlistItem } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useMoney, useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { useWishlist } from '@/lib/state/wishlist';
import { paths, pick } from '@/lib/urls';
import { Price } from '../product/Price';
import { EmptyState } from '../ui/EmptyState';

export function Wishlist() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const { market } = useShop();
  const toast = useToast();
  const cart = useCart();
  const wishlist = useWishlist();
  const [items, setItems] = useState<WishlistItem[] | null>(null);

  useEffect(() => {
    if (!wishlist.ready) return;
    if (!wishlist.listId) { setItems([]); return; }
    api<WishlistItem[]>(`/wishlists/${wishlist.listId}`).then(setItems).catch((e) => { setItems([]); toast({ tone: 'error', message: errorMessage(e, t) }); });
  }, [wishlist.ready, wishlist.listId, t, toast]);

  async function run(fn: () => Promise<unknown>, after: (list: WishlistItem[]) => WishlistItem[], msg?: string) {
    try { await fn(); setItems((x) => after(x ?? [])); if (msg) toast({ tone: 'success', message: msg }); } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
  }

  if (items === null) return <div className="skeleton h-40" />;
  return (
    <div>
      <h1 className="mb-4 text-xl sm:text-2xl font-bold tracking-tight">{t('wishlist.title')}</h1>
      {items.length === 0 ? (
        <EmptyState icon={<Heart className="size-7" aria-hidden />} title={t('wishlist.empty')} text={t('wishlist.emptyHint')} action={<Link href={paths.home(l)} className="btn-primary">{t('cart.startShopping')}</Link>} />
      ) : (
        <ul className="space-y-3">
          {items.map((w) => {
            const p = w.product;
            return (
              <li key={w.productId} className="card flex gap-4 p-4" data-testid="wishlist-item">
                <Link href={paths.product(l, p.slug)} className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-ink-50">
                  {p.imageUrl && <Image src={p.imageUrl} alt="" fill sizes="96px" className="object-contain p-2" />}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={paths.product(l, p.slug)} className="line-clamp-2 text-sm font-medium hover:text-brand-700">{pick(l, p.title, p.titleAr)}</Link>
                    <button type="button" aria-label={t('product.removeFromWishlist')} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" onClick={() => run(() => wishlist.toggle(w.productId), (x) => x.filter((i) => i.productId !== w.productId), t('product.removedFromWishlist'))}>
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="mt-1"><Price input={p} currency={p.currencyCode} minorUnits={market.currency.minorUnits} locale={l} size="sm" /></div>
                  {w.priceDroppedByMinor && <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-success-600"><TrendingDown className="size-3.5" aria-hidden />{t('wishlist.priceDrop', { amount: money(w.priceDroppedByMinor) })}</p>}
                  {!w.available && <p className="mt-1 text-xs font-semibold text-danger-600">{t('wishlist.unavailable')}</p>}
                  <p className="mt-1 text-[11px] text-ink-400">{t('wishlist.added', { date: formatDate(w.addedAt, l) })}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {w.available && (
                      <button
                        type="button"
                        className="btn-primary px-3 py-1.5 text-xs"
                        onClick={() => run(async () => { const c = await api<Cart>(`/wishlists/items/${w.productId}/move-to-cart`, { method: 'POST', body: { quantity: 1, keepInWishlist: true } }); cart.setCart(c); }, (x) => x, t('wishlist.moved'))}
                      >
                        <ShoppingBag className="size-3.5" aria-hidden />{t('wishlist.moveToCart')}
                      </button>
                    )}
                    <label className="inline-flex items-center gap-1.5 text-xs text-ink-600">
                      <input type="checkbox" checked={w.notifyPriceDrop} className="size-3.5 accent-brand-600" onChange={(e) => { const v = e.target.checked; void run(() => api(`/wishlists/items/${w.productId}/alerts`, { method: 'PATCH', body: { notifyPriceDrop: v } }), (x) => x.map((i) => (i.productId === w.productId ? { ...i, notifyPriceDrop: v } : i))); }} />
                      <BellRing className="size-3.5" aria-hidden />{t('wishlist.notifyPriceDrop')}
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-ink-600">
                      <input type="checkbox" checked={w.notifyBackInStock} className="size-3.5 accent-brand-600" onChange={(e) => { const v = e.target.checked; void run(() => api(`/wishlists/items/${w.productId}/alerts`, { method: 'PATCH', body: { notifyBackInStock: v } }), (x) => x.map((i) => (i.productId === w.productId ? { ...i, notifyBackInStock: v } : i))); }} />
                      {t('wishlist.notifyBackInStock')}
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
