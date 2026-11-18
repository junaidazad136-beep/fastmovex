/**
 * Warranty claims on a real database (policy: faulty after 7 days, during the warranty -> accepted, collected,
 * repaired within 14 days, returned; within 7 days it is a normal return).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { WarrantyService, warrantyEnds } from '../../src/finance/warranty';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

describe('Warranty claims — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  async function deliveredOrder(daysAgo: number) {
    await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: s.variant, quantity: 1 }).expect(201);
    const placed = await api().post('/api/v1/checkout').set(bearer(s.customer)).set('Idempotency-Key', `w-${run}-${randomBytes(3).toString('hex')}`)
      .send({ addressId: s.address, paymentMethod: 'CARD' }).expect(201);
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    await prisma.sellerOrder.updateMany({ where: { order: { orderNumber: placed.body.orderNumber } }, data: { status: 'DELIVERED', deliveredAt: at } });
    await prisma.orderItem.updateMany({ where: { order: { orderNumber: placed.body.orderNumber } }, data: { status: 'DELIVERED' } });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order: { orderNumber: placed.body.orderNumber } }, select: { id: true } });
    return { orderNumber: placed.body.orderNumber as string, itemId: item.id };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockImplementation(async () => undefined);
    s.admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: DEMO_PASSWORD })).body.accessToken;
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Blender ${run}`, titleAr: 'خلاط', categoryId: cat.id, warrantyMonths: 12,
      variants: [{ sku: `WAR-${run}`, priceMinor: '15000', initialStock: 20 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
    const reg = await api().post('/api/v1/auth/register').set('X-Client-Type', 'mobile')
      .send({ fullName: 'Warranty Tester', email: `war.${run}@example.com`, phone: phone(), password: `War-Pass-${run}-2026` }).expect(201);
    s.customer = reg.body.accessToken;
    s.address = (await api().post('/api/v1/addresses').set(bearer(s.customer))
      .send({ label: 'Home', recipientName: 'Warranty Tester', phone: '+97455512345', city: 'Doha', zone: '66', street: '901', building: '12' }).expect(201)).body.id;
  });
  afterAll(async () => { await new Promise((r) => setTimeout(r, 300)); await app?.close(); });

  it('the warranty end date is delivery + the product\'s months', () => {
    expect(warrantyEnds(new Date('2026-01-31T10:00:00Z'), 12).toISOString()).toBe('2027-01-31T10:00:00.000Z');
  });

  it('within 7 days of delivery: a return, not a warranty claim', async () => {
    const o = await deliveredOrder(3);
    const res = await api().post(`/api/v1/orders/${o.orderNumber}/warranty`).set(bearer(s.customer)).send({ orderItemId: o.itemId, description: 'It stopped working after two days' }).expect(400);
    expect(res.body.reason).toBe('USE_RETURN');
  });

  it('claim -> photos -> accepted (14 days) -> in repair -> repaired; the customer sees each step', async () => {
    const o = await deliveredOrder(40);
    const view = await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(s.customer)).expect(200);
    expect(view.body.sellerOrders[0].items[0]).toMatchObject({ canClaimWarranty: true });
    const c = await api().post(`/api/v1/orders/${o.orderNumber}/warranty`).set(bearer(s.customer)).send({ orderItemId: o.itemId, description: 'The motor makes noise and stops' }).expect(201);
    await api().post(`/api/v1/orders/${o.orderNumber}/warranty`).set(bearer(s.customer)).send({ orderItemId: o.itemId, description: 'The motor makes noise and stops' }).expect(409); // one open claim
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'ACCEPTED' }).expect(400); // photos first
    await api().post(`/api/v1/me/warranty/${c.body.id}/photos`).set(bearer(s.customer)).attach('file', PNG, 'fault.png').expect(201);
    const accepted = await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'ACCEPTED' }).expect(200);
    expect(new Date(accepted.body.dueAt).getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'REJECTED', note: 'too late' }).expect(400); // no going back
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'IN_REPAIR' }).expect(200);
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'RESOLVED' }).expect(400); // what was done?
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'RESOLVED', resolution: 'REPAIRED', note: 'Motor replaced' }).expect(200);
    const mine = await api().get('/api/v1/me/warranty').set(bearer(s.customer)).expect(200);
    expect(mine.body.find((x: { id: string }) => x.id === c.body.id)).toMatchObject({ status: 'RESOLVED', resolution: 'REPAIRED', note: 'Motor replaced' });
    const uid = (await prisma.user.findUniqueOrThrow({ where: { email: `war.${run}@example.com` }, select: { id: true } })).id;
    for (let i = 0; i < 30 && (await prisma.notification.count({ where: { userId: uid, type: 'WARRANTY_UPDATE' } })) < 3; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.notification.count({ where: { userId: uid, type: 'WARRANTY_UPDATE' } })).toBeGreaterThanOrEqual(3);
  });

  it('rejecting needs a reason; past the 14 days the seller is reminded once', async () => {
    const o = await deliveredOrder(60);
    const c = await api().post(`/api/v1/orders/${o.orderNumber}/warranty`).set(bearer(s.customer)).send({ orderItemId: o.itemId, description: 'Lid cracked when closing it' }).expect(201);
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'REJECTED' }).expect(400);
    await api().post(`/api/v1/me/warranty/${c.body.id}/photos`).set(bearer(s.customer)).attach('file', PNG, 'lid.png').expect(201);
    await api().post(`/api/v1/admin/warranty/${c.body.id}/step`).set(bearer(s.admin)).send({ status: 'ACCEPTED' }).expect(200);
    await prisma.warrantyClaim.update({ where: { id: c.body.id }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    const svc = app.get(WarrantyService);
    await svc.remindOverdue();
    const first = (await prisma.warrantyClaim.findUniqueOrThrow({ where: { id: c.body.id } })).overdueWarnedAt;
    expect(first).not.toBeNull();
    await svc.remindOverdue();
    expect((await prisma.warrantyClaim.findUniqueOrThrow({ where: { id: c.body.id } })).overdueWarnedAt).toEqual(first);
    const list = await api().get('/api/v1/admin/warranty').set(bearer(s.admin)).expect(200);
    expect(list.body.items.find((x: { id: string }) => x.id === c.body.id)).toMatchObject({ overdue: true });
  });

  it('another customer cannot claim on this order; no warranty = no claim', async () => {
    const o = await deliveredOrder(20);
    const other = await api().post('/api/v1/auth/register').set('X-Client-Type', 'mobile')
      .send({ fullName: 'Other', email: `other.${run}@example.com`, phone: phone(), password: `Other-Pass-${run}-2026` }).expect(201);
    await api().post(`/api/v1/orders/${o.orderNumber}/warranty`).set(bearer(other.body.accessToken)).send({ orderItemId: o.itemId, description: 'Not mine but trying' }).expect(404);
    await prisma.product.updateMany({ where: { variants: { some: { id: s.variant } } }, data: { warrantyMonths: null } });
    await api().post(`/api/v1/orders/${o.orderNumber}/warranty`).set(bearer(s.customer)).send({ orderItemId: o.itemId, description: 'It broke after some weeks' }).expect(400);
    await prisma.product.updateMany({ where: { variants: { some: { id: s.variant } } }, data: { warrantyMonths: 12 } });
  });
});
