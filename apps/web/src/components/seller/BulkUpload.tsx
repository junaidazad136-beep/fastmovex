'use client';

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, downloadFile } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';

interface Issue { line: number; handle?: string; sku?: string; message: string }
interface Report {
  dryRun: boolean; rows: number; products: { created: number; updated: number }; variants: { created: number; updated: number };
  stockChanges: number; errors: Issue[]; warnings: Issue[];
}

const COLUMNS = ['handle', 'title', 'title_ar', 'category', 'brand', 'sku', 'option1_name', 'option1_value', 'price', 'compare_at_price', 'stock', 'status'] as const;

/**
 * Many products at once from a spreadsheet: download the template (or the store's own products to edit), fill it in Excel
 * or Google Sheets, save as CSV, check it (nothing is saved, every problem is listed by line), then save.
 */
export function BulkUpload() {
  const t = useT();
  const l = t.locale;
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'save' | 'dl'>('');

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'save');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<Report>(`/seller/products/import?dryRun=${dryRun}`, { method: 'POST', body: fd });
      setReport(r);
      if (!dryRun) toast({ tone: r.errors.length ? 'info' : 'success', message: t('seller.bulk.saved') });
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(''); }
  }
  async function get(path: string, name: string) {
    setBusy('dl');
    try { await downloadFile(path, name); } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(''); }
  }

  const total = report ? report.products.created + report.products.updated : 0;
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="bulk-upload">
      <div>
        <Link href={paths.sellerProducts(l)} className="text-sm text-ink-500 hover:text-brand-700">← {t('seller.nav.products')}</Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{t('seller.bulk.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('seller.bulk.lead')}</p>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>{t('seller.bulk.step1')}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={busy === 'dl'} onClick={() => get('/seller/products/import-template.csv', 'fastmovex-products-template.csv')} data-testid="bulk-template"><Download className="size-4" aria-hidden />{t('seller.bulk.template')}</button>
          <button type="button" className="btn-secondary" disabled={busy === 'dl'} onClick={() => get('/seller/products/export.csv', 'my-products.csv')} data-testid="bulk-export"><FileSpreadsheet className="size-4" aria-hidden />{t('seller.bulk.mine')}</button>
        </div>
        <ul className="list-disc space-y-1 ps-5 text-sm text-ink-700">
          <li>{t('seller.bulk.tip1')}</li>
          <li>{t('seller.bulk.tip2')}</li>
          <li>{t('seller.bulk.tip3')}</li>
          <li>{t('seller.bulk.tip4')}</li>
        </ul>
        <details className="rounded-xl bg-ink-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('seller.bulk.columns')}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
            {COLUMNS.map((c) => (
              <div key={c} className="contents">
                <dt className="font-mono text-xs font-semibold text-ink-800" dir="ltr">{c}</dt>
                <dd className="text-ink-600">{t(`seller.bulk.col.${c}`)}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>{t('seller.bulk.step2')}</h2>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="bulk-file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} data-testid="bulk-file" />
        <label htmlFor="bulk-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 p-6 text-center hover:border-brand-400 hover:bg-brand-50/40">
          <Upload className="size-6 text-brand-600" aria-hidden />
          <span className="text-sm font-semibold text-ink-900">{file ? file.name : t('seller.bulk.choose')}</span>
          <span className="text-xs text-ink-500">{t('seller.bulk.chooseHint')}</span>
        </label>
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={!file || !!busy} onClick={() => send(true)} data-testid="bulk-check">{busy === 'check' && <Spinner className="size-4" />}{t('seller.bulk.check')}</button>
      </section>

      {report && (
        <section className={`card space-y-4 p-5 ${report.dryRun ? '' : 'border-success-600/30'}`} data-testid="bulk-report" aria-live="polite">
          <h2 className="flex items-center gap-2 font-semibold">
            {report.dryRun ? <span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">3</span> : <CheckCircle2 className="size-5 text-success-700" aria-hidden />}
            {report.dryRun ? t('seller.bulk.step3') : t('seller.bulk.done')}
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Num label={t('seller.bulk.newProducts')} n={report.products.created} />
            <Num label={t('seller.bulk.changedProducts')} n={report.products.updated} />
            <Num label={t('seller.bulk.variants')} n={report.variants.created + report.variants.updated} />
            <Num label={t('seller.bulk.stock')} n={report.stockChanges} />
          </dl>
          {report.warnings.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-sand-50 p-3 text-sm text-sand-700">
              {report.warnings.map((w, i) => <li key={i}>{t('seller.bulk.line', { n: w.line })}: {w.message}</li>)}
            </ul>
          )}
          {report.errors.length > 0 && (
            <div className="rounded-xl border border-danger-600/30 bg-danger-50 p-3" data-testid="bulk-errors">
              <p className="flex items-center gap-2 text-sm font-semibold text-danger-600"><AlertTriangle className="size-4" aria-hidden />{t.plural('seller.bulk.problems', report.errors.length)}</p>
              <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-sm text-ink-800">
                {report.errors.map((e, i) => (
                  <li key={i}><span className="font-semibold">{t('seller.bulk.line', { n: e.line })}</span>{e.sku ? <span className="font-mono text-xs text-ink-500" dir="ltr"> {e.sku}</span> : null}: {e.message}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-600">{t('seller.bulk.fixHint')}</p>
            </div>
          )}
          {report.dryRun ? (
            total > 0 ? (
              <button type="button" className="btn-primary btn-lg w-full" disabled={!!busy} onClick={() => send(false)} data-testid="bulk-save">
                {busy === 'save' && <Spinner />}{report.errors.length ? t('seller.bulk.saveRest', { n: total }) : t('seller.bulk.save', { n: total })}
              </button>
            ) : <p className="text-sm text-ink-600">{t('seller.bulk.nothing')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link href={paths.sellerProducts(l)} className="btn-primary">{t('seller.bulk.toProducts')}</Link>
              <button type="button" className="btn-secondary" onClick={() => { setFile(null); setReport(null); if (input.current) input.current.value = ''; }}>{t('seller.bulk.another')}</button>
            </div>
          )}
          {report.dryRun && <p className="text-xs text-ink-500">{t('seller.bulk.safe')}</p>}
        </section>
      )}
    </div>
  );
}

function Num({ label, n }: { label: string; n: number }) {
  return <div className="rounded-xl bg-ink-50 p-3"><dt className="text-xs text-ink-500">{label}</dt><dd className="tabular text-xl font-extrabold">{n}</dd></div>;
}
