'use client';

import { Check, ShoppingCart, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useDeliveryPromise } from '@/lib/delivery-promise';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { haptic } from '@/lib/haptics';

/** "Tomorrow" / "Today" / "Thu 12" / "1–2 days" under a card's price (from the real delivery windows). */
export function CardDelivery() {
  const t = useT();
  const promise = useDeliveryPromise();
  if (!promise) return <p className="h-4" aria-hidden />;
  const label =
    promise.kind === 'today' ? t('card.today')
      : promise.kind === 'tomorrow' ? t('card.tomorrow')
        : promise.kind === 'date' ? new Intl.DateTimeFormat(t.locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${promise.date}T00:00:00Z`))
          : t('card.days');
  return (
    <p className="flex items-center gap-1 text-[11px] text-ink-500 @min-[150px]:gap-1.5 @min-[150px]:text-[12px]" data-testid="card-delivery">
      <Truck className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </p>
  );
}

/**
 * The card's purple "Add" button. One-option products go straight into the cart; products with options (size,
 * colour) open the product page to choose; sold-out products cannot be added.
 */
export function CardAddButton({ productId, slug, title, variantId, inStock }: { productId: string; slug: string; title: string; variantId: string | null; inStock: boolean }) {
  const t = useT();
  const cart = useCart();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const cls = 'relative z-10 mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold transition-colors @min-[150px]:mt-2 @min-[150px]:h-9 @min-[150px]:text-[13px]';

  if (!inStock) {
    return <button type="button" disabled className={`${cls} cursor-not-allowed bg-ink-100 text-ink-400`}>{t('product.outOfStock')}</button>;
  }
  if (!variantId) {
    return (
      <Link href={paths.product(t.locale, slug)} className={`${cls} bg-brand-600 text-white hover:bg-brand-700`} aria-label={t('card.chooseOptions', { title })} data-testid="card-add" data-product={productId}>
        <ShoppingCart className="size-4" aria-hidden />{t('card.add')}
      </Link>
    );
  }
  /** "Added ✓" and the cart badge change the moment it is tapped; a refusal (sold out meanwhile) puts it back. */
  function add() {
    haptic('success');
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1600);
    cart.add(variantId!, 1).then(
      () => toast({ tone: 'success', message: t('product.added'), action: { label: t('product.viewCart'), href: paths.cart(t.locale) } }),
      (e) => { window.clearTimeout(timer.current); setDone(false); haptic('error'); toast({ tone: 'error', message: errorMessage(e, t) }); },
    );
  }
  return (
    <button type="button" onClick={add} className={`${cls} bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800`} aria-label={t('card.addTitle', { title })} data-testid="card-add" data-product={productId}>
      {done ? <Check className="pop size-4" aria-hidden /> : <ShoppingCart className="size-4" aria-hidden />}
      {done ? t('card.added') : t('card.add')}
    </button>
  );
}
