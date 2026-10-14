/**
 * PHASE 33 on a real database: Account Health (the store's measures against targets) and vacation mode (a store closed
 * until a date leaves search and lists, cannot be bought, and says when it is back).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CacheService } from '../../src/cache/cache.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';

describe('Phase 33 — Account Health and vacation mode (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;
  const s: Record<string, string> = {};
  const SLUG = 'nova-powercore-20000-power-bank';

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
    // never leave the demo store closed
    await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: null }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('a store sees its measures with targets; staff see the same; another store cannot', async () => {
    const h = (await api().get('/api/v1/seller/health').set(bearer(s.gadgets)).expect(200)).body;
    expect(['good', 'risk', 'poor']).toContain(h.status);
    expect(h.metrics.map((m: { key: string }) => m.key)).toEqual(['cancellations', 'lateDispatch', 'returns', 'rating', 'questions']);
    for (const m of h.metrics) {
      expect(['good', 'warn', 'bad', 'none']).toContain(m.state);
      expect(m.count).toBeLessThanOrEqual(m.of);
    }
    const seller = await prisma.seller.findFirstOrThrow({ where: { owner: { email: 'seller.gadgets@demo.fastmovex.test' } } });
    const staff = (await api().get(`/api/v1/admin/sellers/${seller.id}/health`).set(bearer(s.admin)).expect(200)).body;
    expect(staff.metrics).toHaveLength(5);
    await api().get(`/api/v1/admin/sellers/${seller.id}/health`).set(bearer(s.oud)).expect(403);
  });

  it('on holiday: out of search and lists, not buyable, the page says when it is back; open again at once', async () => {
    const until = new Date(Date.now() + 3 * 86_400_000);
    await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: new Date(Date.now() + 120 * 86_400_000).toISOString() }).expect(400);
    const on = (await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: until.toISOString(), message: 'Back on Sunday' }).expect(200)).body;
    expect(new Date(on.awayUntil).getTime()).toBe(until.getTime());
    await app.get(CacheService).del(`product:v1:${SLUG}`);

    const search = (await api().get('/api/v1/search').query({ q: 'powercore' }).expect(200)).body;
    expect(search.items.some((p: { slug: string }) => p.slug === SLUG)).toBe(false);
    const page = (await api().get(`/api/v1/products/${SLUG}`).expect(200)).body;
    expect(page.store).toMatchObject({ awayMessage: 'Back on Sunday' });
    expect(new Date(page.store.awayUntil).getTime()).toBe(until.getTime());
    const variant = page.variants[0].id;
    const refused = await api().post('/api/v1/cart/items').send({ variantId: variant, quantity: 1 }).expect(400);
    expect(refused.body.reason).toBe('STORE_AWAY');
    expect((await api().get('/api/v1/seller/away').set(bearer(s.gadgets)).expect(200)).body.awayMessage).toBe('Back on Sunday');

    await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: null }).expect(200);
    await app.get(CacheService).del(`product:v1:${SLUG}`);
    // (search answers are cached for 30 seconds; a differently sorted search is a fresh one)
    expect((await api().get('/api/v1/search').query({ q: 'powercore', sort: 'newest' }).expect(200)).body.items.some((p: { slug: string }) => p.slug === SLUG)).toBe(true);
    await api().post('/api/v1/cart/items').send({ variantId: variant, quantity: 1 }).expect(201);
  });

  it('a cart that already had the item cannot check out while the store is away', async () => {
    const page = (await api().get(`/api/v1/products/${SLUG}`).expect(200)).body;
    const cart = (await api().post('/api/v1/cart/items').send({ variantId: page.variants[0].id, quantity: 1 }).expect(201)).body;
    await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: new Date(Date.now() + 86_400_000).toISOString() }).expect(200);
    const after = (await api().get('/api/v1/cart').set('x-cart-token', cart.cartToken).expect(200)).body;
    expect(after.groups[0].items[0].issues).toContain('STORE_AWAY');
    expect(after.groups[0].store.awayUntil).toBeTruthy();
    expect(after.canCheckout).toBe(false);
    await api().put('/api/v1/seller/away').set(bearer(s.gadgets)).send({ until: null }).expect(200);
  });
});
