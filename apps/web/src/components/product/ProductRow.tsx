import Image from 'next/image';
import Link from 'next/link';
import type { ProductCard as Card } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { pick, paths } from '@/lib/urls';
import { Stars } from '../ui/Stars';
import { CardDelivery } from './CardActions';
import { compactCount } from './ProductCard';
import { effectivePrice } from './Price';
import { QtyStepper } from './QtyStepper';
import { WishlistButton } from './WishlistButton';

/** One search result as a card in a list (phones): photo left; name, stars, price, delivery and "Add to cart" right. */
export function ProductRow({ p, t, minorUnits = 2, priority = false }: { p: Card; t: T; minorUnits?: number; priority?: boolean }) {
  const locale = t.locale;
  const title = pick(locale, p.title, p.titleAr);
  const { now, was, percent } = effectivePrice(p);
  return (
    <article className="relative flex gap-3 rounded-2xl border border-ink-100 bg-white p-3" data-testid="product-row">
      <div className="relative w-[118px] shrink-0 self-stretch">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-ink-50">
          {p.imageUrl ? <Image src={p.imageUrl} alt={title} fill sizes="118px" className="object-contain p-2.5" priority={priority} quality={70} /> : null}
          {percent > 0 ? <span className="tabular absolute start-1.5 top-1.5 rounded-md bg-brand-600 px-1.5 py-0.5 text-[11px] font-extrabold text-white" dir="ltr">-{percent}%</span> : null}
          {!p.inStock ? <span className="absolute inset-x-0 bottom-0 bg-ink-900/75 py-0.5 text-center text-[10.5px] font-semibold text-white">{t('product.outOfStock')}</span> : null}
          <div className="absolute bottom-1 end-1 z-10"><WishlistButton productId={p.id} compact /></div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="line-clamp-2 text-[14px] font-medium leading-[19px] text-ink-900">
          <Link href={paths.product(locale, p.slug)} className="after:absolute after:inset-0 after:rounded-2xl after:content-['']">{title}</Link>
        </h3>
        {p.ratingCount > 0 ? (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-500">
            <b className="font-semibold text-ink-800">{p.ratingAvg.toFixed(1)}</b>
            <Stars value={p.ratingAvg} label={t('product.ratingOutOf', { rating: p.ratingAvg })} />
            <span className="tabular">({compactCount(p.ratingCount, locale)})</span>
          </p>
        ) : null}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          <span className="tabular text-[18px] font-extrabold leading-6 text-brand-700" data-testid="price-now">{formatMoney(now, p.currencyCode, locale, { minorUnits, compact: true })}</span>
          {was ? <span className="tabular text-[12px] text-ink-400 line-through" data-testid="price-was">{formatMoney(was, p.currencyCode, locale, { minorUnits, compact: true })}</span> : null}
        </p>
        {p.inStock ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px]">
            <CardDelivery />
            <span className="truncate text-ink-500">· {t('search.cod')}</span>
          </div>
        ) : null}
        {p.inStock && p.lowStockCount !== null ? <p className="mt-0.5 text-[12px] font-semibold text-warning-600">{t.plural('product.onlyLeft', p.lowStockCount)}</p> : null}
        <div className="mt-auto pt-2.5">
          <QtyStepper productId={p.id} slug={p.slug} title={title} variantId={p.quickAddVariantId ?? null} inStock={p.inStock} />
        </div>
      </div>
    </article>
  );
}
