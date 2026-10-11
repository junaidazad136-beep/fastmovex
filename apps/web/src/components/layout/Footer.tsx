import Link from 'next/link';
import type { CategoryNode, Market, PageSummary, PaymentMethod } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { paths, pick } from '@/lib/urls';
import { Logo } from '../ui/Logo';

export function Footer({ t, market, categories, pages = [] }: { t: T; market: Market; categories: CategoryNode[]; pages?: PageSummary[] }) {
  const l = t.locale;
  const year = new Date().getFullYear();
  const methods: PaymentMethod[] = market.paymentMethods;
  const legal = market.legal ?? {};
  const footerPages = pages.filter((p) => p.showInFooter);
  const legalSlugs = ['privacy', 'terms'];
  const companyPages = footerPages.filter((p) => !legalSlugs.includes(p.slug));
  const legalPages = footerPages.filter((p) => legalSlugs.includes(p.slug));
  return (
    <footer className="mt-16 border-t border-ink-100 bg-white pb-24 md:pb-0">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo label={t('meta.siteName')} />
          <p className="mt-4 max-w-xs text-sm leading-6 text-ink-500">{t('footer.about')}</p>
        </div>
        <div>
          <h2 className="text-sm font-bold text-ink-900">{t('footer.shop')}</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-600">
            <li><Link href={paths.offers(l)} className="font-medium text-deal-600 hover:text-brand-600">{t('footer.offers')}</Link></li>
            {categories.slice(0, 6).map((c) => (
              <li key={c.slug}><Link href={paths.category(l, c.slug)} className="hover:text-brand-600">{pick(l, c.name, c.nameAr)}</Link></li>
            ))}
          </ul>
          {companyPages.length > 0 && (
            <>
              <h2 className="mt-6 text-sm font-bold text-ink-900">{t('footer.company')}</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-600">
                {companyPages.map((p) => <li key={p.slug}><Link href={paths.page(l, p.slug)} className="hover:text-brand-600">{pick(l, p.title, p.titleAr)}</Link></li>)}
              </ul>
            </>
          )}
        </div>
        <div>
          <h2 className="text-sm font-bold text-ink-900">{t('footer.customerCare')}</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-600">
            <li><Link href={paths.help(l)} className="hover:text-brand-600">{t('help.title')}</Link></li>
            <li><Link href={paths.contact(l)} className="hover:text-brand-600">{t('footer.contact')}</Link></li>
            <li><Link href={paths.track(l)} className="hover:text-brand-600">{t('footer.track')}</Link></li>
            <li><Link href={paths.returnsPolicy(l)} className="hover:text-brand-600">{t('help.returnsPolicy')}</Link></li>
            <li><Link href={paths.deliveryInfo(l)} className="hover:text-brand-600">{t('help.deliveryInfo')}</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-ink-900">{t('footer.paymentMethods')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {methods.map((m) => (
              <li key={m} className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-600">{m === 'CARD' && market.cardProvider === 'dibsy' ? t('footer.cardsWallets') : t(`checkout.method.${m}`)}</li>
            ))}
          </ul>
          <h2 className="mt-6 text-sm font-bold text-ink-900">{t('footer.myAccount')}</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-600">
            <li><Link href={paths.account(l)} className="hover:text-brand-600">{t('nav.myAccount')}</Link></li>
            <li><Link href={paths.wishlist(l)} className="hover:text-brand-600">{t('nav.wishlist')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-100">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('footer.rights', { year })}</p>
          <ul className="flex gap-4">
            {legalPages.map((p) => <li key={p.slug}><Link href={paths.page(l, p.slug)} className="hover:text-brand-600">{pick(l, p.title, p.titleAr)}</Link></li>)}
            {!legalPages.some((p) => p.slug === 'terms') && typeof legal.termsUrl === 'string' && <li><a href={legal.termsUrl} className="hover:text-brand-600">{t('footer.terms')}</a></li>}
            {!legalPages.some((p) => p.slug === 'privacy') && typeof legal.privacyUrl === 'string' && <li><a href={legal.privacyUrl} className="hover:text-brand-600">{t('footer.privacy')}</a></li>}
          </ul>
        </div>
      </div>
    </footer>
  );
}
