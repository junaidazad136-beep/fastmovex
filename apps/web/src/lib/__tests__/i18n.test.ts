import { describe, expect, it } from 'vitest';
import { dirOf, negotiateLocale } from '../i18n/config';
import ar from '../i18n/messages/ar';
import en from '../i18n/messages/en';
import { createTranslator, interpolate } from '../i18n/translate';

type Tree = { [k: string]: string | Tree };
function leaves(t: Tree, prefix = ''): Map<string, string | Tree> {
  const out = new Map<string, string | Tree>();
  for (const [k, v] of Object.entries(t)) {
    const p = prefix ? `${prefix}.${k}` : k;
    const isPlural = typeof v === 'object' && 'other' in v && Object.keys(v).every((x) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(x));
    if (typeof v === 'string' || isPlural) out.set(p, v);
    else for (const [pk, pv] of leaves(v as Tree, p)) out.set(pk, pv);
  }
  return out;
}
const placeholders = (v: string | Tree) => new Set(JSON.stringify(v).match(/\{\w+\}/g) ?? []);

describe('translations', () => {
  const E = leaves(en as unknown as Tree);
  const A = leaves(ar as unknown as Tree);

  it('Arabic has exactly the English keys', () => {
    expect([...A.keys()].sort()).toEqual([...E.keys()].sort());
  });

  it('no empty strings, and the same placeholders in both languages', () => {
    for (const [k, v] of E) {
      const a = A.get(k)!;
      expect(JSON.stringify(v).includes('""'), `en ${k} empty`).toBe(false);
      expect(JSON.stringify(a).includes('""'), `ar ${k} empty`).toBe(false);
      // Arabic plural forms may spell out small numbers instead of {count}; every other placeholder must match.
      const pe = [...placeholders(v)].filter((p) => p !== '{count}');
      const pa = [...placeholders(a)].filter((p) => p !== '{count}');
      expect(new Set(pa), k).toEqual(new Set(pe));
    }
  });

  it('interpolates and falls back to the key for missing entries', () => {
    const t = createTranslator('en', en);
    expect(t('nav.hello', { name: 'Sara' })).toBe('Hello, Sara');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect((t as unknown as (p: string) => string)('does.not.exist')).toBe('does.not.exist');
  });

  it('uses the right plural form, including Arabic dual and few/many', () => {
    const te = createTranslator('en', en);
    const ta = createTranslator('ar', ar as unknown as typeof en);
    expect(te.plural('common.items', 1)).toBe('1 item');
    expect(te.plural('common.items', 3)).toBe('3 items');
    expect(ta.plural('common.items', 1)).toBe('منتج واحد');
    expect(ta.plural('common.items', 2)).toBe('منتجان');
    expect(ta.plural('common.items', 3)).toBe('3 منتجات');
    expect(ta.plural('common.items', 11)).toBe('11 منتجاً');
    expect(ta.plural('common.items', 100)).toBe('100 منتج');
    expect(ta.plural('search.count', 0)).toBe('لا توجد منتجات');
  });

  it('negotiates the language from the browser and sets text direction', () => {
    expect(negotiateLocale('ar-QA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
    expect(negotiateLocale('fr-FR,ar;q=0.5')).toBe('ar');
    expect(negotiateLocale('de-DE')).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});
