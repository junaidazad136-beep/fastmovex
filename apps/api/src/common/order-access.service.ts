import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Env } from '../config/env';

/**
 * A guest's proof of access to one order: HMAC of the order id with a key derived from the server secret.
 * Nothing is stored; it cannot be forged or moved to another order, and it survives restarts.
 */
/** How long a guest order link (email, checkout, lookup) keeps working. Long enough for delivery and the return window. */
export const ORDER_LINK_DAYS = 60;
/** Old links without an expiry stop working on this date (UTC). */
export const LEGACY_LINKS_UNTIL = Date.UTC(2027, 0, 17);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class OrderAccessService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private key(): Buffer {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true })).update('fmx:order-access:v1').digest();
  }

  private mac(data: string): string {
    return createHmac('sha256', this.key()).update(data).digest('base64url');
  }

  /** "<expiry, base36 seconds>.<HMAC of orderId + expiry>": a guest link works for ORDER_LINK_DAYS, then the guest looks the order up again. */
  sign(orderId: string, now = Date.now()): string {
    const exp = Math.floor(now / 1000 + ORDER_LINK_DAYS * 86_400).toString(36);
    return `${exp}.${this.mac(`${orderId}.${exp}`)}`;
  }

  verify(orderId: string, token: string | undefined, now = Date.now()): boolean {
    if (!token || token.length > 100) return false;
    const dot = token.indexOf('.');
    if (dot < 0) {
      // links sent before expiry was added (no expiry inside): honoured until LEGACY_LINKS_UNTIL only
      return now < LEGACY_LINKS_UNTIL && safeEqual(this.mac(orderId), token);
    }
    const exp = parseInt(token.slice(0, dot), 36);
    if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
    return safeEqual(this.mac(`${orderId}.${token.slice(0, dot)}`), token.slice(dot + 1));
  }

  trackUrl(orderNumber: string, orderId: string, locale: string): string | null {
    const base = this.config.get('STOREFRONT_URL', { infer: true });
    if (!base) return null;
    return `${base.replace(/\/$/, '')}/${locale === 'ar' ? 'ar' : 'en'}/track?order=${encodeURIComponent(orderNumber)}&t=${this.sign(orderId)}`;
  }
}
