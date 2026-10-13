'use client';

import { BadgeCheck, Bell, Check, Minus, Plus, ShieldCheck, RotateCcw, Truck, Zap } from 'lucide-react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ProductDetail, TogetherCard } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useSession } from '@/lib/state/session';
import { useMoney, useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { Countdown } from '../ui/Countdown';
import { Stars } from '../ui/Stars';
import { Spinner } from '../ui/Spinner';
import { BoughtTogether } from './BoughtTogether';
import { DeliveryLine, PayLaterLine } from './DeliveryLine';
import { Gallery, type GalleryImage } from './Gallery';
import { SizeGuideLink } from './SizeGuide';
import { SIZE_OPTION } from '@/lib/size-chart';
import { Price, effectivePrice } from './Price';
import { defaultVariant, findVariant, isValueAvailable, optionNames, optionValues, selectValue } from './variants';
import { WishlistButton } from './WishlistButton';

const MAX_QTY = 99;

/** Gallery + options + add to cart. One client island, because the chosen variant drives the photo, price and stock. */
export function ProductBuy({ product, images, title, together = [] }: { product: ProductDetail; images: GalleryImage[]; title: string; together?: TogetherCard[] }) {
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
  const [buying, setBuying] = useState(false);
  const router = useRouter();
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

  /** "Buy Now": a one-item cart of its own, straight to checkout; the shopper's cart is left as it is. */
  async function buyNow() {
    if (!variant) return;
    setBuying(true);
    try {
      const { cartToken } = await api<{ cartToken: string }>('/cart/buy-now', { method: 'POST', auth: 'none', body: { variantId: variant.id, quantity: qty } });
      router.push(`${paths.checkout(t.locale)}?buy=${encodeURIComponent(cartToken)}`);
    } catch (e) {
      setBuying(false);
      toast({ tone: 'error', message: errorMessage(e, t) });
    }
  }
  const goods = price ? BigInt(price.now) * BigInt(qty) : 0n;
  const canBuy = ready && !!variant?.inStock && !busy && !buying;

  const storeName = pick(t.locale, product.store.name, product.store.nameAr);
  const chart = product.sizeChart ?? null;
  const sizeOption = names.find((n) => SIZE_OPTION.test(n)) ?? null;
  const bought = product.boughtLastMonth ?? 0;
  const subtitle = pick(t.locale, product.shortDescription ?? '', product.shortDescriptionAr).trim();
  /** the photo of each option value (a colour's own picture), when the seller added one */
  const valueImage = (name: string, value: string) => {
    const ids = new Set(product.variants.filter((v) => v.optionValues?.[name] === value).map((v) => v.id));
    return images.find((im) => im.variantId && ids.has(im.variantId))?.url ?? null;
  };

  return (
    // Phones: who sells it + title first, then the photos, the options and the rest (Amazon's order). Larger screens:
    // photos on the left, everything else on the right.
    <>
    <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12">
      <div className="lg:col-start-2 lg:row-start-1" data-testid="product-head">
        {/* The shop selling it, once, at the top (Amazon's "Visit the Store" line): its logo line when it has a logo,
            otherwise one plain line. The rating sits on the right. The brand is in the specifications. */}
        <div className="flex min-h-5 items-center gap-3">
          {product.store.logoUrl ? (
            <Link href={paths.store(t.locale, product.store.slug)} className="flex min-w-0 items-center gap-2.5" data-testid="product-store">
              <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-ink-100">
                <Image src={product.store.logoUrl} alt="" fill sizes="36px" className="object-contain p-0.5" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="flex items-center gap-1 text-[15px] font-semibold text-ink-900">
                  <span className="truncate">{storeName}</span>
                  {product.store.isHouse && <BadgeCheck className="size-4 shrink-0 text-brand-600" aria-label={t('product.officialStore')} />}
                </span>
                <span className="text-[13px] text-brand-700">{t('product.visitTheStore')}</span>
              </span>
            </Link>
          ) : (
            <Link href={paths.store(t.locale, product.store.slug)} className="flex min-w-0 items-center gap-1 text-sm text-brand-700 hover:underline" data-testid="product-store">
              <span className="truncate">{t('product.visitStoreNamed', { name: storeName })}</span>
              {product.store.isHouse && <BadgeCheck className="size-4 shrink-0 text-brand-600" aria-label={t('product.officialStore')} />}
            </Link>
          )}
          {product.ratingCount > 0 && (
            <a href="#reviews" className="ms-auto flex shrink-0 items-center gap-1 text-[13px]" aria-label={t('product.seeReviews', { count: product.ratingCount })} data-testid="product-rating">
              <span className="tabular text-ink-800">{product.ratingAvg.toFixed(1)}</span>
              <Stars value={product.ratingAvg} label={t('product.ratingOutOf', { rating: product.ratingAvg })} />
              <span className="tabular text-brand-700">({product.ratingCount.toLocaleString('en')})</span>
            </a>
          )}
        </div>
        <h1 className={`mt-1 text-sm leading-[19px] lg:mt-2 lg:text-2xl lg:font-bold lg:leading-snug lg:tracking-tight lg:text-ink-900 ${subtitle ? 'text-ink-900' : 'text-ink-700'}`} data-testid="product-title">{title}</h1>
        {subtitle && <p className="text-sm leading-[19px] text-ink-500 lg:mt-1 lg:text-base" data-testid="product-subtitle">{subtitle}</p>}
        {bought > 0 && (
          <p className="mt-1.5 text-sm text-ink-900" data-testid="bought-last-month">
            <strong className="font-bold">{t('product.boughtCount', { n: bought >= 1000 ? `${bought / 1000}K` : String(bought) })}</strong> {t('product.boughtPeriod')}
          </p>
        )}
      </div>

      <div className="-mx-4 mt-3 sm:-mx-6 md:mx-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mt-0">
        <Gallery images={images} activeVariantId={variant?.id} productId={product.id} title={title} />
      </div>

      <div className="flex flex-col lg:col-start-2 lg:row-start-2">
        {variant && (
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-4 max-lg:order-2">
            <Price input={variant} currency={variant.currencyCode} minorUnits={market.currency.minorUnits} locale={t.locale} size="lg" showPercent percentLabel={(n) => t('product.percentOff', { n })} />
            {price?.was && (
              <p className="mt-1 text-sm font-medium text-success-600">
                {t('product.youSave', { amount: money((BigInt(price.was) - BigInt(price.now)).toString()) })}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-500">{market.pricesIncludeTax ? t('product.vatIncluded') : t('product.vatExcluded')}</p>
            <PayLaterLine totalMinor={goods} />
            {variant.dealEndsAt && price?.onDeal && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-deal-500/8 px-3 py-2 text-sm text-deal-600">
                <span className="font-semibold">{t('product.dealEndsIn')}</span>
                <Countdown endsAt={variant.dealEndsAt} />
                {variant.dealStockLeft !== null && variant.dealStockLeft <= 20 && (
                  <span className="text-xs">· {t.plural('product.dealLeft', variant.dealStockLeft)}</span>
                )}
              </div>
            )}
            {variant.inStock && <DeliveryLine goodsMinor={goods} />}
          </div>
        )}

        <div className="max-lg:order-1">
        {names.map((name) => {
          const values = optionValues(product.variants, name);
          const pictures = values.map((v) => valueImage(name, v));
          // a picture card per value (Amazon's colour cards) when most values have their own photo; small buttons otherwise
          const visual = pictures.filter(Boolean).length >= Math.max(2, Math.ceil(values.length / 2));
          return (
            <fieldset key={name} className="mt-4">
              <legend className="mb-2 flex w-full items-center justify-between gap-3 text-sm font-semibold text-ink-800">
                <span>{name}: <span className="font-normal text-ink-600">{selected[name]}</span></span>
                {chart && name === sizeOption && <SizeGuideLink chart={chart} selected={selected[name]} />}
              </legend>
              <div className={visual ? 'no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:px-0' : 'flex flex-wrap gap-2'} data-testid={visual ? 'option-cards' : undefined}>
                {values.map((value, i) => {
                  const active = selected[name] === value;
                  const available = isValueAvailable(product.variants, selected, name, value);
                  const choose = () => { setSelected(selectValue(product.variants, selected, name, value)); setQty(1); };
                  if (!visual) {
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={choose}
                        aria-pressed={active}
                        className={`min-w-12 rounded-xl border px-3.5 py-2 text-sm transition ${active ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-600' : 'border-ink-200 bg-white text-ink-800 hover:border-ink-400'} ${available ? '' : 'text-ink-400 line-through decoration-ink-300'}`}
                      >
                        {value}
                      </button>
                    );
                  }
                  const v = findVariant(product.variants, selectValue(product.variants, selected, name, value));
                  const vp = v ? effectivePrice(v) : null;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={choose}
                      aria-pressed={active}
                      className={`w-[104px] shrink-0 overflow-hidden rounded-xl border bg-white text-start transition ${active ? 'border-brand-600 ring-2 ring-brand-600' : 'border-ink-200 hover:border-ink-400'}`}
                      data-testid="option-card"
                    >
                      <span className={`relative block aspect-square bg-ink-50 ${available ? '' : 'opacity-40'}`}>
                        {pictures[i] && <Image src={pictures[i]!} alt="" fill sizes="104px" className="object-contain p-1.5" />}
                      </span>
                      <span className="block px-2 pb-2 pt-1.5 leading-tight">
                        <span className="block truncate text-xs font-medium text-ink-800">{value}</span>
                        {vp && available ? (
                          <span className="tabular mt-0.5 block whitespace-nowrap text-xs font-bold text-ink-900">{money(vp.now)}</span>
                        ) : (
                          <span className="mt-0.5 block text-[11px] text-ink-400">{t('product.outOfStock')}</span>
                        )}
                        {vp?.was && available && <span className="tabular block whitespace-nowrap text-[11px] text-ink-400 line-through">{money(vp.was)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        {/* a guide the seller attached to a product without a "Size" option (one size, or sizes in the title) */}
        {chart && !sizeOption && <div className="mt-3"><SizeGuideLink chart={chart} /></div>}
        </div>

        <div className="order-3">
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
          <span className="max-md:hidden"><WishlistButton productId={product.id} /></span>
        </div>
        {variant?.inStock && (
          <button type="button" onClick={buyNow} disabled={!canBuy} className="btn btn-lg mt-3 w-full bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-700 max-md:hidden" data-testid="buy-now">
            {buying ? <Spinner /> : <Zap className="size-5" aria-hidden />}
            {buying ? t('product.buyingNow') : t('product.buyNow')}
          </button>
        )}
        {inCart > 0 && (
          <p className="mt-2 text-sm text-ink-500">
            <Link href={paths.cart(t.locale)} className="link">{t('product.viewCart')}</Link> · {t.plural('common.items', inCart)}
          </p>
        )}

        <ul className="mt-6 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white text-sm">
          {/* who sells it is the top line of the page (Amazon's "Visit the Store"), so it is not repeated here */}
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
            {variant.inStock ? (
              <>
                <button
                  type="button"
                  onClick={add}
                  disabled={!ready || busy || buying}
                  className="btn-primary h-12 min-w-0 flex-1 rounded-xl px-2 text-[15px]"
                  data-testid="sticky-add"
                >
                  {busy ? <Spinner /> : justAdded ? <Check className="size-5" aria-hidden /> : null}
                  <span className="truncate">{busy ? t('product.adding') : justAdded ? t('product.added') : t('product.addToCart')}</span>
                </button>
                <button
                  type="button"
                  onClick={buyNow}
                  disabled={!canBuy}
                  className="btn h-12 min-w-0 flex-1 rounded-xl bg-ink-900 px-2 text-[15px] text-white active:bg-ink-700"
                  data-testid="sticky-buy-now"
                >
                  {buying && <Spinner />}
                  <span className="truncate">{buying ? t('product.buyingNow') : t('product.buyNow')}</span>
                </button>
              </>
            ) : (
              <button type="button" disabled className="btn h-12 min-w-0 flex-1 rounded-xl bg-ink-200 text-[15px] text-ink-500" data-testid="sticky-add">
                {t('product.outOfStock')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    {variant && (
      <BoughtTogether
        main={variant.inStock && price ? { variantId: variant.id, title, imageUrl: images.find((im) => im.variantId === variant.id)?.url ?? images[0]?.url ?? null, priceMinor: price.now } : null}
        items={together}
      />
    )}
    </>
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
