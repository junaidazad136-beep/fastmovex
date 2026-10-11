import bidiFactory from 'bidi-js';
import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';

/**
 * Small toolkit for FastMoveX's printed documents (run sheets, cash receipts, invoices). One font family that has both
 * Arabic and Latin, and right-to-left text placed correctly: pdfkit shapes Arabic letters but draws everything
 * left-to-right, so each line is split into direction runs (Unicode bidi algorithm) and the runs are placed in
 * visual order. Lines are single-line by design (tables): long text shrinks a little, then is cut with "…".
 */

const FONT_DIR = [join(__dirname, '../../assets/fonts'), join(process.cwd(), 'assets/fonts')].find((d) => existsSync(join(d, 'NotoSansArabic-Regular.ttf')));
const bidi = bidiFactory();

export type Doc = PDFKit.PDFDocument;
export const INK = '#111827';
export const MUTED = '#6b7280';
export const LINE = '#d1d5db';
export const DANGER = '#b91c1c';

export function newPdf(opts: PDFKit.PDFDocumentOptions & { title: string }): Doc {
  const doc = new PDFDocument({ margin: 36, bufferPages: true, ...opts, info: { Title: opts.title, Author: 'FastMoveX', Creator: 'FastMoveX' } });
  if (!FONT_DIR) throw new Error('PDF fonts missing: assets/fonts/NotoSansArabic-*.ttf');
  doc.registerFont('Regular', join(FONT_DIR, 'NotoSansArabic-Regular.ttf'));
  doc.registerFont('Bold', join(FONT_DIR, 'NotoSansArabic-Bold.ttf'));
  doc.font('Regular').fillColor(INK);
  return doc;
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/** Arabic-Indic digits print as 0-9 (as on Qatari receipts); keeps number runs left-to-right. Exported for tests. */
export function normaliseDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };

/**
 * Splits one line into pieces in the order they are drawn from left to right. Arabic words stay in logical order (the
 * font engine reverses and shapes their letters); right-to-left runs of only spaces/punctuation are reversed and
 * mirrored here. Exported for tests.
 */
export function visualRuns(text: string): { text: string; rtl: boolean }[] {
  const s = normaliseDigits(text).replace(/[\r\n\t]+/g, ' ');
  if (!s) return [];
  if (!RTL_LETTER.test(s)) return [{ text: s, rtl: false }];
  // Base direction by majority: "شقة 4, Bldg 12, St 901" reads as an English line with an Arabic word in it
  const arabic = (s.match(new RegExp(RTL_LETTER.source, 'g')) ?? []).length;
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  const { levels } = bidi.getEmbeddingLevels(s, arabic >= latin ? 'rtl' : 'ltr');
  const runs: { start: number; end: number; level: number }[] = [];
  for (let i = 0; i < s.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.level === levels[i]) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, level: levels[i] });
  }
  // Unicode rule L2: from the highest level down to the lowest odd level, reverse every sequence at that level or above
  const max = Math.max(...runs.map((r) => r.level));
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), max + 1);
  let order = runs;
  for (let lvl = max; lvl >= minOdd; lvl--) {
    const next: typeof runs = [];
    for (let i = 0; i < order.length;) {
      if (order[i].level >= lvl) {
        let j = i;
        while (j < order.length && order[j].level >= lvl) j++;
        next.push(...order.slice(i, j).reverse());
        i = j;
      } else next.push(order[i++]);
    }
    order = next;
  }
  return order.flatMap((r): { text: string; rtl: boolean }[] => {
    const t = s.slice(r.start, r.end);
    const rtl = r.level % 2 === 1;
    if (rtl && !RTL_LETTER.test(t)) return [{ text: [...t].reverse().map((c) => MIRROR[c] ?? c).join(''), rtl }];
    // The font engine loses spaces inside a shaped right-to-left run, so each word is drawn on its own (words in
    // reverse order; the engine reverses the letters of each word) and the spaces between them are drawn as spaces.
    if (rtl) return t.split(/(\s+)/).filter(Boolean).reverse().map((w) => ({ text: /^\s+$/.test(w) ? w : w.replace(/[()[\]{}<>]/g, (c) => MIRROR[c] ?? c), rtl }));
    return [{ text: t, rtl }];
  });
}

