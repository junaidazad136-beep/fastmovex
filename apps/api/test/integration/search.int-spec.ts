/**
 * Search on a real database: spelling correction ("Showing results for …" / "Did you mean …?"), Arabic letter forms,
 * staff synonyms, the anonymous search log, popular searches (pinned, hidden, distinct visitors), type-ahead,
 * the "no results" help and the staff report.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SearchInsights } from '../../src/search/search-insights.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
// letters only: a tag of digits could look like a phone number, which the log refuses on purpose
const tag = randomBytes(4).toString('hex').replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
interface Result { total: number; items: { id: string }[]; query: { q: string; matchMode?: string }; spelling?: { original: string; corrected: string; auto: boolean }; noResults?: { popular: string[]; products: unknown[] } }

describe('Search — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let insights: SearchInsights;
  let original: unknown;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const word = `quillon${tag}`;
  const search = async (q: string, extra: Record<string, string> = {}) => (await api().get('/api/v1/search').query({ q, ...extra }).expect(200)).body as Result;
  const has = (r: Result) => r.items.some((i) => i.id === s.product);
  const log = (q: string, total: number, ua: string) => api().post('/api/v1/search/log').set('user-agent', ua).send({ q, total }).expect(204);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    insights = app.get(SearchInsights);
    original = (await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } })).searchSettings;
    s.admin = await (async () => (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }).expect(200)).body.accessToken as string)();

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Zorvex ${word} Desk Lamp`, titleAr: 'مصباح الزورفكس المكتبي', categoryId: cat.id, variants: [{ sku: `SRCH-${tag}`, priceMinor: '4500', initialStock: 10 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.product = p.body.id;
    insights.resetVocabulary(); // the new product's words
  });

  afterAll(async () => {
    await prisma?.country.update({ where: { code: 'QA' }, data: { searchSettings: (original ?? {}) as object } }).catch(() => undefined);
    await prisma?.searchLog.deleteMany({ where: { query: { contains: tag } } }).catch(() => undefined);
    await app?.close();
  });

  it('finds the product by its words, in either language', async () => {
    expect(has(await search(word))).toBe(true);
    expect(has(await search('زورفكس'))).toBe(true); // without the article
    expect(has(await search('الزّورفكس'))).toBe(true); // with a shadda
    expect(has(await search('مكتبى'))).toBe(true); // alef maqsura typed for ya
  });

  it('a typo with no matches shows results for the correction, and can be searched exactly instead', async () => {
    const typo = word.slice(0, 5) + word.slice(6); // one letter missing
    const r = await search(`zorvex ${typo}`);
    expect(r.spelling).toEqual({ original: `zorvex ${typo}`, corrected: `zorvex ${word}`, auto: true });
    expect(r.query.q).toBe(`zorvex ${word}`);
    expect(has(r)).toBe(true);

    const exact = await search(`zorvex ${typo}`, { spell: 'false' });
    expect(exact.spelling).toMatchObject({ corrected: `zorvex ${word}`, auto: false }); // "Did you mean …?"
    expect(exact.query.q).toBe(`zorvex ${typo}`);
  });

  it('staff synonyms make other words find the product; bad settings are refused', async () => {
    const other = `glimmer${tag}`;
    expect(has(await search(other))).toBe(false);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ searchSettings: { synonyms: [['alone']] } }).expect(400);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ searchSettings: { synonyms: [[other, `zorvex`, 'ضياء']], pinned: [`lamp ${tag}`] } }).expect(200);
    const r = await search(other);
    expect(has(r)).toBe(true);
    expect(r.spelling).toBeUndefined();
    expect(has(await search(`${other} desk`))).toBe(true); // every other word still has to match
    expect(has(await search('ضياء'))).toBe(true);
  });

  it('the log counts searches anonymously; a search needs 3 different visitors to become popular', async () => {
    const q = `zorvex ${tag}`;
    await log(q, 4, 'browser-a');
    await log(q, 4, 'browser-a'); // same visitor again
    await log(q, 4, 'browser-b');
    await log('sara@example.com', 0, 'browser-a'); // looks like personal data: never stored
    await insights.flush();
    await insights.forget('QA');
    const row = await prisma.searchLog.findFirstOrThrow({ where: { countryCode: 'QA', query: q } });
    expect(row).toMatchObject({ searches: 3, visitors: 2, zeroResults: 0, lastTotal: 4 });
    expect(await prisma.searchLog.count({ where: { query: { contains: '@' } } })).toBe(0);
    expect((await api().get('/api/v1/search/popular').expect(200)).body.queries).not.toContain(q);

    await log(q, 4, 'browser-c');
    // the third visitor makes it eligible; a few more lift it above searches other test runs left in a shared database
    for (let i = 0; i < 40; i++) await log(q, 4, `browser-x${i}`);
    await insights.flush();
    await insights.forget('QA');
    const popular = (await api().get('/api/v1/search/popular').expect(200)).body.queries as string[];
    expect(popular[0]).toBe(`lamp ${tag}`); // pinned by staff comes first
    expect(popular).toContain(q);
    // and the search box offers it while typing
    const suggest = (await api().get('/api/v1/search/suggest').query({ q: `zorvex ${tag.slice(0, 3)}` }).expect(200)).body;
    expect(suggest.queries).toContain(q);
  });

  it('staff can hide a popular search', async () => {
    const q = `zorvex ${tag}`;
    const now = (await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } })).searchSettings as object;
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ searchSettings: { ...now, hidden: [q.toUpperCase()] } }).expect(200);
    expect((await api().get('/api/v1/search/popular').expect(200)).body.queries).not.toContain(q);
  });

  it('nothing found: popular searches and best sellers instead of a dead end; reported to staff', async () => {
    const none = `nothingmatches ${tag} xq`;
    const r = await search(none);
    expect(r.total).toBe(0);
    expect(r.noResults?.popular[0]).toBe(`lamp ${tag}`);
    expect(r.noResults?.products.length).toBeGreaterThan(0);
    await log(none, 0, 'browser-z');

    const report = (await api().get('/api/v1/admin/search/report').query({ days: 7 }).set(bearer(s.admin)).expect(200)).body;
    expect(report.totals.searches).toBeGreaterThanOrEqual(5);
    expect(report.zeroResults.map((x: { query: string }) => x.query)).toContain(none);
    expect(report.top.find((x: { query: string }) => x.query === `zorvex ${tag}`)).toMatchObject({ searches: 44, visitors: 43, hidden: true });
    expect(report.settings.synonyms[0]).toContain(`glimmer${tag}`);
    // staff without the analytics permission cannot read it
    const buyer = (await api().post('/api/v1/auth/register').send({ fullName: 'Search Buyer', email: `search.${tag}@jovia.test`, password: 'Buyer-Pass-123' }).expect(201)).body.accessToken;
    await api().get('/api/v1/admin/search/report').set(bearer(buyer)).expect(403);
  });
});
