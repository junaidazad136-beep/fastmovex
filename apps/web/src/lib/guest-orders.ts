/**
 * Orders placed without an account, remembered on this device so the shopper can reopen them from "Track order".
 * Only the order number and its access token are kept (never personal details). Storage failures are ignored.
 */
const KEY = 'fmx_guest_orders';
const MAX = 10;

export interface GuestOrderRef { orderNumber: string; token: string; placedAt: string }

export function guestOrders(): GuestOrderRef[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as GuestOrderRef[]) : [];
    return Array.isArray(list) ? list.filter((o) => typeof o?.orderNumber === 'string' && typeof o?.token === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberGuestOrder(orderNumber: string, token: string) {
  try {
    const rest = guestOrders().filter((o) => o.orderNumber !== orderNumber);
    window.localStorage.setItem(KEY, JSON.stringify([{ orderNumber, token, placedAt: new Date().toISOString() }, ...rest].slice(0, MAX)));
  } catch { /* private mode: the email link still works */ }
}

export function guestTokenFor(orderNumber: string): string | null {
  return guestOrders().find((o) => o.orderNumber === orderNumber)?.token ?? null;
}
