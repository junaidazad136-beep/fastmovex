import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PolicyPage, policyMetadata } from '@/components/content/PolicyPage';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/help/returns'>): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? policyMetadata('returns', locale) : {};
}

/** Written in code (lib/policies), in English and Arabic: it describes how the platform actually works. */
export default async function Page({ params }: PageProps<'/[locale]/help/returns'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <PolicyPage kind="returns" locale={locale} />;
}
