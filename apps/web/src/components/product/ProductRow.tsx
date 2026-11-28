import { Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ProductCard as Card } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { pick, paths } from '@/lib/urls';
import { CardDelivery } from './CardActions';
import { compactCount } from './ProductCard';
import { effectivePrice } from './Price';
import { QtyStepper } from './QtyStepper';
import { WishlistButton } from './WishlistButton';

/** The searched words in a title in bold, so the eye finds them ("**Nova** Smart Watch"). */
function highlight(title: string, q?: string) {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
  if (!words.length) return title;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return title.split(re).map((part, i) => (i % 2 ? <b key={i} className="font-bold text-ink-900">{part}</b> : part));
}

/** One search result as a row (phones): photo left; name, rating, price, delivery and a round "+" right. */
export function ProductRow({ p, t, minorUnits = 2, q, priority = false }: { p: Card; t: T; minorUnits?: number; q?: string; priority?: boolean }) {
  const locale = t.locale;
  const title = pick(locale, p.title, p.titleAr);
  const { now, was, percent } = effectivePrice(p);
  return (
    <article className="relative flex gap-3 border-b border-ink-100 py-3 active:bg-ink-50" data-testid="product-row">
      <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-ink-50">
        {p.imageUrl ? <Image src={p.imageUrl} alt={title} fill sizes="96px" className="object-contain p-2" priority={priority} quality={70} /> : null}
        {percent > 0 ? <span className="tabular absolute start-1.5 top-1.5 rounded-md bg-deal-500 px-1.5 py-px text-[10.5px] font-extrabold text-white" dir="ltr">-{percent}%</span> : null}
        {!p.inStock ? <span className="absolute inset-x-0 bottom-0 bg-ink-900/75 py-0.5 text-center text-[10.5px] font-semibold text-white">{t('product.outOfStock')}</span> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1.5">
          <h3 className="line-clamp-2 flex-1 text-[13.5px] leading-[18px] text-ink-800">
            <Link href={paths.product(locale, p.slug)} className="after:absolute after:inset-0 after:content-['']">{highlight(title, q)}</Link>
          </h3>
          <div className="relative z-10 -me-1.5 -mt-1.5"><WishlistButton productId={p.id} compact /></div>
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ink-500">
          {p.ratingCount > 0 ? (
            <span className="inline-flex items-center gap-1" aria-label={t('product.ratingOutOf', { rating: p.ratingAvg })}>
              <Star className="size-3.5 fill-sand-400 text-sand-400" aria-hidden />
              <b className="font-semibold text-ink-800">{p.ratingAvg.toFixed(1)}</b>
              <span className="tabular">({compactCount(p.ratingCount, locale)})</span>
            </span>
          ) : null}
          {p.inStock && p.lowStockCount !== null ? <span className="font-semibold text-warning-600">{p.ratingCount > 0 ? '· ' : ''}{t.plural('product.onlyLeft', p.lowStockCount)}</span> : null}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="flex items-baseline gap-1.5">
              <span className="tabular text-[17px] font-extrabold leading-6 text-brand-700" data-testid="price-now">{formatMoney(now, p.currencyCode, locale, { minorUnits, compact: true })}</span>
              {was ? <span className="tabular text-[11.5px] text-ink-400 line-through" data-testid="price-was">{formatMoney(was, p.currencyCode, locale, { minorUnits, compact: true })}</span> : null}
            </p>
            {p.inStock ? <CardDelivery /> : null}
          </div>
          <QtyStepper productId={p.id} slug={p.slug} title={title} variantId={p.quickAddVariantId ?? null} inStock={p.inStock} />
        </div>
      </div>
    </article>
  );
}
