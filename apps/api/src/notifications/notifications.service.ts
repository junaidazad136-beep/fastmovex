import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelSender, EmailSender, PushSender, SmsSender, WhatsAppSender, WhatsAppPayload } from './channels/senders';
import { NotificationType, render, TEMPLATES } from './templates';
import { WebPushService } from './web-push';

const MAX_ATTEMPTS = 5;
const BATCH = 25;

/**
 * Outbox pattern: notify() only writes rows (fast, inside the request). A background worker sends them,
 * retries with backoff, and gives up after 5 attempts. A slow SMS provider can never slow down checkout.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly senders: Map<NotificationChannel, ChannelSender>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    email: EmailSender,
    sms: SmsSender,
    push: PushSender,
    whatsapp: WhatsAppSender,
    @Optional() private readonly webPush?: WebPushService,
  ) {
    this.senders = new Map<NotificationChannel, ChannelSender>([['EMAIL', email], ['SMS', sms], ['PUSH', push], ['WHATSAPP', whatsapp]]);
  }

  channelEnabled(channel: 'EMAIL' | 'SMS' | 'PUSH' | 'WHATSAPP'): boolean {
    return !!this.senders.get(channel)?.enabled() || (channel === 'PUSH' && !!this.webPush?.enabled());
  }

  /**
   * Sends immediately, bypassing the outbox and the Notification table. Used for one-time codes:
   * a code must never be stored in plain text in the database, and the user is waiting for it right now.
   */
  async sendDirect(channel: 'EMAIL' | 'SMS', to: string, title: string, body: string): Promise<void> {
    const sender = this.senders.get(channel);
    if (!sender?.enabled()) throw new ServiceUnavailableException(`${channel === 'EMAIL' ? 'Email' : 'SMS'} delivery is not available right now`);
    await sender.send({ to, title, body });
  }

  /**
   * Queue a notification on every channel the template and the person allow. `opts.email` overrides the template's
   * email choice (staff alerts: the staff member's own preference); `opts.emailFooter` is added to the email only.
   */
  async notify(
    userId: string, type: NotificationType, vars: Record<string, string | number | null | undefined>, data: Record<string, unknown> = {},
    opts: { email?: boolean; emailFooter?: string } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, locale: true, email: true, phone: true, fullName: true, marketingOptIn: true, whatsappOptIn: true, _count: { select: { deviceTokens: true, webPushSubscriptions: true } } },
    });
    if (!user || user.status !== 'ACTIVE') return [];
    const tpl = TEMPLATES[type];
    if (tpl.marketing && !user.marketingOptIn) return []; // promotions only with consent

    const t = user.locale === 'ar' ? tpl.ar : tpl.en;
    const all = { name: user.fullName.split(' ')[0], ...vars };
    const title = render(t.title, all);
    const body = render(t.body, all);
    const payload = { ...data, type } as Prisma.InputJsonValue;

    const channels: NotificationChannel[] = ['IN_APP'];
    // phone app (device tokens) and/or website browsers (web push) share the PUSH channel
    const appPush = user._count.deviceTokens > 0 && this.senders.get('PUSH')!.enabled();
    const browserPush = (user._count.webPushSubscriptions ?? 0) > 0 && !!this.webPush?.enabled();
    if (appPush || browserPush) channels.push('PUSH');
    if ((opts.email ?? !!tpl.email) && user.email && this.senders.get('EMAIL')!.enabled()) channels.push('EMAIL');
    const whatsapp = !!tpl.whatsapp && user.whatsappOptIn && !!user.phone && this.senders.get('WHATSAPP')!.enabled();
    if (whatsapp) channels.push('WHATSAPP');
    // The same news by WhatsApp and SMS would be one message too many: WhatsApp wins when the customer chose it.
    else if (tpl.sms && user.phone && this.senders.get('SMS')!.enabled()) channels.push('SMS');
    const wa: WhatsAppPayload | null = whatsapp
      ? { template: tpl.whatsapp!.template, lang: user.locale === 'ar' ? 'ar' : 'en', params: tpl.whatsapp!.params.map((k) => String(all[k as keyof typeof all] ?? '')) }
      : null;

    await this.prisma.notification.createMany({
      data: channels.map((channel) => ({
        userId, channel, type, title, body: channel === 'EMAIL' && opts.emailFooter ? `${body}\n\n${opts.emailFooter}` : body, data: channel === 'WHATSAPP' ? ({ ...data, type, whatsapp: wa } as unknown as Prisma.InputJsonValue) : payload,
        // In-app needs no delivery: it is "sent" the moment it is stored
        status: channel === 'IN_APP' ? 'SENT' : 'QUEUED',
        sentAt: channel === 'IN_APP' ? new Date() : null,
      })),
    });
    setImmediate(() => void this.processQueue()); // low latency; the interval worker is the safety net
    return channels;
  }

  @Interval(15_000)
  async processQueue(): Promise<{ sent: number; failed: number }> {
    if (this.running) return { sent: 0, failed: 0 };
    this.running = true;
    let sent = 0;
    let failed = 0;
    try {
      // Lease a batch (SKIP LOCKED): several API instances can run this safely in parallel
      const leased = await this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Notification" SET "nextAttemptAt" = now() + interval '5 minutes', "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "Notification"
          WHERE "status" = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
          ORDER BY "createdAt" ASC LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        ) RETURNING "id"`;
      for (const { id } of leased) {
        const ok = await this.deliver(id);
        if (ok) sent++; else failed++;
      }
    } catch (e) {
      this.logger.error(`queue run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return { sent, failed };
  }

  private async deliver(id: string): Promise<boolean> {
    const n = await this.prisma.notification.findUnique({
      where: { id },
      select: { id: true, userId: true, channel: true, title: true, body: true, data: true, attempts: true, user: { select: { email: true, phone: true, locale: true, deviceTokens: { select: { token: true } } } } },
    });
    if (!n) return false;
    const sender = this.senders.get(n.channel);
    try {
      if (n.channel === 'PUSH') {
        await this.deliverPush(n.userId, n.title, n.body, n.data as Record<string, unknown> | null, n.user.locale, n.user.deviceTokens.map((d) => d.token));
        await this.prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
        return true;
      }
      if (!sender?.enabled()) throw new Error(`${n.channel} channel is not configured`);
      const targets = n.channel === 'EMAIL' ? [n.user.email] : n.channel === 'SMS' || n.channel === 'WHATSAPP' ? [n.user.phone] : n.user.deviceTokens.map((d) => d.token);
      const valid = targets.filter((t): t is string => !!t);
      if (!valid.length) throw new Error('No destination on file');
      for (const to of valid) await sender.send({ to, title: n.title, body: n.body, data: n.data as Record<string, unknown> });
      await this.prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
      return true;
    } catch (e) {
      const giveUp = n.attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(3_600_000, 30_000 * 2 ** n.attempts); // 1m, 2m, 4m ... max 1h
      await this.prisma.notification.update({
        where: { id },
        data: { status: giveUp ? 'FAILED' : 'QUEUED', error: (e as Error).message.slice(0, 500), nextAttemptAt: giveUp ? null : new Date(Date.now() + backoffMs) },
      });
      return false;
    }
  }

  /** App devices and website browsers; succeeds when at least one of them took the message. */
  private async deliverPush(userId: string, title: string, body: string, data: Record<string, unknown> | null, locale: string, tokens: string[]) {
    const app = this.senders.get('PUSH')!;
    let ok = 0;
    let lastError: Error | null = null;
    if (app.enabled()) {
      for (const to of tokens) {
        try { await app.send({ to, title, body, data: data ?? undefined }); ok++; } catch (e) { lastError = e as Error; }
      }
    }
    if (this.webPush) ok += await this.webPush.sendToUser(userId, { title, body, data }, locale);
    if (!ok) throw lastError ?? new Error('No device or browser took the message');
  }

  // --------------------------------------------------------------- in-app inbox

  async inbox(userId: string, cursor?: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, channel: 'IN_APP', ...(cursor && { createdAt: { lt: new Date(cursor) } }) },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    });
    return { items: rows, nextCursor: rows.length === 30 ? rows[rows.length - 1].createdAt.toISOString() : null };
  }

  async unreadCount(userId: string) {
    return { unread: await this.prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } }) };
  }

  async markRead(userId: string, id?: string) {
    await this.prisma.notification.updateMany({ where: { userId, channel: 'IN_APP', readAt: null, ...(id && { id }) }, data: { readAt: new Date() } });
    return this.unreadCount(userId);
  }

  async registerDevice(userId: string, token: string, platform: string) {
    // A token moves to whoever logged in last on that phone
    await this.prisma.deviceToken.upsert({ where: { token }, update: { userId, platform }, create: { userId, token, platform } });
    const count = await this.prisma.deviceToken.count({ where: { userId } });
    if (count > 10) {
      const old = await this.prisma.deviceToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, take: count - 10, select: { id: true } });
      await this.prisma.deviceToken.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  async settings(userId: string, d: { marketingOptIn?: boolean; whatsappOptIn?: boolean }) {
    if (d.whatsappOptIn) {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
      if (!me.phone) throw new BadRequestException({ message: 'Add a mobile number to your account to get WhatsApp updates', reason: 'NO_PHONE' });
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        marketingOptIn: d.marketingOptIn,
        ...(d.whatsappOptIn !== undefined && { whatsappOptIn: d.whatsappOptIn, whatsappOptInAt: d.whatsappOptIn ? new Date() : null }),
      },
      select: { marketingOptIn: true, whatsappOptIn: true },
    });
  }
}
