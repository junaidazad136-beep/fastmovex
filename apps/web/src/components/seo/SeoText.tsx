import { ChevronDown } from 'lucide-react';
import type { FaqEntry } from '@/lib/api/types';
import { JsonLd } from '../ui/JsonLd';

/**
 * The text written for a category or brand: shown under the products (shoppers see the products first; search
 * engines read the words), with its questions as an accordion and FAQ structured data.
 */
export function SeoText({ title, text, faqTitle, faq, locale }: { title: string; text: string | null; faqTitle: string; faq: FaqEntry[]; locale: 'en' | 'ar' }) {
  const items = faq.map((f) => ({ q: locale === 'ar' ? f.qAr : f.q, a: locale === 'ar' ? f.aAr : f.a })).filter((f) => f.q && f.a);
  const paragraphs = (text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length && !items.length) return null;
  return (
    <section className="mt-12 grid gap-8 border-t border-ink-100 pt-8 lg:grid-cols-2" data-testid="seo-text">
      {paragraphs.length ? (
        <div>
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <div className="mt-3 space-y-3 text-[15px] leading-7 text-ink-700">{paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div>
        </div>
      ) : null}
      {items.length ? (
        <div>
          <h2 className="text-lg font-bold tracking-tight">{faqTitle}</h2>
          <div className="mt-3 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white" data-testid="seo-faq">
            {items.map((f, i) => (
              <details key={i} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-ink-900">
                  {f.q}<ChevronDown className="size-4 shrink-0 text-ink-400 transition group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-700">{f.a}</p>
              </details>
            ))}
          </div>
          <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }} />
        </div>
      ) : null}
    </section>
  );
}
