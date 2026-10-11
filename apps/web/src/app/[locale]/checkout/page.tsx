import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckoutGate } from '@/components/checkout/CheckoutGate';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/checkout'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('checkout.title'), robots: { index: false, follow: false } };
}

export default function CheckoutPage() {
  return (
    <div className="container-page py-6">
      <Suspense><CheckoutGate /></Suspense>
    </div>
  );
}
