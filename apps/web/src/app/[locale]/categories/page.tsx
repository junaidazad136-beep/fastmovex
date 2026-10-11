import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CategoryIcon } from '@/components/home/CategoryIcon';
import { serverApi } from '@/lib/api/server';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

export async function generateMetadata({ params }: PageProps<'/[locale]/categories'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('nav.allCategories'), alternates: alternatesFor(locale, '/categories') };
}

/** Full category tree — the "Categories" tab on phones. */
export default async function CategoriesPage({ params }: PageProps<'/[locale]/categories'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const cats = await serverApi.categories();
  return (
    <div className="container-page py-6">
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{t('nav.allCategories')}</h1>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <li key={c.slug} className="card p-4">
            <Link href={paths.category(locale, c.slug)} className="flex items-center gap-3 font-semibold text-ink-900 hover:text-brand-700">
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><CategoryIcon slug={c.slug} iconUrl={c.iconUrl} className="size-6" /></span>
              {pick(locale, c.name, c.nameAr)}
            </Link>
            {c.children.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2 ps-14">
                {c.children.map((s) => (
                  <li key={s.slug}><Link href={paths.category(locale, s.slug)} className="text-sm text-ink-600 hover:text-brand-700 hover:underline">{pick(locale, s.name, s.nameAr)}</Link></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
