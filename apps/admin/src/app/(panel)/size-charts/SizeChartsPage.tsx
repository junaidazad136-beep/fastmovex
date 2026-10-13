'use client';

import { Copy, Pencil, Plus, Ruler, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Loading, PageHeader, SelectField, Spinner, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useAction, useApi } from '@/lib/use-api';

type Unit = 'cm' | 'in' | null;
interface Column { label: string; labelAr: string | null; unit: Unit }
export interface SizeChartRow {
  id: string; name: string; nameAr: string; kind: Kind; columns: Column[]; rows: string[][]; note: string | null; noteAr: string | null;
  productCount: number; categoryCount: number;
}
type Kind = 'CLOTHING' | 'LENGTH' | 'SHOES' | 'KIDS' | 'GENERAL';
interface Form { id?: string; name: string; nameAr: string; kind: Kind; columns: { label: string; labelAr: string; unit: string }[]; rows: string[][]; note: string; noteAr: string }

const KINDS: { value: Kind; label: string }[] = [
  { value: 'CLOTHING', label: 'Clothing (chest, waist, hips)' },
  { value: 'LENGTH', label: 'Thobe / abaya (by height)' },
  { value: 'SHOES', label: 'Shoes (foot length)' },
  { value: 'KIDS', label: 'Kids (height, chest)' },
  { value: 'GENERAL', label: 'Other' },
];
const MAX_COLS = 8;
const MAX_ROWS = 40;

const blank = (): Form => ({
  name: '', nameAr: '', kind: 'CLOTHING', note: '', noteAr: '',
  columns: [{ label: 'Size', labelAr: 'المقاس', unit: '' }, { label: 'Chest', labelAr: 'الصدر', unit: 'cm' }, { label: 'Waist', labelAr: 'الخصر', unit: 'cm' }],
  rows: [['S', '', ''], ['M', '', ''], ['L', '', '']],
});
const toForm = (c: SizeChartRow, copy = false): Form => ({
  id: copy ? undefined : c.id, name: copy ? `${c.name} (copy)` : c.name, nameAr: c.nameAr, kind: c.kind, note: c.note ?? '', noteAr: c.noteAr ?? '',
  columns: c.columns.map((x) => ({ label: x.label, labelAr: x.labelAr ?? '', unit: x.unit ?? '' })), rows: c.rows.map((r) => [...r]),
});

/**
 * Size guides customers open from the "Size" option on a product page. A chart is used by a product (chosen in the
 * product) or by a whole category (its default, for products there that come in sizes).
 */
