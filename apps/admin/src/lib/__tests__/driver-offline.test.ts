import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCsp } from '../../proxy';
import { cachedProfile, cachedRun, clearDriverData, enqueue, flush, outbox, saveProfile, saveRun, statusAfter } from '../driver-offline';

// a tiny localStorage for node
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('navigator', { onLine: true });

const netErr = () => Object.assign(new Error('offline'), { name: 'NetworkError' });

describe('driver page without signal', () => {
  beforeEach(() => store.clear());

  it('queued steps move the job on at once, in order', () => {
    expect(statusAfter('ASSIGNED', ['pickup', 'out-for-delivery', 'deliver'])).toBe('DELIVERED');
    expect(statusAfter('ASSIGNED', ['deliver'])).toBe('ASSIGNED'); // cannot skip steps
    expect(statusAfter('OUT_FOR_DELIVERY', ['fail'])).toBe('FAILED');
    expect(statusAfter('DELIVERED', ['fail'])).toBe('DELIVERED');
  });

  it('keeps the run and the outbox per driver; the same step twice counts once', () => {
    saveRun('d1', { jobs: [1] });
    expect(cachedRun('d1')?.run).toEqual({ jobs: [1] });
    expect(cachedRun('d2')).toBeNull();
    enqueue('d1', { jobId: 'j1', orderNumber: 'A', kind: 'pickup', payload: {} });
    enqueue('d1', { jobId: 'j1', orderNumber: 'A', kind: 'pickup', payload: {} });
    enqueue('d1', { jobId: 'j1', orderNumber: 'A', kind: 'out-for-delivery', payload: {} });
    expect(outbox('d1').map((e) => e.kind)).toEqual(['pickup', 'out-for-delivery']);
    expect(outbox('d2')).toEqual([]);
  });

  it('sends in order, stops while offline, drops what the server refused (and reports it)', async () => {
    enqueue('d1', { jobId: 'j1', orderNumber: 'A', kind: 'pickup', payload: {} });
    enqueue('d1', { jobId: 'j1', orderNumber: 'A', kind: 'deliver', payload: { code: '1234' } });
    enqueue('d1', { jobId: 'j2', orderNumber: 'B', kind: 'pickup', payload: {} });
    // still no signal: nothing leaves the outbox
    let r = await flush('d1', async () => { throw netErr(); }, () => '');
    expect(r).toMatchObject({ sent: 0, left: 3 });
    // back online: the wrong code is refused, the rest goes through
    const seen: string[] = [];
    r = await flush('d1', async (e) => { seen.push(`${e.jobId}:${e.kind}`); if (e.kind === 'deliver') throw Object.assign(new Error('Wrong delivery code'), { name: 'ApiError' }); }, (e) => (e as Error).message);
    expect(seen).toEqual(['j1:pickup', 'j1:deliver', 'j2:pickup']);
    expect(r.sent).toBe(2);
    expect(r.refused.map((x) => x.message)).toEqual(['Wrong delivery code']);
    expect(r.left).toBe(0);
  });

  it('opens offline only for a driver; sign-out wipes everything', () => {
    saveProfile({ id: 'd1', fullName: 'K', email: null, roles: ['DELIVERY_AGENT'], perms: ['delivery.update_own'] });
    expect(cachedProfile()?.id).toBe('d1');
    saveProfile({ id: 'a', fullName: 'A', email: null, roles: ['ADMIN'], perms: ['orders.read'] });
    expect(cachedProfile()).toBeNull();
    saveRun('d1', {});
    clearDriverData();
    expect(store.size).toBe(0);
  });

  it('the service worker may be registered under the strict CSP', () => {
    expect(buildCsp('n', { dev: false, apiOrigin: 'https://api.fastmovex.qa', mediaOrigin: '' })).toContain("worker-src 'self'");
  });
});
