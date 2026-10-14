import { createHash } from 'crypto';

/**
 * Pure helpers for automatic English ⇄ Arabic product text. No network here: the planner decides WHAT to
 * translate, `toXml` / `fromXml` prepare text so the translator leaves brand names, model numbers and units alone.
 */

export type Lang = 'en' | 'ar';

/** What the machine wrote into a field, and from which source text (so a changed source is noticed). */
export type AutoText = Record<string, { text: string; src: string }>;

const ARABIC_WORD = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
const LATIN_WORD = /[A-Za-z]+/g;

/** Mostly Arabic words (a brand in Latin inside Arabic text still counts as Arabic). */
export function isArabic(text: string | null | undefined): boolean {
  if (!text) return false;
  const ar = text.match(ARABIC_WORD)?.length ?? 0;
  const en = text.match(LATIN_WORD)?.length ?? 0;
  return ar > 0 && ar >= en;
}

export const hashText = (text: string) => createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export interface Job { field: string; from: Lang; source: string }
export interface Plan { jobs: Job[]; auto: AutoText; set: Record<string, string | null> }

/**
 * Decides, for each [english, arabic] field pair, which side the machine should write.
 * - empty Arabic → written from the English (and the other way round);
 * - a side the machine wrote earlier is rewritten when its source changed;
 * - a side the seller typed or corrected by hand is never touched again;
 * - Arabic typed into the English box moves to the Arabic box, and the English is written from it.
 */
export function planPairs(row: Record<string, unknown>, pairs: [en: string, ar: string][], current: AutoText): Plan {
  const auto: AutoText = { ...current };
  const set: Record<string, string | null> = {};
  const jobs: Job[] = [];
  for (const [en, ar] of pairs) {
    let E = clean(row[en]);
    let A = clean(row[ar]);
    // someone changed what the machine wrote: from now on that text is theirs
    if (auto[ar] && A !== auto[ar].text) delete auto[ar];
    if (auto[en] && E !== auto[en].text) delete auto[en];
    // the English was removed: the machine's Arabic of it goes too (and the other way round)
    if (!E && auto[ar]) { set[ar] = null; A = ''; delete auto[ar]; }
    if (!A && auto[en]) { set[en] = null; E = ''; delete auto[en]; }

    if (E && isArabic(E) && !auto[en]) {
      // Arabic in the English box
      if (!A || auto[ar]) { set[ar] = E; A = E; delete auto[ar]; }
      jobs.push({ field: en, from: 'ar', source: A });
    } else if (E && (!A || (auto[ar] && auto[ar].src !== hashText(E)))) {
      jobs.push({ field: ar, from: 'en', source: E });
    } else if (A && (!E || (auto[en] && auto[en].src !== hashText(A)))) {
      jobs.push({ field: en, from: 'ar', source: A });
    }
  }
  return { jobs, auto, set };
}

/** Option words that stay as they are in both languages: sizes, numbers with units, codes. */
export function keepAsIs(term: string): boolean {
  const t = term.trim();
  if (!t || isArabic(t)) return true;
  if (/^[\d\s.,/×x+\-–]+(cm|mm|m|ml|l|g|kg|gb|tb|mb|w|v|mah|hz|in|inch|"|%|eu|uk|us)?$/i.test(t)) return true;
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl)$/i.test(t)) return true;
  if (/^[A-Z0-9][A-Z0-9\-+/ ]{0,10}$/.test(t)) return true; // USB-C, PRO, 5G
  return false;
}

/** The option names and values of a product's variants that need an Arabic word. */
export function optionTerms(variants: { optionValues: unknown }[]): string[] {
  const out = new Set<string>();
  for (const v of variants) {
    for (const [k, val] of Object.entries((v.optionValues ?? {}) as Record<string, unknown>)) {
      out.add(String(k).trim());
      out.add(String(val).trim());
    }
  }
  return [...out].filter((t) => t && !keepAsIs(t));
}

// ------------------------------------------------------------------ text ⇄ translator markup

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Marks what must not be translated with <k>…</k> (the translator is told to leave <k> alone):
 * the brand, model numbers and sizes (anything with a digit), short ALL-CAPS words (USB, LED, USB-C), CamelCase names
 * (PowerCore, iPhone), links; and in Arabic text every Latin word. **bold** becomes <b>…</b> so it survives.
 */
export function toXml(text: string, from: Lang, keep: string[] = []): string {
  let s = escapeXml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m) => `\u0001${m}\u0002`); // links stay whole
  const names = keep.map((k) => k.trim()).filter((k) => k.length > 1).sort((a, b) => b.length - a.length);
  if (names.length) s = s.replace(new RegExp(`(?<![\\p{L}\\p{N}])(${names.map((n) => escapeRe(escapeXml(n))).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), '\u0001$1\u0002');
  const token = from === 'ar'
    ? /(?<![\p{L}\p{N}\u0001])([A-Za-z][\w\-+./]*(?:\s+[A-Za-z0-9][\w\-+./]*)*)/gu
    : /(?<![\p{L}\p{N}\u0001])((?:[A-Za-z]*\d[\w\-+./]*)|(?:[A-Z]{2,5}(?:[\-+][A-Z0-9]+)*)|(?:[a-z]+[A-Z][\w]*)|(?:[A-Z][a-z]+[A-Z][\w]*))(?![\p{L}\p{N}])/gu;
  s = s.split(/(\u0001[^\u0002]*\u0002)/).map((part) => (part.startsWith('\u0001') ? part : part.replace(token, '\u0001$1\u0002'))).join('');
  s = s.replace(/\u0001/g, '<k>').replace(/\u0002/g, '</k>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return s;
}

export function fromXml(xml: string): string {
  return unescapeXml(xml.replace(/<b>([\s\S]*?)<\/b>/g, '**$1**').replace(/<\/?k>/g, '')).replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Splits page text into the pieces worth translating, keeping blank lines, "- " bullets and "## " headings as they
 * are, so the translation has exactly the same layout.
 */
export function splitLines(text: string): { prefix: string; body: string }[] {
  return text.replace(/\r\n/g, '\n').split('\n').map((line) => {
    const m = /^(\s*(?:[-•*] |#{2,3} |\d+[.)] )?)([\s\S]*)$/.exec(line)!;
    return { prefix: m[1], body: m[2] };
  });
}

export const worthTranslating = (s: string) => /[\p{L}]/u.test(s);
