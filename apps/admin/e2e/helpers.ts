import crypto from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const API = process.env.API_URL || 'http://localhost:4000/api/v1';
export const DEMO_PASSWORD = 'Demo-Pass-2026';
export const ADMIN = 'admin@demo.fastmovex.test';
export const SUPER = { email: process.env.SUPER_ADMIN_EMAIL || 'owner@fastmovex.test', password: process.env.SUPER_ADMIN_PASSWORD || 'Owner-Pass-2026' };
export const CUSTOMER = 'customer@demo.fastmovex.test';
/** 1×1 PNG, enough for a product photo. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

export async function signIn(page: Page, identifier = ADMIN, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email or phone').fill(identifier);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** Mobile-style API session (token in the body), for setting up data the test then works on in the browser. */
export async function apiToken(identifier: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier, password }) });
  const body = (await res.json()) as { accessToken?: string; message?: string };
  if (!body.accessToken) throw new Error(`login ${identifier}: ${body.message}`);
  return body.accessToken;
}

export async function apiCall<T>(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-country': 'QA', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The demo customer buys one unit of the given variant with cash on delivery. Returns the order number. */
export async function placeOrder(variantId: string): Promise<string> {
  const t = await apiToken(CUSTOMER);
  await apiCall(t, 'DELETE', '/cart');
  const addresses = await apiCall<{ id: string }[] | { items: { id: string }[] }>(t, 'GET', '/addresses');
  const addressId = (Array.isArray(addresses) ? addresses : addresses.items)[0].id;
  await apiCall(t, 'POST', '/cart/items', { variantId, quantity: 1 });
  const order = await apiCall<{ orderNumber: string }>(t, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `e2e-${Date.now()}-${Math.random()}` });
  return order.orderNumber;
}

export const run = () => Date.now().toString(36).toUpperCase().slice(-6);

/**
 * A cash order from a brand-new customer (the dates), made ready for a FastMoveX driver. `code()` reads the delivery code
 * the way the customer sees it — staff screens never show it.
 */
export async function fleetOrder(name = 'Noora Driver-Test', zone = '66', slug = 'premium-khalas-dates-1kg', pin?: { lat: number; lng: number }) {
  const email = `fleet.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ fullName: name, email, password: 'Fleet-Pass-2026', countryCode: 'QA' }) });
  if (!reg.ok) throw new Error(`register ${reg.status}`);
  const customer = ((await reg.json()) as { accessToken: string }).accessToken;
  const phone = `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
  const addr = await apiCall<{ id: string }>(customer, 'POST', '/addresses', { recipientName: name, phone, countryCode: 'QA', city: 'Doha', zone, street: '901', building: '12', isDefault: true, ...pin });
  const product = (await (await fetch(`${API}/products/${slug}`)).json()) as { variants: { id: string }[] };
  await apiCall(customer, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
  const { orderNumber } = await apiCall<{ orderNumber: string }>(customer, 'POST', '/checkout', { addressId: addr.id, paymentMethod: 'COD' }, { 'idempotency-key': `fleet-${email}` });
  const t = await apiToken(ADMIN);
  const order = await apiCall<{ sellerOrders: { id: string }[] }>(t, 'GET', `/admin/orders/${orderNumber}`);
  for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await apiCall(t, 'POST', `/admin/orders/shipments/${order.sellerOrders[0].id}/status`, { status });
  const code = async () => {
    for (let i = 0; i < 30; i++) {
      const o = await apiCall<{ sellerOrders: { delivery: { deliveryCode?: string | null } | null }[] }>(customer, 'GET', `/orders/${orderNumber}`);
      const c = o.sellerOrders[0].delivery?.deliveryCode;
      if (c) return c;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('no delivery code');
  };
  return { orderNumber, shipmentId: order.sellerOrders[0].id, phone, customer, code };
}

/** RFC 6238 code (HMAC-SHA1, 30-second steps, 6 digits) for a base32 secret — what an authenticator app shows. */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretBase32.toUpperCase().replace(/[\s=-]/g, '')) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = crypto.createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = mac[mac.length - 1] & 0xf;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** A code from a 30-second step that has not been used yet (each step's code works once). */
export async function freshTotp(secret: string, used: Set<number>): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  while (used.has(step)) {
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 200));
    step = Math.floor(Date.now() / 30_000);
  }
  used.add(step);
  return totp(secret, step * 30_000 + 1000);
}
