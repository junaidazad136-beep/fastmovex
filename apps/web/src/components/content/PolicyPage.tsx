import { ChevronDown, FileText, Languages, ShieldCheck, RotateCcw, Store, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { getT, type T } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { policy, type PolicyKind } from '@/lib/policies';
import { alternatesFor } from '@/lib/seo';
import { paths } from '@/lib/urls';
import { PolicyBody } from './PolicyBody';

/** Where each policy lives (without the locale). */
export const POLICY_PATH: Record<PolicyKind, string> = { returns: '/help/returns', terms: '/terms', privacy: '/privacy', seller: '/seller-policy' };

export function policyMetadata(kind: PolicyKind, locale: Locale): Metadata {
  const p = policy(kind, locale);
  return { title: p.title, description: p.intro, alternates: alternatesFor(locale, POLICY_PATH[kind]) };
}

/** Every policy, for the hub page and the "other policies" list: customers first, then sellers. */
export function policyLinks(t: T) {
  const l = t.locale;
  return [
    { key: 'returns', href: paths.returnsPolicy(l), Icon: RotateCcw, group: 'customers' },
    { key: 'terms', href: paths.terms(l), Icon: FileText, group: 'customers' },
    { key: 'privacy', href: paths.privacy(l), Icon: ShieldCheck, group: 'customers' },
    { key: 'delivery', href: paths.deliveryInfo(l), Icon: Truck, group: 'customers' },
    { key: 'seller', href: paths.sellerPolicy(l), Icon: Store, group: 'sellers' },
  ] as const;
}

/** A full policy page: title, date, an index of its sections, the sections, then the other policies and a way to ask. */
export function PolicyPage({ kind, locale }: { kind: PolicyKind; locale: Locale }) {
  const t = getT(locale);
  const p = policy(kind, locale);
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const index = (
    <ol className="space-y-1 text-sm">
      {p.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="block rounded-lg px-2 py-1 text-ink-600 hover:bg-ink-50 hover:text-brand-700">{s.h}</a></li>)}
    </ol>
  );
  return (
    <div className="container-page py-8 sm:py-10" data-testid={`policy-page-${kind}`}>
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">{p.title}</h1>
        <p className="mt-3 text-[15px] leading-7 text-ink-600">{p.intro}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-ink-500">{t('policies.updated', { date: formatDate(p.updated, locale) })}</span>
          <Link href={`/${other}${POLICY_PATH[kind]}`} hrefLang={other} lang={other} className="link inline-flex items-center gap-1.5 font-medium" data-testid="policy-other-lang">
            <Languages className="size-4" aria-hidden />{t('policies.otherLang')}
          </Link>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-12">
        <div className="min-w-0 max-w-3xl">
          <details className="group mb-8 rounded-xl border border-ink-100 bg-white lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink-900">
              {t('policies.onThisPage')}<ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-ink-100 px-2 py-2">{index}</div>
          </details>
          <PolicyBody sections={p.sections} locale={locale} />
        </div>
        <aside className="max-lg:hidden">
          <nav aria-label={t('policies.onThisPage')} className="sticky top-36">
            <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wide text-ink-500">{t('policies.onThisPage')}</p>
            {index}
          </nav>
        </aside>
      </div>

      <section className="mt-14 border-t border-ink-100 pt-8">
        <h2 className="text-lg font-bold text-ink-900">{t('policies.other')}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {policyLinks(t).filter((x) => x.key !== kind).map(({ key, href, Icon }) => (
            <li key={key}>
              <Link href={href} className="card flex h-full items-start gap-3 p-4 hover:border-brand-200">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                <span><span className="block font-semibold text-ink-900">{t(`policies.names.${key}`)}</span><span className="mt-0.5 block text-sm text-ink-500">{t(`policies.blurbs.${key}`)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl bg-sand-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold text-ink-900">{t('policies.questions')}</p><p className="text-sm text-ink-600">{t('policies.questionsText')}</p></div>
          <Link href={paths.contact(locale)} className="btn-secondary">{t('footer.contact')}</Link>
        </div>
      </section>
    </div>
  );
}
