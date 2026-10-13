import { BadRequestException } from '@nestjs/common';

/**
 * Size guides: pure checks and the "which guide does this product show" rule (no database here, easy to test).
 * A chart is a small table: columns (label EN/AR, optional unit) and rows of short text cells ("97–102").
 */
export const SIZE_CHART_KINDS = ['CLOTHING', 'LENGTH', 'SHOES', 'KIDS', 'GENERAL'] as const;
export type SizeChartKind = (typeof SIZE_CHART_KINDS)[number];
export type SizeUnit = 'cm' | 'in' | null;
export interface SizeColumn { label: string; labelAr: string | null; unit: SizeUnit }
export interface SizeChartData {
  id: string;
  name: string;
  nameAr: string;
  kind: SizeChartKind;
  columns: SizeColumn[];
  rows: string[][];
  note: string | null;
  noteAr: string | null;
}

export const MAX_COLUMNS = 8;
export const MAX_ROWS = 40;
const CELL_MAX = 24;
const LABEL_MAX = 30;

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : '');

/** Strict check of what staff or sellers save. Throws a readable 400; returns the trimmed table. */
export function parseSizeTable(columnsRaw: unknown, rowsRaw: unknown): { columns: SizeColumn[]; rows: string[][] } {
  const bad = (msg: string): never => { throw new BadRequestException(`Size chart: ${msg}`); };
  if (!Array.isArray(columnsRaw) || columnsRaw.length < 2) bad('add at least 2 columns (for example "Size" and "Chest")');
  const cols = columnsRaw as unknown[];
  if (cols.length > MAX_COLUMNS) bad(`at most ${MAX_COLUMNS} columns`);
  const columns = cols.map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const label = clean(o.label, LABEL_MAX);
    const labelAr = clean(o.labelAr, LABEL_MAX) || null;
    if (!label) bad(`column ${i + 1} needs a name`);
    if (label.length > LABEL_MAX || (labelAr?.length ?? 0) > LABEL_MAX) bad(`column names can be at most ${LABEL_MAX} characters`);
    const unit = o.unit === 'cm' || o.unit === 'in' ? o.unit : null;
    if (o.unit !== undefined && o.unit !== null && o.unit !== '' && !unit) bad(`column ${i + 1}: unit must be cm, in or empty`);
    return { label, labelAr, unit } as SizeColumn;
  });
  if (!Array.isArray(rowsRaw) || rowsRaw.length < 1) bad('add at least one row');
  const rowList = rowsRaw as unknown[];
  if (rowList.length > MAX_ROWS) bad(`at most ${MAX_ROWS} rows`);
  const rows = rowList.map((r, i) => {
    if (!Array.isArray(r)) bad(`row ${i + 1} is not a list of cells`);
    const cells = (r as unknown[]).map((c) => (typeof c === 'number' ? String(c) : clean(c, CELL_MAX)));
    if (cells.length !== columns.length) bad(`row ${i + 1} must have ${columns.length} cells, one per column`);
    if (cells.some((c) => c.length > CELL_MAX)) bad(`row ${i + 1}: a cell can be at most ${CELL_MAX} characters`);
    if (!cells[0]) bad(`row ${i + 1}: the first cell (the size) cannot be empty`);
    return cells;
  });
  return { columns, rows };
}

/** "Size", "Shoe size", "EU size", "المقاس", "مقاس الحذاء"… — options a size guide belongs to. */
export const SIZE_OPTION = /size|مقاس|المقاس|القياس|قياس/i;
export function hasSizeOption(optionNames: string[]): boolean {
  return optionNames.some((n) => SIZE_OPTION.test(n));
}

/**
 * The guide a product page shows: the product's own chart always; otherwise the nearest category default (deepest
 * category first), but only when the product actually comes in sizes.
 */
export function pickSizeChart<C>(own: C | null, categoryDefaults: (C | null)[], optionNames: string[]): C | null {
  if (own) return own;
  if (!hasSizeOption(optionNames)) return null;
  for (const c of categoryDefaults) if (c) return c;
  return null;
}

/** Stored JSON → typed chart (anything malformed is dropped rather than shown broken). */
export function toSizeChart(row: { id: string; name: string; nameAr: string; kind: string; columns: unknown; rows: unknown; note: string | null; noteAr: string | null }): SizeChartData | null {
  try {
    const { columns, rows } = parseSizeTable(row.columns, row.rows);
    const kind = (SIZE_CHART_KINDS as readonly string[]).includes(row.kind) ? (row.kind as SizeChartKind) : 'GENERAL';
    return { id: row.id, name: row.name, nameAr: row.nameAr, kind, columns, rows, note: row.note, noteAr: row.noteAr };
  } catch {
    return null;
  }
}
