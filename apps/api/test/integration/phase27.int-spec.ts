/**
 * PHASE 27 on a real database: the admin uploads a category's tile picture; the categories list and the home page's
 * category row show it; removing it clears it. Only catalogue managers may change it.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';

describe('Phase 27 — category tile pictures (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let before: string | null = null;
  let id = '';
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;
  const tree = async () => (await api().get('/api/v1/categories').expect(200)).body as { slug: string; imageUrl: string | null }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'gifts' } });
    id = cat.id;
    before = cat.imageKey;
  });

  afterAll(async () => {
    await prisma.category.update({ where: { id }, data: { imageKey: before } });
    await app.close();
  });

  it('the admin uploads a picture: kept as WebP with transparency, shown in the categories list', async () => {
    const admin = await login('admin@demo.fastmovex.test');
    const png = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 116, g: 34, b: 230, alpha: 0.5 } } }).png().toBuffer();
    const res = await api().post(`/api/v1/admin/categories/${id}/image`).set(bearer(admin)).attach('file', png, 'gifts.png').expect(200);
    expect(res.body.imageUrl).toMatch(/categories\/gifts-[0-9a-f]{8}\.webp$/);
    const row = await prisma.category.findUniqueOrThrow({ where: { id } });
    expect(row.imageKey).toMatch(/^categories\/gifts-/);
    // the public list is cached for a minute: a change clears it
    expect((await tree()).find((c) => c.slug === 'gifts')!.imageUrl).toBe(res.body.imageUrl);
    const list = (await api().get('/api/v1/admin/categories').set(bearer(admin)).expect(200)).body as { id: string; imageUrl: string | null }[];
    expect(list.find((c) => c.id === id)!.imageUrl).toBe(res.body.imageUrl);

    await api().delete(`/api/v1/admin/categories/${id}/image`).set(bearer(admin)).expect(204);
    expect((await prisma.category.findUniqueOrThrow({ where: { id } })).imageKey).toBeNull();
    expect((await tree()).find((c) => c.slug === 'gifts')!.imageUrl).toBeNull();
  });

  it('a file that is not a picture is refused, and a customer cannot change it', async () => {
    const admin = await login('admin@demo.fastmovex.test');
    await api().post(`/api/v1/admin/categories/${id}/image`).set(bearer(admin)).attach('file', Buffer.from('%PDF-1.4 nope'), 'x.pdf').expect(400);
    const customer = await login('customer@demo.fastmovex.test');
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#fff' } }).png().toBuffer();
    await api().post(`/api/v1/admin/categories/${id}/image`).set(bearer(customer)).attach('file', png, 'x.png').expect(403);
  });
});

describe('Phase 27 — product page: colour photos and "bought in past month" (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  it('staff and the seller link a photo to a colour (or clear it); other sellers cannot; the page reports bought-in-past-month', async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE', deletedAt: null, images: { some: {} }, variants: { some: {} }, store: { seller: { owner: { email: 'seller.gadgets@demo.fastmovex.test' } } } },
      include: { images: { orderBy: { sortOrder: 'asc' } }, variants: true },
    });
    const img = product.images[0];
    const v = product.variants[0];
    const admin = await login('admin@demo.fastmovex.test');
    const res = await api().patch(`/api/v1/admin/images/${img.id}`).set(bearer(admin)).send({ variantId: v.id }).expect(200);
    expect(res.body.variantId).toBe(v.id);
    // another product's variant is refused
    const other = await prisma.productVariant.findFirstOrThrow({ where: { productId: { not: product.id } } });
    await api().patch(`/api/v1/admin/images/${img.id}`).set(bearer(admin)).send({ variantId: other.id }).expect(400);
    // the seller can clear it from Seller Center; another seller cannot touch it
    const seller = await login('seller.gadgets@demo.fastmovex.test');
    await api().patch(`/api/v1/seller/images/${img.id}`).set(bearer(seller)).send({ variantId: null }).expect(200);
    const home = await login('seller.home@demo.fastmovex.test');
    await api().patch(`/api/v1/seller/images/${img.id}`).set(bearer(home)).send({ variantId: v.id }).expect((r) => expect([403, 404]).toContain(r.status));
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: img.id } })).variantId).toBeNull(); // cleared by the seller, not changed by the other one
    await prisma.productImage.update({ where: { id: img.id }, data: { variantId: img.variantId } });

    const page = await api().get(`/api/v1/products/${product.slug}`).expect(200);
    expect(typeof page.body.boughtLastMonth).toBe('number');
    expect([0, 10, 20, 50].includes(page.body.boughtLastMonth) || page.body.boughtLastMonth % 100 === 0).toBe(true);
  });
});

describe('Phase 27 — sign out ends the whole login (real database)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const web = { 'x-requested-with': 'fastmovex-web', 'content-type': 'application/json' };
  const cookieOf = (res: request.Response) => ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('fmx_rt=') && c.length > 'fmx_rt='.length);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('a refresh that raced the sign-out cannot keep the person signed in', async () => {
    const login = await api().post('/api/v1/auth/login').set(web).send({ identifier: 'customer@demo.fastmovex.test', password: DEMO_PASSWORD }).expect(200);
    const first = cookieOf(login)!;
    expect(first).toBeTruthy();
    // the page opens and refreshes: first → second (the browser may not have stored "second" yet)
    const refreshed = await api().post('/api/v1/auth/refresh').set(web).set('Cookie', first).send({}).expect(200);
    const second = cookieOf(refreshed)!;
    expect(second).not.toBe(first);
    // sign-out goes out with the older cookie…
    await api().post('/api/v1/auth/logout').set(web).set('Cookie', first).send({}).expect(204);
    // …and the newer one, set by the raced refresh, no longer signs anybody in
    await api().post('/api/v1/auth/refresh').set(web).set('Cookie', second).send({}).expect(401);
  });
});
