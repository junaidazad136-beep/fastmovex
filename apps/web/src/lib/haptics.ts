/**
 * A short buzz when something important happens (added to cart, saved, order placed), like the shopping apps.
 * Android phones only: iPhones have no web vibration, and computers ignore it — there it simply does nothing.
 * Shoppers who ask their phone for less motion get no buzz either.
 */
const PATTERNS = {
  /** a light tap: saved to the wishlist, quantity changed */
  tap: 12,
  /** added to cart */
  success: 22,
  /** order placed: two short pulses */
  done: [24, 70, 36],
  /** something went wrong */
  error: [40, 60, 40],
} as const;

export type Haptic = keyof typeof PATTERNS;

export function haptic(kind: Haptic = 'tap'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const p = PATTERNS[kind];
    navigator.vibrate(typeof p === 'number' ? p : [...p]);
  } catch {
    /* some browsers throw when the page has not been touched yet — a buzz is never worth an error */
  }
}
