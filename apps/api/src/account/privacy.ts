import {
  Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Optional, Param, ParseUUIDPipe,
  Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { AuthUser } from '../common/auth-user';
import { requestMeta } from '../common/utils/request-meta';
import { AllowWithoutTwoFactor, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** Days between asking and deleting: time to change your mind (and to finish anything still open). */
export const DELETION_GRACE_DAYS = 14;
const OPEN_ORDER = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'RETURN_REQUESTED'] as const;
export const DELETED_NAME = 'Deleted customer';

/** What is kept of an order's delivery address once the customer is deleted: the area only (for statistics). Exported for tests. */
export function scrubAddress(a: unknown): Record<string, unknown> {
  const src = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const keep = ['countryCode', 'city', 'zone', 'area'];
  return { recipientName: DELETED_NAME, ...Object.fromEntries(keep.filter((k) => src[k] != null).map((k) => [k, src[k]])) };
}

class DeletionDto {
  @ApiPropertyOptional({ description: 'Current password (required when the account has one)' }) @IsOptional() @IsString() @MaxLength(200) password?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(300) reason?: string;
}

/**
 * The customer's rights under Qatar's personal data law (PDPPL): a copy of everything FastMoveX holds about them, and
 * deleting the account. Deletion waits 14 days (sign in to cancel), then removes personal details; orders, payments
 * and invoices stay for the accounting record, without name, email, phone or address.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ export

  async exportData(userId: string, actorId = userId) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true, phone: true, locale: true, countryCode: true, createdAt: true, emailVerifiedAt: true, phoneVerifiedAt: true,
        marketingOptIn: true, whatsappOptIn: true, whatsappOptInAt: true, lastLoginAt: true, twoFactorEnabledAt: true, isGuest: true,
        deletionRequestedAt: true, deletionScheduledFor: true,
      },
    });
    if (!u) throw new NotFoundException('Account not found');
    const [addresses, orders, returns, reviews, questions, wishlists, tickets, notifications, logins, cart, viewed, devices] = await Promise.all([
      this.prisma.address.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.order.findMany({
        where: { userId }, orderBy: { placedAt: 'asc' },
        select: {
          orderNumber: true, status: true, placedAt: true, currencyCode: true, subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true, totalMinor: true,
          shippingAddress: true, customerNote: true, deliverySlotStart: true, deliverySlotEnd: true, trafficSource: true,
          items: { select: { productTitle: true, sku: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true, refundedQty: true, status: true } },
          payments: { select: { method: true, status: true, amountMinor: true, refundedMinor: true, createdAt: true } },
          refunds: { select: { amountMinor: true, reason: true, status: true, creditNoteNo: true, createdAt: true, completedAt: true } },
        },
      }),
      this.prisma.returnRequest.findMany({ where: { userId }, select: { quantity: true, reason: true, status: true, condition: true, resolution: true, createdAt: true, orderItem: { select: { productTitle: true, order: { select: { orderNumber: true } } } } } }),
      this.prisma.review.findMany({ where: { userId }, select: { rating: true, body: true, status: true, createdAt: true, product: { select: { title: true } } } }),
      this.prisma.productQuestion.findMany({ where: { userId }, select: { body: true, answer: true, status: true, createdAt: true, product: { select: { title: true } } } }),
      this.prisma.wishlist.findMany({ where: { userId }, select: { name: true, items: { select: { addedAt: true, priceAtAddMinor: true, product: { select: { title: true } } } } } }),
      this.prisma.supportTicket.findMany({
        where: { userId }, orderBy: { createdAt: 'asc' },
        select: { number: true, subject: true, status: true, createdAt: true, messages: { where: { isInternal: false }, orderBy: { createdAt: 'asc' }, select: { body: true, createdAt: true, authorId: true } } },
      }),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200, select: { channel: true, type: true, title: true, body: true, status: true, createdAt: true } }),
      this.prisma.loginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, select: { success: true, reason: true, method: true, client: true, ip: true, device: true, createdAt: true } }),
      this.prisma.cart.findMany({ where: { userId }, select: { countryCode: true, items: { select: { quantity: true, variant: { select: { sku: true, product: { select: { title: true } } } } } } } }),
      this.prisma.recentlyViewed.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, take: 100, select: { viewedAt: true, product: { select: { title: true } } } }),
      this.prisma.deviceToken.count({ where: { userId } }),
    ]);
    await this.audit.log({ actorId, action: 'privacy.data_exported', entityType: 'User', entityId: userId });
    const big = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(big) : v instanceof Date ? v : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, big(x)])) : v);
    return big({
      about: 'Everything FastMoveX holds about your account. Amounts are in minor units (QAR 1.00 = 100). Card numbers are never stored by FastMoveX.',
      exportedAt: new Date(),
      account: { ...u, twoStepSignIn: !!u.twoFactorEnabledAt, twoFactorEnabledAt: undefined },
      addresses, orders, returns, reviews, questions, wishlists,
      supportTickets: tickets.map((t) => ({ ...t, messages: t.messages.map(({ authorId, ...m }) => ({ ...m, from: authorId === userId ? 'you' : 'FastMoveX' })) })),
      notifications, signIns: logins, carts: cart, recentlyViewed: viewed, pushDevices: devices,
    }) as Record<string, unknown>;
  }

  // ------------------------------------------------------------------ deletion

  async status(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { deletionRequestedAt: true, deletionScheduledFor: true } });
    return { requested: !!u.deletionRequestedAt, requestedAt: u.deletionRequestedAt, deleteOn: u.deletionScheduledFor, graceDays: DELETION_GRACE_DAYS, blockers: await this.blockers(userId) };
  }

  /** Reasons the account cannot be deleted yet (open orders, returns or refunds still on the way). */
  async blockers(userId: string) {
    const [orders, returns, refunds] = await Promise.all([
      this.prisma.order.count({ where: { userId, status: { in: [...OPEN_ORDER] } } }),
      this.prisma.returnRequest.count({ where: { userId, status: { in: ['REQUESTED', 'APPROVED', 'RECEIVED'] } } }),
      this.prisma.refund.count({ where: { order: { userId }, status: { in: ['PENDING', 'PROCESSING'] } } }),
    ]);
    return [
      ...(orders ? [{ reason: 'OPEN_ORDERS', count: orders }] : []),
      ...(returns ? [{ reason: 'OPEN_RETURNS', count: returns }] : []),
      ...(refunds ? [{ reason: 'REFUNDS_PENDING', count: refunds }] : []),
    ];
  }

  async request(user: AuthUser, dto: DeletionDto, meta: ReturnType<typeof requestMeta>, now = new Date()) {
    if (user.permissions.length) throw new ForbiddenException({ message: 'Staff accounts are removed by an admin (Staff page).', reason: 'STAFF_ACCOUNT' });
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, deletionRequestedAt: true, seller: { select: { id: true } }, locale: true } });
    if (u.seller) throw new ForbiddenException({ message: 'Seller accounts are closed through FastMoveX support (payouts and documents must be settled first).', reason: 'SELLER_ACCOUNT' });
    if (u.deletionRequestedAt) throw new ConflictException('Deletion is already scheduled');
    if (u.passwordHash && !(dto.password && (await this.passwords.verify(u.passwordHash, dto.password)))) throw new UnauthorizedException({ message: 'Password is incorrect', reason: 'BAD_PASSWORD' });
    const blockers = await this.blockers(user.id);
    if (blockers.length) throw new ConflictException({ message: 'Please wait until your open orders, returns and refunds are finished, then try again.', reason: 'OPEN_ACTIVITY', blockers });
    const deleteOn = new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000);
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: now, deletionScheduledFor: deleteOn, deletionReason: dto.reason || null, marketingOptIn: false } });
    await this.tokens.revokeAllForUser(user.id); // signed out everywhere; signing in again shows "Keep my account"
    await this.audit.log({ actorId: user.id, action: 'privacy.deletion_requested', entityType: 'User', entityId: user.id, after: { deleteOn }, ...meta });
    const date = new Intl.DateTimeFormat(u.locale === 'ar' ? 'ar-QA' : 'en-GB', { timeZone: 'Asia/Qatar', day: 'numeric', month: 'long', year: 'numeric' }).format(deleteOn);
    await this.notifications?.notify(user.id, 'ACCOUNT_DELETION_SCHEDULED', { date }).catch((e: Error) => this.logger.warn(`deletion notice failed: ${e.message}`));
    return { requested: true, deleteOn };
  }

  async cancel(userId: string, meta: ReturnType<typeof requestMeta>) {
    const n = await this.prisma.user.updateMany({ where: { id: userId, deletionRequestedAt: { not: null }, deletedAt: null }, data: { deletionRequestedAt: null, deletionScheduledFor: null, deletionReason: null } });
    if (n.count !== 1) throw new ConflictException('No deletion is scheduled');
    await this.audit.log({ actorId: userId, action: 'privacy.deletion_cancelled', entityType: 'User', entityId: userId, ...meta });
    return { requested: false };
  }

  /** Every night (03:30 Qatar): accounts whose waiting period is over are deleted. */
  @Cron('30 0 * * *')
  async nightly() {
    if (process.env.NODE_ENV === 'test') return;
    try { await this.runDue(); } catch (e) { this.logger.error(`account deletion run failed: ${(e as Error).message}`); }
  }

  async runDue(now = new Date()) {
    const due = await this.prisma.user.findMany({ where: { deletionScheduledFor: { lte: now }, deletedAt: null }, select: { id: true }, take: 200 });
    let deleted = 0;
    let waiting = 0;
    for (const { id } of due) {
      if ((await this.blockers(id)).length) {
        // something was still open (e.g. a return started during the waiting period): try again tomorrow
        await this.prisma.user.update({ where: { id }, data: { deletionScheduledFor: new Date(now.getTime() + 86_400_000) } });
        waiting += 1;
        continue;
      }
      await this.anonymise(id, null);
      deleted += 1;
    }
    return { deleted, waiting };
  }

  /** Removes the person from FastMoveX's records; what the law requires to keep (orders, payments, invoices) stays without them. */
  async anonymise(userId: string, actorId: string | null) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, locale: true, deletedAt: true } });
    if (u.deletedAt) return;
    if (u.email) {
      const ar = u.locale === 'ar';
      await this.notifications?.sendDirect('EMAIL', u.email, ar ? 'تم حذف حسابك في فاست موف إكس' : 'Your FastMoveX account was deleted',
        ar ? 'تم حذف حسابك وبياناتك الشخصية كما طلبت. شكراً لتسوقك معنا.' : 'Your account and personal details were deleted as you asked. Thank you for having shopped with us.')
        .catch((e: Error) => this.logger.warn(`deleted notice failed: ${e.message}`));
    }
    await this.prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({ where: { userId }, select: { id: true, shippingAddress: true } });
      for (const o of orders) await tx.order.update({ where: { id: o.id }, data: { shippingAddress: scrubAddress(o.shippingAddress) as Prisma.InputJsonValue, customerNote: null } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.cart.deleteMany({ where: { userId } });
      await tx.wishlist.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.recentlyViewed.deleteMany({ where: { userId } });
      await tx.verificationCode.deleteMany({ where: { userId } });
      await tx.loginEvent.deleteMany({ where: { userId } });
      await tx.customerNote.deleteMany({ where: { userId } }); // staff notes about the person are personal data too
      await tx.socialAccount.deleteMany({ where: { userId } }); // no more Google / Apple sign-in into the anonymised account
      await tx.webPushSubscription.deleteMany({ where: { userId } });
      await tx.review.updateMany({ where: { userId }, data: { images: [] } }); // photos may show the person or their home
      await tx.returnRequest.updateMany({ where: { userId }, data: { images: [] } });
      await tx.ticketMessage.updateMany({ where: { authorId: userId }, data: { body: '[removed at the customer’s request]', attachments: [] } });
      if (u.email) await tx.contactMessage.deleteMany({ where: { OR: [{ userId }, { email: u.email }] } });
      else await tx.contactMessage.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: DELETED_NAME, email: null, phone: null, passwordHash: null, status: 'DELETED', deletedAt: new Date(),
          emailVerifiedAt: null, phoneVerifiedAt: null, marketingOptIn: false, whatsappOptIn: false, whatsappOptInAt: null,
          twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorEnabledAt: null, twoFactorRecovery: [], twoFactorLastStep: null,
          codBlockedReason: null, deletionReason: null, tags: [],
        },
      });
    });
    await this.audit.log({ actorId, action: 'privacy.account_deleted', entityType: 'User', entityId: userId });
  }
}

