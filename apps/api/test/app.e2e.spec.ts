import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Boots the REAL app module (all guards, pipes, DI) with a fake database. Catches wiring mistakes. */
describe('App wiring (e2e, mocked DB)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const prisma = {
    $connect: jest.fn(), $disconnect: jest.fn(),
    category: { findMany: jest.fn().mockResolvedValue([{ id: '1', parentId: null, slug: 'electronics', name: 'Electronics', nameAr: 'إلكترونيات', iconKey: null, sortOrder: 0 }]) },
    seller: { findUnique: jest.fn().mockResolvedValue({ id: 'seller-A', status: 'PENDING', countryCode: 'QA' }) },
    country: { findMany: jest.fn().mockResolvedValue([{ code: 'QA', currencyCode: 'QAR', vatRateBps: 0, pricesIncludeTax: true, defaultLocale: 'en', deliveryConfig: {}, currency: { minorUnits: 2 } }]), findUnique: jest.fn().mockResolvedValue({ searchSettings: {} }) },
    cart: { findUnique: jest.fn().mockResolvedValue(null) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
    address: { findMany: jest.fn().mockResolvedValue([]) },
    faqEntry: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { count: jest.fn().mockResolvedValue(0) },
    banner: { findMany: jest.fn().mockResolvedValue([]) },
    campaignProduct: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    store: { findMany: jest.fn().mockResolvedValue([]) },
    recentlyViewed: { findMany: jest.fn().mockResolvedValue([]) },
    homeSection: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwt = mod.get(JwtService);
  });
  afterAll(() => app.close());

  const token = (roles: string[], perms: string[] = []) => jwt.sign({ sub: 'u1', roles, perms, typ: 'access' });

  it('GET /api/v1/categories is public', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
    expect(res.body[0]).toMatchObject({ slug: 'electronics', children: [] });
  });

  it('seller routes need login', () => request(app.getHttpServer()).get('/api/v1/seller/products').expect(401));

  it('customer token cannot reach seller routes', () =>
    request(app.getHttpServer()).get('/api/v1/seller/products').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).expect(403));

  it('pending seller blocked from products but allowed on onboarding', async () => {
    await request(app.getHttpServer()).get('/api/v1/seller/products').set('Authorization', `Bearer ${token(['SELLER'])}`).expect(403);
  });

  it('customer cannot approve sellers', () =>
    request(app.getHttpServer())
      .post('/api/v1/admin/sellers/7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11/approve')
      .set('Authorization', `Bearer ${token(['CUSTOMER'])}`)
      .expect(403));

  it('unknown body fields are rejected (mass-assignment protection)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'a@b.com', password: 'x', isAdmin: true })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('isAdmin');
  });

  it('bad money format rejected before reaching the service', async () => {
    prisma.seller.findUnique.mockResolvedValueOnce({ id: 'seller-A', status: 'APPROVED', countryCode: 'QA' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/seller/products')
      .set('Authorization', `Bearer ${token(['SELLER'])}`)
      .send({ title: 'Test product', categoryId: '7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11', variants: [{ sku: 'A1', priceMinor: '99.50' }] })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('minor units');
  });

  it('GET /home works for guests', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/home').expect(200);
    expect(res.body).toMatchObject({ country: 'QA', currencyCode: 'QAR' });
    expect(res.body.sections.map((s: { key: string }) => s.key)).toEqual(['value_props', 'categories']);
  });

  it('GET /search rejects an unknown sort', () => request(app.getHttpServer()).get('/api/v1/search?sort=hacked').expect(400));

  it('GET /search rejects a market that is not live', () => request(app.getHttpServer()).get('/api/v1/search').set('X-Country', 'AE').expect(400));

  it('GET /search returns a page', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/search?q=iphone&sort=price_asc').expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0, page: 1 });
  });

  it('suggest needs at least 2 characters', () => request(app.getHttpServer()).get('/api/v1/search/suggest?q=a').expect(400));

  it('GET /cart for a new guest returns an empty cart', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cart').expect(200);
    expect(res.body).toMatchObject({ groups: [], canCheckout: false, totals: { totalMinor: '0' } });
  });

  it('client cannot send a price when adding to cart', () =>
    request(app.getHttpServer()).post('/api/v1/cart/items').send({ variantId: '7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11', quantity: 1, priceMinor: '1' }).expect(400));

  it('quantity above limit rejected', () =>
    request(app.getHttpServer()).post('/api/v1/cart/items').send({ variantId: '7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11', quantity: 500 }).expect(400));

  it('applying a coupon requires login', () => request(app.getHttpServer()).post('/api/v1/cart/coupon').send({ code: 'SAVE10' }).expect(401));

  it('customer cannot create platform coupons', () =>
    request(app.getHttpServer()).post('/api/v1/admin/coupons').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).send({}).expect(403));

  it('checkout requires login', () =>
    request(app.getHttpServer()).post('/api/v1/checkout').send({ addressId: '7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11', paymentMethod: 'COD' }).expect(401));

  it('checkout rejects an unknown payment method before touching the cart', () =>
    request(app.getHttpServer()).post('/api/v1/checkout').set('Authorization', `Bearer ${token(['CUSTOMER'])}`)
      .send({ addressId: '7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11', paymentMethod: 'CRYPTO' }).expect(400));

  it('customer can list their own orders', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/orders').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('a customer cannot browse the admin order list', () =>
    request(app.getHttpServer()).get('/api/v1/admin/orders').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).expect(403));

  it('seller order status is restricted to real statuses', () => {
    prisma.seller.findUnique.mockResolvedValueOnce({ id: 'seller-A', status: 'APPROVED', countryCode: 'QA' });
    return request(app.getHttpServer()).post('/api/v1/seller/orders/7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11/status')
      .set('Authorization', `Bearer ${token(['SELLER'])}`).send({ status: 'REFUNDED' }).expect(400);
  });

  it('payment webhook with a bad signature is rejected', () =>
    request(app.getHttpServer()).post('/api/v1/payments/webhook/test').send({ id: 'evt_1', type: 'payment.captured', ref: 'test_1', status: 'CAPTURED' }).expect(403));

  it('only sellers can request payouts', () =>
    request(app.getHttpServer()).post('/api/v1/seller/payouts').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).send({ amountMinor: '10000' }).expect(403));

  it('support admin cannot mark payouts as paid', () =>
    request(app.getHttpServer()).post('/api/v1/admin/payouts/7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11/mark-paid')
      .set('Authorization', `Bearer ${token(['SUPPORT_ADMIN'], ['tickets.read', 'returns.manage'])}`).send({ reference: 'TRF-1' }).expect(403));

  it('finance summary needs ledger.read', () =>
    request(app.getHttpServer()).get('/api/v1/admin/finance/summary').set('Authorization', `Bearer ${token(['OPERATIONS_ADMIN'], ['orders.read'])}`).expect(403));

  it('return request is validated', () =>
    request(app.getHttpServer()).post('/api/v1/orders/FMX-QA-260922-AAA/returns').set('Authorization', `Bearer ${token(['CUSTOMER'])}`)
      .send({ orderItemId: 'not-a-uuid', quantity: 0, reason: 'x' }).expect(400));

  it('FAQ is public', () => request(app.getHttpServer()).get('/api/v1/faq').expect(200));

  it('wishlist needs login', () => request(app.getHttpServer()).get('/api/v1/wishlists').expect(401));

  it('unread notifications count', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me/notifications/unread-count').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).expect(200);
    expect(res.body).toEqual({ unread: 0 });
  });

  it('customers cannot moderate reviews', () =>
    request(app.getHttpServer()).get('/api/v1/admin/reviews').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).expect(403));

  it('rating must be 1-5', () =>
    request(app.getHttpServer()).post('/api/v1/reviews').set('Authorization', `Bearer ${token(['CUSTOMER'])}`)
      .send({ orderItemId: '7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11', target: 'PRODUCT', rating: 6 }).expect(400));

  it('courier endpoints are for delivery agents only', () =>
    request(app.getHttpServer()).get('/api/v1/courier/jobs').set('Authorization', `Bearer ${token(['CUSTOMER'])}`).expect(403));

  it('analytics needs analytics.read', () =>
    request(app.getHttpServer()).get('/api/v1/admin/analytics/overview').set('Authorization', `Bearer ${token(['SUPPORT_ADMIN'], ['tickets.read'])}`).expect(403));

  it('invalid analytics range is rejected', () =>
    request(app.getHttpServer()).get('/api/v1/admin/analytics/overview?range=forever').set('Authorization', `Bearer ${token(['ADMIN'], ['analytics.read'])}`).expect(400));

  it('regular admins cannot create staff accounts (needs admins.manage)', () =>
    request(app.getHttpServer()).post('/api/v1/admin/staff').set('Authorization', `Bearer ${token(['ADMIN'], ['users.read'])}`).send({}).expect(403));

  it('banner links must be site paths or https (no javascript: URLs)', () =>
    request(app.getHttpServer()).patch('/api/v1/admin/banners/7b0c2f7e-2a4c-4a57-9c1e-2b0a8f3d6e11')
      .set('Authorization', `Bearer ${token(['ADMIN'], ['banners.manage'])}`).send({ linkUrl: 'javascript:alert(1)' }).expect(400));

  it('forgot-password gives the same 202 answer for any identifier', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/password/forgot').send({ identifier: 'nobody@nowhere.test' }).expect(202);
    expect(res.body.message).toContain('If an account exists');
  });

  it('reset needs a 6-digit code', () =>
    request(app.getHttpServer()).post('/api/v1/auth/password/reset').send({ identifier: 'a@b.com', code: '12', newPassword: 'newpass123' }).expect(400));

  it('verification requires login', () => request(app.getHttpServer()).post('/api/v1/auth/verify/request').send({ channel: 'email' }).expect(401));
});