export function SizeChartsPage() {
  const charts = useApi<SizeChartRow[]>('/admin/size-charts');
  const { busy, run } = useAction();
  const [form, setForm] = useState<Form | null>(null);
  const [del, setDel] = useState<SizeChartRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function check(f: Form): string | null {
    if (!f.name.trim() || !f.nameAr.trim()) return 'Give the chart a name in English and Arabic.';
    if (f.columns.some((c) => !c.label.trim())) return 'Every column needs a name.';
    if (f.rows.some((r) => !r[0]?.trim())) return 'Every row needs a size in the first column.';
    return null;
  }

  async function save() {
    if (!form) return;
    const problem = check(form);
    setError(problem);
    if (problem) return;
    const body = {
      name: form.name.trim(), nameAr: form.nameAr.trim(), kind: form.kind, note: form.note.trim(), noteAr: form.noteAr.trim(),
      columns: form.columns.map((c) => ({ label: c.label.trim(), labelAr: c.labelAr.trim() || null, unit: c.unit || null })),
      rows: form.rows.map((r) => r.map((x) => x.trim())),
    };
    const r = await run('save', () => api(form.id ? `/admin/size-charts/${form.id}` : '/admin/size-charts', { method: form.id ? 'PATCH' : 'POST', body }), form.id ? 'Size guide saved' : 'Size guide added');
    if (r !== undefined) { setForm(null); charts.reload(); }
  }

  async function remove() {
    if (!del) return;
    const r = await run('delete', () => api(`/admin/size-charts/${del.id}`, { method: 'DELETE' }).then(() => true), 'Size guide deleted');
    if (r !== undefined) { setDel(null); charts.reload(); }
  }

  return (
    <>
      <PageHeader
        title="Size guides"
        description="The “Size guide” customers open next to the Size option on a product page. Choose one in a product, or make it a category's default (Categories → edit) for every product there that comes in sizes."
        actions={<button type="button" className="btn-primary" onClick={() => { setError(null); setForm(blank()); }}><Plus className="size-4" aria-hidden /> Add size guide</button>}
      />
      {charts.error ? <ErrorState error={charts.error} onRetry={charts.reload} /> : !charts.data ? <Loading /> : charts.data.length === 0 ? (
        <Card><EmptyState title="No size guides yet" icon={<Ruler className="size-6" aria-hidden />} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {charts.data.map((c) => (
            <Card key={c.id} bodyClassName="p-4" className="flex flex-col">
              <div data-testid="size-chart-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-900">{c.name}</p>
                    <p className="truncate text-sm text-ink-500" dir="rtl" lang="ar">{c.nameAr}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => { setError(null); setForm(toForm(c)); }} aria-label={`Edit ${c.name}`}><Pencil className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => { setError(null); setForm(toForm(c, true)); }} aria-label={`Copy ${c.name}`} title="Copy as a new guide"><Copy className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => setDel(c)} aria-label={`Delete ${c.name}`}><Trash2 className="size-4" aria-hidden /></button>
                  </div>
                </div>
                <MiniTable chart={c} />
                <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  <Badge>{KINDS.find((k) => k.value === c.kind)?.label.split(' (')[0] ?? c.kind}</Badge>
                  {c.categoryCount ? <Badge tone="green">Default in {c.categoryCount} {c.categoryCount === 1 ? 'category' : 'categories'}</Badge> : null}
                  {c.productCount ? <Badge tone="blue">{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</Badge> : null}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit size guide' : 'Add size guide'}
        size="xl"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={save} disabled={busy === 'save'} data-testid="size-chart-save">{busy === 'save' ? <Spinner /> : null} Save</button></>}
      >
        {form ? <ChartEditor value={form} onChange={setForm} error={error} /> : null}
      </Dialog>
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={remove}
        title={`Delete ${del?.name ?? ''}?`}
        description={del && (del.productCount || del.categoryCount) ? `It is used by ${del.productCount} products and ${del.categoryCount} categories; they will show no size guide.` : 'This cannot be undone.'}
        confirmLabel="Delete"
        danger
        busy={busy === 'delete'}
      />
    </>
  );
}

function MiniTable({ chart }: { chart: SizeChartRow }) {
  const rows = chart.rows.slice(0, 4);
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-ink-100">
      <table className="w-full text-xs">
        <thead className="bg-ink-50 text-ink-600"><tr>{chart.columns.slice(0, 4).map((c, i) => <th key={i} className="px-2 py-1.5 text-start font-medium">{c.label}{c.unit ? ` (${c.unit})` : ''}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-ink-100">{r.slice(0, 4).map((x, j) => <td key={j} className={`px-2 py-1 tabular ${j === 0 ? 'font-semibold' : 'text-ink-600'}`}>{x}</td>)}</tr>)}</tbody>
      </table>
      {chart.rows.length > rows.length ? <p className="border-t border-ink-100 px-2 py-1 text-[11px] text-ink-400">+ {chart.rows.length - rows.length} more sizes</p> : null}
    </div>
  );
}

/** Name, kind, the table (columns with EN/AR names and a unit; one row per size) and a note. */
function ChartEditor({ value: f, onChange, error }: { value: Form; onChange: (f: Form) => void; error: string | null }) {
  const set = (p: Partial<Form>) => onChange({ ...f, ...p });
  const setCol = (i: number, p: Partial<Form['columns'][number]>) => set({ columns: f.columns.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const setCell = (r: number, c: number, v: string) => set({ rows: f.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const addCol = () => set({ columns: [...f.columns, { label: '', labelAr: '', unit: 'cm' }], rows: f.rows.map((r) => [...r, '']) });
  const dropCol = (i: number) => set({ columns: f.columns.filter((_, j) => j !== i), rows: f.rows.map((r) => r.filter((_, j) => j !== i)) });
  const addRow = () => set({ rows: [...f.rows, f.columns.map(() => '')] });
  const dropRow = (i: number) => set({ rows: f.rows.filter((_, j) => j !== i) });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Name" required value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="Men's shirts" autoFocus />
        <TextField label="Name in Arabic" required dir="rtl" lang="ar" value={f.nameAr} onChange={(e) => set({ nameAr: e.target.value })} maxLength={80} />
        <SelectField label="Type" hint="Picks the “how to measure” tips" value={f.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </SelectField>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-700">Table</p>
        <p className="mb-2 text-xs text-ink-500">First column: the size as it is written in the product's Size option (S, M, 42, 56…), so the customer's choice is highlighted. Columns in cm or inches can be switched by the customer.</p>
        <div className="overflow-x-auto rounded-xl border border-ink-200">
          <table className="text-sm" data-testid="size-chart-grid">
            <thead className="bg-ink-50">
              <tr>
                {f.columns.map((c, i) => (
                  <th key={i} className="min-w-32 border-e border-ink-100 p-1.5 align-top font-normal last:border-e-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <input className="input h-8 px-2 py-1 text-sm font-semibold" value={c.label} onChange={(e) => setCol(i, { label: e.target.value })} placeholder="Column" aria-label={`Column ${i + 1} name`} maxLength={30} />
                        {f.columns.length > 2 ? <button type="button" className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-danger-600" onClick={() => dropCol(i)} aria-label={`Remove column ${i + 1}`}><X className="size-3.5" aria-hidden /></button> : null}
                      </div>
                      <input className="input h-8 px-2 py-1 text-sm" dir="rtl" lang="ar" value={c.labelAr} onChange={(e) => setCol(i, { labelAr: e.target.value })} placeholder="بالعربية" aria-label={`Column ${i + 1} Arabic name`} maxLength={30} />
                      <select className="input h-8 px-2 py-1 text-xs" value={c.unit} onChange={(e) => setCol(i, { unit: e.target.value })} aria-label={`Column ${i + 1} unit`}>
                        <option value="">No unit</option>
                        <option value="cm">cm</option>
                        <option value="in">inches</option>
                      </select>
                    </div>
                  </th>
                ))}
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {f.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-ink-100">
                  {r.map((x, ci) => (
                    <td key={ci} className="border-e border-ink-100 p-1 last:border-e-0">
                      <input className={`input h-8 px-2 py-1 text-sm tabular ${ci === 0 ? 'font-semibold' : ''}`} value={x} onChange={(e) => setCell(ri, ci, e.target.value)} placeholder={ci === 0 ? 'Size' : '97–102'} aria-label={`Row ${ri + 1}, ${f.columns[ci]?.label || `column ${ci + 1}`}`} maxLength={24} />
                    </td>
                  ))}
                  <td className="p-1">
                    {f.rows.length > 1 ? <button type="button" className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-danger-600" onClick={() => dropRow(ri)} aria-label={`Remove row ${ri + 1}`}><X className="size-3.5" aria-hidden /></button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={addRow} disabled={f.rows.length >= MAX_ROWS} data-testid="size-chart-add-row"><Plus className="size-3.5" aria-hidden /> Size (row)</button>
          <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={addCol} disabled={f.columns.length >= MAX_COLS}><Plus className="size-3.5" aria-hidden /> Measurement (column)</button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextArea label="Tip under the table" rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={400} placeholder="If you are between two sizes, choose the larger one." />
        <TextArea label="Tip in Arabic" rows={2} dir="rtl" lang="ar" value={f.noteAr} onChange={(e) => set({ noteAr: e.target.value })} maxLength={400} />
      </div>
      {error ? <p className="text-sm font-medium text-danger-600" role="alert">{error}</p> : null}
    </div>
  );
}
