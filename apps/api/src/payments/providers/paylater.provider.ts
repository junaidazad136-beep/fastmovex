import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Env } from '../../config/env';
import { PaymentIntentInput, PaymentIntentResult, PaymentProvider, RefundInput, RefundResult, WebhookEventData } from '../payment-provider';

const TIMEOUT_MS = 20_000;
/** Our order numbers (FMX-QA-261013-ABC123) are the PayLater order id. */
const ORDER_REF = /^[A-Za-z0-9_-]{4,64}$/;
/** PayLater accepts orders from QAR 300 to QAR 25,000 (an outlet may have a narrower range). */
export const PAYLATER_MIN_MINOR = 30_000n;
export const PAYLATER_MAX_MINOR = 2_500_000n;
/** How long the PayLater payment link stays valid, in minutes (1–1440). */
const LINK_MINUTES = 30;

/** Minor units → 350.00 (a JSON number, as PayLater's checkout expects). */
export function toPayLaterAmount(minor: bigint): number {
  return Number(minor) / 100;
}

/** "120.00" for refunds (PayLater takes the refund amount as a string). */
export function toPayLaterAmountString(minor: bigint): string {
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

/** PayLater status → ours. Status check: 0 not started, 1 pending, 2 success, 3 failed; webhooks: success/failed/pending. */
export function mapPayLaterStatus(status: unknown): Extract<PaymentStatus, 'PENDING' | 'CAPTURED' | 'FAILED'> {
  const s = String(status ?? '').toLowerCase();
  if (s === '2' || s === 'success') return 'CAPTURED';
  if (s === '3' || s === 'failed') return 'FAILED';
  return 'PENDING';
}

/**
 * Webhook check, as PayLater documents it: txHash = MD5 of UPPERCASE(merchantId + orderId + status + timestamp +
 * comments), and signature = HMAC-SHA256 of txHash with the webhook secret (both hex). Exported for tests.
 */
export function verifyPayLaterWebhook(
  body: { merchantId?: unknown; orderId?: unknown; status?: unknown; timestamp?: unknown; comments?: unknown; txHash?: unknown; signature?: unknown },
  secret: string,
): boolean {
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const data = `${s(body.merchantId)}${s(body.orderId)}${s(body.status)}${s(body.timestamp)}${s(body.comments)}`.toUpperCase();
  const txHash = createHash('md5').update(data).digest('hex');
  const signature = createHmac('sha256', secret).update(txHash).digest('hex');
  const same = (a: string, b: unknown) => {
    const x = Buffer.from(a.toLowerCase());
    const y = Buffer.from(s(b).toLowerCase());
    return x.length === y.length && timingSafeEqual(x, y);
  };
  return same(txHash, body.txHash) && same(signature, body.signature);
}

/**
 * PayLater (Qatar, licensed by Qatar Central Bank): the customer splits the order into up to 4 interest-free
 * payments on PayLater's own page; FastMoveX is paid in full by PayLater. Docs: docs.paylaterapp.com.
 *
 * Flow: OAuth2 client-credentials token → POST /v2/web-checkout (our order number as order_id) → redirect to
 * `paymentLinkUrl` → the customer comes back to our return page → we ask GET /v2/web-checkout/status. PayLater also
 * posts a signed webhook (verified with the webhook secret). Refunds: full or partial, 10 minutes to 29 days after.
 */
@Injectable()
export class PayLaterProvider extends PaymentProvider {
  readonly code = 'paylater';
  private readonly logger = new Logger(PayLaterProvider.name);
  private readonly base: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly outletId?: number;
  private readonly webhookSecret?: string;
  private token: { value: string; until: number } | null = null;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.base = String(config.get('PAYLATER_API_URL', { infer: true }) ?? 'https://connect.paylaterapp.com').replace(/\/+$/, '');
    this.clientId = config.get('PAYLATER_CLIENT_ID', { infer: true }) || undefined;
    this.clientSecret = config.get('PAYLATER_CLIENT_SECRET', { infer: true }) || undefined;
    const outlet = config.get('PAYLATER_OUTLET_ID', { infer: true });
    this.outletId = outlet ? Number(outlet) : undefined;
    this.webhookSecret = config.get('PAYLATER_WEBHOOK_SECRET', { infer: true }) || undefined;
  }

  /** Offered only with the merchant credentials and outlet from PayLater. */
  get enabled(): boolean {
    return !!(this.clientId && this.clientSecret && this.outletId);
  }

  supports(method: PaymentMethod) {
    return this.enabled && method === 'PAYLATER';
  }

  async createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    if (input.currencyCode !== 'QAR') throw new BadRequestException('PayLater accepts Qatari riyal (QAR) only');
    if (input.amountMinor < PAYLATER_MIN_MINOR || input.amountMinor > PAYLATER_MAX_MINOR) {
      throw new BadRequestException('PayLater is available for orders from QAR 300 to QAR 25,000');
    }
    if (!input.returnUrl) throw new BadRequestException('A return address is needed for PayLater');
    if (!ORDER_REF.test(input.orderNumber)) throw new BadRequestException('Invalid order number for PayLater');
    const back = (result: 'success' | 'fail') => `${input.returnUrl}${input.returnUrl!.includes('?') ? '&' : '?'}provider=paylater&result=${result}`;
    const res = await this.call<{ paymentLinkUrl?: string }>('POST', '/api/paylater/merchant-portal/v2/web-checkout', {
      outlet_id: this.outletId,
      currency: 'QAR',
      amount: toPayLaterAmount(input.amountMinor),
      order_id: input.orderNumber,
      success_redirect_url: back('success'),
      fail_redirect_url: back('fail'),
      expiry_duration: LINK_MINUTES,
    });
    const url = res.paymentLinkUrl;
    if (!url || !/^https:\/\/[^\s]+$/.test(url)) throw new Error('PayLater returned no payment link');
    return { status: 'PENDING', providerRef: input.orderNumber, redirectUrl: url };
  }

  async retrieve(providerRef: string): Promise<WebhookEventData | null> {
    if (!ORDER_REF.test(providerRef)) return null;
    const r = await this.call<{ status?: number; message?: string; payLaterOrderId?: string; merchantReference?: string }>(
      'GET', `/api/paylater/merchant-portal/v2/web-checkout/status?order_id=${encodeURIComponent(providerRef)}`,
    );
    const status = mapPayLaterStatus(r.status);
    return {
      eventId: `${providerRef}:${status}`,
      type: `paylater.${String(r.message ?? r.status ?? 'unknown').toLowerCase()}`,
      providerRef,
      status,
      paidWith: 'paylater',
      payload: { status: r.status ?? null, message: r.message ?? null, payLaterOrderId: r.payLaterOrderId ?? null },
    };
  }

  /** Signed JSON from PayLater. Unsigned or wrongly signed notifications are refused. */
  parseWebhook(_headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEventData {
    if (!this.webhookSecret) throw new BadRequestException('PayLater webhooks are not set up');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8').slice(0, 10_000)) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid webhook');
    }
    if (!verifyPayLaterWebhook(body, this.webhookSecret)) throw new BadRequestException('Invalid webhook signature');
    const orderId = String(body.orderId ?? '');
    if (!ORDER_REF.test(orderId)) throw new BadRequestException('Invalid webhook');
    const status = mapPayLaterStatus(body.status);
    return {
      eventId: `${String(body.paylaterRef ?? orderId)}:${String(body.status)}:${String(body.timestamp ?? '')}`.slice(0, 200),
      type: `paylater.${String(body.status ?? 'unknown').toLowerCase()}`,
      providerRef: orderId,
      status,
      paidWith: 'paylater',
      payload: { orderId, paylaterRef: body.paylaterRef ?? null, status: body.status ?? null, timestamp: body.timestamp ?? null },
    };
  }

  /** Full refund when it covers the whole payment, otherwise a partial one (PayLater allows 10 minutes – 29 days after). */
  async refund(input: RefundInput): Promise<RefundResult> {
    const ref = input.paymentProviderRef;
    if (!ref || !ORDER_REF.test(ref)) return { status: 'FAILED', providerRef: null, failureReason: 'No PayLater order to refund' };
    const whole = input.paymentAmountMinor !== undefined && (input.alreadyRefundedMinor ?? 0n) === 0n && input.amountMinor === input.paymentAmountMinor;
    try {
      const r = await this.call<{ message?: string }>('POST', '/api/paylater/merchant-portal/v2/web-checkout/refund', {
        order_id: ref,
        ...(whole ? {} : { amount: toPayLaterAmountString(input.amountMinor) }),
      });
      // "Refund request accepted …": PayLater pays it back to the customer's plan
      return /accepted/i.test(r.message ?? '') ? { status: 'SUCCEEDED', providerRef: ref } : { status: 'PENDING', providerRef: ref };
    } catch (e) {
      return { status: 'FAILED', providerRef: null, failureReason: (e as Error).message.slice(0, 200) };
    }
  }

  /** Bearer token from PayLater's OAuth server, reused until shortly before it expires (about 5 minutes). */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await fetch(`${this.base}/auth/realms/api/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId ?? '', client_secret: this.clientSecret ?? '' }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) throw new Error(`PayLater sign-in failed (HTTP ${res.status})`);
    const seconds = Math.max(30, Number(json.expires_in ?? 300));
    this.token = { value: json.access_token, until: Date.now() + (seconds - 20) * 1000 };
    return json.access_token;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.enabled) throw new Error('PayLater is not configured');
    const token = await this.accessToken();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (res.status === 401) this.token = null; // try a new token next time
    if (!res.ok) {
      const message = (json as { message?: string } | null)?.message ?? text.slice(0, 200);
      this.logger.warn(`PayLater ${method} ${path.split('?')[0]} → HTTP ${res.status}: ${message}`);
      throw new Error(`PayLater: ${message || `HTTP ${res.status}`}`);
    }
    return (json ?? {}) as T;
  }
}
