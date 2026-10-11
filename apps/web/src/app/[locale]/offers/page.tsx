import { BadgePercent } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductRail } from '@/components/home/Sections';
import { ProductGrid } from '@/components/product/ProductCard';
import { serverApi } from '@/lib/api/server';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

export async function generateMetadata({ params }: PageProps<'/[locale]/offers'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('offers.title'), description: t('offers.metaDescription'), alternates: alternatesFor(locale, '/offers') };
}

/** Every live sale with its countdown, then the rest of the discounted products. Rebuilt every minute. */
export default async function OffersPage({ params }: PageProps<'/[locale]/offers'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const [offers, market] = await Promise.all([serverApi.offers(), serverApi.market()]);
  const mu = market.currency.minorUnits;
  const empty = offers.campaigns.length === 0 && offers.sale.length === 0;
  return (
    <div className="pb-6">
      <div className="container-page pt-8">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><BadgePercent className="size-7 text-deal-600" aria-hidden />{t('offers.title')}</h1>
        <p className="mt-2 text-ink-500">{t('offers.intro')}</p>
      </div>
      {empty ? (
        <div className="container-page mt-10">
          <div className="card flex flex-col items-center gap-4 p-10 text-center">
            <p className="text-ink-600">{t('offers.empty')}</p>
            <Link href={paths.search(locale)} className="btn-primary">{t('nav.allCategories')}</Link>
          </div>
        </div>
      ) : null}
      {offers.campaigns.map((c) => (
        <ProductRail key={c.id} id={`offer-${c.id}`} title={pick(locale, c.name, c.nameAr)} items={c.items} t={t} minorUnits={mu} endsAt={c.endsAt} deal />
      ))}
      {offers.sale.length > 0 && (
        <section className="container-page mt-10" aria-labelledby="offers-sale">
          <h2 id="offers-sale" className="section-title mb-4">{t('offers.onSale')}</h2>
          <ProductGrid items={offers.sale} t={t} minorUnits={mu} />
        </section>
      )}
    </div>
  );
}