// ====================================================================== controllers

const sendJson = (res: Response, data: unknown, name: string) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify(data, null, 2));
};

@ApiTags('Account / Privacy') @ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class PrivacyController {
  constructor(private readonly svc: PrivacyService) {}

  /** A copy of everything FastMoveX holds about you, as a JSON file. */
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @AllowWithoutTwoFactor() @Get('data-export')
  async export(@CurrentUser() u: AuthUser, @Res() res: Response) {
    sendJson(res, await this.svc.exportData(u.id), `fastmovex-my-data-${new Date().toISOString().slice(0, 10)}.json`);
  }

  @AllowWithoutTwoFactor() @Get('deletion') status(@CurrentUser() u: AuthUser) { return this.svc.status(u.id); }
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @HttpCode(200) @Post('deletion') request(@CurrentUser() u: AuthUser, @Body() d: DeletionDto, @Req() req: Request) { return this.svc.request(u, d, requestMeta(req)); }
  @AllowWithoutTwoFactor() @HttpCode(200) @Delete('deletion') cancel(@CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.cancel(u.id, requestMeta(req)); }
}

@ApiTags('Admin / Users') @ApiBearerAuth()
@Controller({ path: 'admin/users', version: '1' })
export class AdminPrivacyController {
  constructor(private readonly svc: PrivacyService) {}

  /** For a data request received by support: the same file the customer can download. */
  @RequirePermissions('users.read') @Get(':id/data-export')
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    sendJson(res, await this.svc.exportData(id, u.id), `fastmovex-user-data-${id.slice(0, 8)}.json`);
  }
  @RequirePermissions('users.read') @Get(':id/deletion') status(@Param('id', ParseUUIDPipe) id: string) { return this.svc.status(id); }
}

@Module({ imports: [AuthModule], controllers: [PrivacyController, AdminPrivacyController], providers: [PrivacyService], exports: [PrivacyService] })
export class PrivacyModule {}
