'use client';

import { ArrowRight, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useMoney } from '@/lib/state/shop';
import { paths } from '@/lib/urls';

/** Phones, on result pages: what is in the cart, its total, and one tap to it (sits just above the tab bar). */
export function CartBar() {
  const t = useT();
  const { cart, count } = useCart();
  const money = useMoney();
  if (!count || !cart) return null;
  const free = cart.groups.length > 0 && cart.groups.every((g) => g.deliveryWaived || g.deliveryFeeMinor === '0');
  return (
    <Link
      href={paths.cart(t.locale)}
      className="fixed inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex h-12 items-center gap-2.5 rounded-2xl bg-ink-900 px-3.5 text-[13px] text-white shadow-[0_8px_24px_rgb(0_0_0/0.25)] md:hidden"
      data-testid="cart-bar"
    >
      <ShoppingBag className="size-[18px] shrink-0 text-brand-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-bold">{t.plural('common.items', count)}</b>
        <span className="tabular"> · {money(cart.totals.subtotalMinor, { compact: true })}</span>
        {free ? <span className="text-success-600"> · {t('cart.barFree')}</span> : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 font-bold text-brand-300">{t('cart.barOpen')}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></span>
    </Link>
  );
}
