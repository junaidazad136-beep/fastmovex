import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/login'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('auth.signIn'), robots: { index: false, follow: true } };
}

export default async function Page({ searchParams }: PageProps<'/[locale]/login'>) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <LoginForm nextParam={one(sp.next)} reset={one(sp.reset) === '1'} expired={one(sp.expired) === '1'} />;
}
