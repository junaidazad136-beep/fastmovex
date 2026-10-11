'use client';

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Card, PageHeader, Spinner, Table } from '@/components/ui';
import { api, download } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { formatNumber } from '@/lib/format';
import { useToast } from '@/lib/state/toast';

interface Issue { line: number; handle?: string; sku?: string; message: string }
interface Report {
  dryRun: boolean;
  rows: number;
  products: { created: number; updated: number };
  variants: { created: number; updated: number };
  stockChanges: number;
  errors: Issue[];
  warnings: Issue[];
}

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Bulk catalogue editing with a spreadsheet: export (or take the template), edit in Excel / Google Sheets,
 * upload. Every upload is checked first (nothing is written) and shows what will change; then import.
 */
export function ImportExport() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(f: File, dryRun: boolean): Promise<Report | null> {
    const fd = new FormData();
    fd.append('file', f);
    try {
      return await api<Report>(`/admin/products/import?dryRun=${dryRun}`, { method: 'POST', body: fd });
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return toast.error('Choose a .csv file (in Excel: File › Save as › CSV UTF-8).');
    if (f.size > MAX_BYTES) return toast.error('The file is larger than 5 MB. Split it into smaller files.');
    setFile(f);
    setPreview(null);
    setResult(null);
    setBusy('check');
    setPreview(await send(f, true));
    setBusy(null);
  }

  async function runImport() {
    if (!file) return;
    setBusy('import');
    const r = await send(file, false);
    setBusy(null);
    if (r) {
      setResult(r);
      setPreview(null);
      setFile(null);
      summaryStale();
      toast.success('Import finished');
    }
  }

  const changes = preview ? preview.products.created + preview.products.updated + preview.variants.created + preview.variants.updated + preview.stockChanges : 0;

  return (
    <>
      <PageHeader back={{ href: '/products', label: 'Products' }} title="Import / export" description="Add or update many products at once with a spreadsheet." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="1. Get a spreadsheet">
          <p className="text-sm text-ink-600">Start from your current catalogue, or from an empty template with an example row.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="btn-secondary justify-start" disabled={!!busy} onClick={() => download('/admin/products/export.csv?house=true', 'fastmovex-products.csv').catch((e) => toast.error(errorMessage(e)))}>
              <Download className="size-4" aria-hidden /> Export FastMoveX products
            </button>
            <button type="button" className="btn-secondary justify-start" disabled={!!busy} onClick={() => download('/admin/products/import-template.csv', 'fastmovex-import-template.csv').catch((e) => toast.error(errorMessage(e)))}>
              <FileSpreadsheet className="size-4" aria-hidden /> Download empty template
            </button>
          </div>
        </Card>

        <Card title="2. Edit it" className="lg:col-span-2">
          <ul className="list-disc space-y-1.5 ps-5 text-sm text-ink-600">
            <li>One row per variant. Rows with the same <code className="rounded bg-ink-100 px-1">handle</code> are one product; <code className="rounded bg-ink-100 px-1">option1_name</code>/<code className="rounded bg-ink-100 px-1">option1_value</code> make the variants (e.g. Colour / Black).</li>
            <li>Existing products are matched by <strong>handle</strong>, variants by <strong>SKU</strong>: change a price or stock and it is updated; a new handle or SKU is created.</li>
            <li>Prices in QAR with a dot: <code className="rounded bg-ink-100 px-1">149.50</code>. <code className="rounded bg-ink-100 px-1">stock</code> is the counted quantity; the difference is recorded as an adjustment.</li>
            <li><code className="rounded bg-ink-100 px-1">category</code> uses the category slug (e.g. <code className="rounded bg-ink-100 px-1">home-kitchen</code>); unknown brands are created.</li>
            <li>Photos are added in the product page after the import. Imported products stay drafts until they have a photo.</li>
            <li>Save as <strong>CSV UTF-8</strong> so Arabic text is kept. Up to 5,000 rows per file.</li>
          </ul>
        </Card>
      </div>

      <Card title="3. Upload and check" className="mt-6">
        <div
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-ink-200 px-4 py-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files[0]);
          }}
        >
          <Upload className="size-7 text-ink-400" aria-hidden />
          <p className="text-sm text-ink-600">{file ? <strong>{file.name}</strong> : 'Drop the CSV file here, or'}</p>
          <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={!!busy}>
            {busy === 'check' ? <Spinner /> : null} {file ? 'Choose another file' : 'Choose file'}
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          <p className="text-xs text-ink-500">Nothing is saved until you press Import.</p>
        </div>

        {preview ? (
          <div className="mt-6 space-y-4">
            <Summary report={preview} title="What this file will change" />
            <Issues report={preview} />
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-100 pt-4">
              {preview.errors.length ? <p className="me-auto text-sm text-warning-600">Rows with errors will be skipped. Fix them and upload again, or import the rest now.</p> : null}
              <button type="button" className="btn-primary" onClick={runImport} disabled={!!busy || changes === 0}>
                {busy === 'import' ? <Spinner /> : null} {changes === 0 ? 'Nothing to import' : `Import ${formatNumber(preview.rows - preview.errors.length)} rows`}
              </button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2 rounded-xl bg-success-50 px-4 py-3 text-sm font-medium text-success-700">
              <CheckCircle2 className="size-5" aria-hidden /> Import done.
              <Link href="/products?sort=updated" className="link ms-auto">See products</Link>
            </div>
            <Summary report={result} title="What changed" />
            <Issues report={result} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

function Summary({ report, title }: { report: Report; title: string }) {
  const items: [string, number][] = [
    ['New products', report.products.created],
    ['Updated products', report.products.updated],
    ['New variants', report.variants.created],
    ['Updated variants', report.variants.updated],
    ['Stock changes', report.stockChanges],
    ['Rows with errors', report.errors.length],
  ];
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title} <span className="font-normal text-ink-500">({formatNumber(report.rows)} rows read)</span></h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([k, v]) => (
          <div key={k} className={`rounded-lg p-3 ${k === 'Rows with errors' && v ? 'bg-danger-50' : 'bg-ink-50'}`}>
            <dt className="text-xs text-ink-500">{k}</dt>
            <dd className={`text-xl font-bold tabular ${k === 'Rows with errors' && v ? 'text-danger-600' : ''}`}>{formatNumber(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Issues({ report }: { report: Report }) {
  const all = [...report.errors.map((e) => ({ ...e, kind: 'error' as const })), ...report.warnings.map((w) => ({ ...w, kind: 'warning' as const }))].sort((a, b) => a.line - b.line);
  if (!all.length) return null;
  return (
    <div className="max-h-96 overflow-y-auto rounded-xl border border-ink-100">
      <Table>
        <thead className="sticky top-0">
          <tr><th className="th w-20">Line</th><th className="th">Handle / SKU</th><th className="th">Problem</th></tr>
        </thead>
        <tbody>
          {all.slice(0, 500).map((i, k) => (
            <tr key={k}>
              <td className="td tabular">{i.line}</td>
              <td className="td text-xs text-ink-600">{[i.handle, i.sku].filter(Boolean).join(' · ') || '—'}</td>
              <td className="td">
                <span className={`inline-flex items-start gap-1.5 ${i.kind === 'error' ? 'text-danger-600' : 'text-warning-600'}`}>
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {i.message}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
