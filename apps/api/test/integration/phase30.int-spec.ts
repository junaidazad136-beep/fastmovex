/**
 * PHASE 30 on a real API: rate limits count each shopper separately when the website passes their IP on with the
 * shared key, and a made-up IP without the key changes nothing.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { EDGE_IP_HEADER, EDGE_KEY_HEADER } from '../../src/common/utils/edge-client-ip';

describe('Phase 30 — per-shopper rate limits behind the website (real API)', () => {
  let app: INestApplication;
  const key = process.env.INTERNAL_API_KEY ?? '';
  const before = process.env.RATE_LIMIT_DISABLED;
  const api = () => request(app.getHttpServer());
  /** POST /cart/buy-now allows 30 a minute; an empty body is refused (400) but still counted. */
  const hit = (headers: Record<string, string>) => api().post('/api/v1/cart/buy-now').set(headers).send({});
  const vouched = (ip: string) => ({ [EDGE_IP_HEADER]: ip, [EDGE_KEY_HEADER]: key });
  const octet = () => 1 + Math.floor(Math.random() * 250);

  beforeAll(async () => {
    process.env.RATE_LIMIT_DISABLED = 'false';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_DISABLED = before;
    await app?.close();
  });

  it('two shoppers behind the website each get their own limit', async () => {
    expect(key.length).toBeGreaterThanOrEqual(32);
    const a = `198.51.100.${octet()}`;
    for (let i = 0; i < 30; i++) await hit(vouched(a)).expect(400);
    await hit(vouched(a)).expect(429);
    // a different shopper is not blocked by the first one
    await hit(vouched(`203.0.113.${octet()}`)).expect(400);
  });

  it('a made-up IP without the key is ignored: the caller is counted by its own address', async () => {
    const forged = (i: number) => ({ [EDGE_IP_HEADER]: `192.0.2.${i + 1}`, [EDGE_KEY_HEADER]: 'x'.repeat(key.length) });
    let blocked = false;
    for (let i = 0; i < 31 && !blocked; i++) blocked = (await hit(forged(i))).status === 429;
    expect(blocked).toBe(true);
  });
});
