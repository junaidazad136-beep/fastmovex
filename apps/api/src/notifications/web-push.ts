import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** At most this many browsers per person (oldest are dropped). */
const MAX_PER_USER = 10;
/** A subscription that failed this many times in a row is removed. */
const MAX_FAILURES = 5;

/** Where a tap on the notification leads (the website's own paths only). Exported for tests. */
export function pushUrl(data: Record<string, unknown> | null | undefined, locale: string): string {
  const l = locale === 'ar' ? 'ar' : 'en';
  const order = typeof data?.orderNumber === 'string' && /^[A-Z0-9-]{8,40}$/.test(data.orderNumber) ? data.orderNumber : null;
  return order ? `/${l}/account/orders/${order}` : `/${l}/account/notifications`;
}

/**
 * Browser notifications for the website (Web Push with VAPID keys — no third-party service account needed). The
 * browser gives us an endpoint and keys after the customer agrees; messages are encrypted for that browser only.
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger('WebPush');
  private configured = false;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService<Env, true>) {
    const pub = this.config.get('VAPID_PUBLIC_KEY', { infer: true });
    const priv = this.config.get('VAPID_PRIVATE_KEY', { infer: true });
    if (pub && priv) {
      try {
        webpush.setVapidDetails(this.config.get('VAPID_SUBJECT', { infer: true }) || 'mailto:support@fastmovex.qa', pub, priv);
        this.configured = true;
      } catch (e) {
        this.logger.error(`VAPID keys rejected: ${(e as Error).message}`);
      }
    }
  }

  enabled() { return this.configured; }
  publicKey(): string | null { return this.configured ? (this.config.get('VAPID_PUBLIC_KEY', { infer: true }) as string) : null; }

  async subscribe(userId: string, s: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
    if (!this.configured) throw new BadRequestException({ message: 'Browser notifications are not available', reason: 'PUSH_OFF' });
    const ua = userAgent?.slice(0, 300) ?? null;
    // an endpoint belongs to one browser: it moves to whoever is signed in there now
    await this.prisma.webPushSubscription.upsert({
      where: { endpoint: s.endpoint },
      update: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: ua, failures: 0, lastUsedAt: new Date() },
      create: { userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: ua },
    });
    const all = await this.prisma.webPushSubscription.findMany({ where: { userId }, orderBy: { lastUsedAt: 'desc' }, select: { id: true } });
    if (all.length > MAX_PER_USER) await this.prisma.webPushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_PER_USER).map((x) => x.id) } } });
    return { subscribed: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.webPushSubscription.deleteMany({ where: { userId, endpoint } });
    return { subscribed: false };
  }

  count(userId: string) {
    return this.configured ? this.prisma.webPushSubscription.count({ where: { userId } }) : Promise.resolve(0);
  }

  /**
   * Sends to every browser of the user. Gone subscriptions (404/410) are removed at once; others after repeated
   * failures. Returns how many browsers accepted it.
   */
  async sendToUser(userId: string, msg: { title: string; body: string; data?: Record<string, unknown> | null }, locale: string): Promise<number> {
    if (!this.configured) return 0;
    const subs = await this.prisma.webPushSubscription.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, auth: true, failures: true } });
    const payload = JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 300), url: pushUrl(msg.data, locale), tag: typeof msg.data?.orderNumber === 'string' ? msg.data.orderNumber : undefined });
    let ok = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: 'normal' });
        ok++;
        if (s.failures) await this.prisma.webPushSubscription.update({ where: { id: s.id }, data: { failures: 0, lastUsedAt: new Date() } });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410 || s.failures + 1 >= MAX_FAILURES) await this.prisma.webPushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else await this.prisma.webPushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } });
        this.logger.warn(`push to ${new URL(s.endpoint).host} failed: ${status ?? (e as Error).message}`);
      }
    }
    return ok;
  }
}
