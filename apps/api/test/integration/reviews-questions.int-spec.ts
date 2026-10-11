/**
 * Review photos and product questions on a real database and storage: photos are cleaned (upright, smaller, WebP,
 * no GPS/metadata), moderated, removable by the customer and by staff, and shown in the product's photo gallery;
 * questions are private until the store answers, limited per customer, answered once, and the customer is told.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/storage/storage.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Review photos and product questions — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stored: { key: string; body: Buffer; type: string }[] = [];
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  async function login(identifier: string, password = DEMO_PASSWORD) {
    return (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  }
  async function customer(tag: string) {
    const reg = await api().post('/api/v1/auth/register').send({ fullName: `Reem ${tag} Saleh`, email: `rq.${tag}.${run}@jovia.test`, password: 'Buyer-Pass-123' }).expect(201);
    return reg.body.accessToken as string;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    const storage = app.get(StorageService);
    const put = storage.put.bind(storage);
    jest.spyOn(storage, 'put').mockImplementation(async (v, key, body, type) => { stored.push({ key, body, type }); return put(v, key, body, type); });

    s.admin = await login('admin@demo.jovia.test');
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Review Kettle ${run}`, titleAr: 'غلاية', categoryId: cat.id, variants: [{ sku: `RQ-${run}`, priceMinor: '9000', initialStock: 20 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.product = p.body.id;
    s.slug = (await prisma.product.findUniqueOrThrow({ where: { id: p.body.id } })).slug;

    // a customer who bought it and received it
    s.buyer = await customer('buyer');
    const address = (await api().post('/api/v1/addresses').set(bearer(s.buyer)).send({ recipientName: 'Reem', phone: '+97455500077', city: 'Doha', zone: '60', street: '800', building: '3' }).expect(201)).body.id;
    await api().post('/api/v1/cart/items').set(bearer(s.buyer)).send({ variantId: p.body.variants[0].id, quantity: 1 }).expect(201);
    const order = await api().post('/api/v1/checkout').set(bearer(s.buyer)).set('Idempotency-Key', `rq-${run}`).send({ addressId: address, paymentMethod: 'COD' }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: order.body.orderNumber }, include: { items: true } });
    await prisma.sellerOrder.updateMany({ where: { orderId: o.id }, data: { deliveredAt: new Date() } });
    s.item = o.items[0].id;
  });

  afterAll(async () => { await app?.close(); });

  // ------------------------------------------------------------------ review photos

  it('a photo is stored upright, at most 1600 px, as WebP, without the GPS position or any other metadata', async () => {
    const review = await api().post('/api/v1/reviews').set(bearer(s.buyer)).send({ orderItemId: s.item, target: 'PRODUCT', rating: 5 }).expect(201);
    s.review = review.body.id;
    expect(review.body.status).toBe('APPROVED'); // stars only: live at once

    // a phone photo: 2400×1200, taken sideways (EXIF orientation 6), with a GPS position
    const phone = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c08040' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Make: 'PhoneCo', Copyright: 'Reem' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 17/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '51/1 31/1 0/1' } })
      .toBuffer();
    expect(await sharp(phone).metadata()).toMatchObject({ orientation: 6, exif: expect.any(Buffer) });
    expect(phone.includes(Buffer.from('PhoneCo'))).toBe(true);
    const up = await api().post(`/api/v1/reviews/${s.review}/images`).set(bearer(s.buyer)).attach('file', phone, 'IMG_0001.jpg').expect(201);
    expect(up.body.status).toBe('PENDING'); // photos are checked by staff first
    const saved = stored.find((x) => x.key.startsWith(`reviews/${s.review}/`))!;
    expect(saved.type).toBe('image/webp');
    expect(saved.key).toMatch(/\.webp$/);
    const meta = await sharp(saved.body).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 800, height: 1600 }); // turned upright, then shrunk
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(saved.body.includes(Buffer.from('PhoneCo'))).toBe(false);

    // not shown while waiting
    const pub = (await api().get(`/api/v1/products/${s.slug}/reviews`).expect(200)).body;
    expect(pub.items).toHaveLength(0);
  });

  it('a file that is not a photo is refused; at most 5 photos', async () => {
    await api().post(`/api/v1/reviews/${s.review}/images`).set(bearer(s.buyer)).attach('file', Buffer.from('%PDF-1.4 not a photo'), 'x.jpg').expect(400);
    const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
    for (let i = 0; i < 4; i++) await api().post(`/api/v1/reviews/${s.review}/images`).set(bearer(s.buyer)).attach('file', small, `${i}.png`).expect(201);
    await api().post(`/api/v1/reviews/${s.review}/images`).set(bearer(s.buyer)).attach('file', small, '6.png').expect(400);
  });

  it('the customer and staff can take single photos off; someone else cannot', async () => {
    const other = await customer('other');
    await api().delete(`/api/v1/reviews/${s.review}/images/0`).set(bearer(other)).expect(404);
    const mine = await api().delete(`/api/v1/reviews/${s.review}/images/4`).set(bearer(s.buyer)).expect(200);
    expect(mine.body.images).toHaveLength(4);
    const staff = await api().post(`/api/v1/admin/reviews/${s.review}/images/3/remove`).set(bearer(s.admin)).expect(200);
    expect(staff.body.images).toHaveLength(3);
    await api().post(`/api/v1/admin/reviews/${s.review}/images/9/remove`).set(bearer(s.admin)).expect(404);
    expect((await api().get('/api/v1/me/reviews').set(bearer(s.buyer)).expect(200)).body[0].images).toHaveLength(3);
  });

  it('once published, the photos lead the reviews ("Customer photos") and can be filtered', async () => {
    await api().post(`/api/v1/admin/reviews/${s.review}/moderate`).set(bearer(s.admin)).send({ status: 'APPROVED' }).expect(200);
    const pub = (await api().get(`/api/v1/products/${s.slug}/reviews`).expect(200)).body;
    expect(pub.summary).toMatchObject({ ratingCount: 1, photoReviews: 1 });
    expect(pub.photos).toHaveLength(3);
    expect(pub.photos[0]).toMatchObject({ reviewId: s.review, rating: 5 });
    expect(pub.photos[0].url).toMatch(/\.webp$/);
    expect((await api().get(`/api/v1/products/${s.slug}/reviews`).query({ withPhotos: true }).expect(200)).body.items).toHaveLength(1);
  });

  // ------------------------------------------------------------------ questions

  it('a question stays private until the store answers it', async () => {
    s.asker = await customer('asker');
    await api().post(`/api/v1/products/${s.slug}/questions`).send({ body: 'Does it switch off by itself?' }).expect(401);
    await api().post(`/api/v1/products/${s.slug}/questions`).set(bearer(s.asker)).send({ body: 'short' }).expect(400);
    const q = await api().post(`/api/v1/products/${s.slug}/questions`).set(bearer(s.asker)).send({ body: '  Does it switch off   by itself when the water boils? ' }).expect(201);
    s.question = q.body.id;
    expect(q.body.status).toBe('PENDING');
    expect((await api().get(`/api/v1/products/${s.slug}/questions`).expect(200)).body).toMatchObject({ total: 0, items: [] });
    const mine = (await api().get('/api/v1/me/questions').set(bearer(s.asker)).expect(200)).body;
    expect(mine[0]).toMatchObject({ question: 'Does it switch off by itself when the water boils?', status: 'PENDING', answer: null });
  });

  it('too many unanswered questions from one customer are refused', async () => {
    for (let i = 0; i < 2; i++) await api().post(`/api/v1/products/${s.slug}/questions`).set(bearer(s.asker)).send({ body: `Another question number ${i}?` }).expect(201);
    const res = await api().post(`/api/v1/products/${s.slug}/questions`).set(bearer(s.asker)).send({ body: 'One question too many here?' }).expect(429);
    expect(res.body.reason).toBe('TOO_MANY_OPEN');
  });

  it('staff answer it: it appears on the product page and the customer is told, once', async () => {
    const queue = (await api().get('/api/v1/admin/questions').set(bearer(s.admin)).expect(200)).body;
    const row = queue.items.find((x: { id: string }) => x.id === s.question);
    expect(row).toMatchObject({ askedBy: 'Reem S.', status: 'PENDING', product: { slug: s.slug } });
    const summary = (await api().get('/api/v1/admin/dashboard/summary').set(bearer(s.admin)).expect(200)).body;
    expect(summary.questionsPending).toBeGreaterThanOrEqual(3);

    await api().post(`/api/v1/admin/questions/${s.question}/answer`).set(bearer(s.admin)).send({ answer: 'Yes — it switches off automatically and has boil-dry protection.' }).expect(200);
    const pub = (await api().get(`/api/v1/products/${s.slug}/questions`).expect(200)).body;
    expect(pub.total).toBe(1);
    expect(pub.items[0]).toMatchObject({ question: 'Does it switch off by itself when the water boils?', answer: 'Yes — it switches off automatically and has boil-dry protection.', askedBy: 'Reem S.', answeredBy: { name: expect.any(String) } });

    const asker = await prisma.user.findFirstOrThrow({ where: { email: `rq.asker.${run}@jovia.test` } });
    const sent = await prisma.notification.findMany({ where: { userId: asker.id, type: 'QUESTION_ANSWERED' } });
    expect(sent.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(sent.find((n) => n.channel === 'IN_APP')!.body).toContain(`Review Kettle ${run}`);

    // editing the answer does not message the customer again
    await api().patch(`/api/v1/admin/questions/${s.question}/answer`).set(bearer(s.admin)).send({ answer: 'Yes, it switches off automatically.' }).expect(200);
    expect((await api().get(`/api/v1/products/${s.slug}/questions`).expect(200)).body.items[0].answer).toBe('Yes, it switches off automatically.');
    expect(await prisma.notification.count({ where: { userId: asker.id, type: 'QUESTION_ANSWERED' } })).toBe(2);
  });

  it('staff can turn down a question; customers cannot use the staff queue', async () => {
    const queue = (await api().get('/api/v1/admin/questions').set(bearer(s.admin)).expect(200)).body;
    const spam = queue.items.find((x: { body: string }) => x.body === 'Another question number 0?');
    await api().post(`/api/v1/admin/questions/${spam.id}/reject`).set(bearer(s.admin)).send({ reason: 'Duplicate' }).expect(200);
    expect((await api().get('/api/v1/me/questions').set(bearer(s.asker)).expect(200)).body.find((x: { id: string }) => x.id === spam.id).status).toBe('REJECTED');
    await api().get('/api/v1/admin/questions').set(bearer(s.asker)).expect(403);
    await api().post(`/api/v1/admin/questions/${spam.id}/answer`).set(bearer(s.asker)).send({ answer: 'hacked' }).expect(403);
  });
});
