/**
 * Visit analytics on a real database: anonymous sessions from batched browser events (bots ignored, nothing
 * personal kept), the order's source taken at checkout, and the staff funnel / sources report.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TrafficService } from '../../src/analytics/traffic';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const tag = `itest-${run}`;
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';

describe('Visit analytics — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  let traffic: TrafficService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const send = (body: object, ua = PHONE_UA) => api().post('/api/v1/analytics/events').set('user-agent', ua).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF' }); // not what this file tests
    traffic = app.get(TrafficService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    s.admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: DEMO_PASSWORD }).expect(200)).body.accessToken;
    s.variant = (await api().get('/api/v1/products/premium-khalas-dates-1kg').expect(200)).body.variants[0].id;
  });

  afterAll(async () => { await restoreCod?.();
    await prisma?.analyticsSession.deleteMany({ where: { source: tag } }).catch(() => undefined);
    await app?.close();
  });

  it('events are checked, counted per visit and saved in one go; bots are ignored', async () => {
    s.a = randomUUID();
    s.b = randomUUID();
    await send({ sessionId: 'not-a-uuid', events: [{ type: 'page_view' }] }).expect(400);
    await send({ sessionId: s.a, events: [{ type: 'teleport' }] }).expect(400);
    await send({ sessionId: s.a, events: [] }).expect(400);

    await send({ sessionId: s.a, locale: 'ar', touch: { utmSource: tag, utmMedium: 'social', utmCampaign: 'Eid' }, events: [{ type: 'page_view', path: '/ar/p/premium-khalas-dates-1kg?utm_source=x' }, { type: 'product_view' }] }).expect(204);
    await send({ sessionId: s.a, touch: { referrerHost: 'www.google.com' }, events: [{ type: 'page_view', path: '/ar/cart' }, { type: 'add_to_cart' }, { type: 'checkout_start' }] }).expect(204);
    // a beacon from a closing page: text/plain, the market in the address
    await api().post('/api/v1/analytics/events?country=QA').set('user-agent', DESK_UA).set('content-type', 'text/plain')
      .send(JSON.stringify({ sessionId: s.b, touch: { utmSource: tag, utmMedium: 'social' }, events: [{ type: 'page_view', path: '/en/account/orders/FMX-QA-1' }] })).expect(204);
    await api().post('/api/v1/analytics/events').set('content-type', 'text/plain').send('{not json').expect(400);
    await api().post('/api/v1/analytics/events').set('content-type', 'text/plain').send(JSON.stringify({ sessionId: s.b, events: [{ type: 'page_view' }], admin: true })).expect(400);
    await send({ sessionId: randomUUID(), touch: { utmSource: tag }, events: [{ type: 'page_view' }] }, 'Mozilla/5.0 (compatible; Googlebot/2.1)').expect(204);
    await traffic.flush();

    const rows = await prisma.analyticsSession.findMany({ where: { source: tag }, orderBy: { device: 'desc' } });
    expect(rows).toHaveLength(2); // the bot is not there
    expect(rows[0]).toMatchObject({ id: s.a, medium: 'social', campaign: 'eid', device: 'mobile', locale: 'ar', landingPath: '/ar/p/premium-khalas-dates-1kg', pageViews: 2, productViews: 1, addedToCart: true, startedCheckout: true, purchased: false });
    expect(rows[1]).toMatchObject({ id: s.b, device: 'desktop', landingPath: '/en/account' }); // no order number kept

    // later batches add up; the source of a visit never changes
    await send({ sessionId: s.a, touch: { utmSource: 'other' }, events: [{ type: 'page_view', path: '/ar' }] }).expect(204);
    await traffic.flush();
    expect(await prisma.analyticsSession.findUniqueOrThrow({ where: { id: s.a } })).toMatchObject({ source: tag, pageViews: 3, landingPath: '/ar/p/premium-khalas-dates-1kg' });
  });

  it('the order keeps its source and the visit counts as ordered (guest checkout)', async () => {
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `tr-${run}`).send({
      contact: { fullName: 'Traffic Guest', email: `traffic.${run}@example.com`, phone: '+97455512399' },
      address: { recipientName: 'Traffic Guest', phone: '+97455512399', city: 'Doha', zone: '66', street: '901', building: '12' },
      paymentMethod: 'COD',
      traffic: { sessionId: s.a, utmSource: tag, utmMedium: 'social', utmCampaign: 'Eid' },
    }).expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } });
    expect(order).toMatchObject({ trafficSource: tag, trafficMedium: 'social', trafficCampaign: 'eid' });
    await traffic.flush();
    expect((await prisma.analyticsSession.findUniqueOrThrow({ where: { id: s.a } })).purchased).toBe(true);
    s.total = order.totalMinor.toString();
  });

  it('an order without analytics (e.g. from the app) has no source', async () => {
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `tr2-${run}`).send({
      contact: { fullName: 'App Guest', email: `traffic2.${run}@example.com`, phone: '+97455512398' },
      address: { recipientName: 'App Guest', phone: '+97455512398', city: 'Doha', zone: '66', street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } })).trafficSource).toBeNull();
  });

  it('staff see the funnel and sales by source', async () => {
    const r = (await api().get('/api/v1/admin/analytics/traffic').query({ range: 'today' }).set(bearer(s.admin)).expect(200)).body;
    const steps = Object.fromEntries(r.funnel.map((x: { step: string; sessions: number }) => [x.step, x.sessions]));
    expect(steps.visit).toBeGreaterThanOrEqual(2);
    expect(steps.purchase).toBeGreaterThanOrEqual(1);
    expect(steps.visit).toBeGreaterThanOrEqual(steps.product);
    const mine = r.sources.find((x: { source: string }) => x.source === tag);
    expect(mine).toMatchObject({ medium: 'social', sessions: 2, carts: 1, purchases: 1, orders: 1, revenueMinor: s.total, conversionPercent: 50 });
    expect(r.devices.map((d: { device: string }) => d.device)).toEqual(expect.arrayContaining(['mobile', 'desktop']));
    expect(r.daily.length).toBeGreaterThanOrEqual(1);
    // customers cannot read it
    const buyer = (await api().post('/api/v1/auth/register').send({ fullName: 'Traffic Buyer', email: `traffic.b.${run}@fastmovex.test`, password: 'Buyer-Pass-123' }).expect(201)).body.accessToken;
    await api().get('/api/v1/admin/analytics/traffic').set(bearer(buyer)).expect(403);
  });
});
