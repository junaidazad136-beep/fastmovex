import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Env } from '../config/env';

/**
 * A guest's proof of access to one order: HMAC of the order id with a key derived from the server secret.
 * Nothing is stored; it cannot be forged or moved to another order, and it survives restarts.
 */
@Injectable()
export class OrderAccessService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private key(): Buffer {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true })).update('jovia:order-access:v1').digest();
  }

  sign(orderId: string): string {
    return createHmac('sha256', this.key()).update(orderId).digest('base64url');
  }

  verify(orderId: string, token: string | undefined): boolean {
    if (!token || token.length > 100) return false;
    const a = Buffer.from(this.sign(orderId));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  trackUrl(orderNumber: string, orderId: string, locale: string): string | null {
    const base = this.config.get('STOREFRONT_URL', { infer: true });
    if (!base) return null;
    return `${base.replace(/\/$/, '')}/${locale === 'ar' ? 'ar' : 'en'}/track?order=${encodeURIComponent(orderNumber)}&t=${this.sign(orderId)}`;
  }
}
