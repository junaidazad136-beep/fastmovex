import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AccountSecurityService } from '../src/auth/account-security.service';
import { maskTarget, OTP_MAX_ATTEMPTS, OtpService } from '../src/auth/otp.service';
import { validateEnv } from '../src/config/env';

const config = { get: () => 'pepper-'.padEnd(48, 'x') };
const now = new Date('2026-09-28T12:00:00Z');

function otpWith(prisma: Record<string, unknown>, notifications: Record<string, unknown> = { sendDirect: jest.fn(), channelEnabled: () => true }) {
  return new OtpService(prisma as never, notifications as never, config as never);
}

describe('OTP codes', () => {
  it('masks addresses', () => {
    expect(maskTarget('junaid@gmail.com')).toBe('j*****@gmail.com');
    expect(maskTarget('+97455551234')).toBe('+974******34');
  });

  it('hash is bound to user and purpose (a verify code cannot reset a password)', () => {
    const o = otpWith({});
    expect(o.hash('u1', 'VERIFY_EMAIL', '123456')).not.toBe(o.hash('u1', 'RESET_PASSWORD', '123456'));
    expect(o.hash('u1', 'VERIFY_EMAIL', '123456')).not.toBe(o.hash('u2', 'VERIFY_EMAIL', '123456'));
  });

  it('60-second resend cooldown', async () => {
    const prisma = { verificationCode: { findFirst: jest.fn().mockResolvedValue({ createdAt: new Date(now.getTime() - 20_000) }) } };
    await expect(otpWith(prisma).issue({ id: 'u', locale: 'en' }, 'VERIFY_EMAIL', 'EMAIL', 'a@b.com', undefined, now)).rejects.toMatchObject({ status: 429 });
  });

  it('max 5 codes per address per hour', async () => {
    const prisma = { verificationCode: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(5) } };
    await expect(otpWith(prisma).issue({ id: 'u', locale: 'en' }, 'VERIFY_EMAIL', 'EMAIL', 'a@b.com', undefined, now)).rejects.toBeInstanceOf(HttpException);
  });

  it('stores only a hash, cancels older codes, sends a 6-digit code (Arabic for Arabic users)', async () => {
    const tx = { verificationCode: { updateMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'c1' }) } };
    const prisma = { verificationCode: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const sendDirect = jest.fn();
    const res = await otpWith(prisma, { sendDirect }).issue({ id: 'u', locale: 'ar' }, 'RESET_PASSWORD', 'SMS', '+97455551234', '1.1.1.1', now);
    expect(res).toEqual({ sentTo: '+974******34', expiresInSeconds: 600 });
    expect(tx.verificationCode.updateMany).toHaveBeenCalledWith({ where: { userId: 'u', purpose: 'RESET_PASSWORD', consumedAt: null }, data: { consumedAt: now } });
    const body: string = sendDirect.mock.calls[0][3];
    const code = body.match(/\d{6}/)![0];
    expect(body).toContain('إعادة تعيين');
    const stored = tx.verificationCode.create.mock.calls[0][0].data;
    expect(stored.codeHash).not.toContain(code);
    expect(stored.codeHash).toBe(otpWith({}).hash('u', 'RESET_PASSWORD', code));
  });

  it('if sending fails the code is voided and a clear 503 is returned', async () => {
    const tx = { verificationCode: { updateMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'c1' }) } };
    const update = jest.fn();
    const prisma = { verificationCode: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), update }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    await expect(otpWith(prisma, { sendDirect: jest.fn().mockRejectedValue(new Error('twilio down')) }).issue({ id: 'u', locale: 'en' }, 'VERIFY_PHONE', 'SMS', '+97455551234', undefined, now))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(update.mock.calls[0][0].data.consumedAt).toBeInstanceOf(Date);
  });

  const row = (o: object = {}) => ({ id: 'c1', codeHash: otpWith({}).hash('u', 'VERIFY_EMAIL', '111111'), attempts: 0, target: 'a@b.com', ...o });

  it('correct code works exactly once', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    await expect(otpWith({ verificationCode: { findFirst: jest.fn().mockResolvedValue(row()), updateMany } }).verify('u', 'VERIFY_EMAIL', '111111', now)).resolves.toBe('a@b.com');
    const raced = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(otpWith({ verificationCode: { findFirst: jest.fn().mockResolvedValue(row()), updateMany: raced } }).verify('u', 'VERIFY_EMAIL', '111111', now)).resolves.toBeNull();
  });

  it('wrong code is counted; locked after 5 tries even with the right code', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await expect(otpWith({ verificationCode: { findFirst: jest.fn().mockResolvedValue(row()), updateMany } }).verify('u', 'VERIFY_EMAIL', '222222', now)).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 } } }));
    await expect(otpWith({ verificationCode: { findFirst: jest.fn().mockResolvedValue(row({ attempts: OTP_MAX_ATTEMPTS })) } }).verify('u', 'VERIFY_EMAIL', '111111', now)).resolves.toBeNull();
  });
});

