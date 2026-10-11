'use client';

import { Plus, Trash2 } from 'lucide-react';

export type SpecRow = { key: string; value: string };

export function specsToRows(specs: Record<string, string> | null | undefined): SpecRow[] {
  return Object.entries(specs ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}
export function rowsToSpecs(rows: SpecRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim() && r.value.trim()) out[r.key.trim().slice(0, 60)] = r.value.trim().slice(0, 500);
  return out;
}

/** Specification table ("Capacity: 1.7 L") shown on the product page. */
export function SpecsEditor({ rows, onChange }: { rows: SpecRow[]; onChange: (rows: SpecRow[]) => void }) {
  const set = (i: number, patch: Partial<SpecRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <input className="input w-2/5" value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="Name, e.g. Capacity" maxLength={60} aria-label={`Specification ${i + 1} name`} />
          <input className="input flex-1" value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="Value, e.g. 1.7 L" maxLength={500} aria-label={`Specification ${i + 1} value`} />
          <button type="button" className="btn-ghost px-2" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove specification ${i + 1}`}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([...rows, { key: '', value: '' }])} disabled={rows.length >= 50}>
        <Plus className="size-4" aria-hidden /> Add specification
      </button>
    </div>
  );
}
