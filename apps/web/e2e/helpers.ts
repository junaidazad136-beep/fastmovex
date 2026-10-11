import { expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';

export const API = process.env.API_URL || 'http://localhost:4000/api/v1';
export const DEMO_PASSWORD = 'Demo-Pass-2026';
export const CUSTOMER = 'customer@demo.jovia.test';

export async function signIn(page: Page, identifier = CUSTOMER, password = DEMO_PASSWORD, locale = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByLabel(/Email or mobile number|البريد الإلكتروني أو رقم الجوال/).fill(identifier);
  await page.locator('input[name="password"]').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** API-side reset of the demo customer's cart so tests start from a known state. */
export async function clearCustomerCart(identifier = CUSTOMER) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' },
    body: JSON.stringify({ identifier, password: DEMO_PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  await fetch(`${API}/cart`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  await fetch(`${API}/cart/coupon`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  return accessToken;
}

/** Reads the newest 6-digit code sent to `target` from the API log (development "log" notification driver). */
export async function codeFromApiLog(target: string, since: number, pattern = /(?:code is|هو) (\d{6})/): Promise<string | null> {
  const file = process.env.E2E_API_LOG;
  if (!file) return null;
  for (let i = 0; i < 20; i++) {
    const text = fs.readFileSync(file).subarray(since).toString('utf8'); // `since` is a byte offset (the log has Arabic text)
    const lines = text.split('\n').filter((l) => l.includes(target));
    for (const l of lines.reverse()) {
      const m = pattern.exec(l);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

export function apiLogSize(): number {
  const file = process.env.E2E_API_LOG;
  return file && fs.existsSync(file) ? fs.statSync(file).size : 0;
}

/** Creates a brand-new customer with a Qatar address through the API, so every run starts clean (first-order coupons etc.). */
export async function freshCustomer(): Promise<{ email: string; password: string; token: string }> {
  const email = `e2e.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = 'E2e-Pass-2026';
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' },
    body: JSON.stringify({ fullName: 'Aisha Tester', email, password, countryCode: 'QA', locale: 'en' }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const addr = await fetch(`${API}/addresses`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ label: 'Home', recipientName: 'Aisha Tester', phone: '+97455501234', countryCode: 'QA', city: 'Doha', zone: '66', street: '901', building: '12', unit: 'Flat 4', isDefault: true }),
  });
  if (!addr.ok) throw new Error(`address failed: ${addr.status} ${await addr.text()}`);
  return { email, password, token: accessToken };
}

/** A fresh Qatar mobile (8 digits): texted codes are limited per number per hour. */
export const freshMobile = () => `555${String(Math.floor(10_000 + Math.random() * 89_999))}`;

/** Guest cash on delivery: asks for the texted code and types it in (reads it from the API log, as a phone would). */
export async function confirmGuestPhone(page: Page, mobile: string) {
  const since = apiLogSize();
  await page.getByTestId('cod-send-code').click();
  await expect(page.getByLabel(/Code sent to/)).toBeVisible();
  const code = await codeFromApiLog(`+974${mobile}`, since);
  if (!code) throw new Error('No texted code found in the API log — run with E2E_API_LOG pointing at the API output');
  await page.getByLabel(/Code sent to/).fill(code);
}

// ------------------------------------------------------------------ API set-up helpers (mobile-style tokens)

export async function apiToken(identifier: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier, password }) });
  const body = (await res.json()) as { accessToken?: string; message?: string };
  if (!body.accessToken) throw new Error(`login ${identifier}: ${res.status} ${body.message}`);
  return body.accessToken;
}

export async function apiCall<T>(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', 'x-country': 'QA', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Delivery time slots for the Qatar market (admin setting). Tests that turn them on turn them off again. */
export async function setDeliverySlots(deliverySlots: Record<string, unknown>) {
  await apiCall(await apiToken('admin@demo.jovia.test'), 'PATCH', '/admin/countries/QA', { deliverySlots });
}

/**
 * A cash order from the given customer (dates, FastMoveX driver), taken by the demo driver who could not deliver it.
 * `reason` is what the driver's app sends ("Customer not at home", …); `refused` marks a refusal at the door.
 */
export async function missedDeliveryOrder(customerToken: string, reason = 'Customer not answering', refused = false): Promise<string> {
  await apiCall(customerToken, 'DELETE', '/cart');
  // its own mobile number: a refusal at the door counts against cash on delivery for that number
  const phone = `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
  const { id: addressId } = await apiCall<{ id: string }>(customerToken, 'POST', '/addresses', { recipientName: 'Aisha Tester', phone, countryCode: 'QA', city: 'Doha', zone: '66', street: '901', building: '12', isDefault: true });
  const product = await apiCall<{ variants: { id: string }[] }>(null, 'GET', '/products/premium-khalas-dates-1kg');
  await apiCall(customerToken, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
  const { orderNumber } = await apiCall<{ orderNumber: string }>(customerToken, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `missed-${Date.now()}-${Math.random()}` });

  const admin = await apiToken('admin@demo.jovia.test');
  const shipmentId = (await apiCall<{ sellerOrders: { id: string }[] }>(admin, 'GET', `/admin/orders/${orderNumber}`)).sellerOrders[0].id;
  for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await apiCall(admin, 'POST', `/admin/orders/shipments/${shipmentId}/status`, { status });
  let deliveryId: string | undefined;
  for (let i = 0; i < 30 && !deliveryId; i++) {
    const o = await apiCall<{ sellerOrders: { delivery: { id: string } | null }[] }>(admin, 'GET', `/admin/orders/${orderNumber}`);
    deliveryId = o.sellerOrders[0].delivery?.id;
    if (!deliveryId) await new Promise((r) => setTimeout(r, 200));
  }
  if (!deliveryId) throw new Error(`no delivery for ${orderNumber}`);
  const couriers = await apiCall<{ id: string; fullName: string }[]>(admin, 'GET', '/admin/deliveries/couriers');
  const courierUserId = (couriers.find((c) => c.fullName === 'Khalid Courier') ?? couriers[0]).id;
  await apiCall(admin, 'POST', `/admin/deliveries/${deliveryId}/assign`, { courierUserId });
  const driver = await apiToken('courier@demo.jovia.test');
  await apiCall(driver, 'POST', `/courier/jobs/${deliveryId}/pickup`);
  await apiCall(driver, 'POST', `/courier/jobs/${deliveryId}/out-for-delivery`);
  await apiCall(driver, 'POST', `/courier/jobs/${deliveryId}/fail`, { reason, refused, lat: 25.2854, lng: 51.531 });
  return orderNumber;
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
