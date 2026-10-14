import { Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ProductCard as Card } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { pick, paths } from '@/lib/urls';
import { CardAddButton, CardDelivery } from './CardActions';
import { effectivePrice } from './Price';
import { WishlistButton } from './WishlistButton';

/** 1234 → "1.2k" (English) / "1.2 ألف" (Arabic, Latin digits). */
export function compactCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(n).toLowerCase();
}

/**
 * The product card: photo with the discount and a heart, name, rating, old and new price, when it can arrive, and a
 * purple "Add" button. `badge` is a small label on the photo ("Best seller", "Trending"…).
 */
export function ProductCard({ p, t, minorUnits = 2, priority = false, sizes, badge }: { p: Card; t: T; minorUnits?: number; priority?: boolean; sizes?: string; badge?: string | null }) {
  const locale = t.locale;
  const title = pick(locale, p.title, p.titleAr);
  const { now, was, percent } = effectivePrice(p);
  return (
    <article className="pcard group" data-testid="product-card">
      <div className="relative aspect-square bg-white">
        {p.imageUrl ? (
          <Image
            src={p.imageUrl}
            alt={title}
            fill
            sizes={sizes ?? '(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 640px) 30vw, 46vw'}
            className="object-contain p-1.5 transition-transform duration-300 group-hover:scale-[1.03] @min-[150px]:p-3"
            priority={priority}
            quality={70}
          />
        ) : null}
        <div className="absolute start-1.5 top-1.5 flex max-w-[calc(100%-34px)] flex-col items-start gap-1 @min-[150px]:start-2 @min-[150px]:top-2">
          {badge ? <span className="max-w-full truncate rounded-md bg-brand-600 px-1 py-0.5 text-[11px] font-bold text-white @min-[150px]:px-1.5 @min-[150px]:text-[11px]" data-testid="card-badge">{badge}</span> : null}
          {!badge && percent > 0 ? (
            <span className="tabular rounded-md bg-brand-600 px-1 py-0.5 text-[11px] font-bold text-white @min-[150px]:px-1.5 @min-[150px]:text-[12px]" dir="ltr">-{percent}%</span>
          ) : null}
          {p.isSponsored && <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-ink-500">{t('product.sponsored')}</span>}
        </div>
        <div className="absolute end-0.5 top-0.5 @min-[150px]:end-1.5 @min-[150px]:top-1.5">
          <WishlistButton productId={p.id} compact />
        </div>
        {!p.inStock && (
          <div className="absolute inset-x-0 bottom-0 bg-ink-900/70 py-1 text-center text-xs font-semibold text-white">{t('product.outOfStock')}</div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-2 pt-1 @max-[80px]:px-1.5 @min-[150px]:p-2.5 @min-[150px]:pt-1.5">
        <h3 className="pcard-title">
          <Link href={paths.product(locale, p.slug)} className="after:absolute after:inset-0 after:content-['']">
            {title}
          </Link>
        </h3>
        {p.ratingCount > 0 ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-500 @min-[150px]:mt-1 @min-[150px]:text-[12px]" aria-label={t('product.ratingOutOf', { rating: p.ratingAvg })}>
            <Star className="size-3.5 fill-sand-400 text-sand-400" aria-hidden />
            <span className="font-medium text-ink-700">{p.ratingAvg.toFixed(1)}</span>
            <span className="tabular">({compactCount(p.ratingCount, locale)})</span>
          </p>
        ) : null}
        <div className="mt-auto pt-1.5">
          {was ? (
            <p className="tabular text-[11px] leading-4 text-ink-400 line-through @min-[150px]:text-[12px]" data-testid="price-was">{formatMoney(was, p.currencyCode, locale, { minorUnits, compact: true })}</p>
          ) : null}
          <p className="tabular whitespace-nowrap text-[14px] font-extrabold leading-5 text-brand-700 @max-[80px]:text-[13px] @min-[150px]:text-[16px] @min-[150px]:leading-6" data-testid="price-now">{formatMoney(now, p.currencyCode, locale, { minorUnits, compact: true })}</p>
          {p.inStock && p.lowStockCount !== null ? (
            <p className="text-[11.5px] font-medium text-warning-600">{t.plural('product.onlyLeft', p.lowStockCount)}</p>
          ) : p.inStock ? <CardDelivery /> : null}
          <CardAddButton productId={p.id} slug={p.slug} title={title} variantId={p.quickAddVariantId ?? null} inStock={p.inStock} />
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ items, t, minorUnits, priorityCount = 0 }: { items: Card[]; t: T; minorUnits?: number; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-4 gap-2 sm:gap-4 xl:grid-cols-5">
      {items.map((p, i) => (
        <li key={p.id}>
          <ProductCard p={p} t={t} minorUnits={minorUnits} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
