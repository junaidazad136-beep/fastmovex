import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto, SocialLoginDto, TwoFactorLoginDto } from './dto/auth.dto';
import { SocialAuthService } from './social-auth';
import { LoginClient, LoginSecurityService } from './login-security.service';
import { TwoFactorService } from './two-factor.service';
import { PasswordService } from './password.service';
import { IssuedTokens, TokenService } from './token.service';

const INVALID_CREDENTIALS = 'Incorrect email/phone or password';

export interface SessionOptions {
  /** Admin panel sessions: only staff (and drivers, for the driver page) may sign in or refresh. */
  staffOnly?: boolean;
  client?: LoginClient;
}

/** Answer to a correct password on an account with two-step sign-in: send the code with this challenge. */
export interface TwoFactorChallenge { twoFactorRequired: true; challenge: string; expiresIn: number }
export const isChallenge = (r: IssuedTokens | TwoFactorChallenge): r is TwoFactorChallenge => 'twoFactorRequired' in r;
const CHALLENGE_TTL = 300;

/** Permissions that do not make someone staff: couriers use the driver app, not the admin panel. */
const NON_ADMIN_PERMISSIONS = new Set(['delivery.update_own']);

export function isStaff(u: Pick<AuthUser, 'permissions'>): boolean {
  return u.permissions.some((p) => !NON_ADMIN_PERMISSIONS.has(p));
}

