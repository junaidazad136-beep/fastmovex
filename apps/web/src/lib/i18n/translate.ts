import type { Locale } from './config';
import { intlLocale } from './config';

/** Nested dictionary. A plural entry is an object keyed by Intl plural category. */
export type PluralForms = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
export interface Dict { [key: string]: string | PluralForms | Dict }

/** Same shape as the source dictionary, but every plural entry may use all six plural categories. */
type PluralKey = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
/** An object is a plural entry when it has "other" and nothing but plural categories. */
type IsPlural<V> = V extends { other: string } ? (Exclude<keyof V, PluralKey> extends never ? true : false) : false;

export type Localized<T> = {
  [K in keyof T]: T[K] extends string ? string : IsPlural<T[K]> extends true ? PluralForms : Localized<T[K]>;
};

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
/** Every leaf path of the dictionary, e.g. "cart.title". Plural entries count as leaves. */
export type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : IsPlural<T[K]> extends true ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];

export type Vars = Record<string, string | number>;

function lookup(dict: Dict, path: string): string | PluralForms | undefined {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Dict)) cur = (cur as Dict)[part];
    else return undefined;
  }
  return cur as string | PluralForms | undefined;
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export interface Translator<D extends Dict> {
  (path: Paths<D>, vars?: Vars): string;
  /** Plural-aware lookup: picks the right form for `count` in this language (Arabic has six). */
  plural(path: Paths<D>, count: number, vars?: Vars): string;
  locale: Locale;
}

export function createTranslator<D extends Dict>(locale: Locale, dict: D): Translator<D> {
  const rules = new Intl.PluralRules(intlLocale(locale));
  const t = (path: string, vars?: Vars): string => {
    const v = lookup(dict, path);
    if (typeof v === 'string') return interpolate(v, vars);
    if (v && typeof v === 'object' && 'other' in v) return interpolate(String(v.other), vars);
    return path; // visible, greppable fallback for a missing key (tests fail on these)
  };
  const plural = (path: string, count: number, vars?: Vars): string => {
    const v = lookup(dict, path);
    const all = { count, ...vars };
    if (typeof v === 'string') return interpolate(v, all);
    if (!v || typeof v !== 'object') return path;
    const forms = v as PluralForms;
    const cat = count === 0 && forms.zero ? 'zero' : (rules.select(count) as keyof PluralForms);
    return interpolate(forms[cat] ?? forms.other, all);
  };
  return Object.assign(t, { plural, locale }) as unknown as Translator<D>;
}
