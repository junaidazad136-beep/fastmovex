import { BadRequestException } from '@nestjs/common';
import { MemoryCacheService } from '../src/cache/cache.service';
import { anyWordQuery } from '../src/search/postgres-search.engine';
import { SearchInsights } from '../src/search/search-insights.service';
import { editDistance, expansions, logKey, normalizeSearch, parseSearchSettings, readSearchSettings, searchWords, Vocabulary } from '../src/search/search-text';
import { SearchService } from '../src/search/search.service';

describe('search text', () => {
  it('Arabic letter forms, harakat and the article are normalised (same rules as the database)', () => {
    expect(normalizeSearch('أحذيةٌ')).toBe('احذيه');
    expect(normalizeSearch('إبريق الشايِ')).toBe('ابريق شاي');
    expect(normalizeSearch('مستشفى')).toBe('مستشفي');
    expect(normalizeSearch('القهوة')).toBe(normalizeSearch('قهوه'));
    expect(normalizeSearch('ال')).toBe('ال'); // a lone article is a word, not a prefix
    expect(normalizeSearch('ok-الشاي ٣٤٥')).toBe('ok-شاي ٣٤٥'); // Arabic-Indic digits stay
    expect(searchWords('Oud  OUD, perfume!')).toEqual(['oud', 'perfume']);
  });

  it('synonym groups become alternatives for the words typed', () => {
    const groups = parseSearchSettings({ synonyms: [['Mobile', 'phone', 'جوال'], 'air fryer, مقلاة هوائية'] }).synonyms;
    expect(groups).toEqual([['mobile', 'phone', 'جوال'], ['air fryer', 'مقلاه هوائيه']]);
    expect(expansions('mobile case', groups)).toEqual({ mobile: ['phone', 'جوال'] });
    expect(expansions('case', groups)).toBeUndefined();
    expect(anyWordQuery('mobile case', 'and', { mobile: ['phone', 'air fryer'] })).toBe("('mobile' | 'phone' | ('air' <-> 'fryer')) & 'case'");
    expect(anyWordQuery('mobile case', 'or', { mobile: ['phone'] })).toBe("'mobile' | 'phone' | 'case'");
    expect(anyWordQuery("x'); DROP TABLE x;--", 'and')).toBe("'x' & 'drop' & 'table'"); // nothing but quoted words
  });

  it('search settings are checked', () => {
    expect(parseSearchSettings({})).toEqual({ pinned: [], hidden: [], synonyms: [] });
    expect(parseSearchSettings({ pinned: ['  Oud ', 'Oud', 'dates'], hidden: ['Bad  Word'] })).toEqual({ pinned: ['Oud', 'dates'], hidden: ['bad word'], synonyms: [] });
    for (const bad of [{ pinned: 'x' }, { pinned: Array.from({ length: 11 }, (_, i) => `term ${i}`) }, { pinned: ['x'] }, { synonyms: [['alone']] }, { synonyms: [['a phrase that is far too long']] }]) {
      expect(() => parseSearchSettings(bad)).toThrow(BadRequestException);
    }
    expect(readSearchSettings({ pinned: 'broken' })).toEqual({ pinned: [], hidden: [], synonyms: [] });
  });

  it('the log never keeps anything that looks like personal data', () => {
    expect(logKey('  Oud   Perfume ')).toBe('oud perfume');
    expect(logKey('a')).toBeNull();
    expect(logKey('sara@example.com')).toBeNull();
    expect(logKey('+974 5555 1234')).toBeNull();
    expect(logKey('4111 1111 1111 1111')).toBeNull();
    expect(logKey('https://evil.example')).toBeNull();
    expect(logKey('one two three four five six seven eight nine')).toBeNull();
    expect(logKey('iphone 15 pro 256gb')).toBe('iphone 15 pro 256gb'); // model numbers are fine
  });
});

