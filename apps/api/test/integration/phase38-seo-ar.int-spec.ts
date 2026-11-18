/** Arabic Google title and description for products: saved, shown on the product data, copied with the product. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PRODUCT_PAIRS } from '../../src/translation/translation.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Arabic product SEO — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await new Promise((r) => setTimeout(r, 300)); await app?.close(); });

  it('the translator fills the Arabic Google title and description too', () => {
    expect(PRODUCT_PAIRS).toEqual(expect.arrayContaining([['seoTitle', 'seoTitleAr'], ['seoDescription', 'seoDescriptionAr']]));
  });

  it('staff write an Arabic Google title; the product page data carries it', async () => {
    const admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: DEMO_PASSWORD })).body.accessToken;
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(admin)).send({
      title: `Coffee pot ${run}`, titleAr: 'دلة قهوة', categoryId: cat.id, seoTitle: 'Arabic coffee pot in Qatar', seoTitleAr: 'دلة قهوة عربية في قطر', seoDescriptionAr: 'دلة نحاسية تقليدية، توصيل سريع في قطر.',
      variants: [{ sku: `SEO-${run}`, priceMinor: '9000', initialStock: 5 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(admin)).send({ status: 'ACTIVE' }).expect(200);
    const pub = await api().get(`/api/v1/products/${p.body.slug}`).expect(200);
    expect(pub.body).toMatchObject({ seoTitleAr: 'دلة قهوة عربية في قطر', seoDescriptionAr: 'دلة نحاسية تقليدية، توصيل سريع في قطر.' });
    await api().patch(`/api/v1/admin/products/${p.body.id}`).set(bearer(admin)).send({ seoTitleAr: 'دلة قهوة — قطر' }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.body.id } })).seoTitleAr).toBe('دلة قهوة — قطر');
  });
});
