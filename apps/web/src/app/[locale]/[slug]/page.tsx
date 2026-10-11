import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RichText } from '@/components/content/RichText';
import { isNotFound } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';
import { pick } from '@/lib/urls';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A content page written in the admin panel (About, Privacy, Terms, …); unknown addresses are a 404. */
async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 60) return null;
  try {
    return await serverApi.page(slug);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

function summary(body: string): string {
  const text = body.replace(/^#{2,3} .*$/gm, '').replace(/\*\*|\[|\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export async function generateMetadata({ params }: PageProps<'/[locale]/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const page = await load(slug);
  if (!page) return {};
  return { title: pick(locale, page.title, page.titleAr), description: summary(pick(locale, page.body, page.bodyAr)), alternates: alternatesFor(locale, `/${page.slug}`) };
}

export default async function ContentPageRoute({ params }: PageProps<'/[locale]/[slug]'>) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const page = await load(slug);
  if (!page) notFound();
  const t = getT(locale);
  const body = locale === 'ar' && page.bodyAr.trim() ? page.bodyAr : page.body;
  return (
    <article className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">{pick(locale, page.title, page.titleAr)}</h1>
      <p className="mt-2 text-sm text-ink-500">{t('pages.updated', { date: formatDate(page.updatedAt, locale) })}</p>
      <div className="mt-8"><RichText text={body} locale={locale} /></div>
    </article>
  );
}
