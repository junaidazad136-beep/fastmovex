/**
 * PHASE 24 on a real database: content for search engines (category and brand pages), Google & social settings,
 * the Google Merchant product feed, richer search suggestions and a search order that puts buyable products first.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CacheService } from '../../src/cache/cache.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Phase 24 — SEO content, brand pages, Google feed, better search (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seoBefore: unknown;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const flush = () => app.get(CacheService).del(`feed:QA:1`, `sitemap:QA:brands`);
  async function product(title: string, priceMinor: string, opts: { stock?: number; barcode?: string; brandId?: string } = {}) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `${title} ${run}`, titleAr: `${title} ${run}`, categoryId: cat.id, ...(opts.brandId && { brandId: opts.brandId }),
      variants: [{ sku: `P24-${title.replace(/\W/g, '').slice(0, 5).toUpperCase()}-${run}`, priceMinor, initialStock: opts.stock ?? 20, ...(opts.barcode && { barcode: opts.barcode }) }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    return { id: p.body.id as string, slug: p.body.slug as string, variant: p.body.variants[0].id as string, sku: p.body.variants[0].sku as string };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined as never);
    seoBefore = (await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } })).seoSettings;
    s.admin = await login('admin@demo.fastmovex.test');
    s.finance = await login('finance@demo.fastmovex.test');
  });

  afterAll(async () => {
    await prisma?.country.update({ where: { code: 'QA' }, data: { seoSettings: (seoBefore ?? {}) as object } }).catch(() => undefined);
    await prisma?.category.update({ where: { slug: 'home-kitchen' }, data: { description: null, descriptionAr: null, seoTitle: null, seoTitleAr: null, seoDescription: null, seoDescriptionAr: null, faq: [] } }).catch(() => undefined);
    await app?.close();
  });

  it('category: text, Google title/description and questions in both languages; cleared with an empty value', async () => {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const faq = [
      { q: 'Do you deliver to Al Wakrah?', qAr: 'هل توصلون إلى الوكرة؟', a: 'Yes, across Qatar.', aAr: 'نعم، في كل قطر.' },
    ];
    await api().patch(`/api/v1/admin/categories/${cat.id}`).set(bearer(s.admin)).send({ seoTitle: 'x'.repeat(71) }).expect(400);
    await api().patch(`/api/v1/admin/categories/${cat.id}`).set(bearer(s.admin)).send({ faq: [{ q: 'only English', a: 'no Arabic' }] }).expect(400);
    await api().patch(`/api/v1/admin/categories/${cat.id}`).set(bearer(s.finance)).send({ seoTitle: 'Nope' }).expect(403);
    await api().patch(`/api/v1/admin/categories/${cat.id}`).set(bearer(s.admin)).send({
      description: `Kitchen ${run}\n\nSecond paragraph.`, descriptionAr: 'المطبخ', seoTitle: `Home & kitchen in Qatar ${run}`, seoTitleAr: 'المنزل والمطبخ في قطر',
      seoDescription: 'Cookware, coffee sets and more with delivery in Doha.', seoDescriptionAr: 'أدوات الطبخ وأطقم القهوة مع التوصيل في الدوحة.', faq,
    }).expect(200);
    const pub = (await api().get('/api/v1/categories/home-kitchen').expect(200)).body;
    expect(pub).toMatchObject({ seoTitle: `Home & kitchen in Qatar ${run}`, seoTitleAr: 'المنزل والمطبخ في قطر', descriptionAr: 'المطبخ', faq });
    expect(pub.path).toBeUndefined();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: cat.id, action: 'category.update' }, orderBy: { createdAt: 'desc' } });
    expect((audit.after as { seo: string[] }).seo).toEqual(expect.arrayContaining(['seoTitle', 'faq']));
    // clearing
    await api().patch(`/api/v1/admin/categories/${cat.id}`).set(bearer(s.admin)).send({ seoTitle: '', faq: [] }).expect(200);
    const cleared = (await api().get('/api/v1/categories/home-kitchen').expect(200)).body;
    expect(cleared.seoTitle).toBeNull();
    expect(cleared.faq).toEqual([]);
    expect(cleared.seoTitleAr).toBe('المنزل والمطبخ في قطر'); // untouched
  });

  it('brand page: name in Arabic, text, product count; unknown brand 404; listed for the sitemap once it sells something', async () => {
    const b = (await api().post('/api/v1/admin/brands').set(bearer(s.admin)).send({ name: `Brand ${run}`, nameAr: `ماركة ${run}`, description: 'Our story.', seoTitle: 'Brand in Qatar' }).expect(201)).body;
    expect((await api().get(`/api/v1/brands/${b.slug}`).expect(200)).body).toMatchObject({ name: `Brand ${run}`, nameAr: `ماركة ${run}`, description: 'Our story.', productCount: 0, logoUrl: null });
    await api().get('/api/v1/brands/no-such-brand-here').expect(404);
    await api().get('/api/v1/brands/Bad%20Slug').expect(404);
    await flush();
    expect((await api().get('/api/v1/sitemap/brands').expect(200)).body.items.map((x: { slug: string }) => x.slug)).not.toContain(b.slug);
    await product('Branded Pan', '4500', { brandId: b.id });
    await app.get(CacheService).del(`brand:QA:${b.slug}`);
    await flush();
    expect((await api().get(`/api/v1/brands/${b.slug}`).expect(200)).body.productCount).toBe(1);
    expect((await api().get('/api/v1/sitemap/brands').expect(200)).body.items.map((x: { slug: string }) => x.slug)).toContain(b.slug);
    const list = (await api().get('/api/v1/admin/brands').query({ q: run }).set(bearer(s.admin)).expect(200)).body;
    expect(list[0]).toMatchObject({ slug: b.slug, nameAr: `ماركة ${run}`, _count: { products: 1 } });
    // update: SEO text changes, audited with the fields
    await api().patch(`/api/v1/admin/brands/${b.id}`).set(bearer(s.admin)).send({ name: b.name, seoDescription: 'Genuine pans.', description: '' }).expect(200);
    const after = await prisma.brand.findUniqueOrThrow({ where: { id: b.id } });
    expect(after).toMatchObject({ seoDescription: 'Genuine pans.', description: null, nameAr: `ماركة ${run}` });
  });

  it('Google & social: a pasted meta tag keeps only the code; only real social addresses; public for the website', async () => {
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ seoSettings: { social: { instagram: 'https://evil.example/x' } } }).expect(400);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ seoSettings: { googleVerification: '<meta name="google-site-verification" content="p24-Code_1" />', social: { instagram: 'https://www.instagram.com/fastmovex.qa' } } }).expect(200);
    await app.get(CacheService).del('markets:public');
    const market = (await api().get('/api/v1/markets').expect(200)).body.find((m: { code: string }) => m.code === 'QA');
    expect(market.seo).toEqual({ googleVerification: 'p24-Code_1', bingVerification: null, social: { instagram: 'https://www.instagram.com/fastmovex.qa' } });
    // a later save of other settings keeps them
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ seoSettings: { bingVerification: 'BING1234567' } }).expect(200);
    expect((await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } })).seoSettings).toMatchObject({ googleVerification: 'p24-Code_1', bingVerification: 'BING1234567', social: { instagram: 'https://www.instagram.com/fastmovex.qa' } });
  });

  it('Google Merchant feed: a live deal is the sale price with its dates, only real barcodes, stock; switched off → nothing', async () => {
    const deal = await product('Feed Kettle', '12000', { barcode: '4006381333931' });
    const fake = await product('Feed Cup', '2000', { barcode: '1234567890123', stock: 0 });
    const c = await prisma.campaign.create({ data: { name: `P24 ${run}`, type: 'FLASH_DEAL', countryCode: 'QA', startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 86_400_000) } });
    await prisma.campaignProduct.create({ data: { campaignId: c.id, variantId: deal.variant, dealPriceMinor: 9900n } });
    await flush();
    const feed = (await api().get('/api/v1/feeds/products').expect(200)).body;
    expect(feed).toMatchObject({ enabled: true, currencyCode: 'QAR', minorUnits: 2, shipping: { countryCode: 'QA' } });
    const a = feed.items.find((i: { id: string }) => i.id === deal.sku);
    expect(a).toMatchObject({ priceMinor: '12000', salePriceMinor: '9900', gtin: '4006381333931', availability: 'in_stock', productSlug: deal.slug, productType: expect.stringContaining('Home') });
    expect(new Date(a.saleEndsAt).getTime()).toBeGreaterThan(Date.now());
    expect(a.imageUrl).toMatch(/^https?:\/\//);
    const b = feed.items.find((i: { id: string }) => i.id === fake.sku);
    expect(b).toMatchObject({ gtin: null, availability: 'out_of_stock', salePriceMinor: null });
    // product page has the real barcode only
    expect((await api().get(`/api/v1/products/${deal.slug}`).expect(200)).body.variants[0].gtin).toBe('4006381333931');
    // switched off
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ seoSettings: { merchantFeed: false } }).expect(200);
    await flush();
    expect((await api().get('/api/v1/feeds/products').expect(200)).body).toMatchObject({ enabled: false, items: [] });
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ seoSettings: { merchantFeed: true } }).expect(200);
    await prisma.campaign.delete({ where: { id: c.id } });
  });

  it('search: suggestions carry photo, price and stock; buyable products come before sold-out best sellers', async () => {
    const word = `zorbix${run}`;
    const out = await product(`${word} Grinder Pro`, '30000', { stock: 0 });
    const inStock = await product(`${word} Grinder`, '25000', { stock: 5 });
    await prisma.product.update({ where: { id: out.id }, data: { soldCount: 500 } }); // the sold-out one sold far more
    const sug = (await api().get('/api/v1/search/suggest').query({ q: word }).expect(200)).body;
    const p = sug.products.find((x: { slug: string }) => x.slug === inStock.slug);
    expect(p).toMatchObject({ priceMinor: '25000', inStock: true, category: 'Home & Kitchen' });
    expect(p.imageUrl).toMatch(/^https?:\/\//);
    expect(sug.products.find((x: { slug: string }) => x.slug === out.slug)).toMatchObject({ inStock: false });
    const res = (await api().get('/api/v1/search').query({ q: word }).expect(200)).body;
    // (typo-tolerant matching may also find products of earlier runs: only the order of these two matters)
    const order = res.items.map((i: { slug: string }) => i.slug).filter((sl: string) => sl === inStock.slug || sl === out.slug);
    expect(order).toEqual([inStock.slug, out.slug]);
    expect(res.items.findIndex((i: { inStock: boolean }) => !i.inStock)).toBeGreaterThan(res.items.findLastIndex((i: { inStock: boolean }) => i.inStock));
    // an explicit sort is still obeyed
    const pop = (await api().get('/api/v1/search').query({ q: word, sort: 'popular' }).expect(200)).body;
    const popOrder = pop.items.map((i: { slug: string }) => i.slug).filter((sl: string) => sl === inStock.slug || sl === out.slug);
    expect(popOrder).toEqual([out.slug, inStock.slug]);
  });
});
