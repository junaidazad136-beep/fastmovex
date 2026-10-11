import type { Metadata } from 'next';
import { ForgotForm } from '@/components/auth/ForgotForm';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/forgot-password'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('auth.forgotTitle'), robots: { index: false, follow: true } };
}

export default function Page() {
  return <ForgotForm />;
}
