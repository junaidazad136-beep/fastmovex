import type { Metadata } from 'next';
import { CategoryTiles, PopularSearches, ProductRail, PromoBanner, StoreRail, ValueProps } from '@/components/home/Sections';
import { RecentlyViewed } from '@/components/home/RecentlyViewed';
import { QuickLinks } from '@/components/home/QuickLinks';
import { TabbedRail, type RailTab } from '@/components/home/TabbedRail';
import { RailProducts } from '@/components/home/Sections';
import { Countdown } from '@/components/ui/Countdown';
import { JsonLd } from '@/components/ui/JsonLd';
import { serverApi } from '@/lib/api/server';
import type { HomeSection } from '@/lib/api/types';
import { env } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';
import { paths, pick, viewAllHref } from '@/lib/urls';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: { absolute: t('meta.defaultTitle') }, alternates: alternatesFor(locale, '') };
}

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const [feed, market, popular] = await Promise.all([serverApi.home(), serverApi.market(), serverApi.popularSearches().catch(() => ({ queries: [] }))]);
  const mu = market.currency.minorUnits;
  const legal = (market.legal ?? {}) as { supportPhone?: string; supportEmail?: string; address?: string };
  const socialLinks = Object.values(market.seo?.social ?? {}).filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));

  // Titles set in the admin panel win; otherwise the built-in title for the section.
  const known = ['trending', 'best_sellers', 'featured', 'new_arrivals', 'recommended', 'fastmovex_exclusive', 'flash_deals', 'featured_sellers', 'recently_viewed'] as const;
  const titleOf = (s: HomeSection, fallback: string) =>
    s.title ? pick(locale, s.title, s.titleAr) : (known as readonly string[]).includes(s.key) ? t(`home.${s.key as (typeof known)[number]}`) : fallback;

  // A product shows in one rail only (Trending and Best sellers often pick the same items); a rail left with too few new ones is dropped.
  const seen = new Set<string>();
  const dedupe = (s: HomeSection): HomeSection | null => {
    if (s.type !== 'products' && s.type !== 'deals') return s;
    const items = (s.items as { id: string }[]).filter((p) => !seen.has(p.id));
    if (items.length < 4 && items.length < s.items.length) return null;
    items.forEach((p) => seen.add(p.id));
    return { ...s, items } as HomeSection;
  };

  const render = (s: HomeSection) => {
    const href = viewAllHref(locale, s.viewAll);
    switch (s.type) {
      case 'banners':
        // the big home slider (HOME_HERO) was removed on purpose; only the mid-page promo banner is drawn
        return s.key === 'hero' ? null : <PromoBanner key={s.key} items={s.items} t={t} />;
      case 'value_props':
        return <ValueProps key={s.key} t={t} />;
      case 'categories':
        return <CategoryTiles key={s.key} items={s.items} t={t} title={s.title ? pick(locale, s.title, s.titleAr) : t('home.shopByCategory')} />;
      case 'deals':
        return <ProductRail key={s.key} id={s.key} title={titleOf(s, t('home.flash_deals'))} items={s.items} t={t} minorUnits={mu} endsAt={s.endsAt} href={href} deal />;
      case 'products':
        return <ProductRail key={s.key} id={s.key} title={titleOf(s, t('home.featured'))} items={s.items} t={t} minorUnits={mu} href={href} />;
      case 'stores':
        return <StoreRail key={s.key} title={titleOf(s, t('home.featured_sellers'))} items={s.items} t={t} />;
      default:
        return null;
    }
  };

  // The order is the one chosen in the admin panel (or the built-in default); older API answers lack the trust strip.
  const hasValueProps = feed.sections.some((s) => s.type === 'value_props');
  const sections = hasValueProps ? feed.sections : [...feed.sections.slice(0, 1), { key: 'value_props', type: 'value_props', items: [] } as HomeSection, ...feed.sections.slice(1)];

  // Trending / best sellers, new arrivals and flash deals share one row with tabs (Hot · New · Deals): less scrolling, same products.
  const deduped = sections.map(dedupe);
  const TAB_KEYS = ['trending', 'best_sellers', 'new_arrivals', 'flash_deals'];
  const tabSource = deduped.filter((s): s is Extract<HomeSection, { type: 'products' | 'deals' }> => !!s && TAB_KEYS.includes(s.key) && (s.type === 'products' || s.type === 'deals'));
  const hot = [...tabSource.filter((s) => s.key === 'trending' || s.key === 'best_sellers').flatMap((s) => s.items)];
  const fresh = tabSource.find((s) => s.key === 'new_arrivals');
  const deals = tabSource.find((s) => s.key === 'flash_deals');
  const tabs = ([
    hot.length ? { key: 'hot', label: t('home.tabHot'), node: <RailProducts id="hot" label={t('home.tabHot')} items={hot} t={t} minorUnits={mu} compact />, href: viewAllHref(locale, tabSource.find((s) => s.key === 'trending')?.viewAll) } : null,
    fresh?.items.length ? { key: 'new', label: t('home.tabNew'), node: <RailProducts id="new" label={t('home.tabNew')} items={fresh.items} t={t} minorUnits={mu} compact />, href: viewAllHref(locale, fresh.viewAll) } : null,
    deals?.items.length ? { key: 'deals', label: t('home.tabDeals'), node: <RailProducts id="deals" label={t('home.tabDeals')} items={deals.items} t={t} minorUnits={mu} compact />, href: viewAllHref(locale, deals.viewAll), extra: deals.type === 'deals' && deals.endsAt ? <><span className="sr-only">{t('home.endsIn')}</span><Countdown endsAt={deals.endsAt} pill /></> : undefined } : null,
  ] as (RailTab | null)[]).filter((x): x is RailTab => !!x);
  const useTabs = tabs.length >= 2;
  const tabbed = useTabs ? <TabbedRail key="tabs" tabs={tabs} seeAll={t('common.seeAll')} /> : null;
  // Hot / New / Deals sit right after the categories
  const rest = deduped.filter((s) => !(useTabs && s && TAB_KEYS.includes(s.key)));
  const rows: (HomeSection | 'tabs' | null)[] = [...rest];
  if (useTabs) {
    const at = rest.findIndex((s) => s?.type === 'categories');
    rows.splice(at >= 0 ? at + 1 : 0, 0, 'tabs');
  }

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': ['Organization', 'OnlineStore'],
              '@id': `${env.siteUrl}/#org`, name: 'FastMoveX', alternateName: 'فاست موف إكس', url: env.siteUrl, logo: `${env.siteUrl}/icons/icon-512.png`,
              description: t('meta.defaultDescription'),
              areaServed: { '@type': 'Country', name: 'Qatar' },
              // social profiles tie the shop's pages together in Google (knowledge panel)
              ...(socialLinks.length ? { sameAs: socialLinks } : {}),
              ...(legal.supportPhone || legal.supportEmail
                ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer service', areaServed: 'QA', availableLanguage: ['en', 'ar'], ...(legal.supportPhone && { telephone: legal.supportPhone }), ...(legal.supportEmail && { email: legal.supportEmail }) } }
                : {}),
              ...(legal.address ? { address: { '@type': 'PostalAddress', streetAddress: legal.address, addressCountry: 'QA' } } : {}),
            },
            {
              '@type': 'WebSite',
              '@id': `${env.siteUrl}/#website`,
              url: `${env.siteUrl}/${locale}`,
              name: t('meta.siteName'),
              inLanguage: locale,
              publisher: { '@id': `${env.siteUrl}/#org` },
              potentialAction: {
                '@type': 'SearchAction',
                target: { '@type': 'EntryPoint', urlTemplate: `${env.siteUrl}/${locale}/search?q={search_term_string}` },
                'query-input': 'required name=search_term_string',
              },
            },
          ],
        }}
      />
      <h1 className="sr-only">{t('meta.defaultTitle')}</h1>
      <PopularSearches queries={popular.queries} t={t} />
      <QuickLinks t={t} />
      {rows.map((s, i) => (
        <Fragment key={i}>{s === 'tabs' ? tabbed : s ? render(s) : null}</Fragment>
      ))}
      <RecentlyViewed />
    </>
  );
}
