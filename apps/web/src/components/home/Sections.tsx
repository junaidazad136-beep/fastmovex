import { ArrowRight, BadgeCheck, Banknote, ChevronRight, Flame, History, RotateCcw, ShieldCheck, Truck, Zap } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { Banner, ProductCard as Card, StoreCard } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { bannerHref, paths, pick } from '@/lib/urls';
import { ProductCard } from '../product/ProductCard';
import { Countdown } from '../ui/Countdown';
import { Rail } from '../ui/Rail';
import { Stars } from '../ui/Stars';
import { CategoryIcon } from './CategoryIcon';
import { HeroCarousel, type HeroSlide } from './HeroCarousel';

function BannerLink({ banner, t, className, children }: { banner: Banner; t: T; className: string; children: React.ReactNode }) {
  const link = bannerHref(t.locale, banner.linkUrl);
  if (!link) return <div className={className}>{children}</div>;
  if (link.external) return <a href={link.href} className={className} rel="noopener noreferrer">{children}</a>;
  return <Link href={link.href} className={className}>{children}</Link>;
}

/** Home slider. Banners with text are drawn by the website (purple, headline, button); plain pictures stay as they are. */
export function HeroBanners({ items, t }: { items: Banner[]; t: T }) {
  const l = t.locale;
  const slides: HeroSlide[] = items.filter((b) => b.imageUrl).map((b) => ({
    id: b.id,
    imageUrl: b.imageUrl!,
    link: bannerHref(l, b.linkUrl),
    kicker: pickOpt(l, b.kicker, b.kickerAr),
    headline: pickOpt(l, b.headline, b.headlineAr),
    subline: pickOpt(l, b.subline, b.sublineAr),
    cta: pickOpt(l, b.ctaLabel, b.ctaLabelAr) ?? (b.headline ? t('home.shopNow') : null),
  }));
  if (!slides.length) return null;
  return <HeroCarousel slides={slides} />;
}

/** English text, or the Arabic one on the Arabic site when it was written. */
function pickOpt(l: string, en?: string | null, ar?: string | null): string | null {
  return (l === 'ar' ? ar || en : en || ar) || null;
}

