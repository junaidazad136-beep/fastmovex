/**
 * PHASE 28 on a real database: "Buy Now" checks out one item on its own (the customer's cart stays as it was), and
 * "Frequently bought together" comes from real orders.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
type Card = { id: string; slug: string; quickAddVariantId: string | null; inStock: boolean; priceMinor: string };

describe('Phase 28 — Buy Now and bought together (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let token = '';
  let address = '';
  let a: Card;
  let b: Card;
  const cartItems = async () => ((await api().get('/api/v1/cart').set(bearer(token)).expect(200)).body.groups as { items: { variantId: string; quantity: number }[] }[]).flatMap((g) => g.items);
  const checkout = (body: Record<string, unknown>) => api().post('/api/v1/checkout').set(bearer(token)).set('Idempotency-Key', `p28-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: address, paymentMethod: 'COD', ...body });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null });
    const email = `p28.${run}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Buy Now Test', email, password: 'Buyer-Pass-123' }).expect(201);
    token = reg.body.accessToken;
    address = (await api().post('/api/v1/addresses').set(bearer(token)).send({ recipientName: 'Buy Now Test', phone: `+9746${String(1_000_000 + Math.floor(Math.random() * 8_999_999))}`, countryCode: 'QA', city: 'Doha', zone: '31', street: '230', building: '7', isDefault: true }).expect(201)).body.id;
    // two new products nobody has ordered yet, so "bought together" depends on this test only
    const admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: process.env.DEMO_PASSWORD || 'Demo-Pass-2026' }).expect(200)).body.accessToken as string;
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const make = async (name: string, price: string): Promise<Card> => {
      const p = await api().post('/api/v1/admin/products').set(bearer(admin)).send({ title: `${name} ${run}`, categoryId: cat.id, variants: [{ sku: `P28-${name.slice(0, 3).toUpperCase()}-${run}`, priceMinor: price, initialStock: 50 }] }).expect(201);
      await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(admin)).attach('file', PNG, 'p.png').expect(201);
      await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(admin)).send({ status: 'ACTIVE' }).expect(200);
      return { id: p.body.id, slug: p.body.slug, quickAddVariantId: p.body.variants[0].id, inStock: true, priceMinor: price };
    };
    a = await make('Teapot', '8000');
    b = await make('Cups', '4500');
  });

  afterAll(async () => {
    await restoreCod?.();
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('Buy Now makes a separate one-item cart; checking it out leaves the customer cart alone', async () => {
    await api().post('/api/v1/cart/items').set(bearer(token)).send({ variantId: a.quickAddVariantId, quantity: 1 }).expect(201);

    const made = await api().post('/api/v1/cart/buy-now').send({ variantId: b.quickAddVariantId, quantity: 2 }).expect(201);
    const buyToken = made.body.cartToken as string;
    expect(buyToken).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    const view = (await api().get('/api/v1/cart/buy-now').set('x-buy-now-token', buyToken).expect(200)).body;
    const lines = view.groups.flatMap((g: { items: { variantId: string; quantity: number }[] }) => g.items);
    expect(lines).toEqual([expect.objectContaining({ variantId: b.quickAddVariantId, quantity: 2 })]);
    await api().get('/api/v1/cart/buy-now').expect(400);

    const order = await checkout({ buyNowToken: buyToken }).expect(201);
    const placed = await prisma.order.findUniqueOrThrow({ where: { orderNumber: order.body.orderNumber ?? order.body.order?.orderNumber }, include: { sellerOrders: { include: { items: true } } } });
    const bought = placed.sellerOrders.flatMap((so) => so.items);
    expect(bought).toHaveLength(1);
    expect(bought[0]).toMatchObject({ variantId: b.quickAddVariantId, quantity: 2 });
    // the customer's own cart still holds what they put there
    expect(await cartItems()).toEqual([expect.objectContaining({ variantId: a.quickAddVariantId, quantity: 1 })]);
    // and the one-item cart is used up
    const after = (await api().get('/api/v1/cart/buy-now').set('x-buy-now-token', buyToken).expect(200)).body;
    expect(after.totals.itemCount).toBe(0);
  });

  it('a malformed buy-now token is refused at checkout', async () => {
    await checkout({ buyNowToken: 'short' }).expect(400);
  });

  it('items ordered together show up as "Frequently bought together"', async () => {
    await api().post('/api/v1/cart/items').set(bearer(token)).send({ variantId: b.quickAddVariantId, quantity: 1 }).expect(201);
    await checkout({}).expect(201);
    const related = (await api().get(`/api/v1/products/${a.slug}/related`).expect(200)).body as { boughtTogether: (Card & { variantId: string; variantLabel: string | null })[]; alsoViewed: Card[] };
    expect(Array.isArray(related.alsoViewed)).toBe(true);
    expect(related.boughtTogether.map((c) => c.id)).toEqual([b.id]);
    // the exact option the bundle adds (the one priced on the card)
    expect(related.boughtTogether[0]).toMatchObject({ variantId: b.quickAddVariantId, variantLabel: null });
    expect(related.alsoViewed.some((c) => c.id === a.id || c.id === b.id)).toBe(false);
    await api().get('/api/v1/products/no-such-product-xyz/related').expect(404);
  });
});
