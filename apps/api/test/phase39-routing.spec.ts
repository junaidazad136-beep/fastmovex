import { estimateArrival } from '../src/delivery/delivery-rules';
import { RoutingService } from '../src/delivery/routing';

const A = { lat: 25.2854, lng: 51.531 };
const B = { lat: 25.3176, lng: 51.4383 };
const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);

describe('road routing for the arrival time', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('is off by default: no request, null (the straight-line estimate is used)', async () => {
    delete process.env.ROUTING_PROVIDER;
    const f = jest.fn();
    expect(await new RoutingService(f as never).drivingMinutes(A, B)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('openrouteservice: reads the duration, sends the key as a header, caches 2 minutes', async () => {
    process.env.ROUTING_PROVIDER = 'ors'; process.env.ORS_API_KEY = 'k'.repeat(30);
    const f = jest.fn(() => json({ features: [{ properties: { summary: { duration: 900 } } }] }));
    const r = new RoutingService(f as never);
    expect(await r.drivingMinutes(A, B, 1_000)).toBe(15);
    expect(await r.drivingMinutes(A, B, 60_000)).toBe(15);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`start=${A.lng},${A.lat}&end=${B.lng},${B.lat}`);
    expect(url).not.toContain('k'.repeat(30)); // the key is not put in the URL (it would end up in logs)
    expect((init.headers as Record<string, string>).Authorization).toBe('k'.repeat(30));
    await r.drivingMinutes(A, B, 200_000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('osrm: reads routes[0].duration', async () => {
    process.env.ROUTING_PROVIDER = 'osrm'; process.env.OSRM_URL = 'https://osrm.example.com/';
    const f = jest.fn(() => json({ routes: [{ duration: 600 }] }));
    expect(await new RoutingService(f as never).drivingMinutes(A, B)).toBe(10);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`https://osrm.example.com/route/v1/driving/${A.lng},${A.lat};${B.lng},${B.lat}?overview=false`);
  });

  it('an error or a bad answer falls back to null', async () => {
    process.env.ROUTING_PROVIDER = 'osrm'; process.env.OSRM_URL = 'https://osrm.example.com';
    expect(await new RoutingService(jest.fn(() => json({}, false)) as never).drivingMinutes(A, B)).toBeNull();
    expect(await new RoutingService(jest.fn(() => Promise.reject(new Error('timeout'))) as never).drivingMinutes(A, B)).toBeNull();
    expect(await new RoutingService(jest.fn(() => json({ routes: [] })) as never).drivingMinutes(A, B)).toBeNull();
  });

  it('the arrival time uses road minutes when there are some, plus 8 minutes per stop before', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    const driver = { ...A, at: now };
    const road = estimateArrival({ now, driver, pin: B, stopsBefore: 2, roadMinutes: 14 });
    expect(road?.minutes).toBe(14 + 16);
    const line = estimateArrival({ now, driver, pin: B, stopsBefore: 2 });
    expect(line?.minutes).not.toBe(30); // straight-line fallback differs
  });
});
