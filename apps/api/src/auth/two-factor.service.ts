import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CryptoService } from '../common/crypto/crypto.service';
import { isStaffUser, staffTwoFactorRequired } from '../common/guards/two-factor.guard';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUrl, verifyTotp } from './totp';

/**
 * Two-step sign-in with an authenticator app (TOTP), plus 10 one-time recovery codes for a lost phone.
 * Secrets are stored encrypted (AES-256-GCM), recovery codes as hashes, and every code works once.
 */
@Injectable()
export class TwoFactorService {
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.pepper = String(config.get('JWT_ACCESS_SECRET', { infer: true }));
  }

  requiredFor(user: Pick<AuthUser, 'permissions'>) {
    return isStaffUser(user) && staffTwoFactorRequired(this.config);
  }

  async status(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorEnabledAt: true, twoFactorRecovery: true } });
    return { enabled: !!u.twoFactorEnabledAt, enabledAt: u.twoFactorEnabledAt, recoveryCodesLeft: u.twoFactorRecovery.length, required: this.requiredFor(user), thisSession: !!user.mfa };
  }

  /** Step 1: a new secret for the authenticator app (QR code). Nothing changes until it is confirmed with a code. */
  async setup(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true, twoFactorEnabledAt: true } });
    if (u.twoFactorEnabledAt) throw new ConflictException('Two-step sign-in is already on. Turn it off first to move it to another phone.');
    const secret = newSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorPendingSecret: this.crypto.encrypt(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, u.email ?? u.phone ?? userId) };
  }

  /** Step 2: the first code from the app turns it on. Every other session is signed out; recovery codes are shown once. */
  async enable(user: AuthUser, code: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorPendingSecret: true, twoFactorEnabledAt: true } });
    if (u.twoFactorEnabledAt) throw new ConflictException('Two-step sign-in is already on');
    if (!u.twoFactorPendingSecret) throw new BadRequestException('Start the setup first');
    const secret = this.crypto.decrypt(u.twoFactorPendingSecret);
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException({ message: 'That code is not right. Check the time on your phone and try the newest code.', reason: 'BAD_CODE' });
    const recovery = newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: u.twoFactorPendingSecret, twoFactorPendingSecret: null, twoFactorEnabledAt: new Date(), twoFactorLastStep: step,
        twoFactorRecovery: recovery.map((c) => hashRecoveryCode(c, this.pepper)),
      },
    });
    await this.tokens.revokeAllForUser(user.id);
    await this.audit.log({ actorId: user.id, action: 'auth.2fa_enabled', entityType: 'User', entityId: user.id, ...meta });
    return recovery;
  }

  /** Checks a sign-in code: the app's 6 digits (each used once) or a recovery code (removed when used). */
  async verifyCode(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorSecret: true, twoFactorLastStep: true, twoFactorRecovery: true } });
    if (!u?.twoFactorSecret) return null;
    const clean = code.trim();
    if (/^\d{6}$/.test(clean)) {
      const step = verifyTotp(this.crypto.decrypt(u.twoFactorSecret), clean, Date.now(), u.twoFactorLastStep);
      if (step === null) return null;
      // atomic: the same code sent twice at once is accepted only once
      const n = await this.prisma.$executeRaw`UPDATE "User" SET "twoFactorLastStep" = ${step} WHERE "id" = ${userId}::uuid AND ("twoFactorLastStep" IS NULL OR "twoFactorLastStep" < ${step})`;
      return n === 1 ? 'totp' : null;
    }
    const hash = hashRecoveryCode(clean, this.pepper);
    if (!u.twoFactorRecovery.includes(hash)) return null;
    const n = await this.prisma.$executeRaw`UPDATE "User" SET "twoFactorRecovery" = array_remove("twoFactorRecovery", ${hash}) WHERE "id" = ${userId}::uuid AND ${hash} = ANY("twoFactorRecovery")`;
    return n === 1 ? 'recovery' : null;
  }

  async regenerateRecovery(userId: string, code: string, meta: RequestMeta) {
    if ((await this.verifyCode(userId, code)) !== 'totp') throw new BadRequestException({ message: 'Enter the current code from your authenticator app', reason: 'BAD_CODE' });
    const recovery = newRecoveryCodes();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorRecovery: recovery.map((c) => hashRecoveryCode(c, this.pepper)) } });
    await this.audit.log({ actorId: userId, action: 'auth.2fa_recovery_regenerated', entityType: 'User', entityId: userId, ...meta });
    return recovery;
  }

  /** Turning it off needs the password and a code; staff cannot turn it off where it is required. */
  async disable(user: AuthUser, password: string, code: string, meta: RequestMeta) {
    if (this.requiredFor(user)) throw new ForbiddenException({ message: 'Two-step sign-in is required for staff accounts.', reason: 'TWO_FACTOR_REQUIRED' });
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, twoFactorEnabledAt: true } });
    if (!u.twoFactorEnabledAt) throw new BadRequestException('Two-step sign-in is not on');
    if (!u.passwordHash || !(await this.passwords.verify(u.passwordHash, password))) throw new UnauthorizedException('Password is incorrect');
    if (!(await this.verifyCode(user.id, code))) throw new BadRequestException({ message: 'That code is not right', reason: 'BAD_CODE' });
    await this.clear(user.id);
    await this.tokens.revokeAllForUser(user.id);
    await this.audit.log({ actorId: user.id, action: 'auth.2fa_disabled', entityType: 'User', entityId: user.id, ...meta });
  }

  /** A staff member lost their phone and their recovery codes: an admin clears it; they set it up again at next sign-in. */
  async adminReset(targetId: string, actor: AuthUser, meta: RequestMeta) {
    if (targetId === actor.id) throw new ForbiddenException('Ask another admin to reset your two-step sign-in');
    const t = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, roles: { select: { role: { select: { code: true } } } } } });
    if (!t) throw new NotFoundException('User not found');
    if (t.roles.some((r) => r.role.code === 'SUPER_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Only a super admin can reset a super admin');
    await this.clear(targetId);
    await this.tokens.revokeAllForUser(targetId);
    await this.audit.log({ actorId: actor.id, action: 'auth.2fa_reset', entityType: 'User', entityId: targetId, ...meta });
    return { ok: true };
  }

  private clear(userId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null, twoFactorRecovery: [] } });
  }
}
