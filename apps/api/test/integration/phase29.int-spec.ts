/**
 * PHASE 29 on a real database: size guides. FastMoveX's ready guides come with the migration; shoes get the shoe guide
 * by default when they come in sizes; a product can have its own guide; stores keep their own guides private.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const run = randomBytes(3).toString('hex');
const SHOES = '5a1e0001-0000-4000-8000-000000000005';
const THOBE = '5a1e0001-0000-4000-8000-000000000003';

describe('Phase 29 — size guides (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;
  const s: Record<string, string> = {};
  const chartOf = async (slug: string) => (await api().get(`/api/v1/products/${slug}`).expect(200)).body.sizeChart as { id: string; name: string; rows: string[][] } | null;

  async function product(name: string, category: string, options: Record<string, string>[]) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: category } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `${name} ${run}`, categoryId: cat.id,
      variants: options.map((o, i) => ({ sku: `P29-${name.slice(0, 3).toUpperCase()}-${i}-${run}`, priceMinor: '9900', initialStock: 5, ...(Object.keys(o).length && { optionValues: o }) })),
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    return { id: p.body.id as string, slug: p.body.slug as string };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    s.admin = await login('admin@demo.fastmovex.test');
    s.gadgets = await login('seller.gadgets@demo.fastmovex.test');
    s.oud = await login('seller.oud@demo.fastmovex.test');
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('ships ready guides; shoes in sizes get the shoe guide, shoes without sizes get none', async () => {
    const list = (await api().get('/api/v1/admin/size-charts').set(bearer(s.admin)).expect(200)).body as { id: string; name: string; categoryCount: number }[];
    expect(list.map((c) => c.id)).toEqual(expect.arrayContaining([SHOES, THOBE]));
    expect(list.find((c) => c.id === SHOES)!.categoryCount).toBeGreaterThanOrEqual(1);

    const sandals = await product('Sandals', 'shoes', [{ Size: '41' }, { Size: '42' }]);
    const polish = await product('Shoe polish', 'shoes', [{}]);
    const chart = await chartOf(sandals.slug);
    expect(chart).toMatchObject({ id: SHOES, name: 'Shoes' });
    expect(chart!.rows.map((r) => r[0])).toContain('42');
    expect(await chartOf(polish.slug)).toBeNull();
    s.sandals = sandals.id;
    s.sandalsSlug = sandals.slug;
  });

  it("a product's own guide wins over the category's; clearing it falls back", async () => {
    await api().patch(`/api/v1/admin/products/${s.sandals}`).set(bearer(s.admin)).send({ sizeChartId: THOBE }).expect(200);
    expect((await chartOf(s.sandalsSlug))!.id).toBe(THOBE);
    await api().patch(`/api/v1/admin/products/${s.sandals}`).set(bearer(s.admin)).send({ sizeChartId: null }).expect(200);
    expect((await chartOf(s.sandalsSlug))!.id).toBe(SHOES);
  });

  it('staff add, edit and delete guides; broken tables are refused', async () => {
    await api().post('/api/v1/admin/size-charts').set(bearer(s.admin)).send({ name: 'Bad', nameAr: 'سيئ', columns: [{ label: 'Size' }], rows: [['M']] }).expect(400);
    const made = await api().post('/api/v1/admin/size-charts').set(bearer(s.admin)).send({
      name: `Belts ${run}`, nameAr: 'أحزمة', kind: 'GENERAL',
      columns: [{ label: 'Size', labelAr: 'المقاس', unit: null }, { label: 'Waist', labelAr: 'الخصر', unit: 'cm' }], rows: [['M', '80–90'], ['L', '90–100']],
    }).expect(201);
    expect(made.body).toMatchObject({ own: true, productCount: 0 });
    const edited = await api().patch(`/api/v1/admin/size-charts/${made.body.id}`).set(bearer(s.admin)).send({ rows: [['M', '80–90']] }).expect(200);
    expect(edited.body.rows).toEqual([['M', '80–90']]);
    await api().delete(`/api/v1/admin/size-charts/${made.body.id}`).set(bearer(s.admin)).expect(204);
    // customers and sellers cannot touch FastMoveX's guides
    await api().patch(`/api/v1/admin/size-charts/${SHOES}`).set(bearer(s.gadgets)).send({ name: 'x' }).expect(403);
  });

  it("stores keep their own guides; another store can neither see, edit nor use them; categories take FastMoveX's only", async () => {
    const own = await api().post('/api/v1/seller/size-charts').set(bearer(s.gadgets)).send({
      name: `Watch straps ${run}`, nameAr: 'أحزمة الساعات', kind: 'GENERAL',
      columns: [{ label: 'Size', labelAr: 'المقاس', unit: null }, { label: 'Wrist', labelAr: 'المعصم', unit: 'cm' }], rows: [['S', '14–17'], ['L', '17–21']],
    }).expect(201);
    const mine = (await api().get('/api/v1/seller/size-charts').set(bearer(s.gadgets)).expect(200)).body as { id: string; own: boolean }[];
    expect(mine.find((c) => c.id === own.body.id)?.own).toBe(true);
    expect(mine.find((c) => c.id === SHOES)?.own).toBe(false);
    const theirs = (await api().get('/api/v1/seller/size-charts').set(bearer(s.oud)).expect(200)).body as { id: string }[];
    expect(theirs.some((c) => c.id === own.body.id)).toBe(false);
    await api().patch(`/api/v1/seller/size-charts/${own.body.id}`).set(bearer(s.oud)).send({ name: 'Mine now' }).expect(404);
    await api().patch(`/api/v1/seller/size-charts/${SHOES}`).set(bearer(s.gadgets)).send({ name: 'Mine now' }).expect(404);

    // using it: fine on the store's own product, refused for another store's product
    const gadgetProduct = await prisma.product.findFirstOrThrow({ where: { store: { seller: { owner: { email: 'seller.gadgets@demo.fastmovex.test' } } }, deletedAt: null } });
    await api().patch(`/api/v1/seller/products/${gadgetProduct.id}`).set(bearer(s.gadgets)).send({ sizeChartId: own.body.id }).expect(200);
    const oudProduct = await prisma.product.findFirstOrThrow({ where: { store: { seller: { owner: { email: 'seller.oud@demo.fastmovex.test' } } }, deletedAt: null } });
    await api().patch(`/api/v1/seller/products/${oudProduct.id}`).set(bearer(s.oud)).send({ sizeChartId: own.body.id }).expect(400);
    const shoes = await prisma.category.findUniqueOrThrow({ where: { slug: 'shoes' } });
    await api().patch(`/api/v1/admin/categories/${shoes.id}`).set(bearer(s.admin)).send({ sizeChartId: own.body.id }).expect(400);

    // tidy up: the product goes back to no guide when the store deletes it
    await api().delete(`/api/v1/seller/size-charts/${own.body.id}`).set(bearer(s.gadgets)).expect(204);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: gadgetProduct.id } })).sizeChartId).toBeNull();
  });
});
