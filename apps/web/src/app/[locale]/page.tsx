import type { Metadata } from 'next';
import { CategoryTiles, HeroBanners, PopularSearches, ProductRail, PromoBanner, StoreRail, ValueProps } from '@/components/home/Sections';
import { RecentlyViewed } from '@/components/home/RecentlyViewed';
import { JsonLd } from '@/components/ui/JsonLd';
import { serverApi } from '@/lib/api/server';
import type { HomeSection } from '@/lib/api/types';
import { env } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';
import { paths, pick, viewAllHref } from '@/lib/urls';
import { notFound } from 'next/navigation';

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
  const known = ['trending', 'best_sellers', 'featured', 'new_arrivals', 'recommended', 'jovia_exclusive', 'flash_deals', 'featured_sellers', 'recently_viewed'] as const;
  const titleOf = (s: HomeSection, fallback: string) =>
    s.title ? pick(locale, s.title, s.titleAr) : (known as readonly string[]).includes(s.key) ? t(`home.${s.key as (typeof known)[number]}`) : fallback;

  const render = (s: HomeSection) => {
    const href = viewAllHref(locale, s.viewAll);
    switch (s.type) {
      case 'banners':
        return s.key === 'hero' ? <HeroBanners key={s.key} items={s.items} t={t} /> : <PromoBanner key={s.key} items={s.items} t={t} />;
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
      {sections.map(render)}
      <RecentlyViewed />
    </>
  );
}
