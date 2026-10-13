import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Listing } from '@/components/search/Listing';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { JsonLd } from '@/components/ui/JsonLd';
import { serverApi } from '@/lib/api/server';
import { isNotFound } from '@/lib/api/errors';
import { env } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { hasFilters, parseListing, toApiParams } from '@/lib/listing';
import { SeoText } from '@/components/seo/SeoText';
import { alternatesFor, itemListJsonLd, seoDescriptionOf, seoTitleOf } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

async function load(slug: string) {
  try {
    return await serverApi.category(slug);
  } catch (e) {
    if (isNotFound(e)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params, searchParams }: PageProps<'/[locale]/c/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  const [cat, market] = await Promise.all([load(slug), serverApi.market()]);
  const name = pick(locale, cat.name, cat.nameAr);
  const country = pick(locale, market.name, market.nameAr);
  const query = parseListing(await searchParams);
  const title = seoTitleOf(locale, cat, t('meta.categoryTitle', { name, country }));
  const description = seoDescriptionOf(locale, cat, t('meta.categoryDescription', { name, country }));
  return {
    title,
    description,
    openGraph: { title, description, ...(cat.imageUrl ? { images: [{ url: cat.imageUrl, alt: name }] } : {}) },
    alternates: alternatesFor(locale, `/c/${slug}`),
    // Filtered / paged / re-sorted variants point search engines at the clean category page.
    robots: hasFilters(query) || query.page > 1 || query.q ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps<'/[locale]/c/[slug]'>) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const query = { ...parseListing(await searchParams), category: slug };
  const [cat, market] = await Promise.all([load(slug), serverApi.market()]);
  const result = await serverApi.search(toApiParams(query, market.currency.minorUnits));
  const name = pick(locale, cat.name, cat.nameAr);
  const crumbs = [
    { name: t('common.home'), href: paths.home(locale) },
    ...cat.breadcrumbs.map((c) => ({ name: pick(locale, c.name, c.nameAr), href: paths.category(locale, c.slug) })),
  ];

  return (
    <div className="container-page py-6">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${env.siteUrl}${c.href}` })),
        }}
      />
      {result.items.length && !hasFilters(query) && query.page === 1 ? <JsonLd data={itemListJsonLd(env.siteUrl, locale, result.items, name)} /> : null}
      <Breadcrumbs items={crumbs} label={t('nav.breadcrumb')} />
      <Listing
        t={t}
        result={result}
        query={query}
        basePath={paths.category(locale, slug)}
        fixed={['category']}
        minorUnits={market.currency.minorUnits}
        categoryBase={`/${locale}/c/`}
        heading={
          <div className="mb-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{name}</h1>
            {cat.children.length > 0 && (
              <ul className="no-scrollbar mt-4 flex gap-2 overflow-x-auto" aria-label={t('category.subcategories')}>
                {cat.children.map((c) => (
                  <li key={c.slug}><Link href={paths.category(locale, c.slug)} className="chip whitespace-nowrap">{pick(locale, c.name, c.nameAr)}</Link></li>
                ))}
              </ul>
            )}
          </div>
        }
      />
      {query.page === 1 && !hasFilters(query) && !query.q ? (
        <SeoText title={t('category.about', { name })} text={(locale === 'ar' ? cat.descriptionAr : cat.description) ?? null} faqTitle={t('category.faq', { name })} faq={cat.faq ?? []} locale={locale} />
      ) : null}
    </div>
  );
}
