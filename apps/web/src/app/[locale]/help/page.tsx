import { FileText, MessageCircle, RotateCcw, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Faq } from '@/components/help/Faq';
import { JsonLd } from '@/components/ui/JsonLd';
import { serverApi } from '@/lib/api/server';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';
import { paths, pick } from '@/lib/urls';

export async function generateMetadata({ params }: PageProps<'/[locale]/help'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('help.title'), description: t('help.subtitle'), alternates: alternatesFor(locale, '/help') };
}

export default async function HelpPage({ params }: PageProps<'/[locale]/help'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const faq = await serverApi.faq();
  return (
    <div className="container-page py-8">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: pick(locale, f.question, f.questionAr), acceptedAnswer: { '@type': 'Answer', text: pick(locale, f.answer, f.answerAr) } })) }} />
      <h1 className="text-xl sm:text-3xl font-bold tracking-tight">{t('help.title')}</h1>
      <p className="mt-1.5 text-sm text-ink-500 sm:mt-2 sm:text-base">{t('help.subtitle')}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href={paths.returnsPolicy(locale)} className="card flex items-center gap-3 p-4 hover:border-brand-200"><RotateCcw className="size-5 text-brand-600" aria-hidden /><span className="font-semibold">{t('help.returnsPolicy')}</span></Link>
        <Link href={paths.deliveryInfo(locale)} className="card flex items-center gap-3 p-4 hover:border-brand-200"><Truck className="size-5 text-brand-600" aria-hidden /><span className="font-semibold">{t('help.deliveryInfo')}</span></Link>
        <Link href={paths.tickets(locale)} className="card flex items-center gap-3 p-4 hover:border-brand-200"><MessageCircle className="size-5 text-brand-600" aria-hidden /><span className="font-semibold">{t('help.myTickets')}</span></Link>
        <Link href={paths.policies(locale)} className="card flex items-center gap-3 p-4 hover:border-brand-200" data-testid="help-policies"><FileText className="size-5 text-brand-600" aria-hidden /><span className="font-semibold">{t('footer.policies')}</span></Link>
      </div>
      <h2 className="section-title mb-4 mt-10">{t('help.faq')}</h2>
      <Faq items={faq} />
      <section className="mt-10 flex flex-col items-start gap-4 rounded-2xl bg-brand-700 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">{t('help.contact')}</h2>
          <p className="text-sm text-white/80">{t('help.contactText')}</p>
        </div>
        <Link href={paths.newTicket(locale)} className="btn bg-white text-brand-700 hover:bg-sand-50">{t('help.newTicket')}</Link>
      </section>
    </div>
  );
}
