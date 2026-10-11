import { PackageSearch, Search } from 'lucide-react';
import Link from 'next/link';
import type { SearchResult } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { paths } from '@/lib/urls';
import { ProductGrid } from '../product/ProductCard';

const MARK = '§q§';

/** Puts a link or bold word where {q} is in a translated sentence. */
function slot(text: string, node: React.ReactNode) {
  const [before, after = ''] = text.split(MARK);
  return <>{before}{node}{after}</>;
}

/** "Showing results for earbuds. Search instead for erbuds" or "Did you mean earbuds?" */
export function SpellingNote({ t, spelling, exactHref, correctedHref }: { t: T; spelling: NonNullable<SearchResult['spelling']>; exactHref: string; correctedHref: string }) {
  if (spelling.auto) {
    return (
      <p className="mb-4 text-[15px] text-ink-700" data-testid="spelling-auto">
        {slot(t('search.showingFor', { q: MARK }), <Link href={correctedHref} className="font-bold text-ink-900">{spelling.corrected}</Link>)}{' '}
        <span className="text-sm text-ink-500">{slot(t('search.insteadFor', { q: MARK }), <Link href={exactHref} className="link" data-testid="spelling-exact">{spelling.original}</Link>)}</span>
      </p>
    );
  }
  return (
    <p className="mb-4 text-[15px] text-ink-700" data-testid="spelling-suggest">
      {slot(t('search.didYouMean', { q: MARK }), <Link href={correctedHref} className="link font-bold">{spelling.corrected}</Link>)}
    </p>
  );
}

/** Nothing found: say so, then offer searches that work and best sellers, so the page is never a dead end. */
export function NoResults({ t, help, minorUnits }: { t: T; help?: SearchResult['noResults']; minorUnits: number }) {
  return (
    <div data-testid="no-results">
      <div className="card flex flex-col items-center px-6 py-10 text-center">
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-ink-50 text-ink-400"><PackageSearch className="size-7" aria-hidden /></span>
        <h2 className="text-lg font-bold">{t('search.noResults')}</h2>
        <p className="mt-1 max-w-md text-sm text-ink-500">{t('search.noResultsHint')}</p>
        {!!help?.popular.length && (
          <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label={t('search.popular')}>
            {help.popular.map((q) => (
              <li key={q}><Link href={paths.search(t.locale, { q })} className="chip" data-testid="no-results-popular"><Search className="size-3.5 text-ink-400" aria-hidden />{q}</Link></li>
            ))}
          </ul>
        )}
      </div>
      {!!help?.products.length && (
        <section className="mt-10" aria-labelledby="nr-best">
          <h2 id="nr-best" className="mb-4 text-lg font-bold">{t('search.bestSellers')}</h2>
          <ProductGrid items={help.products} t={t} minorUnits={minorUnits} />
        </section>
      )}
    </div>
  );
}