/** Who may sign in to the panel app: staff, and FastMoveX drivers (they only get the driver page; the API checks every call). */
export function canUsePanel(u: Pick<AuthUser, 'permissions'>): boolean {
  return isStaff(u) || u.permissions.includes('delivery.update_own');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    @Optional() private readonly security?: LoginSecurityService,
    @Optional() private readonly twoFactor?: TwoFactorService,
    @Optional() private readonly jwt?: JwtService,
    @Optional() private readonly social?: SocialAuthService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<IssuedTokens & { userId: string }> {
    if (!dto.email && !dto.phone) throw new BadRequestException('Email or phone is required');

    const countryCode: string = dto.countryCode ?? this.config.get('DEFAULT_COUNTRY', { infer: true }) ?? 'QA';
    const country = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { isActive: true } });
    if (!country?.isActive) throw new BadRequestException('FastMoveX is not available in this country yet');

    const customerRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
    // Someone who ordered as a guest proves the email is theirs with a reset code before the orders become visible.
    const guest = await this.prisma.user.findFirst({
      where: { isGuest: true, OR: [...(dto.email ? [{ email: dto.email.toLowerCase() }] : []), ...(dto.phone ? [{ phone: dto.phone }] : [])] },
      select: { id: true },
    });
    if (guest) {
      throw new ConflictException({
        message: 'You have ordered with us before. Use "Forgot password" with the same email or phone to set a password and see your orders.',
        reason: 'GUEST_ACCOUNT',
      });
    }
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          passwordHash,
          countryCode,
          locale: dto.locale ?? 'en',
          roles: { create: { roleId: customerRole.id } },
          wishlists: { create: { name: 'My Wishlist', isDefault: true } },
        },
        select: { id: true },
      });
      return { ...(await this.tokens.issue(await this.loadAuthUser(user.id), meta)), userId: user.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email or phone already exists');
      }
      throw err;
    }
  }

  /**
   * Password sign-in. Accounts are paused after 5 wrong attempts in 15 minutes (on top of the per-IP limit). With
   * two-step sign-in on, a correct password returns a short-lived challenge instead of tokens (POST /auth/2fa/login).
   */
  async login(dto: LoginDto, meta: RequestMeta, opts: SessionOptions = {}): Promise<IssuedTokens | TwoFactorChallenge> {
    const client = opts.client ?? 'web';
    const identifier = dto.identifier.includes('@') ? dto.identifier.toLowerCase() : dto.identifier;
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }], deletedAt: null },
      select: { id: true, passwordHash: true, status: true, lockedUntil: true, twoFactorEnabledAt: true },
    });

    if (!user?.passwordHash) {
      await this.passwords.burnTime(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    await this.security?.assertNotLocked(user, 'password', client, meta);
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      await this.security?.failed(user.id, 'BAD_PASSWORD', 'password', client, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Checked only AFTER password is right, so status never leaks to someone guessing
    if (user.status !== 'ACTIVE') {
      await this.security?.record(user.id, false, 'INACTIVE', 'password', client, meta);
      throw new UnauthorizedException('This account is not active. Contact support.');
    }

    if (this.passwords.needsRehash(user.passwordHash)) await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(dto.password) } });

    const authUser = await this.loadAuthUser(user.id);
    if (opts.staffOnly && !canUsePanel(authUser)) {
      await this.security?.record(user.id, false, 'NOT_STAFF', 'password', client, meta);
      await this.audit.log({ actorId: user.id, action: 'auth.admin_login_denied', entityType: 'User', entityId: user.id, ...meta });
      throw new ForbiddenException('This account does not have access to the admin panel');
    }
    if (user.twoFactorEnabledAt && this.jwt) {
      const challenge = await this.jwt.signAsync({ sub: user.id, typ: 'mfa', cli: client }, { expiresIn: CHALLENGE_TTL, algorithm: 'HS256' });
      return { twoFactorRequired: true, challenge, expiresIn: CHALLENGE_TTL };
    }
    if (this.security) await this.security.succeeded(user.id, 'password', client, meta);
    else await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.tokens.issue(authUser, meta);
  }

  /**
   * Sign in (or sign up) with Google / Apple. Customers only: the admin panel and staff accounts are refused. An
   * account with two-step sign-in still needs its code (same challenge as a password sign-in).
   */
  async loginSocial(dto: SocialLoginDto, meta: RequestMeta, opts: SessionOptions = {}): Promise<(IssuedTokens | TwoFactorChallenge) & { created?: boolean }> {
    if (!this.social) throw new BadRequestException('Not available');
    if (opts.staffOnly) throw new ForbiddenException({ message: 'Staff sign in with their password and two-step code.', reason: 'STAFF_ACCOUNT' });
    const client = opts.client ?? 'web';
    const method = dto.provider.toLowerCase();
    const id = await this.social.verify(dto.provider, dto.idToken, dto.nonce);
    const countryCode: string = this.config.get('DEFAULT_COUNTRY', { infer: true }) ?? 'QA';
    const r = await this.social.findOrCreate(id, { fullName: dto.fullName, locale: dto.locale, countryCode });
    if (r.linked) {
      await this.audit.log({ actorId: r.userId, action: r.created ? 'auth.social_signup' : 'auth.social_linked', entityType: 'User', entityId: r.userId, after: { provider: dto.provider }, ...meta });
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: r.userId }, select: { id: true, lockedUntil: true, twoFactorEnabledAt: true } });
    await this.security?.assertNotLocked(user, method, client, meta);
    if (user.twoFactorEnabledAt && this.jwt) {
      const challenge = await this.jwt.signAsync({ sub: user.id, typ: 'mfa', cli: client }, { expiresIn: CHALLENGE_TTL, algorithm: 'HS256' });
      return { twoFactorRequired: true, challenge, expiresIn: CHALLENGE_TTL };
    }
    if (this.security) await this.security.succeeded(user.id, method, client, meta);
    else await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...(await this.tokens.issue(await this.loadAuthUser(user.id), meta)), created: r.created };
  }

  /** Second step: the code from the authenticator app (or a recovery code). Wrong codes count towards the account pause. */
  async loginWithCode(dto: TwoFactorLoginDto, meta: RequestMeta, opts: SessionOptions = {}): Promise<IssuedTokens> {
    const client = opts.client ?? 'web';
    let sub: string;
    try {
      const p = await this.jwt!.verifyAsync<{ sub: string; typ: string; cli: string }>(dto.challenge, { algorithms: ['HS256'], issuer: 'jovia-api' });
      if (p.typ !== 'mfa' || p.cli !== client) throw new Error('wrong challenge');
      sub = p.sub;
    } catch {
      throw new UnauthorizedException({ message: 'This sign-in took too long. Enter your password again.', reason: 'CHALLENGE_EXPIRED' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub }, select: { id: true, lockedUntil: true } });
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);
    await this.security!.assertNotLocked(user, 'totp', client, meta);
    const method = await this.twoFactor!.verifyCode(sub, dto.code);
    if (!method) {
      await this.security!.failed(sub, 'BAD_CODE', 'totp', client, meta);
      throw new UnauthorizedException({ message: 'That code is not right. Use the newest code from your app, or a recovery code.', reason: 'BAD_CODE' });
    }
    const authUser = await this.loadAuthUser(sub);
    if (opts.staffOnly && !canUsePanel(authUser)) throw new ForbiddenException('This account does not have access to the admin panel');
    await this.security!.succeeded(sub, method, client, meta);
    if (method === 'recovery') await this.audit.log({ actorId: sub, action: 'auth.2fa_recovery_used', entityType: 'User', entityId: sub, ...meta });
    return this.tokens.issue(authUser, meta, undefined, true);
  }

  /** A fresh session that counts as two-step verified (right after two-step sign-in was turned on with a code). */
  async issueVerified(userId: string, meta: RequestMeta): Promise<IssuedTokens> {
    return this.tokens.issue(await this.loadAuthUser(userId), meta, undefined, true);
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta, opts: SessionOptions = {}): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException('Session expired, please log in again');
    const { userId, familyId, mfa } = await this.tokens.consume(rawToken, meta);
    try {
      // Roles/permissions are reloaded on every refresh, so admin changes apply within one access-token lifetime.
      const authUser = await this.loadAuthUser(userId);
      // A staff member whose roles were removed loses the admin session at the next refresh.
      if (opts.staffOnly && !canUsePanel(authUser)) throw new ForbiddenException('This account does not have access to the admin panel');
      return await this.tokens.issue(authUser, meta, familyId, mfa);
    } catch (err) {
      await this.tokens.revokeFamily(familyId);
      throw err;
    }
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revokeLoginByRaw(rawToken);
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({ actorId: userId, action: 'auth.logout_all', entityType: 'User', entityId: userId, ...meta });
  }

  async changePassword(userId: string, dto: ChangePasswordDto, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash || !(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(dto.newPassword) } });
    await this.tokens.revokeAllForUser(userId); // log out every device
    await this.audit.log({ actorId: userId, action: 'auth.password_changed', entityType: 'User', entityId: userId, ...meta });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true, phone: true, locale: true, countryCode: true,
        emailVerifiedAt: true, phoneVerifiedAt: true, createdAt: true, marketingOptIn: true, whatsappOptIn: true, deletionScheduledFor: true, refundLimitMinor: true,
        passwordHash: true, socialAccounts: { select: { provider: true } },
        roles: { select: { role: { select: { code: true } } } },
        seller: { select: { id: true, status: true, store: { select: { slug: true, name: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException();
    const { roles, deletionScheduledFor, refundLimitMinor, passwordHash, socialAccounts, ...rest } = user;
    // account deletion scheduled: the apps show "Your account will be deleted on … — Keep my account"
    const codes = roles.map((r) => r.role.code);
    const staff = codes.some((c) => c !== 'CUSTOMER' && c !== 'SELLER');
    return {
      ...rest, roles: codes, deletion: deletionScheduledFor ? { deleteOn: deletionScheduledFor } : null,
      // signed up with Google / Apple only: no password yet ("Forgot password" sets one)
      hasPassword: !!passwordHash, signIns: socialAccounts.map((s) => s.provider),
      // staff only: the biggest refund this person may approve (null = no limit)
      ...(staff && { refundLimitMinor: refundLimitMinor?.toString() ?? null }),
    };
  }

  /** Single place that turns a user row into roles + permission codes for the access token. */
  async loadAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        roles: {
          select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new UnauthorizedException('This account is not active. Contact support.');
    }
    const roles = user.roles.map((r) => r.role.code);
    const permissions = [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))];
    return { id: user.id, roles, permissions };
  }
}
