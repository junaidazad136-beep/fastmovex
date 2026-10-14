/**
 * PHASE 31 on a real database: sellers write in one language, the shop gets both. Runs with the stand-in translator
 * (it writes "عربي <text>" / "EN <text>"), so what is translated, kept or moved is plain to see.
 */
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import type { PrismaService as PrismaServiceT } from '../../src/prisma/prisma.service';
import type { TranslationService as TranslationServiceT } from '../../src/translation/translation.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const run = randomBytes(3).toString('hex');

describe('Phase 31 — automatic Arabic (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceT;
  let translation: TranslationServiceT;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;
  const s: Record<string, string> = {};

  beforeAll(async () => {
    // the stand-in translator, and no background pass over the shared test data
    process.env.TRANSLATE_PROVIDER = 'fake';
    process.env.TRANSLATE_SWEEP = 'off';
    const [{ Test }, { AppModule }, { configureApp }, { PrismaService }, { TranslationService }] = await Promise.all([
      import('@nestjs/testing'), import('../../src/app.module'), import('../../src/app.setup'), import('../../src/prisma/prisma.service'), import('../../src/translation/translation.service'),
    ]);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    translation = app.get(TranslationService);
    s.admin = await login('admin@demo.fastmovex.test');
    s.gadgets = await login('seller.gadgets@demo.fastmovex.test');
    s.cat = (await prisma.category.findUniqueOrThrow({ where: { slug: 'electronics' } })).id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('a seller writes only English: the Arabic title, line, description and option words are written at once', async () => {
    const r = await api().post('/api/v1/seller/products').set(bearer(s.gadgets)).send({
      title: `Travel Mug 500ml ${run}`, categoryId: s.cat, shortDescription: 'Keeps coffee hot',
      description: '## Features\n- Keeps drinks hot for 12 hours\n\nMade with **steel**',
      variants: [{ sku: `P31-B-${run}`, priceMinor: '4900', initialStock: 5, optionValues: { Colour: 'Black', Size: 'M' } }, { sku: `P31-W-${run}`, priceMinor: '4900', initialStock: 5, optionValues: { Colour: 'White', Size: 'M' } }],
    }).expect(201);
    s.mug = r.body.id;
    expect(r.body.titleAr).toBe(`عربي Travel Mug 500ml ${run}`);
    expect(r.body.shortDescriptionAr).toBe('عربي Keeps coffee hot');
    // layout kept: heading, bullet, blank line; the 12 stays a number; bold survives
    expect(r.body.descriptionAr).toBe('## عربي Features\n- عربي Keeps drinks hot for 12 hours\n\nعربي Made with **steel**');
    expect(Object.keys(r.body.autoText).sort()).toEqual(['descriptionAr', 'shortDescriptionAr', 'titleAr']);
    expect(r.body.optionsAr).toEqual({ Colour: 'عربي Colour', Black: 'عربي Black', Size: 'عربي Size', White: 'عربي White' }); // "M" stays M
  });

  it('a changed English updates the machine Arabic; Arabic the seller corrected is never touched again', async () => {
    const changed = await api().patch(`/api/v1/seller/products/${s.mug}`).set(bearer(s.gadgets)).send({ title: `Travel Mug 750ml ${run}` }).expect(200);
    expect(changed.body.titleAr).toBe(`عربي Travel Mug 750ml ${run}`);

    const mine = await api().patch(`/api/v1/seller/products/${s.mug}`).set(bearer(s.gadgets)).send({ titleAr: 'كوب سفر حراري' }).expect(200);
    expect(mine.body.titleAr).toBe('كوب سفر حراري');
    expect(mine.body.autoText.titleAr).toBeUndefined();
    const later = await api().patch(`/api/v1/seller/products/${s.mug}`).set(bearer(s.gadgets)).send({ title: `Travel Mug 1L ${run}` }).expect(200);
    expect(later.body.titleAr).toBe('كوب سفر حراري');
  });

  it('a seller who writes Arabic gets the English written for them', async () => {
    const r = await api().post('/api/v1/seller/products').set(bearer(s.gadgets)).send({
      title: `مصباح مكتب ذكي ${run}`, categoryId: s.cat,
      variants: [{ sku: `P31-L-${run}`, priceMinor: '9900', initialStock: 3 }],
    }).expect(201);
    expect(r.body.titleAr).toBe(`مصباح مكتب ذكي ${run}`);
    expect(r.body.title).toMatch(/^EN مصباح مكتب ذكي/);
    expect(r.body.autoText.title).toBeDefined();
  });

  it('shoppers see the Arabic option words on the product page and in the cart', async () => {
    await api().post(`/api/v1/admin/products/${s.mug}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${s.mug}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    const slug = (await prisma.product.findUniqueOrThrow({ where: { id: s.mug } })).slug;
    const page = await api().get(`/api/v1/products/${slug}`).expect(200);
    expect(page.body.optionsAr).toMatchObject({ Colour: 'عربي Colour', Black: 'عربي Black' });

    const variant = await prisma.productVariant.findFirstOrThrow({ where: { sku: `P31-B-${run}` } });
    const cart = await api().post('/api/v1/cart/items').send({ variantId: variant.id, quantity: 1 }).expect(201);
    const line = cart.body.groups.flatMap((g: { items: unknown[] }) => g.items)[0];
    expect(line.options).toEqual({ Colour: 'Black', Size: 'M' });
    expect(line.optionsAr).toEqual({ 'عربي Colour': 'عربي Black', 'عربي Size': 'M' });
  });

  it("a store's about text, and staff can see the machine's state and run it", async () => {
    const store = await prisma.store.findFirstOrThrow({ where: { seller: { owner: { email: 'seller.gadgets@demo.fastmovex.test' } } } });
    const before = { description: store.description, descriptionAr: store.descriptionAr, autoText: store.autoText ?? {} };
    try {
      await prisma.store.update({ where: { id: store.id }, data: { description: 'Phones and chargers in Doha', descriptionAr: null } });
      await translation.translateStore(store.id);
      expect((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).descriptionAr).toBe('عربي Phones and chargers in Doha');
    } finally {
      await prisma.store.update({ where: { id: store.id }, data: { description: before.description, descriptionAr: before.descriptionAr, autoText: before.autoText as object } });
    }
    const st = await api().get('/api/v1/admin/translation').set(bearer(s.admin)).expect(200);
    expect(st.body).toMatchObject({ provider: 'fake', state: 'ok' });
    expect(st.body.autoTranslated).toBeGreaterThanOrEqual(2);
    await api().get('/api/v1/admin/translation').set(bearer(s.gadgets)).expect(403);
  });
});
