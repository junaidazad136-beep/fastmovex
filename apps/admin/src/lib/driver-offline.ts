'use client';

/**
 * The driver page keeps working without signal (basements, lifts, the edge of town):
 *  - the last run (today's stops, addresses, phones, cash) is kept on the phone and shown when offline;
 *  - actions taken offline (picked up, on the way, delivered with the code, could not deliver) wait in an outbox
 *    and are sent in order as soon as the phone is back online. The server still checks everything then
 *    (a wrong delivery code is refused and the job comes back as open).
 * Everything is stored per driver and wiped on sign-out.
 */

export type OutboxKind = 'pickup' | 'out-for-delivery' | 'deliver' | 'fail';
export interface OutboxEntry {
  id: string;
  jobId: string;
  orderNumber: string;
  kind: OutboxKind;
  /** deliver: code, recipientName; fail: reason, refused, lat, lng */
  payload: Record<string, string>;
  at: string;
}
export interface DriverProfile { id: string; fullName: string; email: string | null; roles: string[]; perms: string[] }

const RUN = 'jovia_driver_run';
const OUTBOX = 'jovia_driver_outbox';
const PROFILE = 'jovia_driver_profile';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: the page still works online */ }
}

// ---------------------------------------------------------------- who is signed in (to open the page offline)

export function saveProfile(p: DriverProfile) { write(PROFILE, p); }
export function cachedProfile(): DriverProfile | null {
  const p = read<DriverProfile>(PROFILE);
  return p && p.roles?.includes('DELIVERY_AGENT') ? p : null;
}

// ---------------------------------------------------------------- the last run

export function saveRun<T>(userId: string, run: T) { write(RUN, { userId, savedAt: new Date().toISOString(), run }); }
export function cachedRun<T>(userId: string): { savedAt: string; run: T } | null {
  const c = read<{ userId: string; savedAt: string; run: T }>(RUN);
  return c && c.userId === userId ? { savedAt: c.savedAt, run: c.run } : null;
}

// ---------------------------------------------------------------- outbox

export function outbox(userId: string): OutboxEntry[] {
  const c = read<{ userId: string; items: OutboxEntry[] }>(OUTBOX);
  return c && c.userId === userId ? c.items : [];
}
function setOutbox(userId: string, items: OutboxEntry[]) { write(OUTBOX, { userId, items }); }

export function enqueue(userId: string, e: Omit<OutboxEntry, 'id' | 'at'>): OutboxEntry {
  const entry: OutboxEntry = { ...e, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() };
  const items = outbox(userId).filter((x) => !(x.jobId === e.jobId && x.kind === e.kind)); // the same step twice counts once
  setOutbox(userId, [...items, entry]);
  return entry;
}

/** What a job's status becomes after its queued steps (shown at once, before the server confirms). Exported for tests. */
export function statusAfter(status: string, kinds: OutboxKind[]): string {
  let s = status;
  for (const k of kinds) {
    if (k === 'pickup' && s === 'ASSIGNED') s = 'PICKED_UP';
    else if (k === 'out-for-delivery' && (s === 'PICKED_UP' || s === 'IN_TRANSIT')) s = 'OUT_FOR_DELIVERY';
    else if (k === 'deliver' && s === 'OUT_FOR_DELIVERY') s = 'DELIVERED';
    else if (k === 'fail' && s !== 'DELIVERED') s = 'FAILED';
  }
  return s;
}

/** A network failure (no signal) keeps the entry; anything the server answered removes it. Exported for tests. */
export function isOffline(e: unknown): boolean {
  return (e as Error)?.name === 'NetworkError' || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/**
 * Sends the outbox in order. Stops at the first network failure (still offline). Returns the entries the server
 * refused (e.g. a wrong delivery code) with its message, so the driver can be told.
 */
export async function flush(userId: string, send: (e: OutboxEntry) => Promise<void>, message: (e: unknown) => string) {
  const refused: { entry: OutboxEntry; message: string }[] = [];
  let sent = 0;
  for (const entry of outbox(userId)) {
    try {
      await send(entry);
      sent++;
    } catch (e) {
      if (isOffline(e)) break;
      refused.push({ entry, message: message(e) });
    }
    setOutbox(userId, outbox(userId).filter((x) => x.id !== entry.id));
  }
  return { sent, refused, left: outbox(userId).length };
}

/** Sign-out: nothing of the driver's day stays on the phone. */
export function clearDriverData() {
  for (const k of [RUN, OUTBOX, PROFILE]) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}