describe('password reset', () => {
  const tokens = { revokeAllForUser: jest.fn() };
  const audit = { log: jest.fn() };
  const passwords = { hash: jest.fn().mockResolvedValue('$argon2id$new'), burnTime: jest.fn() };
  const user = { id: 'u', email: 'a@b.com', phone: null, locale: 'en' };

  it('unknown account -> same "invalid code" error, time spent anyway', async () => {
    const svc = new AccountSecurityService({ user: { findFirst: jest.fn().mockResolvedValue(null) } } as never, {} as never, passwords as never, tokens as never, audit as never);
    await expect(svc.resetPassword('nobody@x.com', '123456', 'newpass123', {})).rejects.toThrow('invalid or has expired');
    expect(passwords.burnTime).toHaveBeenCalled();
  });

  it('valid code sets the new password, verifies the email and logs out every device', async () => {
    const update = jest.fn();
    const otp = { verify: jest.fn().mockResolvedValue('a@b.com') };
    const svc = new AccountSecurityService({ user: { findFirst: jest.fn().mockResolvedValue(user), update } } as never, otp as never, passwords as never, tokens as never, audit as never);
    await svc.resetPassword('A@B.com', '123456', 'newpass123', {});
    expect(update.mock.calls[0][0].data).toMatchObject({ passwordHash: '$argon2id$new', emailVerifiedAt: expect.any(Date) });
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u');
  });

  it('forgot-password answers instantly and never throws, even for unknown accounts', () => {
    const svc = new AccountSecurityService({ user: { findFirst: jest.fn().mockResolvedValue(null) } } as never, {} as never, passwords as never, tokens as never, audit as never);
    expect(() => svc.forgotPassword('nobody@x.com', {})).not.toThrow();
  });

  it('a code sent to an old email cannot verify a changed email', async () => {
    const otp = { verify: jest.fn().mockResolvedValue('old@b.com') };
    const prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'new@b.com', phone: null }) } };
    const svc = new AccountSecurityService(prisma as never, otp as never, passwords as never, tokens as never, audit as never);
    await expect(svc.confirmVerification('u', 'email', '123456', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('production configuration guard', () => {
  const base = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'Zq8'.repeat(16), FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    S3_ACCESS_KEY_ID: 'x', S3_SECRET_ACCESS_KEY: 'x', S3_BUCKET_PUBLIC: 'p', S3_BUCKET_PRIVATE: 'q', PUBLIC_MEDIA_BASE_URL: 'https://media.fastmovex.qa', CORS_ORIGINS: 'https://fastmovex.qa',
  };
  it('accepts a safe config', () => expect(() => validateEnv(base)).not.toThrow());
  it('refuses log drivers (they would print codes into logs)', () => expect(() => validateEnv({ ...base, NOTIFY_SMS_DRIVER: 'log' })).toThrow('NOTIFY_SMS_DRIVER'));
  it('refuses localhost CORS', () => expect(() => validateEnv({ ...base, CORS_ORIGINS: 'http://localhost:3000' })).toThrow('CORS_ORIGINS'));
});
