import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PaymentIntentInput, PaymentIntentResult, PaymentProvider, RefundInput, RefundResult, WebhookEventData } from '../payment-provider';

/** Cash on delivery: nothing is charged online. The courier collects, delivery confirmation settles it. */
@Injectable()
export class CodProvider extends PaymentProvider {
  readonly code = 'cod';
  supports(method: PaymentMethod) { return method === 'COD'; }

  async createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    return { status: 'PENDING', providerRef: `cod_${input.orderNumber}_${randomUUID().slice(0, 8)}` };
  }

  async refund(): Promise<RefundResult> {
    // Money was never taken online; refunds are handled by the operations team.
    return { status: 'PENDING', providerRef: null };
  }

  parseWebhook(): WebhookEventData {
    throw new Error('COD has no webhooks');
  }
}