export const hasArabic = (s: string | null | undefined) => !!s && RTL_LETTER.test(s);

interface TextOpts { width: number; size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center'; minSize?: number }

function widthOf(doc: Doc, runs: { text: string }[]) {
  return runs.reduce((w, r) => w + doc.widthOfString(r.text), 0);
}

/** Draws one line inside a box (left-aligned unless asked). Returns the line height used. */
export function line(doc: Doc, text: string | null | undefined, x: number, y: number, o: TextOpts): number {
  const raw = (text ?? '').trim();
  let size = o.size ?? 9;
  doc.font(o.bold ? 'Bold' : 'Regular').fontSize(size).fillColor(o.color ?? INK);
  if (!raw) return size * 1.35;
  let logical = raw;
  let runs = visualRuns(logical);
  const minSize = o.minSize ?? Math.max(6.5, size * 0.8);
  while (widthOf(doc, runs) > o.width && size > minSize) { size -= 0.5; doc.fontSize(size); }
  while (widthOf(doc, runs) > o.width && logical.length > 1) { logical = logical.slice(0, -1); runs = visualRuns(`${logical.trimEnd()}…`); }
  const total = widthOf(doc, runs);
  const align = o.align ?? 'left'; // documents are laid out left-to-right; Arabic text inside reads right-to-left
  let cx = align === 'right' ? x + o.width - total : align === 'center' ? x + (o.width - total) / 2 : x;
  for (const r of runs) {
    doc.text(r.text, cx, y, { lineBreak: false });
    cx += doc.widthOfString(r.text);
  }
  return size * 1.35;
}

/** Up to `max` lines of text in a box, broken at spaces (each line keeps its own direction). Returns the height used. */
export function lines(doc: Doc, text: string | null | undefined, x: number, y: number, o: TextOpts & { max?: number }): number {
  const raw = (text ?? '').trim();
  const size = o.size ?? 9;
  doc.font(o.bold ? 'Bold' : 'Regular').fontSize(size);
  if (!raw) return size * 1.35;
  const words = raw.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (cur && widthOf(doc, visualRuns(tryLine)) > o.width) { out.push(cur); cur = w; } else cur = tryLine;
  }
  if (cur) out.push(cur);
  const max = o.max ?? 3;
  const shown = out.length > max ? [...out.slice(0, max - 1), out.slice(max - 1).join(' ')] : out;
  let h = 0;
  for (const l of shown) h += line(doc, l, x, y + h, o);
  return h;
}

export function rule(doc: Doc, x1: number, x2: number, y: number, color = LINE, width = 0.6) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
}

export function box(doc: Doc, x: number, y: number, w: number, h: number, color = LINE) {
  doc.save().rect(x, y, w, h).lineWidth(0.6).strokeColor(color).stroke().restore();
}

/** "Page 1 of 3" and a footer note on every page (needs bufferPages). */
export function footers(doc: Doc, note: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 12;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin must not open a new page
    line(doc, note, doc.page.margins.left, y, { width: w * 0.75, size: 7, color: MUTED });
    line(doc, `Page ${i - range.start + 1} of ${range.count}`, doc.page.margins.left + w * 0.75, y, { width: w * 0.25, size: 7, color: MUTED, align: 'right' });
    doc.page.margins.bottom = bottom;
  }
}

/** Local date/time for a market ("4 Oct 2026, 18:40"). */
export function localTime(d: Date | string, tz: string, withTime = true): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', ...(withTime && { hour: '2-digit', minute: '2-digit', hour12: false }) }).format(new Date(d));
}
