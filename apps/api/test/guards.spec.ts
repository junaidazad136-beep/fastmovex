import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ALLOW_PENDING_SELLER_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY,
} from '../src/common/decorators/auth.decorators';
import { AccessGuard } from '../src/common/guards/access.guard';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { SellerGuard } from '../src/common/guards/seller.guard';
import { assertOwnedBy } from '../src/common/utils/ownership';
import { fakeContext, fakeReflector } from './helpers';

const jwt = new JwtService({ secret: 's'.repeat(40), signOptions: { issuer: 'jovia-api' } });

describe('JwtAuthGuard', () => {
  it('protected route without token -> 401', async () => {
    const g = new JwtAuthGuard(jwt, fakeReflector({}));
    await expect(g.canActivate(fakeContext({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('public route without token -> allowed as guest', async () => {
    const g = new JwtAuthGuard(jwt, fakeReflector({ [IS_PUBLIC_KEY]: true }));
    await expect(g.canActivate(fakeContext({ headers: {} }))).resolves.toBe(true);
  });

  it('valid access token -> req.user filled', async () => {
    const token = await jwt.signAsync({ sub: 'u1', roles: ['ADMIN'], perms: ['orders.read'], typ: 'access' });
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
    await new JwtAuthGuard(jwt, fakeReflector({})).canActivate(fakeContext(req));
    expect(req.user).toMatchObject({ id: 'u1', roles: ['ADMIN'], permissions: ['orders.read'], mfa: false });
  });

  it('token signed with another secret -> 401', async () => {
    const forged = await new JwtService({ secret: 'z'.repeat(40) }).signAsync({ sub: 'u1', roles: ['SUPER_ADMIN'], perms: [], typ: 'access' }, { issuer: 'jovia-api' });
    const g = new JwtAuthGuard(jwt, fakeReflector({}));
    await expect(g.canActivate(fakeContext({ headers: { authorization: `Bearer ${forged}` } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token without typ=access is rejected', async () => {
    const token = await jwt.signAsync({ sub: 'u1', roles: [], perms: [] });
    const g = new JwtAuthGuard(jwt, fakeReflector({}));
    await expect(g.canActivate(fakeContext({ headers: { authorization: `Bearer ${token}` } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AccessGuard (admin permissions)', () => {
  const support = { id: 'a', roles: ['SUPPORT_ADMIN'], permissions: ['tickets.read', 'tickets.reply'] };
  const finance = { id: 'b', roles: ['FINANCE_ADMIN'], permissions: ['payouts.read', 'payouts.approve'] };

  it('support admin cannot approve payouts', () => {
    const g = new AccessGuard(fakeReflector({ [PERMISSIONS_KEY]: ['payouts.approve'] }));
    expect(() => g.canActivate(fakeContext({ user: support }))).toThrow(ForbiddenException);
  });

  it('finance admin can approve payouts', () => {
    const g = new AccessGuard(fakeReflector({ [PERMISSIONS_KEY]: ['payouts.approve'] }));
    expect(g.canActivate(fakeContext({ user: finance }))).toBe(true);
  });

  it('customer cannot enter seller routes', () => {
    const g = new AccessGuard(fakeReflector({ [ROLES_KEY]: ['SELLER'] }));
    expect(() => g.canActivate(fakeContext({ user: { id: 'c', roles: ['CUSTOMER'], permissions: [] } }))).toThrow(ForbiddenException);
  });

  it('route with no rules is open to any logged-in user', () => {
    expect(new AccessGuard(fakeReflector({})).canActivate(fakeContext({}))).toBe(true);
  });
});

describe('SellerGuard + ownership (seller isolation)', () => {
  const sellerUser = { id: 'owner-A', roles: ['SELLER'], permissions: [] };
  const prismaWith = (seller: unknown) => ({ seller: { findUnique: jest.fn().mockResolvedValue(seller) } }) as never;

  it('attaches the seller that belongs to the logged-in user', async () => {
    const req: Record<string, unknown> = { user: sellerUser };
    const g = new SellerGuard(prismaWith({ id: 'seller-A', status: 'APPROVED', countryCode: 'QA' }), fakeReflector({}));
    await g.canActivate(fakeContext(req));
    expect(req.seller).toEqual({ id: 'seller-A', status: 'APPROVED', countryCode: 'QA' });
  });

  it('pending seller blocked from normal routes', async () => {
    const g = new SellerGuard(prismaWith({ id: 's', status: 'PENDING', countryCode: 'QA' }), fakeReflector({}));
    await expect(g.canActivate(fakeContext({ user: sellerUser }))).rejects.toThrow('awaiting approval');
  });

  it('pending seller allowed on onboarding routes', async () => {
    const g = new SellerGuard(prismaWith({ id: 's', status: 'PENDING', countryCode: 'QA' }), fakeReflector({ [ALLOW_PENDING_SELLER_KEY]: true }));
    await expect(g.canActivate(fakeContext({ user: sellerUser }))).resolves.toBe(true);
  });

  it('suspended seller blocked even on onboarding routes', async () => {
    const g = new SellerGuard(prismaWith({ id: 's', status: 'SUSPENDED', countryCode: 'QA' }), fakeReflector({ [ALLOW_PENDING_SELLER_KEY]: true }));
    await expect(g.canActivate(fakeContext({ user: sellerUser }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('non-seller user -> 403', async () => {
    const g = new SellerGuard(prismaWith(null), fakeReflector({}));
    await expect(g.canActivate(fakeContext({ user: { id: 'c', roles: ['CUSTOMER'], permissions: [] } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("seller A reading seller B's product gets 404 (not 403, no id probing)", () => {
    expect(() => assertOwnedBy({ sellerId: 'seller-B' }, 'seller-A', 'Product')).toThrow(NotFoundException);
  });

  it('missing resource -> 404', () => {
    expect(() => assertOwnedBy(null, 'seller-A', 'Order')).toThrow('Order not found');
  });

  it('own resource passes', () => {
    expect(() => assertOwnedBy({ sellerId: 'seller-A' }, 'seller-A')).not.toThrow();
  });
});
