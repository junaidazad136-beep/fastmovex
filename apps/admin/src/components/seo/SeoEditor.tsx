'use client';

import { Plus, Search, Trash2 } from 'lucide-react';
import { TextArea, TextField } from '@/components/ui';

export interface SeoValue {
  description: string; descriptionAr: string;
  seoTitle: string; seoTitleAr: string;
  seoDescription: string; seoDescriptionAr: string;
}
export interface FaqRow { q: string; qAr: string; a: string; aAr: string }
export const EMPTY_SEO: SeoValue = { description: '', descriptionAr: '', seoTitle: '', seoTitleAr: '', seoDescription: '', seoDescriptionAr: '' };

/** From an API row (nulls) to form strings. */
export function seoOf(row: Partial<Record<keyof SeoValue, string | null>> | null | undefined): SeoValue {
  return Object.fromEntries(Object.keys(EMPTY_SEO).map((k) => [k, row?.[k as keyof SeoValue] ?? ''])) as unknown as SeoValue;
}
/** To the API: empty strings clear the field. */
export function seoBody(v: SeoValue) {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() === '' ? null : x.trim()]));
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={n > max ? 'text-danger-600' : n > max * 0.9 ? 'text-warning-700' : 'text-ink-400'}>{n}/{max}</span>;
}

/** How the page may look in Google (title, address, description). */
export function GooglePreview({ title, url, description }: { title: string; url: string; description: string }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3" data-testid="google-preview" aria-label="Google preview">
      <p className="truncate text-xs text-ink-500" dir="ltr">{url}</p>
      <p className="truncate text-[17px] leading-6 text-[#1a0dab]">{title}</p>
      <p className="line-clamp-2 text-[13px] leading-5 text-ink-700">{description || 'Google will pick text from the page.'}</p>
    </div>
  );
}

/**
 * Text that helps the page get found: an intro shown on the page itself (search engines read it), and the title and
 * description Google shows in results — English and Arabic. Empty = an automatic title from the name.
 */
export function SeoEditor({ value, onChange, name, nameAr, url, faq, onFaqChange, kind }: {
  value: SeoValue; onChange: (v: SeoValue) => void; name: string; nameAr: string; url: string;
  faq?: FaqRow[]; onFaqChange?: (f: FaqRow[]) => void; kind: 'category' | 'brand';
}) {
  const set = (k: keyof SeoValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const autoTitle = kind === 'category' ? `${name} — buy online in Qatar` : `${name} Qatar — official products`;
  return (
    <div className="space-y-4" data-testid="seo-editor">
      <div className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
        <Search className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>Write for shoppers in Qatar: what is in this {kind}, why buy here (delivery in Doha, cash on delivery, returns). 2–4 short paragraphs. Never copy text from other sites.</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <TextArea label={<span className="flex justify-between">Text on the page (English) <Counter n={value.description.length} max={5000} /></span>} value={value.description} onChange={set('description')} rows={5} maxLength={5000} />
        <TextArea label={<span className="flex justify-between">Text on the page (Arabic) <Counter n={value.descriptionAr.length} max={5000} /></span>} value={value.descriptionAr} onChange={set('descriptionAr')} rows={5} maxLength={5000} dir="rtl" lang="ar" />
        <TextField label={<span className="flex justify-between">Google title (English) <Counter n={value.seoTitle.length} max={60} /></span>} value={value.seoTitle} onChange={set('seoTitle')} maxLength={70} placeholder={autoTitle} />
        <TextField label={<span className="flex justify-between">Google title (Arabic) <Counter n={value.seoTitleAr.length} max={60} /></span>} value={value.seoTitleAr} onChange={set('seoTitleAr')} maxLength={70} placeholder={nameAr} dir="rtl" lang="ar" />
        <TextArea label={<span className="flex justify-between">Google description (English) <Counter n={value.seoDescription.length} max={160} /></span>} value={value.seoDescription} onChange={set('seoDescription')} maxLength={170} rows={2} />
        <TextArea label={<span className="flex justify-between">Google description (Arabic) <Counter n={value.seoDescriptionAr.length} max={160} /></span>} value={value.seoDescriptionAr} onChange={set('seoDescriptionAr')} maxLength={170} rows={2} dir="rtl" lang="ar" />
      </div>
      <GooglePreview title={`${value.seoTitle || autoTitle} | FastMoveX`} url={url} description={value.seoDescription} />
      {faq && onFaqChange ? (
        <div className="space-y-2" data-testid="faq-editor">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Questions & answers <span className="font-normal text-ink-500">(shown on the page; Google may show them too)</span></p>
            <button type="button" className="btn-secondary btn-sm" disabled={faq.length >= 20} onClick={() => onFaqChange([...faq, { q: '', qAr: '', a: '', aAr: '' }])}><Plus className="size-3.5" aria-hidden /> Add question</button>
          </div>
          {faq.map((f, i) => {
            const up = (k: keyof FaqRow) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onFaqChange(faq.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
            return (
              <div key={i} className="grid gap-2 rounded-lg border border-ink-100 p-3 lg:grid-cols-2">
                <TextField label={`Question ${i + 1} (English)`} value={f.q} onChange={up('q')} maxLength={200} />
                <TextField label={`Question ${i + 1} (Arabic)`} value={f.qAr} onChange={up('qAr')} maxLength={200} dir="rtl" lang="ar" />
                <TextArea label={`Answer ${i + 1} (English)`} value={f.a} onChange={up('a')} maxLength={1500} rows={2} />
                <TextArea label={`Answer ${i + 1} (Arabic)`} value={f.aAr} onChange={up('aAr')} maxLength={1500} rows={2} dir="rtl" lang="ar" />
                <div className="lg:col-span-2 flex justify-end"><button type="button" className="btn-ghost btn-sm text-danger-600" onClick={() => onFaqChange(faq.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /> Remove</button></div>
              </div>
            );
          })}
          {faq.some((f) => !(f.q.trim() && f.a.trim() && f.qAr.trim() && f.aAr.trim())) ? <p className="text-xs text-warning-700">Questions without both languages and an answer are not saved.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
