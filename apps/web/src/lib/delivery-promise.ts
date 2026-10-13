'use client';

import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { DeliverySlots } from './api/types';
import type { Locale } from './i18n/config';

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

/** "Tue, 14 Oct" in Qatar time, for a Qatar calendar day (YYYY-MM-DD). Exported for tests. */
export function dayLabel(date: string, locale: Locale, weekday = false): string {
  const d = new Date(`${date}T12:00:00+03:00`);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Qatar', day: 'numeric', month: 'short', ...(weekday ? { weekday: 'long' as const } : {}),
  }).format(d);
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

/**
 * The product page's delivery line: the first day with a free window, its date, and until when an order still gets it
 * (the window's start minus the booking lead time) — "FREE delivery Tomorrow, 14 Oct · Order within 2 h 10 min".
 * Exported for tests.
 */
export interface DeliveryDetails { promise: DeliveryPromise; date: string | null; cutoff: string | null }
export function detailsFrom(slots: (DeliverySlots & { leadMinutes?: number }) | null, now = new Date()): DeliveryDetails {
  const promise = promiseFrom(slots, now);
  if (!slots?.enabled || promise.kind === 'days') return { promise, date: null, cutoff: null };
  for (const d of slots.days) {
    const s = d.slots.find((x) => x.available);
    if (!s) continue;
    const cutoff = new Date(new Date(s.start).getTime() - (slots.leadMinutes ?? 0) * 60_000);
    return { promise, date: d.date, cutoff: cutoff.getTime() > now.getTime() ? cutoff.toISOString() : null };
  }
  return { promise, date: null, cutoff: null };
}

let detailsPending: Promise<DeliveryDetails> | null = null;
export function useDeliveryDetails(): DeliveryDetails | null {
  const [value, setValue] = useState<DeliveryDetails | null>(null);
  useEffect(() => {
    let alive = true;
    // live data (windows fill up during the day): one request per page view
    detailsPending ??= api<DeliverySlots & { leadMinutes?: number }>('/delivery/slots', { auth: 'none' })
      .then((s) => detailsFrom(s))
      .catch((): DeliveryDetails => ({ promise: { kind: 'days' }, date: null, cutoff: null }))
      .finally(() => { window.setTimeout(() => { detailsPending = null; }, 60_000); });
    detailsPending.then((v) => { if (alive) setValue(v); });
    return () => { alive = false; };
  }, []);
  return value;
}
