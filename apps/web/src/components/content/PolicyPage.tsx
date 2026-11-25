import { ChevronDown, FileText, Languages, ShieldCheck, RotateCcw, Store, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { getT, type T } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { policy, type PolicyKind } from '@/lib/policies';
import { alternatesFor } from '@/lib/seo';
import { paths } from '@/lib/urls';
import { serverApi } from '@/lib/api/server';
import { CompanyDetails } from './CompanyDetails';
import { Logo } from '../ui/Logo';
import { PolicyBody } from './PolicyBody';
import { PrintButton } from './PrintButton';

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
export async function PolicyPage({ kind, locale }: { kind: PolicyKind; locale: Locale }) {
  const t = getT(locale);
  const market = await serverApi.market().catch(() => null);
  const p = policy(kind, locale);
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const index = (
    <ol className="space-y-1 text-sm">
      {p.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="block rounded-lg px-2 py-1 text-ink-600 hover:bg-ink-50 hover:text-brand-700">{s.h}</a></li>)}
    </ol>
  );
  return (
    <div className="bg-ink-100/70 print:bg-white" data-testid={`policy-page-${kind}`}>
      <div className="container-page py-6 sm:py-10 print:p-0">
        {/* toolbar (not printed): back, other language, print or save as PDF */}
        <div className="mx-auto mb-4 flex max-w-[1040px] flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={paths.policies(locale)} className="link text-sm font-medium">← {t('policies.backToPolicies')}</Link>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/${other}${POLICY_PATH[kind]}`} hrefLang={other} lang={other} className="btn-secondary !px-3.5 !py-2 text-sm" data-testid="policy-other-lang">
              <Languages className="size-4" aria-hidden />{t('policies.otherLang')}
            </Link>
            <PrintButton label={t('policies.print')} />
          </div>
        </div>

        <div className="mx-auto grid max-w-[1040px] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8 print:block">
          <aside className="max-lg:hidden print:hidden">
            <nav aria-label={t('policies.onThisPage')} className="sticky top-36">
              <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wide text-ink-500">{t('policies.onThisPage')}</p>
              {index}
            </nav>
          </aside>

          <div className="min-w-0">
            <details className="group mb-4 rounded-xl border border-ink-200 bg-white lg:hidden print:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink-900">
                {t('policies.onThisPage')}<ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-ink-100 px-2 py-2">{index}</div>
            </details>

            {/* the document: a white A4 sheet on a grey desk, like a PDF viewer */}
            <article className="mx-auto w-full max-w-[794px] bg-white px-5 py-8 shadow-[0_1px_3px_rgba(40,30,20,.12),0_8px_30px_rgba(40,30,20,.08)] sm:min-h-[1123px] sm:px-[72px] sm:py-[64px] print:max-w-none print:p-0 print:shadow-none" data-testid="policy-paper">
              <div className="flex items-start justify-between gap-4 border-b-2 border-ink-900 pb-4">
                <Logo label="FastMoveX" />
                <div className="text-end text-xs leading-5 text-ink-500">
                  <p className="font-semibold uppercase tracking-wide text-ink-800">{t('policies.document')}</p>
                  <p>{t('policies.updated', { date: formatDate(p.updated, locale) })}</p>
                </div>
              </div>
              <h1 className="mt-7 text-2xl font-bold tracking-tight text-ink-900 sm:text-[28px]">{p.title}</h1>
              <p className="mt-3 text-[14px] leading-7 text-ink-600 sm:text-[15px]">{p.intro}</p>
              {market && kind !== 'seller' ? <div className="mt-5"><CompanyDetails market={market} t={t} plain /></div> : null}
              <div className="mt-8"><PolicyBody sections={p.sections} locale={locale} paper /></div>
              <p className="mt-12 border-t border-ink-200 pt-3 text-center text-xs text-ink-500">— {t('policies.pageEnd')} · FastMoveX · {formatDate(p.updated, locale)} —</p>
            </article>
          </div>
        </div>
      </div>

      <div className="container-page pb-10 print:hidden">
      <section className="mt-4 border-t border-ink-200 pt-8">
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
    </div>
  );
}
