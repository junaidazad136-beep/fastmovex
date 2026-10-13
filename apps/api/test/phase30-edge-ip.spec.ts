import { EDGE_IP_HEADER, EDGE_KEY_HEADER, edgeClientIp, edgeClientIpMiddleware } from '../src/common/utils/edge-client-ip';

const KEY = 'k'.repeat(40);

describe('shopper IP passed on by our website', () => {
  it('is believed only with the right key and a real IP', () => {
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: KEY, [EDGE_IP_HEADER]: ' 203.0.113.7 ' }, KEY)).toBe('203.0.113.7');
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: KEY, [EDGE_IP_HEADER]: '2001:db8::1' }, KEY)).toBe('2001:db8::1');
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: 'x'.repeat(40), [EDGE_IP_HEADER]: '203.0.113.7' }, KEY)).toBeNull();
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: 'short', [EDGE_IP_HEADER]: '203.0.113.7' }, KEY)).toBeNull();
    expect(edgeClientIp({ [EDGE_IP_HEADER]: '203.0.113.7' }, KEY)).toBeNull();
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: KEY, [EDGE_IP_HEADER]: 'not-an-ip' }, KEY)).toBeNull();
    // no key configured (or a weak one): nobody may set an IP
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: 'abc', [EDGE_IP_HEADER]: '203.0.113.7' }, 'abc')).toBeNull();
    expect(edgeClientIp({ [EDGE_KEY_HEADER]: KEY, [EDGE_IP_HEADER]: '203.0.113.7' }, undefined)).toBeNull();
  });

  it('sets req.ip for vouched requests and never passes the two headers on', () => {
    const run = (headers: Record<string, string>) => {
      const req = { headers: { ...headers }, ip: '10.1.1.1', ips: [] as string[] } as never as { headers: Record<string, string>; ip: string; ips: string[] };
      const next = jest.fn();
      edgeClientIpMiddleware(KEY)(req as never, {} as never, next);
      expect(next).toHaveBeenCalled();
      return req;
    };
    const ok = run({ [EDGE_KEY_HEADER]: KEY, [EDGE_IP_HEADER]: '203.0.113.7' });
    expect(ok.ip).toBe('203.0.113.7');
    expect(ok.ips).toEqual(['203.0.113.7']);
    expect(ok.headers[EDGE_KEY_HEADER]).toBeUndefined();
    const forged = run({ [EDGE_KEY_HEADER]: 'nope', [EDGE_IP_HEADER]: '203.0.113.8' });
    expect(forged.ip).toBe('10.1.1.1');
    expect(forged.headers[EDGE_IP_HEADER]).toBeUndefined();
  });
});
