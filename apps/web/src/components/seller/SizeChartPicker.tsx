'use client';

import { Pencil, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api/client';
import type { SizeChart } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { pick } from '@/lib/urls';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { Field } from './BecomeSeller';

type Chart = SizeChart & { own: boolean };
type Kind = SizeChart['kind'];
interface Draft { id?: string; name: string; nameAr: string; kind: Kind; columns: { label: string; labelAr: string; unit: string }[]; rows: string[][]; note: string; noteAr: string }

const KINDS: Kind[] = ['CLOTHING', 'LENGTH', 'SHOES', 'KIDS', 'GENERAL'];
const blank = (): Draft => ({
  name: '', nameAr: '', kind: 'CLOTHING', note: '', noteAr: '',
  columns: [{ label: 'Size', labelAr: 'المقاس', unit: '' }, { label: 'Chest', labelAr: 'الصدر', unit: 'cm' }],
  rows: [['S', ''], ['M', ''], ['L', '']],
});
const draftOf = (c: Chart): Draft => ({
  id: c.id, name: c.name, nameAr: c.nameAr, kind: c.kind, note: c.note ?? '', noteAr: c.noteAr ?? '',
  columns: c.columns.map((x) => ({ label: x.label, labelAr: x.labelAr ?? '', unit: x.unit ?? '' })), rows: c.rows.map((r) => [...r]),
});

/**
 * The product's size guide: one of FastMoveX's ready guides, one of the store's own, or the category's default.
 * A seller can make or edit their own guide right here.
 */
export function SizeChartPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  const [charts, setCharts] = useState<Chart[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = useCallback(() => api<Chart[]>('/seller/size-charts').then(setCharts).catch(() => setCharts([])), []);
  useEffect(() => { void load(); }, [load]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shared = charts.filter((c) => !c.own);
  const own = charts.filter((c) => c.own);
  const current = own.find((c) => c.id === value);
  const name = (c: Chart) => pick(t.locale, c.name, c.nameAr);

  return (
    <Field id="pf-size-chart" label={t('seller.form.sizeGuide')} hint={t('seller.form.sizeGuideHint')}>
      <div className="flex gap-2">
        <select id="pf-size-chart" className="input" value={value} onChange={(e) => onChange(e.target.value)} data-testid="seller-size-chart">
          <option value="">{t('seller.form.sizeGuideDefault')}</option>
          {shared.length > 0 && <optgroup label={t('seller.form.sizeGuideShared')}>{shared.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}</optgroup>}
          {own.length > 0 && <optgroup label={t('seller.form.sizeGuideOwn')}>{own.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}</optgroup>}
        </select>
        {current && (
          <button type="button" className="btn-secondary shrink-0 px-3" onClick={() => setDraft(draftOf(current))} aria-label={t('seller.form.sizeGuideEdit')}>
            <Pencil className="size-4" aria-hidden />
          </button>
        )}
        <button type="button" className="btn-secondary shrink-0 px-3" onClick={() => setDraft(blank())} data-testid="seller-size-chart-new">
          <Plus className="size-4" aria-hidden /><span className="max-sm:sr-only">{t('seller.form.sizeGuideNew')}</span>
        </button>
      </div>
      {/* outside the product form, so Enter in the guide never submits the product */}
      {mounted && createPortal(<Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? t('seller.form.sizeGuideEdit') : t('seller.form.sizeGuideNew')} closeLabel={t('common.close')} wide sheet>
        {draft && <Editor draft={draft} setDraft={setDraft} onSaved={async (id) => { await load(); onChange(id); setDraft(null); }} />}
      </Dialog>, document.body)}
    </Field>
  );
}

function Editor({ draft: d, setDraft, onSaved }: { draft: Draft; setDraft: (d: Draft) => void; onSaved: (id: string) => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<Draft>) => setDraft({ ...d, ...p });
  const setCol = (i: number, p: Partial<Draft['columns'][number]>) => set({ columns: d.columns.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const setCell = (r: number, c: number, v: string) => set({ rows: d.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });

  async function save() {
    if (!d.name.trim() || !d.nameAr.trim() || d.columns.some((c) => !c.label.trim()) || d.rows.some((r) => !r[0]?.trim())) {
      setError(t('seller.form.sizeGuideIncomplete'));
      return;
    }
    setBusy(true); setError('');
    try {
      const body = {
        name: d.name.trim(), nameAr: d.nameAr.trim(), kind: d.kind, note: d.note.trim(), noteAr: d.noteAr.trim(),
        columns: d.columns.map((c) => ({ label: c.label.trim(), labelAr: c.labelAr.trim() || null, unit: c.unit || null })),
        rows: d.rows.map((r) => r.map((x) => x.trim())),
      };
      const saved = await api<{ id: string }>(d.id ? `/seller/size-charts/${d.id}` : '/seller/size-charts', { method: d.id ? 'PATCH' : 'POST', body });
      toast({ tone: 'success', message: t('seller.form.sizeGuideSaved') });
      onSaved(saved.id);
    } catch (e) { setError(errorMessage(e, t)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3" data-testid="seller-size-chart-editor">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="sc-name" label={t('seller.form.sizeGuideName')}><input id="sc-name" className="input" maxLength={80} value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field id="sc-name-ar" label={t('seller.form.sizeGuideNameAr')}><input id="sc-name-ar" className="input" dir="rtl" maxLength={80} value={d.nameAr} onChange={(e) => set({ nameAr: e.target.value })} /></Field>
        <Field id="sc-kind" label={t('seller.form.sizeGuideType')}>
          <select id="sc-kind" className="input" value={d.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`seller.form.sizeKind${k}`)}</option>)}
          </select>
        </Field>
      </div>
      <div>
        <p className="text-sm font-medium text-ink-700">{t('seller.form.sizeGuideTable')}</p>
        <p className="mb-2 text-xs text-ink-500">{t('seller.form.sizeGuideTableHint')}</p>
        <div className="overflow-x-auto rounded-xl border border-ink-200">
          <table className="text-sm">
            <thead className="bg-ink-50">
              <tr>
                {d.columns.map((c, i) => (
                  <th key={i} className="min-w-28 p-1.5 align-top font-normal">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <input className="input h-9 px-2 py-1 text-sm font-semibold" value={c.label} onChange={(e) => setCol(i, { label: e.target.value })} placeholder={t('seller.form.sizeColumn')} maxLength={30} aria-label={`${t('seller.form.sizeColumn')} ${i + 1}`} />
                        {d.columns.length > 2 && (
                          <button type="button" className="rounded p-1 text-ink-400 hover:text-danger-600" onClick={() => set({ columns: d.columns.filter((_, j) => j !== i), rows: d.rows.map((r) => r.filter((_, j) => j !== i)) })} aria-label={t('seller.form.sizeRemoveColumn', { n: i + 1 })}>
                            <X className="size-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                      <input className="input h-9 px-2 py-1 text-sm" dir="rtl" value={c.labelAr} onChange={(e) => setCol(i, { labelAr: e.target.value })} placeholder={t('seller.form.sizeColumnAr')} maxLength={30} aria-label={`${t('seller.form.sizeColumnAr')} ${i + 1}`} />
                      <select className="input h-9 px-2 py-1 text-xs" value={c.unit} onChange={(e) => setCol(i, { unit: e.target.value })} aria-label={`${t('seller.form.sizeColumn')} ${i + 1}: ${t('product.unitSwitch')}`}>
                        <option value="">{t('seller.form.sizeNoUnit')}</option>
                        <option value="cm">{t('product.unitCm')}</option>
                        <option value="in">{t('product.unitIn')}</option>
                      </select>
                    </div>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-ink-100">
                  {r.map((x, ci) => (
                    <td key={ci} className="p-1">
                      <input className={`input h-9 px-2 py-1 text-sm ${ci === 0 ? 'font-semibold' : ''}`} dir="ltr" value={x} onChange={(e) => setCell(ri, ci, e.target.value)} maxLength={24} aria-label={`${ri + 1} / ${d.columns[ci]?.label || ci + 1}`} />
                    </td>
                  ))}
                  <td className="p-1">
                    {d.rows.length > 1 && (
                      <button type="button" className="rounded p-1 text-ink-400 hover:text-danger-600" onClick={() => set({ rows: d.rows.filter((_, j) => j !== ri) })} aria-label={t('seller.form.sizeRemoveRow', { n: ri + 1 })}>
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={d.rows.length >= 40} onClick={() => set({ rows: [...d.rows, d.columns.map(() => '')] })}><Plus className="size-3.5" aria-hidden />{t('seller.form.sizeAddRow')}</button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={d.columns.length >= 8} onClick={() => set({ columns: [...d.columns, { label: '', labelAr: '', unit: 'cm' }], rows: d.rows.map((r) => [...r, '']) })}><Plus className="size-3.5" aria-hidden />{t('seller.form.sizeAddColumn')}</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="sc-note" label={t('seller.form.sizeTip')}><textarea id="sc-note" className="input min-h-16" maxLength={400} value={d.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        <Field id="sc-note-ar" label={t('seller.form.sizeTipAr')}><textarea id="sc-note-ar" className="input min-h-16" dir="rtl" maxLength={400} value={d.noteAr} onChange={(e) => set({ noteAr: e.target.value })} /></Field>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="button" className="btn-primary w-full" onClick={save} disabled={busy} data-testid="seller-size-chart-save">{busy && <Spinner />}{t('common.save')}</button>
    </div>
  );
}
