import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Env } from '../../config/env';
import { PaymentIntentInput, PaymentIntentResult, PaymentProvider, RefundInput, RefundResult, WebhookEventData } from '../payment-provider';

/** Dibsy payment ids are short opaque tokens; anything else is refused before it reaches a URL. */
const REF = /^[A-Za-z0-9_-]{4,64}$/;
const API_VERSION = '2022-07-10';
const TIMEOUT_MS = 20_000;

interface DibsyAmount { value: string; currency: string }
interface DibsyPayment {
  id: string;
  status: string;
  amount?: DibsyAmount;
  method?: string | null;
  metadata?: Record<string, unknown> | null;
  _links?: { checkout?: { href?: string } };
}
interface DibsyRefund { id: string; status?: string }
interface DibsyError { status?: number; title?: string; details?: string; error?: unknown }

/** Minor units → "129.00" (QAR has 2 decimals). */
export function toDibsyAmount(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** "129.00" / "129.5" / "129" → minor units; null when it is not a clean amount. */
export function fromDibsyAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

/** Dibsy status → ours. Unknown / in-progress states stay PENDING. */
export function mapDibsyStatus(status: string | undefined): Extract<PaymentStatus, 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED'> {
  switch ((status ?? '').toLowerCase()) {
    case 'succeeded':
    case 'paid':
    case 'captured':
      return 'CAPTURED';
    case 'authorized':
      return 'AUTHORIZED';
    case 'failed':
    case 'expired':
    case 'canceled':
    case 'cancelled':
    case 'declined':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/**
 * Dibsy (Qatar, QCB-licensed). The customer pays on Dibsy's hosted page, which offers every method enabled on the
 * FastMoveX account: Visa / Mastercard, Himyan (NAPS) debit, Apple Pay and Google Pay. Card data never touches FastMoveX.
 *
 * Flow: POST /payments → redirect to `_links.checkout.href` → customer returns to our `redirectUrl` → Dibsy calls
 * `webhookUrl` with the payment id. The webhook body is NOT trusted: we fetch the payment back from Dibsy with our
 * secret key and use only that answer (status, amount, currency, our order id in metadata).
 * API shape follows Dibsy's own WooCommerce plugin (github.com/dibsyhq/WooCommerce), API version 2022-07-10.
 */
@Injectable()
export class DibsyProvider extends PaymentProvider {
  readonly code = 'dibsy';
  private readonly logger = new Logger(DibsyProvider.name);
  private readonly key: string | undefined;
  private readonly base: string;
  private readonly webhookUrl: string | undefined;
  private readonly production: boolean;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.key = config.get('DIBSY_SECRET_KEY', { infer: true }) || undefined;
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
    this.base = String(config.get('DIBSY_API_URL', { infer: true }) ?? 'https://api.dibsy.one/v2').replace(/\/+$/, '');
    const pub = config.get('API_PUBLIC_URL', { infer: true });
    this.webhookUrl = pub ? `${pub.replace(/\/+$/, '')}/api/v1/payments/webhook/dibsy` : undefined;
  }

  /** Only offered when a secret key is configured. */
  get enabled(): boolean {
    return !!this.key;
  }

  /** One option at checkout ("Card, Apple Pay, Google Pay, Himyan"): the hosted page lets the customer choose. */
  supports(method: PaymentMethod) {
    return this.enabled && method === 'CARD';
  }

  async createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    if (input.currencyCode !== 'QAR') throw new BadRequestException('Dibsy accepts Qatari riyal (QAR) only');
    if (!input.returnUrl) throw new BadRequestException('A return address is needed for card payments');
    const body = {
      amount: { value: toDibsyAmount(input.amountMinor), currency: 'QAR' },
      description: `FastMoveX order ${input.orderNumber}`,
      redirectUrl: input.returnUrl,
      ...(this.webhookUrl ? { webhookUrl: this.webhookUrl } : {}),
      metadata: { order_id: input.orderId, order_number: input.orderNumber, customer_id: input.customer.id },
    };
    const p = await this.call<DibsyPayment>('POST', 'payments', body, input.idempotencyKey);
    const href = p._links?.checkout?.href;
    if (!p.id || !REF.test(p.id)) throw new Error('Dibsy returned no payment id');
    const status = mapDibsyStatus(p.status);
    if (status === 'FAILED') return { status, providerRef: p.id, failureReason: 'Payment was declined' };
    if (status === 'CAPTURED' || status === 'AUTHORIZED') return { status, providerRef: p.id };
    if (!href || !this.safeCheckoutUrl(href)) throw new Error('Dibsy returned no checkout address');
    return { status: 'PENDING', providerRef: p.id, redirectUrl: href };
  }

  async retrieve(providerRef: string): Promise<WebhookEventData | null> {
    if (!REF.test(providerRef)) return null;
    let p: DibsyPayment;
    try {
      p = await this.call<DibsyPayment>('GET', `payments/${encodeURIComponent(providerRef)}`);
    } catch (e) {
      if ((e as { httpStatus?: number }).httpStatus === 404) return null;
      throw e;
    }
    if (p.id !== providerRef) return null;
    const status = mapDibsyStatus(p.status);
    const amount = fromDibsyAmount(p.amount?.value);
    const orderId = typeof p.metadata?.order_id === 'string' ? p.metadata.order_id : undefined;
    return {
      eventId: `${p.id}:${status}`,
      type: `payment.${String(p.status ?? 'unknown').toLowerCase()}`,
      providerRef: p.id,
      status,
      amountMinor: amount ?? undefined,
      currencyCode: p.amount?.currency,
      orderId,
      paidWith: typeof p.method === 'string' ? p.method : undefined,
      payload: { id: p.id, status: p.status, amount: p.amount, method: p.method ?? null },
    };
  }

  /** Dibsy posts the payment id (JSON `{ "id": … }`, or form `id=…`). We look the payment up ourselves. */
  async parseWebhook(_headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<WebhookEventData> {
    const text = rawBody.toString('utf8').slice(0, 10_000);
    let id: unknown;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      id = new URLSearchParams(text).get('id');
    }
    if (typeof id !== 'string' || !REF.test(id)) throw new BadRequestException('Invalid webhook');
    const event = await this.retrieve(id);
    if (!event) throw new BadRequestException('Unknown payment');
    return event;
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!input.paymentProviderRef || !REF.test(input.paymentProviderRef)) return { status: 'FAILED', providerRef: null, failureReason: 'No Dibsy payment to refund' };
    if (input.currencyCode !== 'QAR') return { status: 'FAILED', providerRef: null, failureReason: 'Dibsy refunds are in QAR only' };
    try {
      // Same body as Dibsy's WooCommerce plugin: amount as a decimal string, description ≤ 80 characters.
      const r = await this.call<DibsyRefund>('POST', `payments/${encodeURIComponent(input.paymentProviderRef)}/refunds`, {
        amount: toDibsyAmount(input.amountMinor),
        description: input.reason.slice(0, 80),
      }, input.idempotencyKey);
      const s = (r.status ?? '').toLowerCase();
      if (['refunded', 'succeeded', 'completed'].includes(s)) return { status: 'SUCCEEDED', providerRef: r.id };
      if (['failed', 'canceled', 'cancelled'].includes(s)) return { status: 'FAILED', providerRef: r.id ?? null, failureReason: 'Dibsy refused the refund' };
      return { status: 'PENDING', providerRef: r.id ?? null };
    } catch (e) {
      return { status: 'FAILED', providerRef: null, failureReason: (e as Error).message.slice(0, 200) };
    }
  }

  /** https only; outside production also the local Dibsy sandbox (scripts/dibsy-sandbox.mjs). */
  private safeCheckoutUrl(href: string): boolean {
    if (/^https:\/\/[^\s]+$/.test(href)) return true;
    return !this.production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(href);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    if (!this.key) throw new Error('Dibsy is not configured');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      Accept: 'application/json',
      'Dibsy-Version': API_VERSION,
      'User-Agent': 'FastMoveX/1.0 (+https://fastmovex.qa)',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 100);
    const res = await fetch(`${this.base}/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const err = json as DibsyError | null;
    // Dibsy may answer errors with HTTP 200 and a status/details body (seen in its plugin): treat both as errors.
    const bodyStatus = typeof err?.status === 'number' ? err.status : undefined;
    if (!res.ok || (bodyStatus && bodyStatus >= 400) || (err && err.error)) {
      const code = !res.ok ? res.status : bodyStatus ?? 400;
      const detail = typeof err?.details === 'string' ? err.details : typeof err?.title === 'string' ? err.title : `HTTP ${res.status}`;
      this.logger.warn(`Dibsy ${method} ${path.split('/')[0]} failed: ${code} ${detail}`);
      throw Object.assign(new Error(`Dibsy: ${detail}`), { httpStatus: code });
    }
    if (!json || typeof json !== 'object') throw new Error('Dibsy returned an empty answer');
    return json as T;
  }
}
