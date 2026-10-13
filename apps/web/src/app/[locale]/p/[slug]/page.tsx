import { BadgeCheck, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductRail } from '@/components/home/Sections';
import { ProductBuy } from '@/components/product/BuyBox';
import { WhatsAppAsk } from '@/components/ui/WhatsApp';
import { effectivePrice } from '@/components/product/Price';
import { Questions } from '@/components/product/Questions';
import { Reviews } from '@/components/product/Reviews';
import { ViewTracker } from '@/components/product/ViewTracker';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { JsonLd } from '@/components/ui/JsonLd';
import { Stars } from '@/components/ui/Stars';
import { isNotFound } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { Market, ProductDetail } from '@/lib/api/types';
import { env } from '@/lib/env';
import { getT } from '@/lib/i18n';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { minorToDecimalString } from '@/lib/money';
import { alternatesFor, clip } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

async function load(slug: string): Promise<ProductDetail> {
  try {
    return await serverApi.product(slug);
  } catch (e) {
    if (isNotFound(e)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: PageProps<'/[locale]/p/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  const [p, market] = await Promise.all([load(slug), serverApi.market()]);
  const name = pick(locale, p.title, p.titleAr);
  const country = pick(locale, market.name, market.nameAr);
  // "Dallah Set — buy in Qatar | FastMoveX" while it fits Google's ~60 characters; the title written in the admin panel wins (English)
  const long = t('meta.productTitle', { name, country });
  const title = locale === 'en' && p.seoTitle?.trim() ? p.seoTitle.trim() : long.length <= 52 ? long : name;
  const own = locale === 'en' ? p.seoDescription?.trim() : '';
  const desc = own || clip(`${pick(locale, p.description ?? '', p.descriptionAr)} ${t('meta.productDescriptionSuffix', { country })}`);
  const image = p.images.find((i) => i.url)?.url;
  return {
    title,
    description: desc,
    alternates: alternatesFor(locale, `/p/${slug}`),
    openGraph: { title, description: desc, images: image ? [{ url: image, alt: name }] : undefined },
  };
}

function productJsonLd(p: ProductDetail, locale: Locale, title: string, desc: string, minorUnits: number, market: Market) {
  const url = `${env.siteUrl}${paths.product(locale, p.slug)}`;
  // delivery and returns, so Google can show "Free delivery" / "30-day returns" with the price
  const fee = market.delivery.flatFeeMinor ?? '0';
  const shippingDetails = {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: minorToDecimalString(fee, minorUnits), currency: market.currency.code },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: market.code },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
      transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' },
    },
  };
  const returnPolicy = p.returnWindowDays > 0
    ? { '@type': 'MerchantReturnPolicy', applicableCountry: market.code, returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: p.returnWindowDays, returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/FreeReturn' }
    : { '@type': 'MerchantReturnPolicy', applicableCountry: market.code, returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' };
  const offers = p.variants.map((v) => {
    const { now, onDeal } = effectivePrice(v);
    return {
      '@type': 'Offer',
      sku: v.sku,
      url,
      price: minorToDecimalString(now, minorUnits),
      priceCurrency: v.currencyCode,
      availability: v.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      ...(v.gtin ? { gtin: v.gtin } : {}),
      shippingDetails,
      hasMerchantReturnPolicy: returnPolicy,
      ...(onDeal && v.dealEndsAt ? { priceValidUntil: v.dealEndsAt.slice(0, 10) } : {}),
      seller: { '@type': 'Organization', name: p.store.name },
    };
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description: desc,
    image: p.images.filter((i) => i.url).map((i) => i.url),
    sku: p.variants[0]?.sku,
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand.name, url: `${env.siteUrl}${paths.brand(locale, p.brand.slug)}` } } : {}),
    ...(p.variants[0]?.gtin ? { gtin: p.variants[0].gtin } : {}),
    category: pick(locale, p.category.name, p.category.nameAr),
    offers: offers.length === 1 ? offers[0] : offers,
    ...(p.ratingCount > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.ratingAvg, reviewCount: p.ratingCount, bestRating: 5, worstRating: 1 } } : {}),
  };
}

