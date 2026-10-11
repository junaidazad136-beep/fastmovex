import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountShell } from '@/components/account/AccountShell';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: LayoutProps<'/[locale]/account'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('account.title'), robots: { index: false, follow: false } };
}

export default function AccountLayout({ children }: LayoutProps<'/[locale]/account'>) {
  return <Suspense><AccountShell>{children}</AccountShell></Suspense>;
}
