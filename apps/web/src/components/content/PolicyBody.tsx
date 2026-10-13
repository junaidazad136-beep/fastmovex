import { Info } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import type { PolicySection } from '@/lib/policies';
import { inline } from './RichText';

/** The sections of a policy: paragraphs, bullet lists, numbered steps, tables (cards on a phone) and a highlighted note. */
export function PolicyBody({ sections, locale, headingLevel = 2 }: { sections: PolicySection[]; locale: Locale; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="space-y-8 text-sm leading-6 text-ink-700 sm:space-y-10 sm:text-[15px] sm:leading-7">
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-32 space-y-4" data-testid={`policy-${s.id}`}>
          <H className={`${headingLevel === 2 ? 'text-[17px] sm:text-xl' : 'text-base sm:text-lg'} font-bold tracking-tight text-ink-900`}>{s.h}</H>
          {s.steps && (
            <ol className="space-y-3">
              {s.steps.map((x, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{i + 1}</span>
                  <p className="pt-0.5">{inline(x, locale)}</p>
                </li>
              ))}
            </ol>
          )}
          {s.p?.map((x, i) => <p key={i}>{inline(x, locale)}</p>)}
          {s.list && (
            <ul className="list-disc space-y-1.5 ps-6 marker:text-brand-500">
              {s.list.map((x, i) => <li key={i}>{inline(x, locale)}</li>)}
            </ul>
          )}
          {s.table && <PolicyTable head={s.table.head} rows={s.table.rows} locale={locale} />}
          {s.note && (
            <p className="flex gap-2.5 rounded-xl bg-warning-50 p-3.5 text-sm font-medium text-warning-600">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{inline(s.note, locale)}</span>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function PolicyTable({ head, rows, locale }: { head: string[]; rows: string[][]; locale: Locale }) {
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-ink-100 max-sm:hidden">
        <table className="w-full text-start text-sm">
          <thead className="bg-ink-50 text-ink-900">
            <tr>{head.map((h) => <th key={h} scope="col" className="px-3.5 py-2.5 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r, i) => (
              <tr key={i} className="align-top">
                {r.map((c, j) => <td key={j} className={`px-3.5 py-2.5 ${j === 0 ? 'font-medium text-ink-900' : ''}`}>{inline(c, locale)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* phone: one card per row, so nothing is squeezed or scrolls sideways */}
      <ul className="space-y-2.5 sm:hidden">
        {rows.map((r, i) => (
          <li key={i} className="rounded-xl border border-ink-100 p-3.5 text-sm">
            <p className="font-semibold text-ink-900">{inline(r[0], locale)}</p>
            {r.slice(1).map((c, j) => (
              <p key={j} className="mt-1"><span className="text-ink-500">{head[j + 1]}: </span>{inline(c, locale)}</p>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
