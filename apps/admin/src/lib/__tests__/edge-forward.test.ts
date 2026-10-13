import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { EDGE_IP_HEADER, EDGE_KEY_HEADER, forwardApi, visitorIp } from '../edge-forward';

const KEY = 'k'.repeat(40);
const ENV = { VERCEL: '1', API_PROXY_TARGET: 'https://api.example.test/', INTERNAL_API_KEY: KEY };
const req = (headers: Record<string, string>) => new NextRequest('https://shop.example.test/api/v1/cart?x=1', { headers });

describe('API requests passed on with the shopper\'s IP', () => {
  it('reads the IP the host put in x-forwarded-for, only on Vercel or behind a trusted proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(visitorIp(h, { VERCEL: '1' })).toBe('203.0.113.7');
    expect(visitorIp(h, { TRUST_PROXY_IP: 'true' })).toBe('203.0.113.7');
    expect(visitorIp(h, {})).toBeNull();
    expect(visitorIp(new Headers({ 'x-forwarded-for': 'evil<script>' }), { VERCEL: '1' })).toBeNull();
  });

  it('sends the IP and the key to the API, drops whatever the visitor sent in those headers', () => {
    const res = forwardApi(req({ 'x-forwarded-for': '203.0.113.7', [EDGE_IP_HEADER]: '1.2.3.4', [EDGE_KEY_HEADER]: 'guess' }), ENV)!;
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://api.example.test/api/v1/cart?x=1');
    expect(res.headers.get(`x-middleware-request-${EDGE_IP_HEADER}`)).toBe('203.0.113.7');
    expect(res.headers.get(`x-middleware-request-${EDGE_KEY_HEADER}`)).toBe(KEY);
  });

  it('without a trusted IP the visitor\'s own headers are still removed and no key is sent', () => {
    const res = forwardApi(req({ [EDGE_IP_HEADER]: '1.2.3.4', [EDGE_KEY_HEADER]: 'guess' }), { ...ENV, VERCEL: undefined })!;
    expect(res.headers.get(`x-middleware-request-${EDGE_IP_HEADER}`)).toBeNull();
    expect(res.headers.get(`x-middleware-request-${EDGE_KEY_HEADER}`)).toBeNull();
  });

  it('does nothing without the shared key (the plain rewrite in next.config is used)', () => {
    expect(forwardApi(req({ 'x-forwarded-for': '203.0.113.7' }), { ...ENV, INTERNAL_API_KEY: undefined })).toBeNull();
    expect(forwardApi(req({ 'x-forwarded-for': '203.0.113.7' }), { ...ENV, INTERNAL_API_KEY: 'short' })).toBeNull();
  });
});
