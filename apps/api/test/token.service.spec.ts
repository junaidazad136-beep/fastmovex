import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../src/auth/token.service';

const SECRET = 'x'.repeat(40);

function setup(row: Record<string, unknown> | null, burnCount = 1, liveInFamily = 0) {
  const prisma = {
    refreshToken: {
      count: jest.fn().mockResolvedValue(liveInFamily),
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: burnCount }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const audit = { log: jest.fn() };
  const config = { get: (k: string) => ({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TTL_DAYS: 30 })[k] };
  const jwt = new JwtService({ secret: SECRET });
  const svc = new TokenService(jwt, prisma as never, config as never, audit as never);
  return { svc, prisma, audit, jwt };
}

const future = new Date(Date.now() + 86_400_000);
const meta = { ip: '1.2.3.4' };

describe('TokenService', () => {
  it('issues an access token and stores only the HASH of the refresh token', async () => {
    const { svc, prisma, jwt } = setup(null);
    const t = await svc.issue({ id: 'u1', roles: ['CUSTOMER'], permissions: [] }, meta);
    const stored = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(TokenService.hash(t.refreshToken));
    expect(stored.tokenHash).not.toBe(t.refreshToken);
    const payload = await jwt.verifyAsync(t.accessToken);
    expect(payload).toMatchObject({ sub: 'u1', roles: ['CUSTOMER'], typ: 'access' });
  });

  it('rejects an unknown refresh token', async () => {
    const { svc } = setup(null);
    await expect(svc.consume('nope', meta)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired refresh token', async () => {
    const { svc } = setup({ id: 'r1', userId: 'u1', familyId: 'f1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
    await expect(svc.consume('raw', meta)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('REUSE of a used token revokes the whole family and is audited', async () => {
    const usedLongAgo = new Date(Date.now() - 60_000);
    const { svc, prisma, audit } = setup({ id: 'r1', userId: 'u1', familyId: 'fam-9', revokedAt: usedLongAgo, expiresAt: future }, 1, 1);
    await expect(svc.consume('stolen', meta)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'fam-9', revokedAt: null } }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse_detected' }));
  });

  it('a token rotated seconds ago comes back while its login is alive (lost response): allowed, not theft', async () => {
    const { svc, prisma, audit } = setup({ id: 'r1', userId: 'u1', familyId: 'f1', revokedAt: new Date(Date.now() - 3000), expiresAt: future }, 1, 1);
    await expect(svc.consume('raw', meta)).resolves.toEqual({ userId: 'u1', familyId: 'f1' });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a token replayed seconds after LOGOUT (no live token left) is still treated as theft', async () => {
    const { svc, audit } = setup({ id: 'r1', userId: 'u1', familyId: 'f1', revokedAt: new Date(Date.now() - 3000), expiresAt: future }, 1, 0);
    await expect(svc.consume('raw', meta)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse_detected' }));
  });

  it('two parallel refreshes with the same token (two tabs): both succeed, nobody is logged out', async () => {
    const { svc, audit } = setup({ id: 'r1', userId: 'u1', familyId: 'f1', revokedAt: null, expiresAt: future }, 0);
    await expect(svc.consume('raw', meta)).resolves.toEqual({ userId: 'u1', familyId: 'f1' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('valid token is burned exactly once and returns owner + family', async () => {
    const { svc, prisma } = setup({ id: 'r1', userId: 'u1', familyId: 'f1', revokedAt: null, expiresAt: future });
    await expect(svc.consume('raw', meta)).resolves.toEqual({ userId: 'u1', familyId: 'f1' });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
  });
});
