import type { Market } from '@/lib/api/types';
import type { T } from '@/lib/i18n';

/** What Qatar's e-commerce rules ask an online shop to show: company name, commercial registration, e-commerce licence, contact. Filled in the admin panel (Settings → Legal); shows only what is filled. */
export function companyRows(market: Pick<Market, 'legal'>, t: T): { key: string; label: string; value: string }[] {
  const g = (k: string) => (typeof market.legal?.[k] === 'string' ? (market.legal[k] as string).trim() : '');
  return [
    { key: 'name', label: t('company.name'), value: g('companyName') },
    { key: 'cr', label: t('company.cr'), value: g('commercialRegNo') },
    { key: 'license', label: t('company.license'), value: g('ecommerceLicenseNo') },
    { key: 'address', label: t('company.address'), value: g('address') },
    { key: 'email', label: t('company.email'), value: g('supportEmail') },
    { key: 'phone', label: t('company.phone'), value: g('supportPhone') },
  ].filter((r) => r.value);
}

export function CompanyDetails({ market, t, compact, plain }: { market: Pick<Market, 'legal'>; t: T; compact?: boolean; plain?: boolean }) {
  const rows = companyRows(market, t);
  if (rows.length === 0) return null;
  if (compact) {
    return (
      <p className="text-xs leading-5 text-ink-500" data-testid="company-line">
        {rows.filter((r) => ['name', 'cr', 'license'].includes(r.key)).map((r, i) => (
          <span key={r.key}>{i > 0 ? ' · ' : ''}{r.key === 'name' ? r.value : `${r.label}: ${r.value}`}</span>
        ))}
      </p>
    );
  }
  return (
    <section className={plain ? 'border-y border-ink-200 py-3' : 'mt-6 max-w-3xl rounded-xl border border-ink-100 bg-white p-4'} aria-label={t('company.title')} data-testid="company-details">
      <h2 className="text-sm font-bold text-ink-900">{t('company.title')}</h2>
      <dl className="mt-2 space-y-0.5 text-[13px] sm:grid sm:grid-cols-[auto_1fr] sm:gap-x-6 sm:gap-y-1 sm:space-y-0 sm:text-sm">
        {rows.map((r) => (
          <div key={r.key} className="max-sm:flex max-sm:flex-wrap max-sm:gap-x-2 sm:contents">
            <dt className="text-ink-500">{r.label}</dt>
            <dd className="text-ink-900"><bdi>{r.value}</bdi></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
