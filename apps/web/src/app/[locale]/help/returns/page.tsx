import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/help/returns'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('policy.returnsTitle'), description: t('policy.returnsIntro'), alternates: alternatesFor(locale, '/help/returns') };
}

/** Describes how the platform actually works (the rules the API enforces), not legal terms. */
export default async function ReturnsPolicy({ params }: PageProps<'/[locale]/help/returns'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const steps = [t('policy.returns1'), t('policy.returns2'), t('policy.returns3'), t('policy.returns4'), t('policy.returns5')];
  return (
    <article className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">{t('policy.returnsTitle')}</h1>
      <p className="mt-2 text-ink-500">{t('policy.returnsIntro')}</p>
      <ol className="mt-8 space-y-4">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{i + 1}</span>
            <p className="pt-1 leading-7 text-ink-700">{s}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
