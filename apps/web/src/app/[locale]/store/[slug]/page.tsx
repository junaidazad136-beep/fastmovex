import { BadgeCheck, MapPin, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Reviews } from '@/components/product/Reviews';
import { Listing } from '@/components/search/Listing';
import { JsonLd } from '@/components/ui/JsonLd';
import { Stars } from '@/components/ui/Stars';
import { isNotFound } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { hasFilters, parseListing, toApiParams } from '@/lib/listing';
import { alternatesFor, clip } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

async function load(slug: string) {
  try {
    return await serverApi.store(slug);
  } catch (e) {
    if (isNotFound(e)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params, searchParams }: PageProps<'/[locale]/store/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  const [s, market] = await Promise.all([load(slug), serverApi.market()]);
  const name = pick(locale, s.name, s.nameAr);
  const query = parseListing(await searchParams);
  return {
    title: name,
    description: clip(pick(locale, s.description ?? '', s.descriptionAr) || t('meta.storeDescription', { name, country: pick(locale, market.name, market.nameAr) })),
    alternates: alternatesFor(locale, `/store/${slug}`),
    robots: hasFilters(query) || query.page > 1 ? { index: false, follow: true } : undefined,
    openGraph: s.logoUrl ? { images: [{ url: s.logoUrl }] } : undefined,
  };
}

export default async function StorePage({ params, searchParams }: PageProps<'/[locale]/store/[slug]'>) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const query = { ...parseListing(await searchParams), store: slug };
  const [s, market] = await Promise.all([load(slug), serverApi.market()]);
  const [result, reviews] = await Promise.all([serverApi.search(toApiParams(query, market.currency.minorUnits)), serverApi.storeReviews(slug)]);
  const name = pick(locale, s.name, s.nameAr);
  const description = pick(locale, s.description ?? '', s.descriptionAr);

  return (
    <div className="container-page py-6">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Store', name, url: `${env.siteUrl}${paths.store(locale, slug)}`, ...(s.logoUrl ? { logo: s.logoUrl, image: s.logoUrl } : {}), ...(s.city ? { address: { '@type': 'PostalAddress', addressLocality: s.city, addressCountry: market.code } } : {}), ...(s.ratingCount > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.ratingAvg, reviewCount: s.ratingCount } } : {}) }} />
      <section className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <div className="relative h-28 bg-gradient-to-br from-brand-700 via-brand-600 to-sand-500 sm:h-40">
          {s.bannerUrl && <Image src={s.bannerUrl} alt="" fill priority sizes="100vw" className="object-cover" />}
        </div>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-6">
          <span className="relative -mt-14 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-4 ring-white shadow-md sm:-mt-16 sm:size-24">
            {s.logoUrl ? <Image src={s.logoUrl} alt="" fill sizes="96px" className="object-cover" /> : <Store className="size-8 text-ink-400" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
              {s.verified && <span className="inline-flex items-center gap-1 font-medium text-success-600"><BadgeCheck className="size-4" aria-hidden />{t('store.verified')}</span>}
              {s.ratingCount > 0 && <span className="inline-flex items-center gap-1"><Stars value={s.ratingAvg} label={t('product.ratingOutOf', { rating: s.ratingAvg })} /> {s.ratingAvg.toFixed(1)} ({s.ratingCount})</span>}
              {s.city && <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{t('store.location', { city: s.city })}</span>}
              <span>{t('store.since', { date: formatDate(s.createdAt, locale, { month: 'long', year: 'numeric' }) })}</span>
            </div>
          </div>
        </div>
        {description && <p className="border-t border-ink-100 px-4 py-4 text-sm leading-6 text-ink-600 sm:px-6">{description}</p>}
      </section>

      <div className="mt-8">
        <Listing
          t={t}
          result={result}
          query={query}
          basePath={paths.store(locale, slug)}
          fixed={['store']}
          minorUnits={market.currency.minorUnits}
          heading={<h2 className="section-title mb-2">{t('store.products')}</h2>}
        />
      </div>
      <Reviews initial={reviews} endpoint={`/stores/${encodeURIComponent(slug)}/reviews`} title={t('store.reviews')} />
    </div>
  );
}
