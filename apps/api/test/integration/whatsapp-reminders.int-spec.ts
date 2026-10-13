/**
 * WhatsApp order updates and abandoned-cart reminders on a real database, against a local stand-in for the
 * WhatsApp Cloud API (same request shape as Meta's). Consent rules, the template and its values, phone handling,
 * reminder timing and limits, and the credit a reminder gets for the order it brought back.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import type { PrismaService as PrismaT } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';
import type { NotificationsService as NotificationsT } from '../../src/notifications/notifications.service';
import type { CartRemindersService as RemindersT } from '../../src/marketing/cart-reminders';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
interface Sent { to: string; template: string; lang: string; params: string[] }

describe('WhatsApp and cart reminders — real database, stand-in WhatsApp API', () => {
  let app: INestApplication;
  let prisma: PrismaT;
  let restoreCod: (() => Promise<void>) | undefined;
  let notifications: NotificationsT;
  let reminders: RemindersT;
  let server: http.Server;
  let original: { cartReminders: unknown; legalSettings: unknown };
  const env = { ...process.env };
  const sent: Sent[] = [];
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }
  const flush = async () => { await new Promise((r) => setTimeout(r, 150)); await notifications.processQueue(); };
  const to = (p: string) => sent.filter((m) => m.to === p.replace('+', ''));

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => {
        if (req.headers.authorization !== 'Bearer EAAG-integration-token-0001' || req.url !== '/v22.0/9988776655/messages') { res.writeHead(401); return res.end('{"error":{"code":190,"message":"bad token"}}'); }
        const b = JSON.parse(d);
        sent.push({ to: b.to, template: b.template.name, lang: b.template.language.code, params: (b.template.components[0]?.parameters ?? []).map((p: { text: string }) => p.text) });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${sent.length}` }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      WHATSAPP_DRIVER: 'cloud', WHATSAPP_TOKEN: 'EAAG-integration-token-0001', WHATSAPP_PHONE_NUMBER_ID: '9988776655',
      WHATSAPP_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v22.0`, STOREFRONT_URL: 'https://shop.fastmovex.test',
    });
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.setup');
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const { NotificationsService } = await import('../../src/notifications/notifications.service');
    const { CartRemindersService } = await import('../../src/marketing/cart-reminders');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF' }); // not what this file tests
    notifications = app.get(NotificationsService);
    reminders = app.get(CartRemindersService);
    jest.spyOn(notifications, 'sendDirect').mockResolvedValue(undefined);
    original = await prisma.country.findUniqueOrThrow({ where: { code: 'QA' }, select: { cartReminders: true, legalSettings: true } });

    s.admin = await login('admin@demo.fastmovex.test');
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `WA Teapot ${run}`, titleAr: 'إبريق شاي', categoryId: cat.id, variants: [{ sku: `WA-${run}`, priceMinor: '6500', initialStock: 50 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ legalSettings: { ...(original.legalSettings as object), whatsapp: '+974 4400 1234' } }).expect(200);
  });

  afterAll(async () => { await restoreCod?.();
    await prisma?.country.update({ where: { code: 'QA' }, data: { cartReminders: (original?.cartReminders ?? {}) as object, legalSettings: (original?.legalSettings ?? {}) as object } }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
    await new Promise<void>((r) => server.close(() => r()));
    process.env = env;
  });

  it('the shop says WhatsApp updates are available and which number to chat with', async () => {
    const qa = (await api().get('/api/v1/markets').expect(200)).body.find((m: { code: string }) => m.code === 'QA');
    expect(qa.whatsapp).toEqual({ updates: true, chat: '97444001234' });
    const integrations = await api().get('/api/v1/admin/countries/integrations').set(bearer(s.admin)).expect(200);
    expect(integrations.body).toMatchObject({ whatsapp: true, email: true });
  });

  it('a guest who ticks WhatsApp gets the order confirmation there, with name, total and delivery', async () => {
    const p = phone();
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `wa-g-${run}`).send({
      contact: { fullName: 'Mariam Al-Kuwari', email: `wa.guest.${run}@example.com`, phone: p, whatsappOptIn: true, locale: 'ar' },
      address: { recipientName: 'Mariam', phone: p, city: 'Doha', zone: '66', street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    await flush();
    const m = to(p);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ template: 'fastmovex_order_placed', lang: 'ar' });
    expect(m[0].params[0]).toBe('Mariam');
    expect(m[0].params[1]).toBe(res.body.orderNumber);
    expect(m[0].params[2]).toMatch(/75\.00/); // 65.00 + 10.00 delivery
    expect(m[0].params[3]).toBe('في أقرب وقت');
  });

  it('without the tick there is no WhatsApp message (email only)', async () => {
    const p = phone();
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201);
    await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `wa-n-${run}`).send({
      contact: { fullName: 'No Ticks', email: `wa.none.${run}@example.com`, phone: p },
      address: { recipientName: 'No Ticks', phone: p, city: 'Doha', zone: '66', street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    await flush();
    expect(to(p)).toHaveLength(0);
  });

  it('an account without a mobile can opt in at checkout: the delivery mobile is used', async () => {
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Hamad Ali', email: `wa.acct.${run}@fastmovex.test`, password: 'Buyer-Pass-123' }).expect(201);
    s.acct = reg.body.accessToken;
    const settings = await api().patch('/api/v1/me/notification-settings').set(bearer(s.acct)).send({ whatsappOptIn: true });
    expect(settings.status).toBe(400);
    expect(settings.body.reason).toBe('NO_PHONE');
    const p = phone();
    s.acctPhone = p;
    const address = (await api().post('/api/v1/addresses').set(bearer(s.acct)).send({ recipientName: 'Hamad', phone: p, city: 'Doha', zone: '60', street: '800', building: '3' }).expect(201)).body.id;
    s.acctAddress = address;
    await api().post('/api/v1/cart/items').set(bearer(s.acct)).send({ variantId: s.variant, quantity: 1 }).expect(201);
    await api().post('/api/v1/checkout').set(bearer(s.acct)).set('Idempotency-Key', `wa-a-${run}`).send({ addressId: address, paymentMethod: 'COD', whatsappOptIn: true }).expect(201);
    const me = await api().get('/api/v1/auth/me').set(bearer(s.acct)).expect(200);
    expect(me.body).toMatchObject({ phone: p, whatsappOptIn: true });
    await flush();
    expect(to(p).map((m) => m.template)).toEqual(['fastmovex_order_placed']);
    // and can switch it off again
    await api().patch('/api/v1/me/notification-settings').set(bearer(s.acct)).send({ whatsappOptIn: false }).expect(200);
    expect((await api().get('/api/v1/auth/me').set(bearer(s.acct))).body.whatsappOptIn).toBe(false);
  });

  // ------------------------------------------------------------------ cart reminders

  it('staff switch cart reminders on; bad settings are refused', async () => {
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ cartReminders: { enabled: true, firstAfterMinutes: 5 } }).expect(400);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ cartReminders: { enabled: true, firstAfterMinutes: 60, secondAfterHours: 24, quietFrom: 0, quietTo: 0 } }).expect(200);
  });

  it('a forgotten cart gets one reminder (email, in-app, WhatsApp) — only with consent, only once a day', async () => {
    const mk = async (tag: string, consent: boolean) => {
      const p = phone();
      const reg = await api().post('/api/v1/auth/register').send({ fullName: `Noor ${tag}`, email: `wa.rem.${tag}.${run}@fastmovex.test`, phone: p, password: 'Buyer-Pass-123' }).expect(201);
      const token = reg.body.accessToken as string;
      await api().patch('/api/v1/me/notification-settings').set(bearer(token)).send({ marketingOptIn: consent, whatsappOptIn: true }).expect(200);
      await api().post('/api/v1/cart/items').set(bearer(token)).send({ variantId: s.variant, quantity: 2 }).expect(201);
      const user = await prisma.user.findFirstOrThrow({ where: { email: `wa.rem.${tag}.${run}@fastmovex.test` } });
      await prisma.cart.updateMany({ where: { userId: user.id }, data: { itemsChangedAt: new Date(Date.now() - 2 * 3600_000) } });
      return { token, p, userId: user.id };
    };
    const yes = await mk('yes', true);
    const no = await mk('no', false);
    s.remindedToken = yes.token; s.remindedUser = yes.userId;

    const n = await reminders.runOnce();
    expect(n).toBeGreaterThanOrEqual(1);
    await flush();
    const wa = to(yes.p).filter((m) => m.template === 'fastmovex_cart_reminder');
    expect(wa).toHaveLength(1);
    expect(wa[0].params).toEqual(['Noor', `"WA Teapot ${run}"`, 'https://shop.fastmovex.test/en/cart']);
    expect(await prisma.notification.count({ where: { userId: yes.userId, type: 'CART_REMINDER', channel: { in: ['IN_APP', 'EMAIL'] } } })).toBe(2);
    expect(to(no.p)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: no.userId, type: 'CART_REMINDER' } })).toBe(0);

    // running again right away sends nothing new
    await reminders.runOnce();
    await flush();
    expect(to(yes.p).filter((m) => m.template === 'fastmovex_cart_reminder')).toHaveLength(1);
    // the second reminder comes a day later
    await prisma.cart.updateMany({ where: { userId: yes.userId }, data: { lastReminderAt: new Date(Date.now() - 25 * 3600_000) } });
    await reminders.runOnce();
    await flush();
    expect(to(yes.p).filter((m) => m.template === 'fastmovex_cart_reminder')).toHaveLength(2);
    // and never a third
    await prisma.cart.updateMany({ where: { userId: yes.userId }, data: { lastReminderAt: new Date(Date.now() - 49 * 3600_000) } });
    await reminders.runOnce();
    expect((await prisma.cart.findFirstOrThrow({ where: { userId: yes.userId } })).remindersSent).toBe(2);
  });

  it('changing the cart starts over; the order after a reminder is credited to it', async () => {
    await api().post('/api/v1/cart/items').set(bearer(s.remindedToken)).send({ variantId: s.variant, quantity: 1 }).expect(201);
    const cart = await prisma.cart.findFirstOrThrow({ where: { userId: s.remindedUser } });
    expect(cart.remindersSent).toBe(0); // database trigger: new activity
    expect(Date.now() - cart.itemsChangedAt.getTime()).toBeLessThan(60_000);

    const address = (await api().post('/api/v1/addresses').set(bearer(s.remindedToken)).send({ recipientName: 'Noor', phone: '+97455500066', city: 'Doha', zone: '60', street: '800', building: '3' }).expect(201)).body.id;
    const res = await api().post('/api/v1/checkout').set(bearer(s.remindedToken)).set('Idempotency-Key', `wa-r-${run}`).send({ addressId: address, paymentMethod: 'COD' }).expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } });
    expect(order.cartReminderAt).not.toBeNull();

    const stats = await api().get('/api/v1/admin/cart-reminders/stats').query({ days: 1 }).set(bearer(s.admin)).expect(200);
    expect(stats.body.reminders).toBeGreaterThanOrEqual(2);
    expect(stats.body.recoveredOrders).toBeGreaterThanOrEqual(1);
    expect(BigInt(stats.body.recoveredMinor)).toBeGreaterThanOrEqual(order.totalMinor);
  });

  it('quiet hours and the off switch stop reminders', async () => {
    const p = phone();
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Late Shopper', email: `wa.late.${run}@fastmovex.test`, phone: p, password: 'Buyer-Pass-123' }).expect(201);
    await api().patch('/api/v1/me/notification-settings').set(bearer(reg.body.accessToken)).send({ marketingOptIn: true }).expect(200);
    await api().post('/api/v1/cart/items').set(bearer(reg.body.accessToken)).send({ variantId: s.variant, quantity: 1 }).expect(201);
    const user = await prisma.user.findFirstOrThrow({ where: { email: `wa.late.${run}@fastmovex.test` } });
    await prisma.cart.updateMany({ where: { userId: user.id }, data: { itemsChangedAt: new Date(Date.now() - 2 * 3600_000) } });

    // 23:00 in Doha with quiet hours 21–09
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ cartReminders: { enabled: true, firstAfterMinutes: 60, quietFrom: 21, quietTo: 9 } }).expect(200);
    const night = new Date(); night.setUTCHours(20, 0, 0, 0);
    await reminders.runOnce(night);
    expect(await prisma.notification.count({ where: { userId: user.id, type: 'CART_REMINDER' } })).toBe(0);

    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ cartReminders: { enabled: false } }).expect(200);
    await reminders.runOnce();
    expect(await prisma.notification.count({ where: { userId: user.id, type: 'CART_REMINDER' } })).toBe(0);
  });
  // ------------------------------------------------------------------ saved-product alerts

  it('back in stock and price drop reach WhatsApp in the customer\'s language, with a link to the product', async () => {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const prod = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `WA Lamp ${run}`, titleAr: `مصباح ${run}`, categoryId: cat.id, variants: [{ sku: `WAL-${run}`, priceMinor: '12000', initialStock: 0 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${prod.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${prod.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    const variant = prod.body.variants[0].id as string;
    const slug = (await prisma.product.findUniqueOrThrow({ where: { id: prod.body.id } })).slug;

    const watcher = async (tag: string, locale: 'en' | 'ar', whatsapp: boolean) => {
      const p = phone();
      const reg = await api().post('/api/v1/auth/register').send({ fullName: `Fatima ${tag}`, email: `wa.alert.${tag}.${run}@fastmovex.test`, phone: p, password: 'Buyer-Pass-123' }).expect(201);
      const token = reg.body.accessToken as string;
      await prisma.user.updateMany({ where: { email: `wa.alert.${tag}.${run}@fastmovex.test` }, data: { locale } });
      if (whatsapp) await api().patch('/api/v1/me/notification-settings').set(bearer(token)).send({ whatsappOptIn: true }).expect(200);
      await api().post('/api/v1/wishlists/items').set(bearer(token)).send({ productId: prod.body.id }).expect(201);
      await api().patch(`/api/v1/wishlists/items/${prod.body.id}/alerts`).set(bearer(token)).send({ notifyBackInStock: true, notifyPriceDrop: true }).expect(200);
      return p;
    };
    const en = await watcher('en', 'en', true);
    const ar = await watcher('ar', 'ar', true);
    const quiet = await watcher('off', 'en', false); // no WhatsApp consent: in-app and email only

    await api().post(`/api/v1/admin/variants/${variant}/stock`).set(bearer(s.admin)).send({ delta: 5, reason: 'RESTOCK' }).expect(200);
    await flush();
    expect(to(en).filter((m) => m.template === 'fastmovex_back_in_stock').map((m) => m.params)).toEqual([['Fatima', `WA Lamp ${run}`, `https://shop.fastmovex.test/en/p/${slug}`]]);
    expect(to(ar).filter((m) => m.template === 'fastmovex_back_in_stock')).toEqual([{ to: ar.replace('+', ''), template: 'fastmovex_back_in_stock', lang: 'ar', params: ['Fatima', `مصباح ${run}`, `https://shop.fastmovex.test/ar/p/${slug}`] }]);
    expect(to(quiet)).toHaveLength(0);
    const quietUser = await prisma.user.findFirstOrThrow({ where: { email: `wa.alert.off.${run}@fastmovex.test` } });
    expect(await prisma.notification.count({ where: { userId: quietUser.id, type: 'BACK_IN_STOCK', channel: { in: ['IN_APP', 'EMAIL'] } } })).toBe(2);

    // more stock while it is already available is not news
    await api().post(`/api/v1/admin/variants/${variant}/stock`).set(bearer(s.admin)).send({ delta: 3, reason: 'RESTOCK' }).expect(200);
    await api().patch(`/api/v1/admin/variants/${variant}`).set(bearer(s.admin)).send({ priceMinor: '9500' }).expect(200);
    await flush();
    expect(to(en).filter((m) => m.template === 'fastmovex_back_in_stock')).toHaveLength(1);
    const drop = to(en).filter((m) => m.template === 'fastmovex_price_drop');
    expect(drop).toHaveLength(1);
    expect(drop[0].params[0]).toBe('Fatima');
    expect(drop[0].params[2]).toMatch(/95\.00/);
    expect(drop[0].params[3]).toBe(`https://shop.fastmovex.test/en/p/${slug}`);
    expect(to(ar).filter((m) => m.template === 'fastmovex_price_drop')[0].params[3]).toBe(`https://shop.fastmovex.test/ar/p/${slug}`);

    // a price going up, or the same drop again, says nothing
    await api().patch(`/api/v1/admin/variants/${variant}`).set(bearer(s.admin)).send({ priceMinor: '11000' }).expect(200);
    await api().patch(`/api/v1/admin/variants/${variant}`).set(bearer(s.admin)).send({ priceMinor: '9500' }).expect(200);
    await flush();
    expect(to(en).filter((m) => m.template === 'fastmovex_price_drop')).toHaveLength(1);
  });
});
