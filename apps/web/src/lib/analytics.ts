'use client';

import { apiCountry, apiUrl } from './api/client';

/**
 * First-party, anonymous visit analytics. A random id per browser tab session (sessionStorage, no cookie), where the
 * visit came from (campaign tags or the referring site's name — never the full address), and four steps:
 * page view → product view → add to cart → checkout. Events are sent in small batches; nothing is personal.
 */
export type EventType = 'page_view' | 'product_view' | 'add_to_cart' | 'checkout_start';
export interface Touch { utmSource?: string; utmMedium?: string; utmCampaign?: string; referrerHost?: string; click?: 'gclid' | 'fbclid' | 'ttclid' | 'msclkid' }

const SID = 'jovia.sid';
const TOUCH = 'jovia.touch';
const LAST = 'jovia.lastTouch'; // last visit that came from somewhere (not direct), for 30 days
const KEEP_MS = 30 * 86_400_000;

let memorySid: string | null = null;
let memoryTouch: Touch | null = null;
let queue: { type: EventType; path?: string }[] = [];
let timer: number | null = null;
let touchSent = false;

const get = (s: Storage | undefined, k: string) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const set = (s: Storage | undefined, k: string, v: string) => { try { s?.setItem(k, v); } catch { /* storage blocked */ } };
const store = (kind: 'session' | 'local') => (typeof window === 'undefined' ? undefined : kind === 'session' ? window.sessionStorage : window.localStorage);

function sessionId(): string {
  const saved = get(store('session'), SID);
  if (saved) return saved;
  memorySid ??= crypto.randomUUID();
  set(store('session'), SID, memorySid);
  return memorySid;
}

const isDirect = (t: Touch) => !t.utmSource && !t.click && !t.referrerHost;

/** Where this visit came from: worked out once, when the visit starts. */
export function currentTouch(): Touch {
  const saved = get(store('session'), TOUCH);
  if (saved) { try { return JSON.parse(saved) as Touch; } catch { /* rebuild */ } }
  if (memoryTouch) return memoryTouch;
  const url = new URL(window.location.href);
  const p = (k: string) => url.searchParams.get(k)?.slice(0, 100) || undefined;
  let referrerHost: string | undefined;
  try {
    const r = document.referrer ? new URL(document.referrer).hostname : '';
    if (r && r !== window.location.hostname) referrerHost = r;
  } catch { /* no referrer */ }
  const click = (['gclid', 'fbclid', 'ttclid', 'msclkid'] as const).find((k) => url.searchParams.has(k));
  let touch: Touch = { utmSource: p('utm_source'), utmMedium: p('utm_medium'), utmCampaign: p('utm_campaign'), referrerHost, click };
  if (isDirect(touch)) {
    // typed the address or opened a bookmark: credit the last place they came from (30 days), like most analytics tools
    try {
      const last = JSON.parse(get(store('local'), LAST) ?? 'null') as { touch: Touch; at: number } | null;
      if (last && Date.now() - last.at < KEEP_MS) touch = last.touch;
    } catch { /* ignore */ }
  } else {
    set(store('local'), LAST, JSON.stringify({ touch, at: Date.now() }));
  }
  memoryTouch = touch;
  set(store('session'), TOUCH, JSON.stringify(touch));
  return touch;
}

function send(keepalive = false) {
  if (timer) { window.clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  const events = queue.splice(0, 50);
  const body = JSON.stringify({ sessionId: sessionId(), locale: document.documentElement.lang === 'ar' ? 'ar' : 'en', ...(touchSent ? {} : { touch: currentTouch() }), events });
  touchSent = true;
  // text/plain and the market in the address: a "simple" request, so no CORS preflight — it still goes out while
  // the page is closing (sendBeacon), and the API never has to answer it
  const url = `${apiUrl()}/analytics/events?country=${encodeURIComponent(apiCountry())}`;
  const blob = new Blob([body], { type: 'text/plain' });
  if (!(keepalive && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, blob))) {
    fetch(url, { method: 'POST', body: blob, mode: 'no-cors', credentials: 'omit', keepalive }).catch(() => { /* statistics only */ });
  }
  if (queue.length) send(keepalive);
}

export function track(type: EventType, path?: string) {
  if (typeof window === 'undefined') return;
  currentTouch(); // read the landing address now, before the visitor moves on (it is remembered for the visit)
  queue.push({ type, ...(path && { path }) });
  // funnel steps go out at once, with everything queued before them, as a request that survives leaving the page:
  // shoppers often tap "Add to cart" and move on straight away, and a batched event would be lost with the page
  if (type === 'add_to_cart' || type === 'checkout_start') send(true);
  else if (queue.length >= 10) send();
  else timer ??= window.setTimeout(() => send(), type === 'page_view' ? 2_000 : 500);
}

if (typeof window !== 'undefined') {
  // the page is being closed or hidden: send what is left
  window.addEventListener('pagehide', () => send(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(true); });
}

/** Sent with an order so sales can be reported by source. */
export function trafficForCheckout() {
  if (typeof window === 'undefined') return undefined;
  return { sessionId: sessionId(), ...currentTouch() };
}
