/**
 * PHASE 14 on a real database: guest checkout and order tracking, the guest → account claim, content pages,
 * the contact form, the editable home page and the offers page.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

describe('Guest checkout, content and home layout — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sent: { to: string; body: string }[] = [];
  const s: Record<string, string> = {};
  const email = `guest.${run}@example.com`;
  const guestPhone = phone();

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  async function guestCart(quantity = 1) {
    const res = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity }).expect(201);
    expect(res.body.cartToken).toBeTruthy();
    return res.body.cartToken as string;
  }

  const order = (over: Record<string, unknown> = {}) => ({
    contact: { fullName: 'Guest Shopper', email, phone: guestPhone },
    address: { recipientName: 'Guest Shopper', phone: guestPhone, city: 'Doha', zone: '66', street: '901', building: '12' },
    paymentMethod: 'COD',
    ...over,
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockImplementation(async (_channel, to, _title, body) => {
      sent.push({ to, body });
    });
    s.admin = await login('admin@demo.fastmovex.test');
    await prisma.country.update({ where: { code: 'QA' }, data: { guestCheckout: true } });

    // a product in FastMoveX's own store, with 5 in stock
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Guest Mug ${run}`, titleAr: 'كوب', categoryId: cat.id, tags: [`guest${run}`],
      variants: [{ sku: `GM-${run}`, priceMinor: '2500', initialStock: 5 }],
    }).expect(201);
    s.product = p.body.id;
    s.variant = p.body.variants[0].id;
    await api().post(`/api/v1/admin/products/${s.product}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${s.product}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  afterAll(async () => {
    await prisma?.country.update({ where: { code: 'QA' }, data: { guestCheckout: true } }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  const stock = async () => { const i = await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } }); return i.onHand - i.reserved; };

  // ------------------------------------------------------------------ guest checkout

  it('a guest orders without an account and gets a private tracking token', async () => {
    const token = await guestCart(2);
    // cash on delivery as a guest: the mobile number is proven with a texted code first
    const missing = await api().post('/api/v1/checkout/guest').set('x-cart-token', token).set('Idempotency-Key', `g-${run}`).send(order());
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('COD_PHONE_CODE');
    const sentCode = await api().post('/api/v1/checkout/guest/phone-code').send({ fullName: 'Guest Shopper', email, phone: guestPhone }).expect(200);
    expect(sentCode.body).toMatchObject({ required: true, sentTo: expect.stringContaining('***') });
    const code = /(\d{6})/.exec(sent.filter((m) => m.to === guestPhone).at(-1)!.body)![1];
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await api().post('/api/v1/checkout/guest').set('x-cart-token', token).set('Idempotency-Key', `g-${run}`).send(order({ contact: { fullName: 'Guest Shopper', email, phone: guestPhone, phoneCode: wrong } }));
    expect(bad.body.reason).toBe('COD_PHONE_CODE');
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', token).set('Idempotency-Key', `g-${run}`)
      .send(order({ contact: { fullName: 'Guest Shopper', email, phone: guestPhone, phoneCode: code } })).expect(201);
    expect(res.body).toMatchObject({ orderNumber: expect.any(String) });
    expect(res.body.orderAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    s.order = res.body.orderNumber;
    s.token = res.body.orderAccessToken;

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user).toMatchObject({ isGuest: true, passwordHash: null, phone: guestPhone, phoneVerifiedAt: expect.any(Date) }); // next time: no code
    // the same key replays the same order instead of placing a second one
    const again = await api().post('/api/v1/checkout/guest').set('x-cart-token', token).set('Idempotency-Key', `g-${run}`).send(order());
    expect(again.body.orderNumber).toBe(s.order);
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(1);
    // the cart was emptied
    const cart = await api().get('/api/v1/cart').set('x-cart-token', token).expect(200);
    expect(JSON.stringify(cart.body)).not.toContain(s.variant);
  });

  it('the guest gets an email with the tracking link', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    const start = Date.now();
    const find = () => prisma.notification.findFirst({ where: { userId: user.id, type: 'GUEST_ORDER_PLACED', channel: 'EMAIL' } });
    while (Date.now() - start < 5000 && !(await find())) await new Promise((r) => setTimeout(r, 50));
    const mail = await find();
    expect(mail?.body).toContain(s.order);
    expect(mail?.body).toMatch(/track/i); // a link when STOREFRONT_URL is set, otherwise how to use the Track order page
  });

  it('only the token opens the order; the order number alone does not', async () => {
    const ok = await api().get(`/api/v1/orders/guest/${s.order}`).set('x-order-token', s.token).expect(200);
    expect(ok.body).toMatchObject({ orderNumber: s.order, guest: true });
    await api().get(`/api/v1/orders/guest/${s.order}`).expect(401);
    await api().get(`/api/v1/orders/guest/${s.order}`).set('x-order-token', `${s.token[0] === 'A' ? 'B' : 'A'}${s.token.slice(1)}`).expect(401);
    // a signed-in customer's order can never be opened through the guest route
    const other = await prisma.order.findFirst({ where: { user: { isGuest: false } }, select: { orderNumber: true } });
    if (other) await api().get(`/api/v1/orders/guest/${other.orderNumber}`).set('x-order-token', s.token).expect(401);
  });

  it('the guest can find the order again with the order number and their email or phone', async () => {
    const byEmail = await api().post('/api/v1/orders/guest/lookup').send({ orderNumber: s.order.toLowerCase(), contact: email.toUpperCase() }).expect(200);
    expect(byEmail.body.token).toBe(s.token);
    const byPhone = await api().post('/api/v1/orders/guest/lookup').send({ orderNumber: s.order, contact: guestPhone }).expect(200);
    expect(byPhone.body.token).toBe(s.token);
    await api().post('/api/v1/orders/guest/lookup').send({ orderNumber: s.order, contact: 'someone@else.com' }).expect(401);
    await api().post('/api/v1/orders/guest/lookup').send({ orderNumber: 'FMX-QA-000000-ZZZZZZ', contact: email }).expect(401);
  });

  it('an email that belongs to an account must sign in instead', async () => {
    const token = await guestCart();
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', token)
      .send(order({ contact: { fullName: 'Someone', email: 'customer@demo.fastmovex.test', phone: phone() } }));
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('ACCOUNT_EXISTS');
  });

  it('guest checkout needs a cart and can be switched off per market', async () => {
    await api().post('/api/v1/checkout/guest').send(order()).expect(400);
    await prisma.country.update({ where: { code: 'QA' }, data: { guestCheckout: false } });
    const token = await guestCart();
    const off = await api().post('/api/v1/checkout/guest').set('x-cart-token', token).send(order());
    expect(off.status).toBe(403);
    expect(off.body.reason).toBe('GUEST_CHECKOUT_OFF');
    const markets = await api().get('/api/v1/markets').expect(200);
    expect(markets.body.find((m: { code: string }) => m.code === 'QA').guestCheckout).toBe(false);
    await prisma.country.update({ where: { code: 'QA' }, data: { guestCheckout: true } });
  });

  it('the guest can cancel before it ships; the stock comes back', async () => {
    const before = await stock();
    const res = await api().post(`/api/v1/orders/guest/${s.order}/cancel`).set('x-order-token', s.token).send({ reason: 'Changed my mind' });
    expect([200, 201]).toContain(res.status);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: s.order } });
    expect(o.status).toBe('CANCELLED');
    expect(await stock()).toBe(before + 2);
    await api().post(`/api/v1/orders/guest/${s.order}/cancel`).send({ reason: 'Changed my mind' }).expect(401);
  });

  it('registering with a guest email points to "forgot password"; the reset turns the guest into an account with its orders', async () => {
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Guest Shopper', email, password: 'Guest-Pass-123' });
    expect(reg.status).toBe(409);
    expect(reg.body.reason).toBe('GUEST_ACCOUNT');

    sent.length = 0;
    await api().post('/api/v1/auth/password/forgot').send({ identifier: email }).expect(202);
    const start = Date.now();
    let code: string | undefined;
    while (!code && Date.now() - start < 5000) {
      code = sent.filter((m) => m.to === email && !m.body.includes(s.order)).map((m) => m.body.match(/\b\d{6}\b/)?.[0]).find(Boolean);
      if (!code) await new Promise((r) => setTimeout(r, 50));
    }
    expect(code).toBeTruthy();
    await api().post('/api/v1/auth/password/reset').send({ identifier: email, code, newPassword: 'Claimed-Pass-2026' }).expect(204);
    const token = await login(email, 'Claimed-Pass-2026');
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.isGuest).toBe(false);
    const orders = await api().get('/api/v1/orders').set(bearer(token)).expect(200);
    expect(JSON.stringify(orders.body)).toContain(s.order);
    // now a real account: guest checkout with this email must sign in
    const cart = await guestCart();
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart).send(order());
    expect(res.body.reason).toBe('ACCOUNT_EXISTS');
  });

  // ------------------------------------------------------------------ content pages & contact

  it('staff write content pages; drafts stay hidden; website addresses are reserved', async () => {
    const seeded = await api().get('/api/v1/pages').expect(200);
    expect(seeded.body.map((p: { slug: string }) => p.slug)).toEqual(expect.arrayContaining(['about', 'privacy', 'terms']));

    const slug = `guide-${run}`;
    const created = await api().post('/api/v1/admin/pages').set(bearer(s.admin))
      .send({ slug, title: 'Size guide', titleAr: 'دليل المقاسات', body: '## Sizes\n- S\n- M', bodyAr: '## المقاسات', isPublished: false }).expect(201);
    s.page = created.body.id;
    await api().get(`/api/v1/pages/${slug}`).expect(404);
    await api().patch(`/api/v1/admin/pages/${s.page}`).set(bearer(s.admin)).send({ isPublished: true }).expect(200);
    const pub = await api().get(`/api/v1/pages/${slug}`).expect(200);
    expect(pub.body).toMatchObject({ slug, title: 'Size guide', body: '## Sizes\n- S\n- M' });

    const reserved = await api().post('/api/v1/admin/pages').set(bearer(s.admin)).send({ slug: 'checkout', title: 'X page', titleAr: 'X page', body: 'x', bodyAr: 'x' });
    expect(reserved.status).toBe(400);
    const dup = await api().post('/api/v1/admin/pages').set(bearer(s.admin)).send({ slug, title: 'X page', titleAr: 'X page', body: 'x', bodyAr: 'x' });
    expect(dup.status).toBe(409);
    // support staff cannot edit pages
    const support = await login('support@demo.fastmovex.test');
    await api().post('/api/v1/admin/pages').set(bearer(support)).send({ slug: `x-${run}`, title: 'X page', titleAr: 'X page', body: 'x', bodyAr: 'x' }).expect(403);

    await api().delete(`/api/v1/admin/pages/${s.page}`).set(bearer(s.admin)).expect((r) => expect([200, 204]).toContain(r.status));
    await api().get(`/api/v1/pages/${slug}`).expect(404);
  });

  it('contact messages reach the Messages screen; bots filling the hidden field are dropped', async () => {
    const who = `contact.${run}@example.com`;
    await api().post('/api/v1/contact').send({ name: 'Ali', email: who, message: 'Do you deliver to Al Khor on Fridays?' }).expect(202);
    await api().post('/api/v1/contact').send({ name: 'Bot', email: `bot.${run}@example.com`, message: 'Cheap followers here!!!', website: 'http://spam' }).expect(202);
    await api().post('/api/v1/contact').send({ name: 'Ali', email: 'nope', message: 'hi' }).expect(400);
    expect(await prisma.contactMessage.count({ where: { email: `bot.${run}@example.com` } })).toBe(0);

    const support = await login('support@demo.fastmovex.test');
    const list = await api().get('/api/v1/admin/contact-messages').query({ status: 'NEW' }).set(bearer(support)).expect(200);
    const msg = list.body.items.find((m: { email: string }) => m.email === who);
    expect(msg).toBeTruthy();
    const summary = await api().get('/api/v1/admin/dashboard/summary').set(bearer(support));
    if (summary.status === 200) expect(Number(summary.body.newMessages)).toBeGreaterThan(0);
    await api().patch(`/api/v1/admin/contact-messages/${msg.id}`).set(bearer(support)).send({ status: 'HANDLED', note: 'Replied by email' }).expect(200);
    const handled = await prisma.contactMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(handled).toMatchObject({ status: 'HANDLED', note: 'Replied by email' });
    expect(handled.handledAt).toBeTruthy();
  });

  // ------------------------------------------------------------------ home layout & offers

  it('staff arrange the home page with their own collections; reset brings back the standard page', async () => {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const preview = await api().post('/api/v1/admin/home-sections/preview').set(bearer(s.admin))
      .send({ config: { source: 'tag', tag: `guest${run}`, limit: 8 } }).expect((r) => expect([200, 201]).toContain(r.status));
    expect(preview.body.items.map((i: { id: string }) => i.id)).toContain(s.product);

    const sections = [
      { key: 'hero' },
      { key: 'collection', title: `Mugs ${run}`, titleAr: 'أكواب', config: { source: 'tag', tag: `guest${run}`, limit: 8 } },
      { key: 'categories', title: 'Browse' },
      { key: 'best_sellers', isActive: false },
      { key: 'collection', title: 'Kitchen', config: { source: 'category', categoryId: cat.id } },
    ];
    await api().put('/api/v1/admin/home-sections').set(bearer(s.admin)).send({ countryCode: 'QA', sections }).expect(200);
    const home = await api().get('/api/v1/home').set('x-country', 'QA').expect(200);
    const keys = home.body.sections.map((x: { key: string; title?: string }) => x.title ?? x.key);
    expect(keys).toContain(`Mugs ${run}`);
    expect(keys).not.toContain('best_sellers');
    const mugs = home.body.sections.find((x: { title?: string }) => x.title === `Mugs ${run}`);
    expect(mugs.items.map((i: { id: string }) => i.id)).toContain(s.product);
    expect(keys.indexOf(`Mugs ${run}`)).toBeLessThan(keys.indexOf('Browse'));

    // a built-in section only once; collections need a valid config
    await api().put('/api/v1/admin/home-sections').set(bearer(s.admin)).send({ countryCode: 'QA', sections: [{ key: 'hero' }, { key: 'hero' }] }).expect(400);
    await api().put('/api/v1/admin/home-sections').set(bearer(s.admin)).send({ countryCode: 'QA', sections: [{ key: 'collection', config: { source: 'tag' } }] }).expect(400);
    await api().put('/api/v1/admin/home-sections').set(bearer(s.admin)).send({ countryCode: 'QA', sections: [{ key: 'nonsense' }] }).expect(400);
    // support staff cannot change the home page
    const support = await login('support@demo.fastmovex.test');
    await api().put('/api/v1/admin/home-sections').set(bearer(support)).send({ countryCode: 'QA', sections }).expect(403);

    await api().post('/api/v1/admin/home-sections/reset').set(bearer(s.admin)).send({ countryCode: 'QA' }).expect((r) => expect([200, 201, 204]).toContain(r.status));
    expect(await prisma.homeSection.count({ where: { countryCode: 'QA' } })).toBe(0);
    const standard = await api().get('/api/v1/home').set('x-country', 'QA').expect(200);
    expect(standard.body.sections.some((x: { title?: string }) => x.title === `Mugs ${run}`)).toBe(false);
  });

  it('the offers page lists products on sale', async () => {
    await prisma.productVariant.update({ where: { id: s.variant }, data: { compareAtMinor: 5000n } });
    const res = await api().get('/api/v1/offers').set('x-country', 'QA').expect(200);
    expect(res.body).toMatchObject({ currencyCode: 'QAR', campaigns: expect.any(Array), sale: expect.any(Array) });
    expect(res.body.sale.map((p: { id: string }) => p.id)).toContain(s.product); // 50% off
  });
});
