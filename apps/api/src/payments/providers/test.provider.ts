import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Env } from '../../config/env';
import { PaymentIntentInput, PaymentIntentResult, PaymentProvider, RefundInput, RefundResult, WebhookEventData } from '../payment-provider';

/**
 * Sandbox provider for development and automated tests. It refuses to run in production.
 * Amount ending in 13 fails, ending in 01 stays pending (for testing those flows).
 */
@Injectable()
export class TestPaymentProvider extends PaymentProvider {
  readonly code = 'test';
  private readonly secret: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
    this.secret = String(config.get('JWT_ACCESS_SECRET', { infer: true }));
  }

  supports(method: PaymentMethod) { return method !== 'COD'; }

  private assertNotProduction() {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new ForbiddenException('Test payments are disabled in production. Configure a real payment provider.');
    }
  }

  async createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    this.assertNotProduction();
    const ref = `test_${randomUUID()}`;
    const cents = Number(input.amountMinor % 100n);
    if (cents === 13) return { status: 'FAILED', providerRef: ref, failureReason: 'Card declined (test)' };
    if (cents === 1) return { status: 'PENDING', providerRef: ref, redirectUrl: `${input.returnUrl ?? 'https://checkout.test'}?ref=${ref}` };
    return { status: 'CAPTURED', providerRef: ref };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.assertNotProduction();
    return { status: 'SUCCEEDED', providerRef: `test_refund_${randomUUID()}` };
  }

  /** Same shape as a real gateway: HMAC over the raw body, compared in constant time. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEventData {
    this.assertNotProduction();
    const sig = String(headers['x-test-signature'] ?? '');
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) throw new ForbiddenException('Invalid webhook signature');
    const body = JSON.parse(rawBody.toString('utf8')) as { id: string; type: string; ref: string; status: WebhookEventData['status'] };
    return { eventId: body.id, type: body.type, providerRef: body.ref, status: body.status };
  }
}
