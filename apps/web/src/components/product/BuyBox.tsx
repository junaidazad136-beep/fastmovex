'use client';

import { Bell, Check, Minus, Plus, ShieldCheck, RotateCcw, ShoppingCart, Truck } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ProductDetail } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useSession } from '@/lib/state/session';
import { useMoney, useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { Countdown } from '../ui/Countdown';
import { Spinner } from '../ui/Spinner';
import { Gallery, type GalleryImage } from './Gallery';
import { Price, effectivePrice } from './Price';
import { defaultVariant, findVariant, isValueAvailable, optionNames, optionValues, selectValue } from './variants';
import { WishlistButton } from './WishlistButton';

const MAX_QTY = 99;

/** Gallery + options + add to cart. One client island, because the chosen variant drives the photo, price and stock. */
export function ProductBuy({ product, images, title }: { product: ProductDetail; images: GalleryImage[]; title: string }) {
  const t = useT();
  const { market } = useShop();
  const money = useMoney();
  const cart = useCart();
  const toast = useToast();
  const names = useMemo(() => optionNames(product.variants), [product.variants]);
  const [selected, setSelected] = useState<Record<string, string>>(() => ({ ...(defaultVariant(product.variants)?.optionValues ?? {}) }));
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  // Server-rendered buttons only work once hydrated; keep them disabled until then so an early tap is never lost.
  // …and until we know whether the shopper is signed in, so the item lands in the right cart (account or guest).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { status } = useSession();
  const ready = mounted && status !== 'loading';

  const variant = findVariant(product.variants, selected) ?? defaultVariant(product.variants);
  const inCart = cart.cart?.groups.flatMap((g) => g.items).find((i) => i.variantId === variant?.id)?.quantity ?? 0;
  const maxQty = Math.min(MAX_QTY, variant?.lowStockCount ?? MAX_QTY);
  const price = variant ? effectivePrice(variant) : null;

  async function add() {
    if (!variant) return;
    setBusy(true);
    try {
      await cart.add(variant.id, qty);
      setJustAdded(true);
      window.setTimeout(() => setJustAdded(false), 2500);
      toast({ tone: 'success', message: t('product.added'), action: { label: t('product.viewCart'), href: paths.cart(t.locale) } });
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
      <Gallery images={images} activeVariantId={variant?.id} />
      <div>
        <h1 className="text-xl font-bold leading-snug tracking-tight text-ink-900 sm:text-2xl" data-testid="product-title">{title}</h1>
        {variant && (
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-4">
            <Price input={variant} currency={variant.currencyCode} minorUnits={market.currency.minorUnits} locale={t.locale} size="lg" showPercent percentLabel={(n) => t('product.percentOff', { n })} />
            {price?.was && (
              <p className="mt-1 text-sm font-medium text-success-600">
                {t('product.youSave', { amount: money((BigInt(price.was) - BigInt(price.now)).toString()) })}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-500">{market.pricesIncludeTax ? t('product.vatIncluded') : t('product.vatExcluded')}</p>
            {variant.dealEndsAt && price?.onDeal && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-deal-500/8 px-3 py-2 text-sm text-deal-600">
                <span className="font-semibold">{t('product.dealEndsIn')}</span>
                <Countdown endsAt={variant.dealEndsAt} />
                {variant.dealStockLeft !== null && variant.dealStockLeft <= 20 && (
                  <span className="text-xs">· {t.plural('product.dealLeft', variant.dealStockLeft)}</span>
                )}
              </div>
            )}
          </div>
        )}

        {names.map((name) => (
          <fieldset key={name} className="mt-5">
            <legend className="mb-2 text-sm font-semibold text-ink-800">
              {name}: <span className="font-normal text-ink-600">{selected[name]}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {optionValues(product.variants, name).map((value) => {
                const active = selected[name] === value;
                const available = isValueAvailable(product.variants, selected, name, value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setSelected(selectValue(product.variants, selected, name, value)); setQty(1); }}
                    aria-pressed={active}
                    className={`min-w-12 rounded-xl border px-3.5 py-2 text-sm transition ${active ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-600' : 'border-ink-200 bg-white text-ink-800 hover:border-ink-400'} ${available ? '' : 'text-ink-400 line-through decoration-ink-300'}`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="mt-5">
          {variant?.inStock ? (
            <p className={`text-sm font-semibold ${variant.lowStockCount !== null ? 'text-warning-600' : 'text-success-600'}`} data-testid="stock-status">
              {variant.lowStockCount !== null ? t.plural('product.onlyLeft', variant.lowStockCount) : t('product.inStock')}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold text-danger-600" data-testid="stock-status">{t('product.outOfStock')}</p>
              {mounted && <NotifyMe productId={product.id} />}
            </div>
          )}
        </div>

        {/* Phones add from the bar at the bottom of the screen; here they pick the quantity (and save to the wishlist). */}
        <div className="mt-4 flex items-stretch gap-3">
          <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-white max-md:flex-1">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label={t('product.decrease')} className="flex size-12 items-center justify-center text-ink-700 disabled:text-ink-300">
              <Minus className="size-4" aria-hidden />
            </button>
            <output className="tabular w-8 text-center font-semibold" aria-label={t('product.quantity')} data-testid="qty">{qty}</output>
            <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label={t('product.increase')} className="flex size-12 items-center justify-center text-ink-700 disabled:text-ink-300">
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
          <button type="button" onClick={add} disabled={!ready || !variant?.inStock || busy} className="btn-primary btn-lg flex-1 max-md:hidden" data-testid="add-to-cart">
            {busy ? <Spinner /> : justAdded ? <Check className="size-5" aria-hidden /> : null}
            {busy ? t('product.adding') : justAdded ? t('product.added') : t('product.addToCart')}
          </button>
          <WishlistButton productId={product.id} />
        </div>
        {inCart > 0 && (
          <p className="mt-2 text-sm text-ink-500">
            <Link href={paths.cart(t.locale)} className="link">{t('product.viewCart')}</Link> · {t.plural('common.items', inCart)}
          </p>
        )}

        <ul className="mt-6 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white text-sm">
          <li className="flex items-start gap-3 p-3.5"><Truck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden /><span className="text-ink-700">{t('product.deliveryNote')}</span></li>
          <li className="flex items-start gap-3 p-3.5">
            <RotateCcw className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
            <span className="text-ink-700">
              {product.returnWindowDays > 0 ? t.plural('product.returnWindow', product.returnWindowDays) : t('product.notReturnable')}
              {' · '}<Link href={paths.returnsPolicy(t.locale)} className="link">{t('help.returnsPolicy')}</Link>
            </span>
          </li>
          {!!product.warrantyMonths && (
            <li className="flex items-start gap-3 p-3.5"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden /><span className="text-ink-700">{t.plural('product.warranty', product.warrantyMonths)}</span></li>
          )}
        </ul>
        {variant && <p className="mt-3 text-xs text-ink-400">{t('product.sku')}: <span dir="ltr">{variant.sku}</span></p>}
      </div>

      {/* Phones: price + "Add to cart" always at the bottom of the screen (the tab bar steps aside on product pages). */}
      {variant && price && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur md:hidden" data-testid="sticky-buy">
          <div className="flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <p className="tabular text-lg font-extrabold leading-tight text-brand-700" data-testid="sticky-price">{money(price.now)}</p>
              {price.was && price.percent > 0 && (
                <p className="tabular flex items-center gap-1.5 text-xs leading-tight">
                  <span className="text-ink-400 line-through">{money(price.was)}</span>
                  <span className="rounded bg-brand-600 px-1 font-bold text-white">-{price.percent}%</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={add}
              disabled={!ready || !variant.inStock || busy}
              className="btn-primary h-12 min-w-0 flex-1 rounded-xl text-[15px] disabled:bg-ink-200 disabled:text-ink-500"
              data-testid="sticky-add"
            >
              {busy ? <Spinner /> : justAdded ? <Check className="size-5" aria-hidden /> : variant.inStock ? <ShoppingCart className="size-5" aria-hidden /> : null}
              <span className="truncate">
                {!variant.inStock ? t('product.outOfStock') : busy ? t('product.adding') : justAdded ? t('product.added') : qty > 1 ? `${t('product.addToCart')} · ${qty}` : t('product.addToCart')}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Tell me when it is back": saves the product with the back-in-stock alert on (email, app, WhatsApp if chosen). */
function NotifyMe({ productId }: { productId: string }) {
  const t = useT();
  const { status } = useSession();
  const toast = useToast();
  const pathname = usePathname();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  if (status === 'loading') return null;
  if (status !== 'user') {
    return <Link href={paths.login(t.locale, pathname)} className="btn-secondary px-3 py-1.5 text-sm" data-testid="notify-me"><Bell className="size-4" aria-hidden />{t('product.notifyMe')}</Link>;
  }
  async function go() {
    setState('busy');
    try {
      await api('/wishlists/items', { method: 'POST', body: { productId } }).catch((e) => { if (!(e instanceof ApiError && e.status === 409)) throw e; });
      await api(`/wishlists/items/${productId}/alerts`, { method: 'PATCH', body: { notifyBackInStock: true } });
      setState('done');
      toast({ tone: 'success', message: t('product.notifySaved') });
    } catch (e) {
      setState('idle');
      toast({ tone: 'error', message: errorMessage(e, t) });
    }
  }
  return state === 'done'
    ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-600" data-testid="notify-me-done"><Check className="size-4" aria-hidden />{t('product.notifyOn')}</span>
    : <button type="button" onClick={go} disabled={state === 'busy'} className="btn-secondary px-3 py-1.5 text-sm" data-testid="notify-me">{state === 'busy' ? <Spinner className="size-4" /> : <Bell className="size-4" aria-hidden />}{t('product.notifyMe')}</button>;
}
