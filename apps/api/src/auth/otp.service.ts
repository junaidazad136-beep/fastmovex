import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_MAX_PER_HOUR = 5;

type Channel = 'EMAIL' | 'SMS';

const TEXT: Record<OtpPurpose, { en: [string, string]; ar: [string, string] }> = {
  VERIFY_EMAIL: { en: ['Your FastMoveX verification code', 'Your code is {code}. It expires in 10 minutes.'], ar: ['رمز التحقق من FastMoveX', 'رمزك هو {code}. ينتهي خلال 10 دقائق.'] },
  VERIFY_PHONE: { en: ['Your FastMoveX verification code', 'Your code is {code}. It expires in 10 minutes.'], ar: ['رمز التحقق من FastMoveX', 'رمزك هو {code}. ينتهي خلال 10 دقائق.'] },
  RESET_PASSWORD: {
    en: ['Reset your FastMoveX password', 'Your password reset code is {code}. It expires in 10 minutes. If you did not ask for this, ignore this message.'],
    ar: ['إعادة تعيين كلمة المرور', 'رمز إعادة تعيين كلمة المرور هو {code}. ينتهي خلال 10 دقائق. إذا لم تطلب ذلك، تجاهل هذه الرسالة.'],
  },
};

/** "junaid@gmail.com" -> "j****@gmail.com", "+97455551234" -> "+974******34". Exported for tests. */
export function maskTarget(target: string): string {
  if (target.includes('@')) {
    const [local, domain] = target.split('@');
    return `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
  }
  return `${target.slice(0, 4)}${'*'.repeat(Math.max(3, target.length - 6))}${target.slice(-2)}`;
}

/**
 * One-time codes. Only an HMAC of the code is stored, bound to the user and the purpose, so a leaked
 * database row is useless and a verification code can never be used to reset a password.
 * Limits: 10-minute expiry, 5 wrong tries per code, 60 s between sends, 5 sends per address per hour,
 * and every new code cancels the previous one.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = String(config.get('JWT_ACCESS_SECRET', { infer: true }));
  }

  hash(userId: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.pepper).update(`${userId}:${purpose}:${code}`).digest('hex');
  }

  channelAvailable(channel: Channel) {
    return this.notifications.channelEnabled(channel);
  }

  async issue(user: { id: string; locale: string }, purpose: OtpPurpose, channel: Channel, target: string, ip?: string, now = new Date()) {
    const last = await this.prisma.verificationCode.findFirst({ where: { userId: user.id, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000);
      throw new HttpException({ message: `Please wait ${retryAfterSeconds} seconds before asking for a new code`, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const lastHour = await this.prisma.verificationCode.count({ where: { target, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
    if (lastHour >= OTP_MAX_PER_HOUR) {
      throw new HttpException({ message: 'Too many codes requested. Try again in an hour.', retryAfterSeconds: 3600 }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.verificationCode.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } });
      return tx.verificationCode.create({
        data: { userId: user.id, purpose, channel, target, codeHash: this.hash(user.id, purpose, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS), ip },
        select: { id: true },
      });
    });

    const [title, body] = TEXT[purpose][user.locale === 'ar' ? 'ar' : 'en'];
    try {
      await this.notifications.sendDirect(channel, target, title, body.replace('{code}', code));
    } catch (e) {
      await this.prisma.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } }); // unusable, and does not burn the cooldown
      this.logger.error(`OTP send failed (${channel}): ${(e as Error).message}`);
      throw e instanceof ServiceUnavailableException ? e : new ServiceUnavailableException('Could not send the code. Please try again.');
    }
    return { sentTo: maskTarget(target), expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  /** Returns the target the code was sent to when correct, null otherwise. Wrong tries are counted atomically. */
  async verify(userId: string, purpose: OtpPurpose, code: string, now = new Date()): Promise<string | null> {
    const row = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, attempts: true, target: true },
    });
    if (!row || row.attempts >= OTP_MAX_ATTEMPTS) return null;

    const counted = await this.prisma.verificationCode.updateMany({
      where: { id: row.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) return null;

    const expected = Buffer.from(row.codeHash, 'hex');
    const given = Buffer.from(this.hash(userId, purpose, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    const consumed = await this.prisma.verificationCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
    return consumed.count === 1 ? row.target : null; // a code works exactly once, even under concurrent requests
  }
}
