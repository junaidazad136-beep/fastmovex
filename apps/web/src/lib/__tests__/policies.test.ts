import { describe, expect, it } from 'vitest';
import { POLICIES, policy, type PolicyKind } from '../policies';

const kinds = Object.keys(POLICIES) as PolicyKind[];
const text = (k: PolicyKind, l: 'en' | 'ar') => JSON.stringify(policy(k, l));

describe('policies (English and Arabic)', () => {
  it('has returns, terms, privacy and seller policies', () => {
    expect(kinds.sort()).toEqual(['privacy', 'returns', 'seller', 'terms']);
  });

  it.each(kinds)('%s: Arabic has the same sections, lists, steps and table shape as English', (k) => {
    const en = policy(k, 'en');
    const ar = policy(k, 'ar');
    expect(ar.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id));
    expect(ar.updated).toBe(en.updated);
    en.sections.forEach((s, i) => {
      const a = ar.sections[i];
      expect(a.list?.length, `${k}.${s.id} list`).toBe(s.list?.length);
      expect(a.steps?.length, `${k}.${s.id} steps`).toBe(s.steps?.length);
      expect(a.p?.length, `${k}.${s.id} p`).toBe(s.p?.length);
      expect(!!a.note).toBe(!!s.note);
      expect(a.table?.head.length).toBe(s.table?.head.length);
      expect(a.table?.rows.length).toBe(s.table?.rows.length);
      a.table?.rows.forEach((r) => expect(r.length).toBe(a.table!.head.length));
    });
    expect(text(k, 'ar')).toMatch(/[؀-ۿ]/);
  });

  it.each(kinds)('%s: links point at pages that exist, the same in both languages', (k) => {
    const links = (l: 'en' | 'ar') => [...text(k, l).matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]).sort();
    expect(links('ar')).toEqual(links('en'));
    for (const href of links('en')) expect(['/help/returns', '/contact', '/help', '/terms', '/privacy']).toContain(href);
  });

  it('matches how the platform works: 14-day payouts, QAR 50 minimum, delivery code, data download and deletion', () => {
    expect(text('seller', 'en')).toContain('within 14 days of delivery');
    expect(text('seller', 'en')).toContain('QAR 50');
    expect(text('terms', 'en')).toContain('4-digit delivery code');
    expect(text('privacy', 'en')).toContain('Download my data');
    expect(text('privacy', 'en')).toContain('14 days to change your mind');
    expect(text('privacy', 'en')).toContain('Law No. 13 of 2016');
  });
});
