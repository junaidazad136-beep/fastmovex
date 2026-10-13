import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import {
  PayLaterProvider, mapPayLaterStatus, toPayLaterAmount, toPayLaterAmountString, verifyPayLaterWebhook,
} from '../src/payments/providers/paylater.provider';

const cfg = (over: Record<string, unknown> = {}) => {
  const v: Record<string, unknown> = {
    PAYLATER_CLIENT_ID: 'fmx-client', PAYLATER_CLIENT_SECRET: 'top-secret', PAYLATER_OUTLET_ID: '1234',
    PAYLATER_WEBHOOK_SECRET: 'whsec-123', PAYLATER_API_URL: 'https://connect.uat.paylaterapp.test', ...over,
  };
  return { get: (k: string) => v[k] } as unknown as ConfigService<never, true>;
};

type Call = { url: string; init: RequestInit };
function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: { message: 'no more mocks' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}
const TOKEN = { body: { access_token: 'tok-1', expires_in: 300 } };

const input = {
  orderId: '5c16d269-edad-4cd0-8934-95be42dd5d20', orderNumber: 'FMX-QA-261013-ABC123', amountMinor: 35000n, currencyCode: 'QAR',
  method: 'PAYLATER' as const, customer: { id: 'u1', email: 'a@b.qa', phone: null }, idempotencyKey: 'pay_k1', returnUrl: 'https://fastmovex.qa/en/checkout/return',
};

function signed(body: Record<string, string>, secret = 'whsec-123') {
  const txHash = createHash('md5').update(`${body.merchantId}${body.orderId}${body.status}${body.timestamp}${body.comments}`.toUpperCase()).digest('hex');
  return { ...body, txHash, signature: createHmac('sha256', secret).update(txHash).digest('hex') };
}

describe('PayLater helpers', () => {
  it('converts amounts', () => {
    expect(toPayLaterAmount(35000n)).toBe(350);
    expect(toPayLaterAmount(12950n)).toBe(129.5);
    expect(toPayLaterAmountString(12000n)).toBe('120.00');
    expect(toPayLaterAmountString(5n)).toBe('0.05');
  });
  it('maps statuses (numbers from the status check, words from webhooks)', () => {
    expect(mapPayLaterStatus(2)).toBe('CAPTURED');
    expect(mapPayLaterStatus('success')).toBe('CAPTURED');
    expect(mapPayLaterStatus(3)).toBe('FAILED');
    expect(mapPayLaterStatus('FAILED')).toBe('FAILED');
    for (const s of [0, 1, 'pending', '', undefined, null]) expect(mapPayLaterStatus(s)).toBe('PENDING');
  });
  it('accepts only correctly signed webhooks', () => {
    const body = signed({ merchantId: 'm1', orderId: 'FMX-QA-261013-ABC123', status: 'success', timestamp: '1760000000', comments: 'ok' });
    expect(verifyPayLaterWebhook(body, 'whsec-123')).toBe(true);
    expect(verifyPayLaterWebhook(body, 'other-secret')).toBe(false);
    expect(verifyPayLaterWebhook({ ...body, status: 'failed' }, 'whsec-123')).toBe(false);
    expect(verifyPayLaterWebhook({ ...body, signature: undefined }, 'whsec-123')).toBe(false);
  });
});

