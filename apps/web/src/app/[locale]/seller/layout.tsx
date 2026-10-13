import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SellerShell } from '@/components/seller/SellerShell';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: LayoutProps<'/[locale]/seller'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('seller.title'), robots: { index: false, follow: false } };
}

export default function SellerLayout({ children }: LayoutProps<'/[locale]/seller'>) {
  return <Suspense><SellerShell>{children}</SellerShell></Suspense>;
}
