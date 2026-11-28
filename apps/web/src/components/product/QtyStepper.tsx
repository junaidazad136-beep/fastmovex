'use client';

import { Minus, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Cart } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useToast } from '@/lib/state/toast';
import { OptionsSheet } from './OptionsSheet';

function lineOf(cart: Cart | null, variantId: string) {
  for (const g of cart?.groups ?? []) for (const i of g.items) if (i.variantId === variantId) return i;
  return null;
}

/**
 * Purple "Add to cart" on a result row. Tap: one goes in the cart and the button turns into "− 1 +" right there, so
 * more or fewer can be set without opening the cart. Products with options (size, colour) open their page.
 */
export function QtyStepper({ productId, slug, title, variantId, inStock }: { productId: string; slug: string; title: string; variantId: string | null; inStock: boolean }) {
  const t = useT();
  const cart = useCart();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  const round = 'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-brand-600 text-[13px] font-bold text-white transition-colors hover:bg-brand-700 active:scale-[0.98]';
  if (!inStock) return null;
  if (!variantId) {
    // colour / size to pick: a sheet opens here (no page change); shows how many of this product are already in the cart
    const inCart = (cart.cart?.groups ?? []).flatMap((g) => g.items).filter((i) => i.productSlug === slug).reduce((n, i) => n + i.quantity, 0);
    return (
      <>
        <button type="button" onClick={() => { haptic('tap'); setSheet(true); }} className={`relative z-10 ${round}`} aria-label={t('card.chooseOptions', { title })} aria-haspopup="dialog" data-testid="row-add" data-product={productId}>
          <Plus className="size-4" strokeWidth={2.6} aria-hidden />{inCart ? t('search.addMore', { count: inCart }) : t('search.addToCart')}
        </button>
        {sheet ? <OptionsSheet slug={slug} open={sheet} onClose={closeSheet} /> : null}
      </>
    );
  }
  const line = lineOf(cart.cart, variantId);
  const qty = line?.quantity ?? 0;
  const fail = (e: unknown) => { haptic('error'); toast({ tone: 'error', message: errorMessage(e, t) }); };
  const run = (p: Promise<unknown>) => { setBusy(true); p.catch(fail).finally(() => setBusy(false)); };

  if (!qty) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => { haptic('success'); run(cart.add(variantId, 1)); }}
        className={`relative z-10 ${round} ${busy ? 'opacity-70' : ''}`}
        aria-label={t('card.addTitle', { title })}
        data-testid="row-add"
        data-product={productId}
      >
        <Plus className="size-4" strokeWidth={2.6} aria-hidden />{t('search.addToCart')}
      </button>
    );
  }
  const max = line!.maxQuantity || 99;
  return (
    <div className="relative z-10 flex h-9 w-full items-center justify-between rounded-full bg-brand-600 text-white" data-testid="row-stepper">
      <button type="button" onClick={() => { haptic('tap'); run(qty <= 1 ? cart.remove(line!.id) : cart.update(line!.id, qty - 1)); }} className="grid size-9 place-items-center rounded-full active:bg-white/15" aria-label={t('cart.decrease', { title })} data-testid="row-minus">
        <Minus className="size-4" strokeWidth={2.6} aria-hidden />
      </button>
      <span className="tabular min-w-5 text-center text-[14px] font-bold" aria-live="polite" aria-label={t('cart.inCart', { count: qty })} data-testid="row-qty">{qty}</span>
      <button type="button" disabled={qty >= max} onClick={() => { haptic('tap'); run(cart.update(line!.id, qty + 1)); }} className="grid size-9 place-items-center rounded-full active:bg-white/15 disabled:opacity-50" aria-label={t('cart.increase', { title })} data-testid="row-plus">
        <Plus className="size-4" strokeWidth={2.6} aria-hidden />
      </button>
    </div>
  );
}