describe('PayLaterProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('is off until client id, secret and outlet are all set; takes PAYLATER only', () => {
    expect(new PayLaterProvider(cfg({ PAYLATER_OUTLET_ID: undefined })).enabled).toBe(false);
    expect(new PayLaterProvider(cfg({ PAYLATER_CLIENT_SECRET: '' })).supports('PAYLATER')).toBe(false);
    const p = new PayLaterProvider(cfg());
    expect(p.supports('PAYLATER')).toBe(true);
    expect(p.supports('CARD')).toBe(false);
  });

  it('creates a web checkout and sends the customer to PayLater', async () => {
    const calls = mockFetch([TOKEN, { body: { paymentLinkUrl: 'https://pay.paylaterapp.test/l/abc' } }]);
    const r = await new PayLaterProvider(cfg()).createPayment(input);
    expect(r).toEqual({ status: 'PENDING', providerRef: input.orderNumber, redirectUrl: 'https://pay.paylaterapp.test/l/abc' });
    expect(calls[0].url).toBe('https://connect.uat.paylaterapp.test/auth/realms/api/protocol/openid-connect/token');
    expect(String(calls[0].init.body)).toContain('grant_type=client_credentials');
    expect(calls[1].url).toBe('https://connect.uat.paylaterapp.test/api/paylater/merchant-portal/v2/web-checkout');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    const sent = JSON.parse(String(calls[1].init.body));
    expect(sent).toMatchObject({ outlet_id: 1234, currency: 'QAR', amount: 350, order_id: input.orderNumber });
    expect(sent.success_redirect_url).toBe('https://fastmovex.qa/en/checkout/return?provider=paylater&result=success');
    expect(sent.fail_redirect_url).toBe('https://fastmovex.qa/en/checkout/return?provider=paylater&result=fail');
  });

  it('refuses amounts outside QAR 300–25,000 and other currencies without calling PayLater', async () => {
    const calls = mockFetch([]);
    const p = new PayLaterProvider(cfg());
    await expect(p.createPayment({ ...input, amountMinor: 29_999n })).rejects.toThrow(/300/);
    await expect(p.createPayment({ ...input, amountMinor: 2_500_001n })).rejects.toThrow(/25,000/);
    await expect(p.createPayment({ ...input, currencyCode: 'AED' })).rejects.toThrow(/QAR/);
    expect(calls).toHaveLength(0);
  });

  it('reuses the token and reads the status', async () => {
    const calls = mockFetch([TOKEN, { body: { status: 2, message: 'Success' } }, { body: { status: 1, message: 'Pending' } }]);
    const p = new PayLaterProvider(cfg());
    expect((await p.retrieve(input.orderNumber))?.status).toBe('CAPTURED');
    expect((await p.retrieve(input.orderNumber))?.status).toBe('PENDING');
    expect(calls.filter((c) => c.url.includes('openid-connect'))).toHaveLength(1);
    expect(calls[1].url).toContain('/v2/web-checkout/status?order_id=FMX-QA-261013-ABC123');
  });

  it('parses signed webhooks and refuses forged ones', () => {
    const p = new PayLaterProvider(cfg());
    const body = signed({ merchantId: 'm1', orderId: input.orderNumber, status: 'success', timestamp: '1760000000', comments: '' });
    const ev = p.parseWebhook({}, Buffer.from(JSON.stringify(body)));
    expect(ev).toMatchObject({ providerRef: input.orderNumber, status: 'CAPTURED' });
    expect(() => p.parseWebhook({}, Buffer.from(JSON.stringify({ ...body, status: 'failed' })))).toThrow(/signature/);
    expect(() => new PayLaterProvider(cfg({ PAYLATER_WEBHOOK_SECRET: undefined })).parseWebhook({}, Buffer.from('{}'))).toThrow();
  });

  it('refunds the whole order without an amount, part of it with one', async () => {
    const calls = mockFetch([TOKEN, { body: { message: 'Refund request accepted' } }, { body: { message: 'Refund request accepted' } }]);
    const p = new PayLaterProvider(cfg());
    const base = { refundId: 'r1', paymentProviderRef: input.orderNumber, currencyCode: 'QAR', reason: 'x', idempotencyKey: 'k' };
    expect((await p.refund({ ...base, amountMinor: 35000n, paymentAmountMinor: 35000n, alreadyRefundedMinor: 0n } as never)).status).toBe('SUCCEEDED');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ order_id: input.orderNumber });
    await p.refund({ ...base, amountMinor: 12000n, paymentAmountMinor: 35000n, alreadyRefundedMinor: 0n } as never);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ order_id: input.orderNumber, amount: '120.00' });
  });
});
