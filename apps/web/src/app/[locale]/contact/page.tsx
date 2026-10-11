import { Mail, MapPin, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContactForm } from '@/components/content/ContactForm';
import { serverApi } from '@/lib/api/server';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/contact'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('contact.title'), description: t('contact.intro'), alternates: alternatesFor(locale, '/contact') };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export default async function ContactPage({ params, searchParams }: PageProps<'/[locale]/contact'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const [market, sp] = await Promise.all([serverApi.market(), searchParams]);
  const legal = market.legal ?? {};
  const email = str(legal.supportEmail);
  const phone = str(legal.supportPhone);
  const address = str(legal.address);
  const order = typeof sp.order === 'string' ? sp.order.slice(0, 40) : undefined;
  return (
    <div className="container-page py-10">
      <h1 className="text-3xl font-bold tracking-tight">{t('contact.title')}</h1>
      <p className="mt-2 max-w-2xl text-ink-500">{t('contact.intro')}</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <ContactForm order={order} />
        {email || phone || address ? (
          <aside className="card space-y-4 p-5 text-sm">
            <h2 className="font-bold">{t('contact.otherWays')}</h2>
            {phone && (
              <p className="flex items-start gap-3"><Phone className="mt-0.5 size-4 text-brand-600" aria-hidden />
                <span><span className="block text-xs text-ink-500">{t('contact.callUs')}</span><a href={`tel:${phone.replace(/\s/g, '')}`} className="font-medium hover:text-brand-700" dir="ltr">{phone}</a></span>
              </p>
            )}
            {email && (
              <p className="flex items-start gap-3"><Mail className="mt-0.5 size-4 text-brand-600" aria-hidden />
                <span><span className="block text-xs text-ink-500">{t('contact.emailUs')}</span><a href={`mailto:${email}`} className="font-medium hover:text-brand-700">{email}</a></span>
              </p>
            )}
            {address && (
              <p className="flex items-start gap-3"><MapPin className="mt-0.5 size-4 text-brand-600" aria-hidden />
                <span><span className="block text-xs text-ink-500">{t('contact.address')}</span><span className="font-medium">{address}</span></span>
              </p>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
