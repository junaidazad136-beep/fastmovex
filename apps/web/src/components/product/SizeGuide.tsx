'use client';

import { Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SizeChart } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { convertCell, hasUnits, rowFor } from '@/lib/size-chart';
import { pick } from '@/lib/urls';
import { Dialog } from '../ui/Dialog';

const UNIT_KEY = 'fmx.sizeUnit';

/**
 * Amazon's "Size chart" link next to the size option: opens the chart (a bottom sheet on phones) with a cm / inch
 * switch, the shopper's chosen size highlighted, and how to measure.
 */
export function SizeGuideLink({ chart, selected, className = '' }: { chart: SizeChart; selected?: string; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline ${className}`} data-testid="size-guide-open">
        <Ruler className="size-4" aria-hidden />
        {t('product.sizeGuide')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('product.sizeGuide')} subtitle={pick(t.locale, chart.name, chart.nameAr)} closeLabel={t('common.close')} wide sheet>
        {open && <SizeGuideBody chart={chart} selected={selected} />}
      </Dialog>
    </>
  );
}

function SizeGuideBody({ chart, selected }: { chart: SizeChart; selected?: string }) {
  const t = useT();
  const units = hasUnits(chart);
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');
  useEffect(() => {
    try { if (window.localStorage.getItem(UNIT_KEY) === 'in') setUnit('in'); } catch { /* storage blocked */ }
  }, []);
  const choose = (u: 'cm' | 'in') => { setUnit(u); try { window.localStorage.setItem(UNIT_KEY, u); } catch { /* fine */ } };
  const mine = rowFor(chart, selected);
  const note = pick(t.locale, chart.note ?? '', chart.noteAr).trim();
  const label = (c: SizeChart['columns'][number]) => pick(t.locale, c.label, c.labelAr);
  const unitLabel = (u: 'cm' | 'in') => (u === 'cm' ? t('product.unitCm') : t('product.unitIn'));

  return (
    <div data-testid="size-guide">
      {units && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-500">{chart.kind === 'SHOES' ? t('product.sizeFootNote') : t('product.sizeBodyNote')}</span>
          <div role="radiogroup" aria-label={t('product.unitSwitch')} className="flex shrink-0 rounded-full bg-ink-100 p-0.5 text-[13px] font-semibold">
            {(['cm', 'in'] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={unit === u}
                onClick={() => choose(u)}
                className={`min-w-11 rounded-full px-3 py-1 transition ${unit === u ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}
                data-testid={`size-unit-${u}`}
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full border-separate border-spacing-0 text-sm" data-testid="size-table">
          <thead>
            <tr>
              {chart.columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`border-b border-ink-200 bg-ink-50 px-2.5 py-2.5 text-start align-bottom text-[13px] font-semibold leading-4 text-ink-700 first:rounded-ss-lg last:rounded-se-lg sm:px-3 ${i === 0 ? 'sticky start-0 z-10' : ''}`}
                >
                  {label(c)}
                  {c.unit && <span className="font-normal text-ink-500"> ({unitLabel(units ? unit : c.unit)})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((r, ri) => {
              const on = ri === mine;
              return (
                <tr key={ri} aria-current={on ? 'true' : undefined} data-testid={on ? 'size-row-selected' : undefined}>
                  {r.map((cell, ci) => {
                    const col = chart.columns[ci];
                    const value = col?.unit ? convertCell(cell, col.unit, unit) : cell;
                    return ci === 0 ? (
                      <th key={ci} scope="row" className={`sticky start-0 whitespace-nowrap border-b border-ink-100 px-2.5 py-2.5 sm:px-3 text-start font-bold ${on ? 'bg-brand-50 text-brand-800' : 'bg-white text-ink-900'}`}>
                        {value}
                        {on && <span className="ms-1.5 rounded bg-brand-600 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-white">{t('product.yourSize')}</span>}
                      </th>
                    ) : (
                      <td key={ci} className={`tabular whitespace-nowrap border-b border-ink-100 px-2.5 py-2.5 text-start sm:px-3 ${on ? 'bg-brand-50 font-semibold text-ink-900' : 'text-ink-700'}`}>
                        <span dir="ltr">{value}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="mt-5" aria-labelledby="how-to-measure">
        <h3 id="how-to-measure" className="text-sm font-bold text-ink-900">{t('product.howToMeasure')}</h3>
        <ol className="mt-2 space-y-2 text-sm leading-5 text-ink-700">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">{n}</span>
              <span>{t(`product.sizeTip${chart.kind}${n}`)}</span>
            </li>
          ))}
        </ol>
        {note && <p className="mt-3 rounded-xl bg-sand-50 px-3 py-2.5 text-[13px] leading-5 text-ink-700">{note}</p>}
      </section>
    </div>
  );
}
