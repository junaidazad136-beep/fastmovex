/**
 * PHASE 25 on a real database: the FastMoveX storefront look — banners with their own text, category photos,
 * the card's "Add" button, a barcode / SKU found by search (camera scan), popular searches for a new shop.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CacheService } from '../../src/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Phase 25 — storefront look (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let admin = '';
  let bannerId = '';
  const fresh = () => app.get(CacheService).del('home:QA');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: DEMO_PASSWORD }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    if (bannerId) await prisma?.banner.delete({ where: { id: bannerId } }).catch(() => undefined);
    await app?.close();
  });

  it('a slider banner carries its own text in both languages; three headline lines are refused; empty clears', async () => {
    await api().post('/api/v1/admin/banners').set(bearer(admin)).attach('file', PNG, 'b.png')
      .field('placement', 'HOME_HERO').field('headline', 'one\ntwo\nthree').expect(400);
    const b = await api().post('/api/v1/admin/banners').set(bearer(admin)).attach('file', PNG, 'b.png')
      .field('placement', 'HOME_HERO').field('linkUrl', '/offers').field('sortOrder', '999')
      .field('kicker', 'Limited time').field('headline', `Big deals ${run}\nUp to *50% off*`).field('headlineAr', 'عروض كبيرة\nخصم حتى *50%*')
      .field('subline', 'Top brands • Best prices').field('ctaLabel', 'Shop now').expect(201);
    bannerId = b.body.id;
    expect(b.body).toMatchObject({ kicker: 'Limited time', headline: `Big deals ${run}\nUp to *50% off*`, ctaLabel: 'Shop now' });
    await fresh();
    const home = (await api().get('/api/v1/home').expect(200)).body as { sections: { key: string; items: Record<string, unknown>[] }[] };
    const hero = home.sections.find((x) => x.key === 'hero')!.items.find((i) => i.id === bannerId)!;
    expect(hero).toMatchObject({ headlineAr: 'عروض كبيرة\nخصم حتى *50%*', subline: 'Top brands • Best prices', kickerAr: null });
    expect(hero).not.toHaveProperty('imageKey');
    const cleared = await api().patch(`/api/v1/admin/banners/${bannerId}`).set(bearer(admin)).send({ placement: 'HOME_HERO', subline: '  ' }).expect(200);
    expect(cleared.body.subline).toBeNull();
    expect(cleared.body.headline).toBe(`Big deals ${run}\nUp to *50% off*`);
  });

  it('category tiles get the photo of their best seller; cards say when "Add" can go straight to the cart', async () => {
    await fresh();
    const home = (await api().get('/api/v1/home').expect(200)).body as { sections: { key: string; type: string; items: Record<string, unknown>[] }[] };
    const cats = home.sections.find((x) => x.key === 'categories')!.items as { slug: string; imageUrl: string | null }[];
    expect(cats.some((c) => typeof c.imageUrl === 'string' && c.imageUrl.length > 0)).toBe(true);
    const cards = home.sections.filter((x) => x.type === 'products' || x.type === 'deals').flatMap((x) => x.items) as { quickAddVariantId?: string | null; inStock: boolean }[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).toHaveProperty('quickAddVariantId');
    expect(cards.some((c) => c.quickAddVariantId)).toBe(true);
  });

  it('the barcode on the pack (camera) and a SKU find the product', async () => {
    const v = await prisma.productVariant.findFirstOrThrow({ where: { isActive: true, product: { status: 'ACTIVE', deletedAt: null, countryCode: 'QA', store: { isActive: true, seller: { status: 'APPROVED' } } } }, select: { id: true, sku: true, barcode: true, productId: true } });
    const code = `629${Date.now().toString().slice(-10)}`;
    await prisma.productVariant.update({ where: { id: v.id }, data: { barcode: code } });
    try {
      await fresh();
      const byBarcode = (await api().get(`/api/v1/search?q=${code}`).expect(200)).body as { items: { id: string }[]; total: number };
      expect(byBarcode.items[0]?.id).toBe(v.productId);
      const bySku = (await api().get(`/api/v1/search?q=${encodeURIComponent(v.sku)}`).expect(200)).body as { items: { id: string }[] };
      expect(bySku.items.map((i) => i.id)).toContain(v.productId);
    } finally {
      await prisma.productVariant.update({ where: { id: v.id }, data: { barcode: v.barcode } });
    }
  });

  it('popular searches are never empty for a shop with products (best-selling brands fill in)', async () => {
    const r = (await api().get('/api/v1/search/popular').expect(200)).body as { queries: string[] };
    expect(r.queries.length).toBeGreaterThan(0);
  });
});
