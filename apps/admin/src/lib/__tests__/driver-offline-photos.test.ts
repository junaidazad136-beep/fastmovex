import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDriverData, enqueue, flush, outbox, queuedPhoto, savePhoto } from '../driver-offline';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('navigator', { onLine: true });
const netErr = () => Object.assign(new Error('offline'), { name: 'NetworkError' });
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });

describe('driver page without signal: the doorstep photo waits with its step', () => {
  beforeEach(() => store.clear());

  it('keeps the photo until the step is sent, then removes it', async () => {
    const e = enqueue('u1', { jobId: 'j1', orderNumber: 'FMX-1', kind: 'fail', payload: { reason: 'Not at home' } });
    expect(await savePhoto(e.id, jpeg())).toBe(true);
    expect((await queuedPhoto(e.id))?.size).toBe(6);

    // still no signal: nothing sent, photo still there
    const offline = await flush('u1', async () => { throw netErr(); }, () => 'x');
    expect(offline.left).toBe(1);
    expect(await queuedPhoto(e.id)).not.toBeNull();

    // back online: the sender finds the photo, and it is gone afterwards
    const seen: (number | undefined)[] = [];
    const online = await flush('u1', async (x) => { seen.push((await queuedPhoto(x.id))?.size); }, () => 'x');
    expect(online).toMatchObject({ sent: 1, left: 0 });
    expect(seen).toEqual([6]);
    expect(await queuedPhoto(e.id)).toBeNull();
  });

  it('a step the server refuses also drops its photo', async () => {
    const e = enqueue('u1', { jobId: 'j2', orderNumber: 'FMX-2', kind: 'deliver', payload: { code: '0000' } });
    await savePhoto(e.id, jpeg());
    const r = await flush('u1', async () => { throw Object.assign(new Error('Wrong code'), { name: 'ApiError' }); }, (x) => (x as Error).message);
    expect(r.refused).toHaveLength(1);
    expect(await queuedPhoto(e.id)).toBeNull();
  });

  it('queueing the same step again replaces the old photo; sign-out wipes photos', async () => {
    const a = enqueue('u1', { jobId: 'j3', orderNumber: 'FMX-3', kind: 'fail', payload: { reason: 'a' } });
    await savePhoto(a.id, jpeg());
    const b = enqueue('u1', { jobId: 'j3', orderNumber: 'FMX-3', kind: 'fail', payload: { reason: 'b' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await queuedPhoto(a.id)).toBeNull();
    expect(outbox('u1')).toHaveLength(1);
    await savePhoto(b.id, jpeg());
    clearDriverData();
    await new Promise((r) => setTimeout(r, 20));
    expect(await queuedPhoto(b.id)).toBeNull();
  });
});
