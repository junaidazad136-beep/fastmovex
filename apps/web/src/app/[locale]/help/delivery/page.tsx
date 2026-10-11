import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api/server';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/money';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/help/delivery'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('policy.deliveryTitle'), description: t('policy.deliveryIntro'), alternates: alternatesFor(locale, '/help/delivery') };
}

export default async function DeliveryInfo({ params }: PageProps<'/[locale]/help/delivery'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const market = await serverApi.market();
  const fmt = (m: string) => formatMoney(m, market.currency.code, locale, { minorUnits: market.currency.minorUnits, compact: true });
  const { flatFeeMinor, freeOverMinor } = market.delivery;
  const feeLine = flatFeeMinor
    ? freeOverMinor ? t('policy.feeLine', { fee: fmt(flatFeeMinor), threshold: fmt(freeOverMinor) }) : t('policy.feeLineNoFree', { fee: fmt(flatFeeMinor) })
    : null;
  const points = [t('policy.delivery1'), t('policy.delivery2'), t('policy.delivery3'), ...(market.paymentMethods.includes('COD') ? [t('policy.delivery4')] : [])];
  return (
    <article className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">{t('policy.deliveryTitle')}</h1>
      <p className="mt-2 text-ink-500">{t('policy.deliveryIntro')}</p>
      {feeLine && <p className="mt-6 rounded-2xl bg-sand-50 p-4 font-medium text-sand-700" data-testid="delivery-fee-line">{feeLine}</p>}
      <ul className="mt-6 list-disc space-y-3 ps-5 leading-7 text-ink-700">
        {points.map((p) => <li key={p}>{p}</li>)}
      </ul>
    </article>
  );
}
