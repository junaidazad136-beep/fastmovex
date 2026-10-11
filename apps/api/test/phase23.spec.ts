import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createServer, Server } from 'http';
import { identityFrom, SocialAuthService } from '../src/auth/social-auth';
import { ETA, estimateArrival } from '../src/delivery/delivery-rules';
import { pushUrl } from '../src/notifications/web-push';
import { checkCouponFacts, CouponService } from '../src/pricing/coupon.service';

describe('Phase 23 — Google / Apple identity', () => {
  it('reads the fields we use; Apple sends email_verified as a string', () => {
    expect(identityFrom('GOOGLE', { sub: '123', email: ' Sara@Example.COM ', email_verified: true, name: 'Sara Demo' })).toEqual({ provider: 'GOOGLE', subject: '123', email: 'sara@example.com', emailVerified: true, name: 'Sara Demo' });
    expect(identityFrom('APPLE', { sub: 'a.1', email: 'x@privaterelay.appleid.com', email_verified: 'true' }).emailVerified).toBe(true);
    expect(identityFrom('GOOGLE', { sub: '1', email: 'a@b.qa', email_verified: false }).emailVerified).toBe(false);
    expect(identityFrom('GOOGLE', { sub: '1' })).toMatchObject({ email: null, emailVerified: false, name: null });
    expect(() => identityFrom('GOOGLE', {})).toThrow(UnauthorizedException);
  });

  describe('token check against the provider keys', () => {
    let server: Server;
    let url = '';
    let key: CryptoKey;
    let other: CryptoKey;
    beforeAll(async () => {
      const pair = await generateKeyPair('RS256', { extractable: true });
      key = pair.privateKey as CryptoKey;
      other = (await generateKeyPair('RS256')).privateKey as CryptoKey;
      const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
      server = createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
      url = `http://127.0.0.1:${(server.address() as { port: number }).port}/certs`;
    });
    afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

    const svc = (cfg: Record<string, string | undefined>) => new SocialAuthService({} as never, { get: (k: string) => cfg[k] } as never);
    const token = (claims: Record<string, unknown>, signer = key, iss = 'https://accounts.google.com', aud = 'web.apps.googleusercontent.com') =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setSubject('g-1').setIssuedAt().setExpirationTime('5m').sign(signer);

    it('accepts a token for our client id with the nonce we chose', async () => {
      const s = svc({ GOOGLE_CLIENT_IDS: 'web.apps.googleusercontent.com,ios.apps.googleusercontent.com', GOOGLE_JWKS_URL: url });
      const id = await s.verify('GOOGLE', await token({ email: 'a@b.qa', email_verified: true, nonce: 'n1' }), 'n1');
      expect(id).toMatchObject({ subject: 'g-1', email: 'a@b.qa', emailVerified: true });
      expect(s.providers()).toEqual({ google: 'web.apps.googleusercontent.com', apple: null });
    });
    it('refuses another audience, a forged signature, a wrong or missing nonce, and a switched-off provider', async () => {
      const s = svc({ GOOGLE_CLIENT_IDS: 'web.apps.googleusercontent.com', GOOGLE_JWKS_URL: url });
      await expect(s.verify('GOOGLE', await token({ nonce: 'n' }, key, 'https://accounts.google.com', 'someone-else'), 'n')).rejects.toThrow(UnauthorizedException);
      await expect(s.verify('GOOGLE', await token({ nonce: 'n' }, other), 'n')).rejects.toThrow(UnauthorizedException);
      await expect(s.verify('GOOGLE', await token({ nonce: 'n' }, key, 'https://evil.example'), 'n')).rejects.toThrow(UnauthorizedException);
      await expect(s.verify('GOOGLE', await token({ nonce: 'n' }), 'other')).rejects.toThrow(UnauthorizedException);
      await expect(s.verify('GOOGLE', await token({ nonce: 'n' }), undefined)).rejects.toThrow(UnauthorizedException);
      await expect(s.verify('GOOGLE', await token({}), 'expected')).rejects.toThrow(UnauthorizedException);
      await expect(svc({ GOOGLE_JWKS_URL: url }).verify('GOOGLE', await token({}), undefined)).rejects.toThrow(BadRequestException);
    });
  });

  it('staff accounts never sign in with Google / Apple; the last way in cannot be removed', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'ACTIVE', deletedAt: null, roles: [{ role: { code: 'ADMIN' } }], passwordHash: null, socialAccounts: [{ provider: 'GOOGLE' }] }) },
      socialAccount: { findUnique: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1' }), update: jest.fn() },
    };
    const s = new SocialAuthService(prisma as never, { get: () => undefined } as never);
    await expect(s.findOrCreate({ provider: 'GOOGLE', subject: 'x', email: 'a@b.qa', emailVerified: true, name: null }, { countryCode: 'QA' })).rejects.toThrow(ForbiddenException);
    await expect(s.unlink('u1', 'GOOGLE')).rejects.toThrow(BadRequestException);
  });

  it('an unconfirmed email never links to an existing account', async () => {
    const prisma = { socialAccount: { findUnique: jest.fn().mockResolvedValue(null) }, user: { findUnique: jest.fn() } };
    const s = new SocialAuthService(prisma as never, { get: () => undefined } as never);
    await expect(s.findOrCreate({ provider: 'APPLE', subject: 'x', email: 'a@b.qa', emailVerified: false, name: null }, { countryCode: 'QA' })).rejects.toThrow(BadRequestException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('Phase 23 — browser notifications', () => {
  it('a tap opens the order (or the inbox) in the customer’s language, never another site', () => {
    expect(pushUrl({ orderNumber: 'FMX-QA-20261006-ABC123' }, 'ar')).toBe('/ar/account/orders/FMX-QA-20261006-ABC123');
    expect(pushUrl({ orderNumber: 'https://evil.example' }, 'en')).toBe('/en/account/notifications');
    expect(pushUrl(null, 'fr')).toBe('/en/account/notifications');
  });
});

describe('Phase 23 — delivery ETA', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const pin = { lat: 25.2854, lng: 51.531 };
  it('road time from the driver’s position plus the stops before yours, rounded up to 5 minutes', () => {
    const driver = { lat: 25.3154, lng: 51.531, at: new Date(now.getTime() - 60_000) }; // ~3.3 km north
    const e = estimateArrival({ now, driver, pin, stopsBefore: 2 })!;
    // 3.34 km × 1.4 ≈ 4.67 km at 25 km/h ≈ 11 min, + 2 × 8 min
    expect(e.minutes).toBe(27);
    expect(e.stopsBefore).toBe(2);
    expect(e.at.getTime() % 300_000).toBe(0);
    expect(e.at.getTime()).toBeGreaterThanOrEqual(now.getTime() + 27 * 60_000);
  });
  it('at the door: at least a few minutes; no estimate without a fresh position or a pin', () => {
    expect(estimateArrival({ now, driver: { ...pin, at: now }, pin, stopsBefore: 0 })!.minutes).toBe(ETA.MIN_MIN);
    expect(estimateArrival({ now, driver: { ...pin, at: new Date(now.getTime() - 25 * 60_000) }, pin, stopsBefore: 0 })).toBeNull();
    expect(estimateArrival({ now, driver: null, pin, stopsBefore: 0 })).toBeNull();
    expect(estimateArrival({ now, driver: { ...pin, at: now }, pin: null, stopsBefore: 0 })).toBeNull();
  });
});

describe('Phase 23 — promo codes on phone orders', () => {
  const coupon = { id: 'c', code: 'WELCOME', type: 'PERCENT', scope: 'ORDER', fundedBy: 'PLATFORM', valueBps: 1000, valueMinor: null, maxDiscountMinor: null, minOrderMinor: 0n, sellerId: null, category: null, firstOrderOnly: true, newCustomerDays: 30, startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01'), usageLimit: null, perUserLimit: 1, usedCount: 0, isActive: true };
  it('a caller who gets a new profile counts as a new customer on a first order', async () => {
    const prisma = { coupon: { findUnique: jest.fn().mockResolvedValue(coupon) } };
    const svc = new CouponService(prisma as never);
    expect(await svc.resolve('welcome', 'QA', undefined, new Date('2026-10-06'), true)).toHaveProperty('rule');
    // without an owner at all the code still needs an account
    expect(await svc.resolve('welcome', 'QA', undefined, new Date('2026-10-06'))).toEqual({ error: 'LOGIN_REQUIRED' });
    expect(checkCouponFacts(coupon as never, { now: new Date('2026-10-06'), userId: 'u', userOrderCount: 2, userRedemptions: 0 })).toBe('FIRST_ORDER_ONLY');
  });
});
