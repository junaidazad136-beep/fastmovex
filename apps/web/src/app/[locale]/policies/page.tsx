import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { policyLinks } from '@/components/content/PolicyPage';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/policies'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('policies.title'), description: t('policies.intro'), alternates: alternatesFor(locale, '/policies') };
}

/** All policies in one place: what customers and sellers should know. */
export default async function PoliciesHub({ params }: PageProps<'/[locale]/policies'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const links = policyLinks(t);
  const group = (g: 'customers' | 'sellers') => (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {links.filter((x) => x.group === g).map(({ key, href, Icon }) => (
        <li key={key}>
          <Link href={href} className="card flex h-full items-start gap-3 p-5 hover:border-brand-200" data-testid={`policies-${key}`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50"><Icon className="size-5 text-brand-600" aria-hidden /></span>
            <span><span className="block font-semibold text-ink-900">{t(`policies.names.${key}`)}</span><span className="mt-1 block text-sm leading-6 text-ink-500">{t(`policies.blurbs.${key}`)}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="container-page max-w-4xl py-8 sm:py-10">
      <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-ink-900">{t('policies.title')}</h1>
      <p className="mt-1.5 text-sm text-ink-600 sm:mt-2 sm:text-base">{t('policies.intro')}</p>
      <h2 className="mt-8 text-lg font-bold text-ink-900">{t('policies.forCustomers')}</h2>
      {group('customers')}
      <h2 className="mt-8 text-lg font-bold text-ink-900">{t('policies.forSellers')}</h2>
      {group('sellers')}
    </div>
  );
}
