import type { SizeChart, SizeUnit } from './api/types';

/** Every number in a cell turned into the other unit: "97–102" cm → "38.2–40.2" in; "56" in → "142" cm. */
export function convertCell(cell: string, from: SizeUnit, to: 'cm' | 'in'): string {
  if (!from || from === to) return cell;
  return cell.replace(/\d+(?:\.\d+)?/g, (n) => {
    const v = Number(n);
    const out = to === 'in' ? v / 2.54 : v * 2.54;
    const rounded = to === 'in' ? Math.round(out * 10) / 10 : Math.round(out * 2) / 2; // in: 0.1, cm: 0.5
    return String(rounded);
  });
}

/** Whether a chart has anything to switch between cm and inches. */
export function hasUnits(chart: Pick<SizeChart, 'columns'>): boolean {
  return chart.columns.some((c) => c.unit === 'cm' || c.unit === 'in');
}

/** The row for the size the shopper picked ("M", "42", "56"), matched on the first column. */
export function rowFor(chart: Pick<SizeChart, 'rows'>, selected: string | undefined): number {
  if (!selected) return -1;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '').replace(/^(eu|uk|us)/, '');
  const want = norm(selected);
  return chart.rows.findIndex((r) => norm(r[0] ?? '') === want);
}

/** "Size", "Shoe size", "المقاس"… — the option a size guide belongs to (same rule as the API). */
export const SIZE_OPTION = /size|مقاس|المقاس|القياس|قياس/i;
