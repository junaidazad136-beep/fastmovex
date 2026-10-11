import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { PasswordService } from '../src/auth/password.service';

const passwords = new PasswordService();
let goodHash: string;
beforeAll(async () => {
  goodHash = await passwords.hash('secret123');
});

function setup(overrides: { user?: unknown; createError?: Error } = {}) {
  const authUserRow = {
    id: 'u1', status: 'ACTIVE', deletedAt: null,
    roles: [{ role: { code: 'CUSTOMER', permissions: [] } }],
  };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(overrides.user ?? null),
      findUnique: jest.fn().mockResolvedValue(authUserRow),
      update: jest.fn().mockResolvedValue({}),
      create: overrides.createError
        ? jest.fn().mockRejectedValue(overrides.createError)
        : jest.fn().mockResolvedValue({ id: 'u1' }),
    },
    country: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-customer' }) },
  };
  const tokens = {
    issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, refreshExpiresAt: new Date() }),
    consume: jest.fn(),
    revokeFamily: jest.fn(),
    revokeAllForUser: jest.fn(),
    revokeByRaw: jest.fn(),
  };
  const pw = new PasswordService();
  const burn = jest.spyOn(pw, 'burnTime');
  const config = { get: () => 'QA' };
  const audit = { log: jest.fn() };
  const svc = new AuthService(prisma as never, pw, tokens as never, audit as never, config as never);
  return { svc, prisma, tokens, burn };
}

describe('AuthService.login', () => {
  it('unknown user -> generic 401, and still spends hashing time (no account enumeration)', async () => {
    const { svc, burn } = setup();
    await expect(svc.login({ identifier: 'x@y.com', password: 'secret123' }, {})).rejects.toThrow('Incorrect email/phone or password');
    expect(burn).toHaveBeenCalled();
  });

  it('wrong password -> same generic 401', async () => {
    const { svc } = setup({ user: { id: 'u1', passwordHash: goodHash, status: 'ACTIVE' } });
    await expect(svc.login({ identifier: 'x@y.com', password: 'wrong999' }, {})).rejects.toThrow('Incorrect email/phone or password');
  });

  it('suspended user with correct password -> 401, no tokens issued', async () => {
    const { svc, tokens } = setup({ user: { id: 'u1', passwordHash: goodHash, status: 'SUSPENDED' } });
    await expect(svc.login({ identifier: 'x@y.com', password: 'secret123' }, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('correct credentials -> tokens with roles loaded from DB', async () => {
    const { svc, tokens } = setup({ user: { id: 'u1', passwordHash: goodHash, status: 'ACTIVE' } });
    await svc.login({ identifier: 'X@Y.com', password: 'secret123' }, {});
    expect(tokens.issue).toHaveBeenCalledWith({ id: 'u1', roles: ['CUSTOMER'], permissions: [] }, {});
  });
});

describe('AuthService.register', () => {
  it('duplicate email/phone -> 409', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    const { svc } = setup({ createError: dup });
    await expect(svc.register({ fullName: 'A B', email: 'a@b.com', password: 'secret123' }, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores an argon2id hash, never the plain password', async () => {
    const { svc, prisma } = setup();
    await svc.register({ fullName: 'A B', email: 'a@b.com', password: 'secret123' }, {});
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(data)).not.toContain('secret123');
  });
});

describe('AuthService.refresh', () => {
  it('if the user got suspended, refresh fails and the family is revoked', async () => {
    const { svc, prisma, tokens } = setup();
    tokens.consume.mockResolvedValue({ userId: 'u1', familyId: 'f1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'SUSPENDED', deletedAt: null, roles: [] });
    await expect(svc.refresh('raw', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.revokeFamily).toHaveBeenCalledWith('f1');
  });

  it('missing token -> 401', async () => {
    const { svc } = setup();
    await expect(svc.refresh(undefined, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
