import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RequestMeta } from '../common/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { deviceHash, deviceLabel } from './totp';

export const LOCK_AFTER = 5;
export const LOCK_WINDOW_MS = 15 * 60_000;
export const LOCK_FOR_MS = 15 * 60_000;
export type LoginClient = 'web' | 'admin' | 'mobile';

/**
 * What happens around a sign-in: per-account lockout after repeated failures (on top of the per-IP rate limit),
 * a history of every attempt, an email when an account is used from a new device, and the list of signed-in devices.
 */
@Injectable()
export class LoginSecurityService {
  private readonly logger = new Logger(LoginSecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Refuses while the account is paused; the attempt is still recorded. */
  async assertNotLocked(user: { id: string; lockedUntil: Date | null }, method: string, client: LoginClient, meta: RequestMeta, now = new Date()) {
    if (!user.lockedUntil || user.lockedUntil <= now) return;
    await this.record(user.id, false, 'LOCKED', method, client, meta);
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new HttpException(
      { message: `Too many wrong attempts. Signing in to this account is paused for ${minutes} more minute${minutes === 1 ? '' : 's'}, or reset your password.`, reason: 'ACCOUNT_LOCKED', retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** A wrong password or code: counted within a 15-minute window; the 5th pauses the account for 15 minutes. */
  async failed(userId: string, reason: 'BAD_PASSWORD' | 'BAD_CODE', method: string, client: LoginClient, meta: RequestMeta, now = new Date()) {
    await this.record(userId, false, reason, method, client, meta);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { failedLogins: true, failedLoginAt: true } });
    const fresh = !u.failedLoginAt || now.getTime() - u.failedLoginAt.getTime() > LOCK_WINDOW_MS;
    const count = fresh ? 1 : u.failedLogins + 1;
    if (count >= LOCK_AFTER) {
      await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, failedLoginAt: null, lockedUntil: new Date(now.getTime() + LOCK_FOR_MS) } });
      await this.audit.log({ actorId: userId, action: 'auth.account_locked', entityType: 'User', entityId: userId, after: { attempts: count, reason }, ...meta });
      await this.notifications?.notify(userId, 'ACCOUNT_LOCKED', { n: count }).catch((e: Error) => this.logger.warn(`lock notice failed: ${e.message}`));
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: count, failedLoginAt: fresh ? now : u.failedLoginAt } });
    }
  }

  /** A successful sign-in: counters reset, history written, and an email when the device was never used before. */
  async succeeded(userId: string, method: string, client: LoginClient, meta: RequestMeta, now = new Date()) {
    const hash = deviceHash(meta.userAgent);
    const [seen, before] = await Promise.all([
      this.prisma.loginEvent.count({ where: { userId, success: true, deviceHash: hash, createdAt: { gte: new Date(now.getTime() - 180 * 86_400_000) } } }),
      this.prisma.loginEvent.count({ where: { userId, success: true } }),
    ]);
    const newDevice = before > 0 && seen === 0; // the very first sign-in is not news
    await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, failedLoginAt: null, lockedUntil: null, lastLoginAt: now } });
    await this.record(userId, true, 'OK', method, client, meta, newDevice);
    if (newDevice) {
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Qatar', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      await this.notifications?.notify(userId, 'NEW_SIGN_IN', { device: deviceLabel(meta.userAgent), time }).catch((e: Error) => this.logger.warn(`new sign-in notice failed: ${e.message}`));
    }
  }

  async record(userId: string, success: boolean, reason: string, method: string, client: LoginClient, meta: RequestMeta, newDevice = false) {
    await this.prisma.loginEvent.create({
      data: { userId, success, reason, method, client, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, device: deviceLabel(meta.userAgent), deviceHash: deviceHash(meta.userAgent), newDevice },
    });
  }

  history(userId: string, take = 30) {
    return this.prisma.loginEvent.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take,
      select: { id: true, success: true, reason: true, method: true, client: true, ip: true, device: true, newDevice: true, createdAt: true },
    });
  }

  /** Signed-in devices: one per live refresh-token family (the newest token of each). */
  async sessions(userId: string, currentId?: string) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, createdAt: true, ip: true, userAgent: true, mfa: true },
    });
    const firsts = await this.prisma.refreshToken.groupBy({ by: ['familyId'], where: { familyId: { in: rows.map((r) => r.familyId) } }, _min: { createdAt: true } });
    const started = new Map(firsts.map((f) => [f.familyId, f._min.createdAt]));
    return rows.map((r) => ({
      id: r.familyId, device: deviceLabel(r.userAgent), ip: r.ip, lastActiveAt: r.createdAt, signedInAt: started.get(r.familyId) ?? r.createdAt,
      twoStep: r.mfa, current: r.familyId === currentId,
    }));
  }

  async revokeSession(userId: string, familyId: string, meta: RequestMeta) {
    const owned = await this.prisma.refreshToken.count({ where: { userId, familyId } });
    if (!owned) throw new NotFoundException('Session not found');
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: userId, action: 'auth.session_revoked', entityType: 'RefreshTokenFamily', entityId: familyId, ...meta });
  }

  /** Staff looking at someone else's history (users.read / admins.manage). */
  async historyFor(targetId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!u) throw new NotFoundException('User not found');
    return this.history(targetId, 50);
  }

  static forbiddenSelf() { return new ForbiddenException('You cannot do this to your own account'); }
}