export default async function ProductPage({ params }: PageProps<'/[locale]/p/[slug]'>) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const [p, market] = await Promise.all([load(slug), serverApi.market()]);
  const [reviews, questions, more, together] = await Promise.all([
    serverApi.productReviews(slug),
    serverApi.productQuestions(slug).catch(() => ({ total: 0, nextCursor: null, items: [] })),
    serverApi.search({ store: p.store.slug, sort: 'popular', limit: 13 }).catch(() => null),
    serverApi.productRelated(slug).catch(() => ({ boughtTogether: [], alsoViewed: [] })),
  ]);
  const title = pick(locale, p.title, p.titleAr);
  const description = pick(locale, p.description ?? '', p.descriptionAr);
  const storeName = pick(locale, p.store.name, p.store.nameAr);
  const crumbs = [
    { name: t('common.home'), href: paths.home(locale) },
    ...p.breadcrumbs.map((c) => ({ name: pick(locale, c.name, c.nameAr), href: paths.category(locale, c.slug) })),
    { name: title },
  ];
  const images = p.images.filter((i) => i.kind === 'IMAGE' && i.url).map((i) => ({ id: i.id, url: i.url!, alt: i.altText || title, variantId: i.variantId }));
  const alsoViewed = together.alsoViewed.filter((x) => x.id !== p.id).slice(0, 12);
  const seen = new Set(alsoViewed.map((x) => x.id));
  // "More from this store" without repeating what "Customers also viewed" just showed
  const related = (more?.items ?? []).filter((x) => x.id !== p.id && !(seen.has(x.id) && alsoViewed.length >= 4)).slice(0, 12);
  const specs = Object.entries(p.specs ?? {});

  return (
    <div className="container-page pb-6 pt-3 md:pt-6">
      <JsonLd data={productJsonLd(p, locale, title, clip(description, 500), market.currency.minorUnits, market)} />
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, ...(c.href ? { item: `${env.siteUrl}${c.href}` } : {}) })) }} />
      <ViewTracker slug={slug} />
      {/* phones skip the path: the store and the title come first, like the big shopping apps */}
      <div className="max-md:hidden"><Breadcrumbs items={crumbs} label={t('nav.breadcrumb')} /></div>

      <ProductBuy product={p} images={images} title={title} together={together.boughtTogether} />
      <div className="mt-3 flex justify-end"><WhatsAppAsk text={t('whatsapp.aboutProduct', { product: title, url: `${env.siteUrl}${paths.product(locale, p.slug)}` })} label={t('whatsapp.askProduct')} /></div>

      {/* The seller card is for marketplace sellers on large screens; phones (and the shop's own products) show one line in the buy box. */}
      <div className={`mt-12 grid gap-8 ${p.store.isHouse ? '' : 'lg:grid-cols-[minmax(0,1fr)_320px]'}`}>
        <div className="space-y-8">
          {description && (
            <section aria-labelledby="desc">
              <h2 id="desc" className="section-title mb-3">{t('product.description')}</h2>
              <div className="whitespace-pre-line text-sm leading-6 text-ink-700 sm:text-[15px] sm:leading-7">{description}</div>
            </section>
          )}
          {(specs.length > 0 || p.brand) && (
            <section aria-labelledby="specs">
              <h2 id="specs" className="section-title mb-3">{t('product.specifications')}</h2>
              <dl className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white text-sm">
                {p.brand && (
                  <div className="grid grid-cols-[40%_1fr] gap-4 px-4 py-3"><dt className="text-ink-500">{t('product.brand')}</dt><dd className="font-medium text-ink-800"><Link href={paths.brand(locale, p.brand.slug)} className="hover:text-brand-600" data-testid="product-brand">{pick(locale, p.brand.name, p.brand.nameAr)}</Link></dd></div>
                )}
                {specs.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[40%_1fr] gap-4 px-4 py-3"><dt className="text-ink-500">{k}</dt><dd className="font-medium text-ink-800">{String(v)}</dd></div>
                ))}
              </dl>
            </section>
          )}
        </div>
        {!p.store.isHouse && <aside className="max-lg:hidden">
          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('product.soldBy')}</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-ink-50 ring-1 ring-ink-100">
                {p.store.logoUrl ? <Image src={p.store.logoUrl} alt="" fill sizes="48px" className="object-cover" /> : <Store className="size-5 text-ink-400" aria-hidden />}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900">{storeName}</p>
                {p.store.ratingCount > 0 ? (
                  <p className="flex items-center gap-1 text-xs text-ink-500"><Stars value={p.store.ratingAvg} label={t('product.ratingOutOf', { rating: p.store.ratingAvg })} /> ({p.store.ratingCount})</p>
                ) : (
                  <p className="inline-flex items-center gap-1 text-xs text-success-600"><BadgeCheck className="size-3.5" aria-hidden />{t('product.verifiedSeller')}</p>
                )}
              </div>
            </div>
            <Link href={paths.store(locale, p.store.slug)} className="btn-secondary mt-4 w-full">{t('product.visitStore')}</Link>
          </div>
        </aside>}
      </div>

      {alsoViewed.length > 0 && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8" data-testid="also-viewed">
          <ProductRail id="also-viewed" title={t('product.alsoViewed')} items={alsoViewed} t={t} minorUnits={market.currency.minorUnits} />
        </div>
      )}
      <Reviews initial={reviews} endpoint={`/products/${encodeURIComponent(slug)}/reviews`} title={t('product.reviews')} />
      <Questions slug={slug} initial={questions} />

      {related.length > 0 && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8">
          <ProductRail id="related" title={t('product.related', { store: storeName })} items={related} t={t} minorUnits={market.currency.minorUnits} href={paths.store(locale, p.store.slug)} />
        </div>
      )}
    </div>
  );
}
