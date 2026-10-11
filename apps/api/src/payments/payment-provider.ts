import { PaymentMethod, PaymentStatus } from '@prisma/client';

export interface PaymentIntentInput {
  orderId: string;
  orderNumber: string;
  amountMinor: bigint;
  currencyCode: string;
  method: PaymentMethod;
  customer: { id: string; email: string | null; phone: string | null };
  idempotencyKey: string;
  returnUrl?: string;
}

export interface PaymentIntentResult {
  status: Extract<PaymentStatus, 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED'>;
  providerRef: string | null;
  /** Set when the customer must be sent to a hosted page / 3-D Secure. */
  redirectUrl?: string;
  failureReason?: string;
}

export interface RefundInput {
  paymentProviderRef: string | null;
  amountMinor: bigint;
  currencyCode: string;
  idempotencyKey: string;
  reason: string;
}

export interface RefundResult {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  providerRef: string | null;
  failureReason?: string;
}

export interface WebhookEventData {
  /** Unique per (provider, event): a replay with the same id is ignored. */
  eventId: string;
  type: string;
  providerRef: string;
  status: PaymentStatus | null;
  amountMinor?: bigint;
  currencyCode?: string;
  /** Our order id as the gateway echoes it back (metadata), checked against the payment row. */
  orderId?: string;
  /** What the customer actually paid with on a hosted page (e.g. "applepay"), for the record. */
  paidWith?: string;
  /** What to store in WebhookEvent.payload (defaults to the parsed body). */
  payload?: unknown;
}

/**
 * Every payment integration implements this. Nothing above this layer knows about any provider,
 * so adding a Qatari gateway later is one new class + one registry entry.
 * Raw card data never reaches FastMoveX: providers give us a token/reference only.
 */
export abstract class PaymentProvider {
  abstract readonly code: string;
  abstract supports(method: PaymentMethod): boolean;
  abstract createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  abstract refund(input: RefundInput): Promise<RefundResult>;
  /**
   * Turns a webhook into trusted, normalized event data, or throws. Either the signature is verified, or (for
   * gateways without signatures) the payment is fetched back from the gateway with our secret key.
   */
  abstract parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEventData | Promise<WebhookEventData>;
  /** Optional: ask the gateway for the current state of a payment (used when a webhook is late or lost). */
  retrieve?(providerRef: string): Promise<WebhookEventData | null>;
}
