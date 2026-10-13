import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Listing } from '@/components/search/Listing';
import { SeoText } from '@/components/seo/SeoText';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { JsonLd } from '@/components/ui/JsonLd';
import { isNotFound } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { hasFilters, parseListing, toApiParams } from '@/lib/listing';
import { alternatesFor, itemListJsonLd, seoDescriptionOf, seoTitleOf } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

async function load(slug: string) {
  try {
    return await serverApi.brand(slug);
  } catch (e) {
    if (isNotFound(e)) notFound();
    throw e;
  }
}

/** A brand's page: "Samsung Qatar" style searches land here — every product of the brand, its story and questions. */
export async function generateMetadata({ params, searchParams }: PageProps<'/[locale]/brand/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  const [b, market] = await Promise.all([load(slug), serverApi.market()]);
  const name = pick(locale, b.name, b.nameAr);
  const country = pick(locale, market.name, market.nameAr);
  const query = parseListing(await searchParams);
  const title = seoTitleOf(locale, b, t('meta.brandTitle', { name, country }));
  const description = seoDescriptionOf(locale, b, t('meta.brandDescription', { name, country }));
  return {
    title,
    description,
    alternates: alternatesFor(locale, `/brand/${slug}`),
    openGraph: { title, description, ...(b.logoUrl ? { images: [{ url: b.logoUrl, alt: name }] } : {}) },
    // a brand with nothing on sale, and filtered / paged views, are not landing pages
    robots: b.productCount === 0 || hasFilters(query) || query.page > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function BrandPage({ params, searchParams }: PageProps<'/[locale]/brand/[slug]'>) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const query = { ...parseListing(await searchParams), brands: [slug] };
  const [b, market] = await Promise.all([load(slug), serverApi.market()]);
  const result = await serverApi.search(toApiParams(query, market.currency.minorUnits));
  const name = pick(locale, b.name, b.nameAr);
  const crumbs = [{ name: t('common.home'), href: paths.home(locale) }, { name, href: paths.brand(locale, slug) }];
  return (
    <div className="container-page py-6" data-testid="brand-page">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${env.siteUrl}${c.href}` })) }} />
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Brand', name: b.name, ...(b.nameAr ? { alternateName: b.nameAr } : {}), url: `${env.siteUrl}${paths.brand(locale, slug)}`, ...(b.logoUrl ? { logo: b.logoUrl } : {}) }} />
      {result.items.length && !hasFilters({ ...query, brands: [] }) && query.page === 1 ? <JsonLd data={itemListJsonLd(env.siteUrl, locale, result.items, name)} /> : null}
      <Breadcrumbs items={crumbs} label={t('nav.breadcrumb')} />
      <Listing
        t={t}
        result={result}
        query={query}
        basePath={paths.brand(locale, slug)}
        fixed={['brands']}
        minorUnits={market.currency.minorUnits}
        heading={
          <div className="mb-3 flex items-center gap-4">
            {b.logoUrl ? <span className="relative size-14 shrink-0 overflow-hidden rounded-2xl border border-ink-100 bg-white"><Image src={b.logoUrl} alt="" fill sizes="56px" className="object-contain p-1.5" /></span> : null}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('brand.label')}</p>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{name}</h1>
            </div>
          </div>
        }
      />
      {query.page === 1 && !hasFilters({ ...query, brands: [] }) ? (
        <SeoText title={t('brand.about', { name })} text={(locale === 'ar' ? b.descriptionAr : b.description) ?? null} faqTitle="" faq={[]} locale={locale} />
      ) : null}
    </div>
  );
}
