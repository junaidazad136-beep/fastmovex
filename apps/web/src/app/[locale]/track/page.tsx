import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TrackOrder } from '@/components/checkout/TrackOrder';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/track'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  // Order links carry a private token: never indexed, never sent on as a referrer.
  return { title: getT(locale)('track.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function TrackPage({ params, searchParams }: PageProps<'/[locale]/track'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  return (
    <div className="container-page py-6">
      <TrackOrder order={one(sp.order)?.toUpperCase().slice(0, 40)} token={one(sp.t)?.slice(0, 100)} placed={one(sp.placed) === '1'} />
    </div>
  );
}
