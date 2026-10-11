import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/register'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('auth.createAccount'), robots: { index: false, follow: true } };
}

export default async function Page({ searchParams }: PageProps<'/[locale]/register'>) {
  const next = (await searchParams).next;
  return <RegisterForm nextParam={Array.isArray(next) ? next[0] : next} />;
}