/** Section title row: icon + title on one side, "View all →" on the other. */
export function SectionHead({ id, title, icon, href, linkLabel, extra }: { id: string; title: string; icon?: React.ReactNode; href?: string; linkLabel: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 id={id} className="inline-flex items-center gap-1.5 text-[17px] font-bold tracking-tight text-ink-900 sm:gap-2 sm:text-xl">
          {icon}
          {title}
        </h2>
        {extra}
      </div>
      {href ? (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-brand-600 hover:text-brand-700 sm:text-[13.5px]">
          {linkLabel} <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/** Popular searches as chips under the search box (home page). */
export function PopularSearches({ queries, t }: { queries: string[]; t: T }) {
  if (!queries.length) return null;
  return (
    <section aria-labelledby="home-popular" className="container-page pt-3">
      <div className="flex items-center gap-2">
        <h2 id="home-popular" className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-ink-900 sm:text-[13.5px]">
          <History className="size-4 text-ink-700 sm:size-[18px]" aria-hidden />{t('home.popularSearches')}
        </h2>
        <ul className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {queries.slice(0, 10).map((q) => (
            <li key={q} className="shrink-0">
              <Link href={paths.search(t.locale, { q })} className="inline-flex h-7 items-center rounded-full border border-ink-100 bg-ink-50 px-3 text-[12px] text-ink-800 sm:h-8 sm:px-3.5 sm:text-[13px] hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700" data-testid="popular-chip">
                {q}
              </Link>
            </li>
          ))}
        </ul>
        <Link href={paths.search(t.locale)} aria-label={t('common.seeAll')} className="shrink-0 rounded-full p-1 text-ink-700 hover:bg-ink-100">
          <ChevronRight className="size-5 rtl:rotate-180" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export function ValueProps({ t }: { t: T }) {
  const items = [
    { Icon: Truck, title: t('home.valueDelivery'), text: t('home.valueDeliveryText') },
    { Icon: Banknote, title: t('home.valueCod'), text: t('home.valueCodText') },
    { Icon: RotateCcw, title: t('home.valueReturns'), text: t('home.valueReturnsText') },
    { Icon: ShieldCheck, title: t('home.valueSellers'), text: t('home.valueSellersText') },
  ];
  return (
    <section className="container-page mt-4 sm:mt-6" aria-label={t('home.whyUs')}>
      <ul className="no-scrollbar flex divide-x divide-ink-100 overflow-x-auto rounded-2xl border border-ink-100 bg-white py-2.5 rtl:divide-x-reverse lg:grid lg:grid-cols-4 lg:py-3.5">
        {items.map(({ Icon, title, text }) => (
          <li key={title} className="flex shrink-0 items-center gap-1.5 px-2 lg:gap-2.5 lg:px-5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 lg:size-11 lg:rounded-xl"><Icon className="size-4 lg:size-[22px]" aria-hidden /></span>
            <span className="leading-tight">
              <span className="block whitespace-nowrap text-[10px] font-semibold text-ink-900 lg:text-sm">{title}</span>
              <span className="block whitespace-nowrap text-[8.5px] text-ink-500 lg:text-xs">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Category tiles with a photo (the category's best seller) — a swipeable row, like the app. */
export function CategoryTiles({ items, t, title }: { items: { slug: string; name: string; nameAr: string; iconUrl: string | null; imageUrl?: string | null }[]; t: T; title: string }) {
  return (
    <section className="container-page mt-7" aria-labelledby="home-cats">
      <SectionHead id="home-cats" title={title} href={`/${t.locale}/categories`} linkLabel={t('home.viewAll')} />
      <ul className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto scroll-px-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {items.slice(0, 24).map((c) => (
          <li key={c.slug} className="w-[calc((100%-50px)/6)] min-w-[64px] max-w-[132px] shrink-0 snap-start sm:w-[104px]">
            <Link href={paths.category(t.locale, c.slug)} className="group flex flex-col items-center gap-1.5 text-center" data-testid="category-tile">
              <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-white text-brand-700 ring-1 ring-ink-100 transition group-hover:ring-brand-300">
                {c.imageUrl ? (
                  <Image src={c.imageUrl} alt="" fill sizes="(min-width: 640px) 104px, 16vw" className="object-contain p-1.5 transition-transform duration-300 group-hover:scale-105" quality={70} />
                ) : (
                  <CategoryIcon slug={c.slug} iconUrl={c.iconUrl} />
                )}
              </span>
              <span className="line-clamp-2 text-[11.5px] font-medium leading-[15px] text-ink-800 group-hover:text-brand-700 sm:text-[13px] sm:leading-4">{pick(t.locale, c.name, c.nameAr)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Small label on a card in the trending / best-seller rails, from what shoppers do with the product. Exported for tests. */
export function cardBadge(key: string, p: Card, i: number, t: T): string | null {
  if (key === 'best_sellers') return i < 3 ? t('card.bestSeller') : null;
  if (key === 'new_arrivals') return t('card.new');
  if (key !== 'trending') return null;
  if (i === 0) return t('card.bestSeller');
  if (p.dealPriceMinor) return t('card.hot');
  if (p.ratingAvg >= 4.5 && p.ratingCount >= 10) return t('card.popular');
  return t('card.trending');
}

export function ProductRail({ id, title, items, t, minorUnits, endsAt, href, deal = false }: { id: string; title: string; items: Card[]; t: T; minorUnits: number; endsAt?: string | null; href?: string; deal?: boolean }) {
  if (!items.length) return null;
  const icon = deal ? <Zap className="size-5 text-brand-600 sm:size-[22px]" strokeWidth={2.2} aria-hidden /> : id === 'trending' ? <Flame className="size-5 text-brand-600 sm:size-[22px]" strokeWidth={2.2} aria-hidden /> : null;
  return (
    <section className="container-page mt-7" aria-labelledby={`rail-${id}`}>
      <SectionHead
        id={`rail-${id}`}
        title={title}
        icon={icon}
        href={href}
        linkLabel={t('common.seeAll')}
        extra={endsAt ? <><span className="sr-only">{t('home.endsIn')}</span><Countdown endsAt={endsAt} pill /></> : null}
      />
      <Rail label={title} prevLabel={t('common.previous')} nextLabel={t('common.next')}>
        {items.map((p, i) => (
          <li key={p.id} className="rail-item">
            <ProductCard p={p} t={t} minorUnits={minorUnits} badge={cardBadge(id, p, i, t)} sizes="(min-width: 1280px) 200px, (min-width: 768px) 22vw, 25vw" />
          </li>
        ))}
      </Rail>
    </section>
  );
}

export function StoreRail({ title, items, t }: { title: string; items: StoreCard[]; t: T }) {
  if (!items.length) return null;
  return (
    <section className="container-page mt-10" aria-labelledby="home-stores">
      <h2 id="home-stores" className="section-title mb-4">{title}</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((s) => (
          <li key={s.slug}>
            <Link href={paths.store(t.locale, s.slug)} className="card flex items-center gap-3 p-3 transition hover:border-brand-200">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-ink-50 ring-1 ring-ink-100">
                {s.logoUrl && <Image src={s.logoUrl} alt="" fill sizes="48px" className="object-cover" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink-900">{pick(t.locale, s.name, s.nameAr)}</span>
                {s.ratingCount > 0 ? (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-500"><Stars value={s.ratingAvg} label={t('product.ratingOutOf', { rating: s.ratingAvg })} /> ({s.ratingCount})</span>
                ) : (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-success-600"><BadgeCheck className="size-3.5" aria-hidden />{t('store.verified')}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PromoBanner({ items, t }: { items: Banner[]; t: T }) {
  const b = items.find((x) => x.imageUrl);
  if (!b) return null;
  return (
    <section className="container-page mt-10">
      <BannerLink banner={b} t={t} className="block overflow-hidden rounded-2xl bg-ink-100">
        <div className="relative aspect-[16/5] sm:aspect-[16/4]">
          <Image src={b.imageUrl!} alt={t('home.promo')} fill sizes="(min-width: 1320px) 1280px, 100vw" className="object-cover" quality={80} />
        </div>
      </BannerLink>
    </section>
  );
}
