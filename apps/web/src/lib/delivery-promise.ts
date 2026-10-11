'use client';

import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { DeliverySlots } from './api/types';

/**
 * When an order placed now can arrive, for the line on product cards ("Tomorrow"). Taken from the real delivery
 * windows (the first day with a free window); without windows the market promises 1–2 days. One request per page view
 * for all cards, remembered for 10 minutes in this tab.
 */
export type DeliveryPromise = { kind: 'today' | 'tomorrow' } | { kind: 'date'; date: string } | { kind: 'days' };

const KEY = 'fmx.deliveryPromise';
const TTL = 10 * 60_000;
let pending: Promise<DeliveryPromise> | null = null;

/** Qatar calendar day (YYYY-MM-DD) `addDays` from now. Exported for tests. */
export function qatarDay(now: Date, addDays = 0): string {
  return new Date(now.getTime() + 3 * 3_600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
}

/** The promise from the delivery windows. Exported for tests. */
export function promiseFrom(slots: DeliverySlots | null, now = new Date()): DeliveryPromise {
  if (!slots?.enabled) return { kind: 'days' };
  const first = slots.days.find((d) => d.slots.some((s) => s.available));
  if (!first) return { kind: 'days' };
  if (first.date === qatarDay(now)) return { kind: 'today' };
  if (first.date === qatarDay(now, 1)) return { kind: 'tomorrow' };
  return { kind: 'date', date: first.date };
}

function load(): Promise<DeliveryPromise> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const { at, value } = JSON.parse(raw) as { at: number; value: DeliveryPromise };
      if (Date.now() - at < TTL) return Promise.resolve(value);
    }
  } catch { /* storage blocked: ask the server */ }
  pending ??= api<DeliverySlots>('/delivery/slots', { auth: 'none' })
    .then((s) => promiseFrom(s))
    .catch((): DeliveryPromise => ({ kind: 'days' }))
    .then((value) => {
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), value })); } catch { /* fine */ }
      return value;
    });
  return pending;
}

export function useDeliveryPromise(): DeliveryPromise | null {
  const [value, setValue] = useState<DeliveryPromise | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((v) => { if (alive) setValue(v); });
    return () => { alive = false; };
  }, []);
  return value;
}
