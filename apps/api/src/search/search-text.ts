import { BadRequestException } from '@nestjs/common';

/**
 * Text rules shared by search, spelling and the search log. Pure functions (unit-tested).
 * normalizeSearch() must match fastmovex_search_norm() in the database (migration 20261003000000_search_insights).
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // harakat, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(^|[^\u0621-\u064Aa-z0-9])ال(?=[\u0621-\u064A]{2})/g, '$1'); // the article: "القهوة" → "قهوه"
}

/** Normalised distinct words of a search (letters and digits only, at most 12). */
export function searchWords(q: string): string[] {
  return [...new Set(normalizeSearch(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 12);
}

// ------------------------------------------------------------------ settings (Country.searchSettings)

export interface SearchSettings {
  /** shown first under "Popular searches", in this order */
  pinned: string[];
  /** never shown as a popular search or suggestion (log keys) */
  hidden: string[];
  /** groups of words / short phrases that mean the same thing: [["mobile","phone","جوال"]] */
  synonyms: string[][];
}

export const NO_SEARCH_SETTINGS: SearchSettings = { pinned: [], hidden: [], synonyms: [] };
const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

export function parseSearchSettings(raw: unknown): SearchSettings {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bad = (m: string): never => { throw new BadRequestException(`Search settings: ${m}`); };
  const list = (v: unknown, name: string): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : bad(`${name} must be a list`));

  const pinned = [...new Set(list(c.pinned, 'pinned').map(clean).filter(Boolean))];
  if (pinned.length > 10) bad('at most 10 pinned searches');
  if (pinned.some((p) => p.length < 2 || p.length > 60)) bad('pinned searches are 2–60 characters');

  const hidden = [...new Set(list(c.hidden, 'hidden').map((h) => logKey(clean(h)) ?? clean(h).toLowerCase()).filter(Boolean))];
  if (hidden.length > 500) bad('at most 500 hidden searches');

  const synonyms: string[][] = [];
  for (const g of list(c.synonyms, 'synonyms')) {
    const terms = [...new Set((Array.isArray(g) ? g : typeof g === 'string' ? g.split(',') : bad('each synonym group is a list of words'))
      .map((t) => searchWords(clean(t)).join(' ')).filter(Boolean))];
    if (terms.length === 0) continue;
    if (terms.length < 2) bad(`"${terms[0]}" needs at least one other word in its group`);
    if (terms.length > 10) bad('at most 10 words in a synonym group');
    if (terms.some((t) => t.length > 40 || t.split(' ').length > 3)) bad('synonyms are single words or phrases of up to 3 words');
    synonyms.push(terms);
  }
  if (synonyms.length > 200) bad('at most 200 synonym groups');
  return { pinned, hidden, synonyms };
}

export function readSearchSettings(raw: unknown): SearchSettings {
  try { return parseSearchSettings(raw); } catch { return NO_SEARCH_SETTINGS; }
}

/**
 * For each word of the search that has synonyms: the other terms of its groups (words or phrases).
 * Only single words trigger an expansion. Plain object so it can be part of a cache key.
 */
export function expansions(q: string, groups: string[][]): Record<string, string[]> | undefined {
  if (!groups.length) return undefined;
  const out: Record<string, string[]> = {};
  for (const w of searchWords(q)) {
    const alts = new Set<string>();
    for (const g of groups) if (g.includes(w)) for (const t of g) if (t !== w) alts.add(t);
    if (alts.size) out[w] = [...alts].slice(0, 12);
  }
  return Object.keys(out).length ? out : undefined;
}

// ------------------------------------------------------------------ search log

/**
 * How a search is stored in the log and shown as a popular search: trimmed, single spaces, lower case.
 * null = not logged: too short or long, or it looks like personal data (an email, a phone or card number, a link).
 */
export function logKey(q: string): string | null {
  const k = clean(q).toLowerCase().slice(0, 100);
  if (k.length < 2 || k.split(' ').length > 8) return null;
  if (/@|https?:|www\.|\.(com|qa|net|org)\b/.test(k)) return null;
  if (/\d{6,}/.test(k.replace(/[\s\-+().]/g, ''))) return null;
  return k;
}

// ------------------------------------------------------------------ spelling

/** Optimal-string-alignment distance (a swap of two neighbours counts as 1), giving up above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const A = [...a], B = [...b];
  let prev2: number[] = [], prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[B.length];
}

/** The words the catalogue uses, for "Did you mean …?". Keys are normalised; each keeps its most common written form. */
export class Vocabulary {
  private readonly count = new Map<string, number>();
  private readonly shown = new Map<string, string>();
  private readonly byLength = new Map<number, string[]>();

  constructor(entries: { word: string; ndoc: number }[]) {
    const best = new Map<string, number>();
    for (const { word, ndoc } of entries) {
      for (const w of searchWords(word)) {
        this.count.set(w, (this.count.get(w) ?? 0) + ndoc);
        if (ndoc > (best.get(w) ?? -1)) { best.set(w, ndoc); this.shown.set(w, word.toLowerCase()); }
      }
    }
    for (const w of this.count.keys()) {
      const n = [...w].length;
      if (!this.byLength.has(n)) this.byLength.set(n, []);
      this.byLength.get(n)!.push(w);
    }
  }

  get size() { return this.count.size; }
  has(w: string) { return this.count.has(w); }

  /** Closest catalogue word to a word the catalogue does not use; null when it is known, too short, has digits, or nothing is close. */
  correct(w: string): string | null {
    const n = [...w].length;
    if (n < 3 || /\d/.test(w) || this.has(w)) return null;
    const max = n <= 4 ? 1 : 2;
    let best: { w: string; score: number; ndoc: number } | null = null;
    for (let len = n - max; len <= n + max; len++) {
      for (const cand of this.byLength.get(len) ?? []) {
        const d = editDistance(w, cand, max);
        if (d > max) continue;
        const score = d + (cand[0] === w[0] ? 0 : 0.5); // first letters are rarely mistyped
        const ndoc = this.count.get(cand)!;
        if (!best || score < best.score || (score === best.score && ndoc > best.ndoc)) best = { w: cand, score, ndoc };
      }
    }
    return best ? best.w : null;
  }

  /** The whole search with unknown words corrected, in their usual written form; null when nothing changed. */
  correctQuery(q: string): string | null {
    let changed = false;
    const out = q.trim().split(/\s+/).map((part) => {
      const words = searchWords(part);
      if (words.length !== 1) return part.toLowerCase();
      const fix = this.correct(words[0]);
      if (!fix) return part.toLowerCase();
      changed = true;
      return this.shown.get(fix) ?? fix;
    });
    return changed ? out.join(' ') : null;
  }
}