describe('spelling', () => {
  const vocab = new Vocabulary([
    { word: 'earbuds', ndoc: 4 }, { word: 'wireless', ndoc: 9 }, { word: 'charger', ndoc: 6 }, { word: 'dates', ndoc: 3 },
    { word: 'khalas', ndoc: 2 }, { word: 'القهوة', ndoc: 5 }, { word: 'cable', ndoc: 7 }, { word: 'table', ndoc: 1 }, { word: 'phone', ndoc: 3 },
  ]);

  it('edit distance counts a swap of neighbours as one', () => {
    expect(editDistance('wirless', 'wireless', 2)).toBe(1);
    expect(editDistance('chrager', 'charger', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2); // gave up above the limit
  });

  it('corrects unknown words to the closest, most used catalogue word, in its usual spelling', () => {
    expect(vocab.correctQuery('wirless chargr')).toBe('wireless charger');
    expect(vocab.correctQuery('Erbuds')).toBe('earbuds');
    expect(vocab.correctQuery('قهوا')).toBe('القهوة');
    expect(vocab.correctQuery('cabel')).toBe('cable'); // swap
    expect(vocab.correctQuery('xable')).toBe('cable'); // same distance as "table": more products use "cable"
  });

  it('leaves known words, short words, numbers and far-off words alone', () => {
    expect(vocab.correctQuery('wireless charger')).toBeNull();
    expect(vocab.correctQuery('القهوة')).toBeNull(); // known after normalising
    expect(vocab.correctQuery('ok')).toBeNull();
    expect(vocab.correctQuery('x12')).toBeNull();
    expect(vocab.correctQuery('zzzzzz')).toBeNull();
    expect(vocab.correct('dtes')).toBe('dates'); // 4 letters: one edit allowed
    expect(vocab.correct('dts')).toBeNull(); // 3 letters, two edits away
  });
});

describe('search log and popular searches', () => {
  const build = (rows: { query: string; last: number }[] = [], settings: object = {}) => {
    const executeRaw = jest.fn();
    const prisma = { $executeRaw: executeRaw, $queryRaw: jest.fn().mockResolvedValue(rows), country: { findUnique: jest.fn().mockResolvedValue({ searchSettings: settings }) } };
    return { svc: new SearchInsights(prisma as never, new MemoryCacheService(), {} as never), executeRaw };
  };

  it('counts searches and distinct visitors in memory, then writes one row per search per day', async () => {
    const { svc, executeRaw } = build();
    const at = new Date('2026-10-01T10:00:00Z');
    expect(svc.record('QA', 'Oud', 12, false, 'ip1|ua', at)).toBe(true);
    svc.record('QA', ' oud ', 12, false, 'ip1|ua', at); // same visitor
    svc.record('QA', 'oud', 0, true, 'ip2|ua', at);
    expect(svc.record('QA', 'sara@example.com', 0, false, 'ip1|ua', at)).toBe(false);
    expect(await svc.flush()).toBe(1);
    const values = executeRaw.mock.calls[0][0].values;
    expect(values).toEqual(['QA', '2026-10-01', 'oud', 3, 2, 1, 1, 0]);
    expect(await svc.flush()).toBe(0); // nothing new
  });

  it('popular: pinned first, then the most used, never hidden ones', async () => {
    const { svc } = build([{ query: 'oud', last: 5 }, { query: 'bad word', last: 3 }, { query: 'dates', last: 9 }], { pinned: ['Eid gifts', 'Oud'], hidden: ['bad word'] });
    expect(await svc.popular('QA')).toEqual(['Eid gifts', 'Oud', 'dates']);
    expect(await svc.matching('QA', 'da')).toEqual(['dates']);
    expect(await svc.matching('QA', 'gif')).toEqual(['eid gifts']); // matches the start of any word
    expect(await svc.matching('QA', 'bad')).toEqual([]);
  });
});

describe('search with spelling', () => {
  const QA = { code: 'QA', currencyCode: 'QAR', vatRateBps: 0, pricesIncludeTax: true, defaultLocale: 'en', minorUnits: 2 } as never;
  const make = (byQuery: Record<string, { all: number; any?: number }>, correct: string | null) => {
    const calls: string[] = [];
    const engine = {
      search: jest.fn(async (p: { q?: string; matchMode?: string; limit: number }) => {
        calls.push(`${p.q}:${p.matchMode ?? 'auto'}`);
        const r = byQuery[p.q ?? ''] ?? { all: 0 };
        if (p.matchMode === 'all' || r.all >= 10 || !p.q) return { ids: Array.from({ length: Math.min(r.all, p.limit) }, (_, i) => `${p.q}-${i}`), total: r.all, matchMode: 'all' };
        const n = r.any ?? r.all; // the loose search also finds the precise matches
        return { ids: Array.from({ length: Math.min(n, p.limit) }, (_, i) => `${p.q}~${i}`), total: n, matchMode: 'any' };
      }),
      facets: jest.fn().mockResolvedValue({ categories: [], brands: [], price: { minMinor: null, maxMinor: null } }),
    };
    const insights = { correct: jest.fn().mockResolvedValue(correct), settings: jest.fn().mockResolvedValue({ pinned: [], hidden: [], synonyms: [] }), popular: jest.fn().mockResolvedValue(['dates']) };
    const cards = { hydrate: jest.fn(async (ids: string[]) => ids.map((id) => ({ id }))) };
    return { svc: new SearchService(engine as never, cards as never, {} as never, new MemoryCacheService(), insights as never), calls };
  };

  it('nothing matches what was typed: results for the correction instead', async () => {
    const { svc } = make({ erbuds: { all: 0, any: 0 }, earbuds: { all: 3 } }, 'earbuds');
    const r = await svc.search({ q: 'erbuds' }, QA);
    expect(r).toMatchObject({ total: 3, spelling: { original: 'erbuds', corrected: 'earbuds', auto: true }, query: { q: 'earbuds' } });
    expect(r.noResults).toBeUndefined();
  });

  it('"search instead for" turns the correction into a suggestion', async () => {
    const { svc } = make({ erbuds: { all: 0, any: 0 }, earbuds: { all: 3 } }, 'earbuds');
    const r = await svc.search({ q: 'erbuds', spell: false }, QA);
    expect(r).toMatchObject({ total: 0, spelling: { corrected: 'earbuds', auto: false }, noResults: { popular: ['dates'] } });
  });

  it('only loose matches, while the correction matches every word: auto; loose and precise: a suggestion', async () => {
    const a = make({ ipone: { all: 0, any: 2 }, phone: { all: 4 } }, 'phone');
    expect(await a.svc.search({ q: 'ipone' }, QA)).toMatchObject({ total: 4, spelling: { auto: true }, query: { q: 'phone', matchMode: 'all' } });
    const b = make({ 'oud set': { all: 1, any: 6 }, 'oud sets': { all: 5 } }, 'oud sets');
    expect(await b.svc.search({ q: 'oud set' }, QA)).toMatchObject({ total: 6, spelling: { corrected: 'oud sets', auto: false }, query: { q: 'oud set' } });
  });

  it('plenty of precise matches never pays for a spelling check', async () => {
    const { svc, calls } = make({ dates: { all: 40 } }, 'dates');
    const r = await svc.search({ q: 'dates' }, QA);
    expect(r.spelling).toBeUndefined();
    expect(calls).toEqual(['dates:auto']);
  });

  it('a dead end gets popular searches and best sellers', async () => {
    const { svc } = make({ zzz: { all: 0, any: 0 } }, null);
    const r = await svc.search({ q: 'zzz' }, QA);
    expect(r.total).toBe(0);
    expect(r.noResults?.popular).toEqual(['dates']);
  });
});
