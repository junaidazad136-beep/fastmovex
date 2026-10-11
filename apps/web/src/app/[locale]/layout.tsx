import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../globals.css';

import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ClientChrome } from '@/components/layout/ClientChrome';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { Providers } from '@/components/layout/Providers';
import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { getMessages, getT } from '@/lib/i18n';
import { dirOf, isLocale, LOCALES } from '@/lib/i18n/config';
import { languageAlternates } from '@/lib/seo';

export const viewport: Viewport = {
  themeColor: '#7422E6',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  // Search Console / Bing ownership codes, set in the admin panel (Settings → Google & social)
  const seo = (await serverApi.market().catch(() => null))?.seo;
  return {
    metadataBase: new URL(env.siteUrl),
    ...(seo?.googleVerification || seo?.bingVerification
      ? { verification: { ...(seo.googleVerification && { google: seo.googleVerification }), ...(seo.bingVerification && { other: { 'msvalidate.01': seo.bingVerification } }) } }
      : {}),
    title: { default: t('meta.defaultTitle'), template: `%s | ${t('meta.siteName')}` },
    description: t('meta.defaultDescription'),
    applicationName: t('meta.siteName'),
    alternates: { canonical: `/${locale}`, languages: languageAlternates('') },
    openGraph: {
      type: 'website',
      siteName: t('meta.siteName'),
      locale: locale === 'ar' ? 'ar_QA' : 'en_QA',
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => (l === 'ar' ? 'ar_QA' : 'en_QA')),
      // shared links without their own picture (home, help…) show the FastMoveX banner
      images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: t('meta.siteName') }],
    },
    twitter: { card: 'summary_large_image', images: ['/brand/og.png'] },
    appleWebApp: { capable: true, title: t('meta.siteName'), statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Every page is rendered per request (per-request CSP nonce, fresh stock and prices);
  // catalogue data itself is cached by the data cache in lib/api/server.ts.
  await connection();
  const t = getT(locale);
  // Pages feed the footer; the shop must still render if that one call fails.
  const [market, categories, pages] = await Promise.all([serverApi.market(), serverApi.categories(), serverApi.pages().catch(() => [])]);

  return (
    <html lang={locale} dir={dirOf(locale)} data-scroll-behavior="smooth">
      <body className="min-h-dvh">
        <Providers locale={locale} messages={getMessages(locale)} market={market} apiUrl={env.publicApiUrl} siteUrl={env.siteUrl}>
          <Header t={t} market={market} categories={categories} />
          <main id="main" className="min-h-[60vh]">{children}</main>
          <Footer t={t} market={market} categories={categories} pages={pages} />
          <MobileTabBar />
          <ClientChrome />
        </Providers>
      </body>
    </html>
  );
}
