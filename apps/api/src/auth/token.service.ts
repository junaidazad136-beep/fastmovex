import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AccessTokenPayload, AuthUser, RequestMeta } from '../common/auth-user';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
  refreshExpiresAt: Date;
}

/** How long a just-rotated refresh token may be presented again without being treated as stolen. */
export const REUSE_GRACE_MS = 15_000;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** `mfa`: this sign-in passed the two-step code (kept across refreshes of the same sign-in). */
  async issue(user: AuthUser, meta: RequestMeta, familyId: string = randomUUID(), mfa = false): Promise<IssuedTokens> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const payload: AccessTokenPayload = { sub: user.id, roles: user.roles, perms: user.permissions, typ: 'access', sid: familyId, ...(mfa && { mfa: true }) };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn, algorithm: 'HS256' });

    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const refreshExpiresAt = new Date(Date.now() + days * 86_400_000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: TokenService.hash(refreshToken), // raw token is never stored
        familyId,
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
        mfa,
      },
    });

    return { accessToken, refreshToken, expiresIn, refreshExpiresAt };
  }

  /**
   * Validates and burns a refresh token (single use). Returns who it belonged to.
   * If an already-used token shows up again, someone stole it: the whole login family is revoked.
   */
  async consume(raw: string, meta: RequestMeta): Promise<{ userId: string; familyId: string; mfa: boolean }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: TokenService.hash(raw) } });
    if (!row) throw new UnauthorizedException('Invalid refresh token');

    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    if (row.revokedAt) {
      if (await this.isBenignRetry(row.familyId, row.revokedAt)) return { userId: row.userId, familyId: row.familyId, mfa: row.mfa };
      await this.reuseDetected(row.userId, row.familyId, meta);
      throw new UnauthorizedException('Session expired, please log in again');
    }

    // Atomic burn: if two requests race with the same token, only one wins; the other is a benign retry.
    const burned = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (burned.count !== 1) return { userId: row.userId, familyId: row.familyId, mfa: row.mfa };

    return { userId: row.userId, familyId: row.familyId, mfa: row.mfa };
  }

  /**
   * A token rotated a few seconds ago may legitimately come back: the browser was closed or the network dropped
   * before the response carrying its replacement arrived. That is not theft as long as the login is still alive
   * (its replacement exists and is unrevoked). Logout, logout-all and password reset leave no live token,
   * so a replay after them is still treated as theft.
   */
  private async isBenignRetry(familyId: string, rotatedAt: Date): Promise<boolean> {
    if (Date.now() - rotatedAt.getTime() > REUSE_GRACE_MS) return false;
    const live = await this.prisma.refreshToken.count({ where: { familyId, revokedAt: null, createdAt: { gte: new Date(rotatedAt.getTime() - 1000) } } });
    return live > 0;
  }

  /**
   * Logout: ends the whole login the token belongs to, not just this one token. A refresh that raced the logout may
   * already have rotated it into a newer token (and set that cookie); that one dies too.
   */
  async revokeLoginByRaw(raw: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: TokenService.hash(raw) }, select: { familyId: true } });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async reuseDetected(userId: string, familyId: string, meta: RequestMeta) {
    await this.revokeFamily(familyId);
    await this.audit.log({
      actorId: userId,
      action: 'auth.refresh_reuse_detected',
      entityType: 'RefreshTokenFamily',
      entityId: familyId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
