import type { Metadata } from 'next';
import Image from 'next/image';
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

/**
 * Every top-level category as a picture tile — the "Categories" tab on phones: the name at the top, the category's
 * picture standing in the bottom corner (uploaded in the admin panel; a drawn picture until then).
 */
export default async function CategoriesPage({ params }: PageProps<'/[locale]/categories'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const cats = await serverApi.categories();
  return (
    <div className="container-page py-5 sm:py-7">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight text-ink-900 sm:mb-5 sm:text-2xl">{t('nav.allCategories')}</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {cats.map((c, i) => (
          <li key={c.slug}>
            <Link
              href={paths.category(locale, c.slug)}
              className="group relative flex aspect-[2/1] overflow-hidden rounded-2xl bg-gradient-to-b from-[#F4F2F7] to-[#E6E3EC] p-3 ring-1 ring-black/[0.03] transition hover:ring-brand-200 sm:p-4"
              data-testid="category-card"
            >
              <span className="relative z-10 line-clamp-2 max-w-[60%] text-[15px] font-medium leading-[19px] text-ink-900 sm:text-base sm:leading-5">{pick(locale, c.name, c.nameAr)}</span>
              <span aria-hidden className="absolute bottom-0 end-0 h-[86%] w-[55%]">
                {c.imageUrl ? (
                  <Image
                    src={c.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 160px, (min-width: 640px) 22vw, 30vw"
                    priority={i < 6}
                    className="object-contain object-right-bottom transition-transform duration-300 group-hover:scale-105 rtl:object-left-bottom"
                  />
                ) : (
                  <span className="absolute bottom-3 end-3 text-brand-300"><CategoryIcon slug={c.slug} iconUrl={c.iconUrl} className="size-12" /></span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
