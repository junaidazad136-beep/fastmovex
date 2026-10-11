import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DibsyProvider, fromDibsyAmount, mapDibsyStatus, toDibsyAmount } from '../src/payments/providers/dibsy.provider';
import { PaymentsService } from '../src/payments/payments.service';

const cfg = (over: Record<string, unknown> = {}) => {
  const v: Record<string, unknown> = { DIBSY_SECRET_KEY: 'sk_test_0123456789abcdef', DIBSY_API_URL: 'https://api.dibsy.test/v2', API_PUBLIC_URL: 'https://api.fastmovex.qa', ...over };
  return { get: (k: string) => v[k] } as unknown as ConfigService<never, true>;
};

type Call = { url: string; init: RequestInit };
function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: { status: 500, details: 'no more mocks' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

const input = {
  orderId: '5c16d269-edad-4cd0-8934-95be42dd5d20', orderNumber: 'FMX-QA-261001-ABC123', amountMinor: 12950n, currencyCode: 'QAR',
  method: 'CARD' as const, customer: { id: 'u1', email: 'a@b.qa', phone: null }, idempotencyKey: 'pay_k1', returnUrl: 'https://fastmovex.qa/en/checkout/return',
};

describe('Dibsy amounts and statuses', () => {
  it('converts minor units exactly, both ways', () => {
    expect(toDibsyAmount(12950n)).toBe('129.50');
    expect(toDibsyAmount(5n)).toBe('0.05');
    expect(toDibsyAmount(100000n)).toBe('1000.00');
    expect(fromDibsyAmount('129.50')).toBe(12950n);
    expect(fromDibsyAmount('129.5')).toBe(12950n);
    expect(fromDibsyAmount('129')).toBe(12900n);
    expect(fromDibsyAmount(129)).toBe(12900n);
    for (const bad of ['1.234', '-5', 'abc', '', null, undefined, '1e3']) expect(fromDibsyAmount(bad)).toBeNull();
  });
  it('maps statuses; anything unknown stays pending', () => {
    expect(mapDibsyStatus('succeeded')).toBe('CAPTURED');
    expect(mapDibsyStatus('Paid')).toBe('CAPTURED');
    expect(mapDibsyStatus('authorized')).toBe('AUTHORIZED');
    for (const s of ['failed', 'expired', 'canceled', 'cancelled', 'declined']) expect(mapDibsyStatus(s)).toBe('FAILED');
    for (const s of ['open', 'pending', 'created', '', undefined]) expect(mapDibsyStatus(s)).toBe('PENDING');
  });
});

describe('DibsyProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('is off without a secret key, and then takes cards only (its page offers Apple Pay, Google Pay, Himyan)', () => {
    expect(new DibsyProvider(cfg({ DIBSY_SECRET_KEY: undefined })).supports('CARD')).toBe(false);
    const d = new DibsyProvider(cfg());
    expect(d.supports('CARD')).toBe(true);
    expect(d.supports('COD')).toBe(false);
    expect(d.supports('APPLE_PAY')).toBe(false);
  });

  it('creates a hosted payment and sends the customer to Dibsy', async () => {
    const calls = mockFetch([{ body: { id: 'pt_AbC123', status: 'open', _links: { checkout: { href: 'https://pay.dibsy.one/pt_AbC123' } } } }]);
    const r = await new DibsyProvider(cfg()).createPayment(input);
    expect(r).toEqual({ status: 'PENDING', providerRef: 'pt_AbC123', redirectUrl: 'https://pay.dibsy.one/pt_AbC123' });
    expect(calls[0].url).toBe('https://api.dibsy.test/v2/payments');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer sk_test_0123456789abcdef');
    expect(h['Dibsy-Version']).toBe('2022-07-10');
    expect(h['Idempotency-Key']).toBe('pay_k1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      amount: { value: '129.50', currency: 'QAR' },
      description: 'FastMoveX order FMX-QA-261001-ABC123',
      redirectUrl: 'https://fastmovex.qa/en/checkout/return',
      webhookUrl: 'https://api.fastmovex.qa/api/v1/payments/webhook/dibsy',
      metadata: { order_id: input.orderId, order_number: input.orderNumber, customer_id: 'u1' },
    });
  });

  it('refuses other currencies, a missing return address, and answers without a safe checkout link', async () => {
    const d = new DibsyProvider(cfg());
    await expect(d.createPayment({ ...input, currencyCode: 'AED' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(d.createPayment({ ...input, returnUrl: undefined })).rejects.toBeInstanceOf(BadRequestException);
    mockFetch([{ body: { id: 'pt_1234', status: 'open', _links: { checkout: { href: 'javascript:alert(1)' } } } }]);
    await expect(d.createPayment(input)).rejects.toThrow('no checkout address');
    mockFetch([{ status: 422, body: { status: 422, details: 'amount invalid' } }]);
    await expect(d.createPayment(input)).rejects.toThrow('Dibsy: amount invalid');
    mockFetch([{ status: 200, body: { status: 500, details: 'server error' } }]); // errors with HTTP 200 (seen in their plugin)
    await expect(d.createPayment(input)).rejects.toThrow('Dibsy: server error');
  });

  it('never trusts the webhook body: it looks the payment up with the secret key', async () => {
    const calls = mockFetch([{ body: { id: 'pt_AbC123', status: 'succeeded', method: 'applepay', amount: { value: '129.50', currency: 'QAR' }, metadata: { order_id: input.orderId } } }]);
    const e = await new DibsyProvider(cfg()).parseWebhook({}, Buffer.from(JSON.stringify({ id: 'pt_AbC123', status: 'succeeded', amount: { value: '0.01' } })));
    expect(calls[0].url).toBe('https://api.dibsy.test/v2/payments/pt_AbC123');
    expect(calls[0].init.method).toBe('GET');
    expect(e).toMatchObject({ eventId: 'pt_AbC123:CAPTURED', providerRef: 'pt_AbC123', status: 'CAPTURED', amountMinor: 12950n, currencyCode: 'QAR', orderId: input.orderId, paidWith: 'applepay' });
  });

  it('accepts form-encoded webhooks and rejects junk ids before any request', async () => {
    const calls = mockFetch([{ body: { id: 'pt_Form99', status: 'failed', amount: { value: '10.00', currency: 'QAR' } } }]);
    const d = new DibsyProvider(cfg());
    expect((await d.parseWebhook({}, Buffer.from('id=pt_Form99'))).status).toBe('FAILED');
    await expect(d.parseWebhook({}, Buffer.from(JSON.stringify({ id: '../../admin' })))).rejects.toBeInstanceOf(BadRequestException);
    await expect(d.parseWebhook({}, Buffer.from('{}'))).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(1);
  });

  it('an unknown payment is not an event', async () => {
    mockFetch([{ status: 404, body: { status: 404, details: 'not found' } }]);
    await expect(new DibsyProvider(cfg()).parseWebhook({}, Buffer.from('{"id":"pt_Nope1"}'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refunds by amount; errors become a failed refund, never an exception', async () => {
    const calls = mockFetch([{ body: { id: 're_1', status: 'refunded' } }, { body: { id: 're_2', status: 'pending' } }, { status: 400, body: { status: 400, details: 'too much' } }]);
    const d = new DibsyProvider(cfg());
    const base = { paymentProviderRef: 'pt_AbC123', amountMinor: 7110n, currencyCode: 'QAR', idempotencyKey: 'refund_1', reason: 'Returned item' };
    expect(await d.refund(base)).toEqual({ status: 'SUCCEEDED', providerRef: 're_1' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ amount: '71.10', description: 'Returned item' });
    expect(calls[0].url).toBe('https://api.dibsy.test/v2/payments/pt_AbC123/refunds');
    expect(await d.refund(base)).toEqual({ status: 'PENDING', providerRef: 're_2' });
    expect(await d.refund(base)).toMatchObject({ status: 'FAILED', failureReason: 'Dibsy: too much' });
    expect(await d.refund({ ...base, paymentProviderRef: null })).toMatchObject({ status: 'FAILED' });
  });
});

describe('return address after the payment page', () => {
  const svc = (dibsy = true) => {
    const d = new DibsyProvider(cfg(dibsy ? {} : { DIBSY_SECRET_KEY: undefined }));
    return new PaymentsService({} as never, {} as never, {} as never, {} as never, { setReconciler: jest.fn() } as never, { code: 'cod', supports: (m: string) => m === 'COD' } as never, { code: 'test', supports: (m: string) => m !== 'COD' } as never, d);
  };
  const env = { ...process.env };
  beforeAll(() => { process.env.CORS_ORIGINS = 'http://localhost:3000,https://fastmovex.qa'; process.env.STOREFRONT_URL = 'https://www.fastmovex.qa'; });
  afterAll(() => { process.env = env; });

  it('only our own website; Dibsy needs one', () => {
    const s = svc();
    expect(s.cardProvider()).toBe('dibsy');
    expect(() => s.assertReturnUrl('CARD', 'https://fastmovex.qa/en/checkout/return')).not.toThrow();
    expect(() => s.assertReturnUrl('CARD', 'https://www.fastmovex.qa/ar/checkout/return?x=1')).not.toThrow();
    for (const bad of ['https://evil.com/x', 'https://fastmovex.qa.evil.com/', 'javascript:alert(1)', 'not a url', 'https://user:pw@fastmovex.qa/']) {
      expect(() => s.assertReturnUrl('CARD', bad)).toThrow(BadRequestException);
    }
    expect(() => s.assertReturnUrl('CARD', undefined)).toThrow(BadRequestException);
    expect(() => s.assertReturnUrl('COD', 'https://evil.com')).not.toThrow(); // not used for cash on delivery
  });

  it('without Dibsy the sandbox takes cards and needs no return address', () => {
    const s = svc(false);
    expect(s.cardProvider()).toBe('test');
    expect(() => s.assertReturnUrl('CARD', undefined)).not.toThrow();
  });
});
