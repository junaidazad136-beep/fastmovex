import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type SocialProvider = 'GOOGLE' | 'APPLE';

const ISSUERS: Record<SocialProvider, string[]> = {
  GOOGLE: ['https://accounts.google.com', 'accounts.google.com'],
  APPLE: ['https://appleid.apple.com'],
};
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'CATALOG_MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'SUPPORT_ADMIN', 'DELIVERY_AGENT'];

export interface SocialIdentity { provider: SocialProvider; subject: string; email: string | null; emailVerified: boolean; name: string | null }

/** Reads the fields we use from a verified Google / Apple ID token. Exported for tests. */
export function identityFrom(provider: SocialProvider, p: JWTPayload & Record<string, unknown>): SocialIdentity {
  if (!p.sub) throw new UnauthorizedException('Sign-in token without a user');
  const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : null;
  // Google: boolean; Apple: "true" / true. Apple's private relay addresses are real, verified mailboxes.
  const verified = p.email_verified === true || p.email_verified === 'true';
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 100) : null;
  return { provider, subject: String(p.sub), email, emailVerified: !!email && verified, name };
}

/**
 * Sign in with Google / Apple. The app or website gets an ID token from the provider; we check its signature against
 * the provider's published keys, the issuer, the audience (our own client ids) and the expiry, then find or create
 * the customer. Staff accounts never sign in this way (password + two-step only).
 */
@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly jwks = new Map<SocialProvider, ReturnType<typeof createRemoteJWKSet>>();

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService<Env, true>) {}

  private clientIds(provider: SocialProvider): string[] {
    const raw = this.config.get(provider === 'GOOGLE' ? 'GOOGLE_CLIENT_IDS' : 'APPLE_CLIENT_IDS', { infer: true }) as string | undefined;
    return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** What the website / app may show: the web client id per provider, or null when that sign-in is off. */
  providers() {
    return { google: this.clientIds('GOOGLE')[0] ?? null, apple: this.clientIds('APPLE')[0] ?? null };
  }

  private keys(provider: SocialProvider) {
    let k = this.jwks.get(provider);
    if (!k) {
      const url = this.config.get(provider === 'GOOGLE' ? 'GOOGLE_JWKS_URL' : 'APPLE_JWKS_URL', { infer: true }) as string;
      k = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 3_600_000 });
      this.jwks.set(provider, k);
    }
    return k;
  }

  async verify(provider: SocialProvider, idToken: string, nonce?: string): Promise<SocialIdentity> {
    const audience = this.clientIds(provider);
    if (!audience.length) throw new BadRequestException({ message: `Sign in with ${provider === 'GOOGLE' ? 'Google' : 'Apple'} is not available`, reason: 'SOCIAL_OFF' });
    let payload: JWTPayload & Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys(provider), { issuer: ISSUERS[provider], audience, algorithms: ['RS256', 'ES256'], clockTolerance: 60 }));
    } catch (e) {
      this.logger.warn(`${provider} token refused: ${(e as Error).message}`);
      throw new UnauthorizedException({ message: 'We could not confirm this sign-in. Please try again.', reason: 'SOCIAL_TOKEN' });
    }
    // a nonce chosen by our page must come back inside the token (stops a stolen token being replayed elsewhere)
    if (payload.nonce !== undefined || nonce !== undefined) {
      if (!nonce || payload.nonce !== nonce) throw new UnauthorizedException({ message: 'We could not confirm this sign-in. Please try again.', reason: 'SOCIAL_NONCE' });
    }
    return identityFrom(provider, payload);
  }

  /**
   * The account for this identity:
   *  1. already linked → that account;
   *  2. a verified email that matches an account → link it (a guest profile becomes a full account: the provider
   *     proved the email is theirs);
   *  3. otherwise a new customer (the email counts as verified).
   */
  async findOrCreate(id: SocialIdentity, input: { fullName?: string; locale?: 'en' | 'ar'; countryCode: string }): Promise<{ userId: string; created: boolean; linked: boolean }> {
    const linked = await this.prisma.socialAccount.findUnique({ where: { provider_subject: { provider: id.provider, subject: id.subject } }, select: { id: true, userId: true } });
    if (linked) {
      await this.assertCustomer(linked.userId);
      await this.prisma.socialAccount.update({ where: { id: linked.id }, data: { lastUsedAt: new Date(), ...(id.email && { email: id.email }) } });
      return { userId: linked.userId, created: false, linked: false };
    }
    if (!id.email || !id.emailVerified) {
      throw new BadRequestException({ message: 'Your account has no confirmed email address. Please sign up with your email instead.', reason: 'SOCIAL_NO_EMAIL' });
    }
    const existing = await this.prisma.user.findUnique({ where: { email: id.email }, select: { id: true, isGuest: true, deletedAt: true } });
    if (existing && !existing.deletedAt) {
      await this.assertCustomer(existing.id);
      await this.prisma.$transaction([
        this.prisma.socialAccount.create({ data: { userId: existing.id, provider: id.provider, subject: id.subject, email: id.email } }),
        this.prisma.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date(), ...(existing.isGuest && { isGuest: false }) } }),
      ]);
      return { userId: existing.id, created: false, linked: true };
    }
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' }, select: { id: true } });
    const fullName = (input.fullName?.trim() || id.name || id.email.split('@')[0]).slice(0, 100);
    try {
      const u = await this.prisma.user.create({
        data: {
          fullName, email: id.email, emailVerifiedAt: new Date(), passwordHash: null, countryCode: input.countryCode, locale: input.locale ?? 'en',
          roles: { create: { roleId: role.id } }, wishlists: { create: { name: 'My Wishlist', isDefault: true } },
          socialAccounts: { create: { provider: id.provider, subject: id.subject, email: id.email } },
        },
        select: { id: true },
      });
      return { userId: u.id, created: true, linked: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.findOrCreate(id, input); // two taps at once
      throw e;
    }
  }

  private async assertCustomer(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, deletedAt: true, roles: { select: { role: { select: { code: true } } } } } });
    if (u.roles.some((r) => STAFF_ROLES.includes(r.role.code))) {
      throw new ForbiddenException({ message: 'Staff accounts sign in with their password and two-step code.', reason: 'STAFF_ACCOUNT' });
    }
    if (u.deletedAt || u.status !== 'ACTIVE') throw new UnauthorizedException('This account is not active. Contact support.');
  }

  /** Sign-ins linked to the account, for the account page. */
  async linked(userId: string) {
    return this.prisma.socialAccount.findMany({ where: { userId }, select: { provider: true, email: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Unlink one; refused when it is the only way in (no password set yet). */
  async unlink(userId: string, provider: SocialProvider) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, socialAccounts: { select: { provider: true } } } });
    if (!u.socialAccounts.some((s) => s.provider === provider)) throw new BadRequestException('Not linked');
    if (!u.passwordHash && u.socialAccounts.length === 1) {
      throw new BadRequestException({ message: 'Set a password first (Forgot password), otherwise you could not sign in any more.', reason: 'LAST_SIGN_IN' });
    }
    await this.prisma.socialAccount.deleteMany({ where: { userId, provider } });
    return this.linked(userId);
  }
}
