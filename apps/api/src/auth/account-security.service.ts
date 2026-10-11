import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RequestMeta } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const INVALID_CODE = 'The code is invalid or has expired';

/** Password reset and email/phone verification. */
@Injectable()
export class AccountSecurityService {
  private readonly logger = new Logger(AccountSecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  private findByIdentifier(identifier: string) {
    const id = identifier.includes('@') ? identifier.toLowerCase() : identifier;
    return this.prisma.user.findFirst({
      where: { OR: [{ email: id }, { phone: id }], deletedAt: null, status: 'ACTIVE' },
      select: { id: true, email: true, phone: true, locale: true },
    });
  }

  /**
   * Always answers the same way and returns before anything is sent, so nobody can learn whether an
   * email or phone number has an account (not from the message, not from the response time).
   */
  forgotPassword(identifier: string, meta: RequestMeta): void {
    setImmediate(() => {
      void (async () => {
        try {
          const user = await this.findByIdentifier(identifier);
          if (!user) return;
          const byEmail = identifier.includes('@');
          const target = byEmail ? user.email : user.phone;
          if (!target) return;
          await this.otp.issue(user, 'RESET_PASSWORD', byEmail ? 'EMAIL' : 'SMS', target, meta.ip);
          await this.audit.log({ actorId: user.id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, ...meta });
        } catch (e) {
          this.logger.warn(`forgot-password not sent: ${(e as Error).message}`);
        }
      })();
    });
  }

  async resetPassword(identifier: string, code: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const user = await this.findByIdentifier(identifier);
    if (!user) {
      await this.passwords.burnTime(newPassword);
      throw new BadRequestException(INVALID_CODE);
    }
    const target = await this.otp.verify(user.id, 'RESET_PASSWORD', code);
    if (!target) throw new BadRequestException(INVALID_CODE);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        isGuest: false, // a guest who sets a password now has a normal account with all their orders
        failedLogins: 0, failedLoginAt: null, lockedUntil: null, // a new password ends a sign-in pause
        // receiving the code proves the address belongs to them
        ...(target === user.email && { emailVerifiedAt: new Date() }),
        ...(target === user.phone && { phoneVerifiedAt: new Date() }),
      },
    });
    await this.tokens.revokeAllForUser(user.id); // anyone who had the old password is logged out everywhere
    await this.audit.log({ actorId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id, ...meta });
  }

  async requestVerification(userId: string, channel: 'email' | 'phone', meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, phone: true, locale: true, emailVerifiedAt: true, phoneVerifiedAt: true } });
    const target = channel === 'email' ? user.email : user.phone;
    if (!target) throw new BadRequestException(`Add a ${channel === 'email' ? 'email address' : 'phone number'} to your account first`);
    if (channel === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt) throw new BadRequestException(`Your ${channel} is already verified`);
    return this.otp.issue(user, channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE', channel === 'email' ? 'EMAIL' : 'SMS', target, meta.ip);
  }

  async confirmVerification(userId: string, channel: 'email' | 'phone', code: string, meta: RequestMeta) {
    const target = await this.otp.verify(userId, channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE', code);
    if (!target) throw new BadRequestException(INVALID_CODE);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true } });
    // The code only proves ownership of the address it was sent to
    if ((channel === 'email' ? user.email : user.phone) !== target) throw new BadRequestException(INVALID_CODE);
    await this.prisma.user.update({ where: { id: userId }, data: channel === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() } });
    await this.audit.log({ actorId: userId, action: `auth.${channel}_verified`, entityType: 'User', entityId: userId, ...meta });
    return { channel, verified: true };
  }

  /** After sign-up: send a verification code in the background if that channel is configured. Never blocks registration. */
  sendWelcomeVerification(userId: string, meta: RequestMeta) {
    setImmediate(() => {
      void (async () => {
        try {
          const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
          if (u?.email && this.otp.channelAvailable('EMAIL')) await this.requestVerification(userId, 'email', meta);
          else if (u?.phone && this.otp.channelAvailable('SMS')) await this.requestVerification(userId, 'phone', meta);
        } catch (e) {
          this.logger.warn(`welcome verification not sent: ${(e as Error).message}`);
        }
      })();
    });
  }
}
