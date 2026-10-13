import { expect, test } from './fixtures';
import crypto from 'node:crypto';
import http from 'node:http';
import { apiCall, apiToken, freshCustomer, signIn } from './helpers';

/**
 * Phase 23 on the website: Continue with Google (Google's script and keys are replaced by test doubles — the API is
 * started with GOOGLE_CLIENT_IDS=e2e-web.apps.googleusercontent.com and GOOGLE_JWKS_URL=http://127.0.0.1:47824/certs),
 * Buy again, the driver's arrival estimate, and browser notifications.
 */
const CLIENT = process.env.E2E_GOOGLE_CLIENT || 'e2e-web.apps.googleusercontent.com';
const JWKS_PORT = Number(process.env.E2E_JWKS_PORT || 47824);
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = `e2e-${Date.now().toString(36)}`; // a new key id per run, as when Google rotates its keys
const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url');
function googleToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, iat: now, exp: now + 300, ...claims }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${b64(sig)}`;
}
// Google's sign-in button, as a small stand-in: initialize() keeps the settings, the button hands back a token
const FAKE_GIS = `window.google = { accounts: { id: {
  initialize(cfg) { window.__gis = cfg; },
  renderButton(el) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Continue with Google'; b.dataset.testid = 'fake-google';
    b.onclick = async () => window.__gis.callback({ credential: await window.__signGoogle(window.__gis.nonce) }); el.appendChild(b); },
} } };`;

let jwks: http.Server;
test.beforeAll(async () => {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  jwks = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((ok) => jwks.listen(JWKS_PORT, '127.0.0.1', ok));
});
test.afterAll(async () => { jwks.closeAllConnections(); await new Promise<void>((ok) => jwks.close(() => ok())); });

test('Continue with Google creates the account; the account page lists the sign-in and asks to set a password', async ({ page }) => {
  const providers = await apiCall<{ google: string | null }>(null, 'GET', '/auth/social/providers');
  test.skip(providers.google !== CLIENT, 'the API under test does not have the e2e Google client set up');
  const email = `google.${Date.now().toString(36)}@example.com`;
  const sub = `e2e-${Date.now()}`;
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  await page.exposeFunction('__signGoogle', (nonce: string) => googleToken({ sub, email, email_verified: true, name: 'Latifa Google', nonce }));
  await page.goto('/en/login');
  await expect(page.getByTestId('social-sign-in')).toBeVisible();
  await page.getByTestId('fake-google').click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/en/account');
  await expect(page.getByTestId('no-password')).toBeVisible();
  await expect(page.getByTestId('sign-ins')).toContainText('Google');
  await expect(page.getByTestId('sign-ins')).toContainText(email);
  await expect(page.getByTestId('unlink-google')).toBeDisabled(); // the only way in

  // the same Google account again, in Arabic, from a fresh page
  await page.context().clearCookies();
  await page.goto('/ar/login');
  await page.getByTestId('fake-google').click();
  await expect(page).not.toHaveURL(/\/login/);
});

test('Buy again puts the order back in the cart', async ({ page }) => {
  const c = await freshCustomer();
  const product = await apiCall<{ variants: { id: string }[] }>(null, 'GET', '/products/premium-khalas-dates-1kg');
  const addresses = await apiCall<{ id: string }[] | { items: { id: string }[] }>(c.token, 'GET', '/addresses');
  const addressId = (Array.isArray(addresses) ? addresses : addresses.items)[0].id;
  await apiCall(c.token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 2 });
  const { orderNumber } = await apiCall<{ orderNumber: string }>(c.token, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `again-${Date.now()}` });
  await signIn(page, c.email, c.password);
  await page.goto(`/en/account/orders/${orderNumber}`);
  await page.getByTestId('buy-again').click();
  await expect(page.getByText('2 items added to your cart')).toBeVisible();
  const cart = await apiCall<{ totals: { itemCount: number } }>(c.token, 'GET', '/cart');
  expect(cart.totals.itemCount).toBe(2);
});

test('while the driver is on the way, the order page says when they should arrive', async ({ page }) => {
  const c = await freshCustomer();
  const pin = { lat: 25.2854, lng: 51.531 };
  const { id: addressId } = await apiCall<{ id: string }>(c.token, 'POST', '/addresses', { recipientName: 'Aisha Tester', phone: '+97455501239', countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '3', isDefault: true, ...pin });
  const product = await apiCall<{ variants: { id: string }[] }>(null, 'GET', '/products/premium-khalas-dates-1kg');
  await apiCall(c.token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
  const { orderNumber } = await apiCall<{ orderNumber: string }>(c.token, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `eta-${Date.now()}` });
  const admin = await apiToken('admin@demo.fastmovex.test');
  const shipment = (await apiCall<{ sellerOrders: { id: string }[] }>(admin, 'GET', `/admin/orders/${orderNumber}`)).sellerOrders[0].id;
  for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await apiCall(admin, 'POST', `/admin/orders/shipments/${shipment}/status`, { status });
  let deliveryId: string | undefined;
  for (let i = 0; i < 30 && !deliveryId; i++) {
    deliveryId = (await apiCall<{ sellerOrders: { delivery: { id: string } | null }[] }>(admin, 'GET', `/admin/orders/${orderNumber}`)).sellerOrders[0].delivery?.id;
    if (!deliveryId) await new Promise((r) => setTimeout(r, 200));
  }
  const couriers = await apiCall<{ id: string; fullName: string }[]>(admin, 'GET', '/admin/deliveries/couriers');
  await apiCall(admin, 'POST', `/admin/deliveries/${deliveryId}/assign`, { courierUserId: (couriers.find((x) => x.fullName === 'Khalid Courier') ?? couriers[0]).id });
  const driver = await apiToken('courier@demo.fastmovex.test');
  await apiCall(driver, 'POST', `/courier/jobs/${deliveryId}/pickup`);
  await apiCall(driver, 'POST', `/courier/jobs/${deliveryId}/out-for-delivery`);
  await apiCall(driver, 'POST', `/courier/jobs/${deliveryId}/location`, { lat: 25.3154, lng: 51.531 });
  await signIn(page, c.email, c.password);
  await page.goto(`/en/account/orders/${orderNumber}`);
  const eta = page.getByTestId('delivery-eta');
  await expect(eta).toContainText('Arriving around');
  await expect(eta).toContainText(/minutes away/);
  await page.goto(`/ar/account/orders/${orderNumber}`);
  await expect(page.getByTestId('delivery-eta')).toContainText('الوصول حوالي');
});

test('notifications on this browser: switched on and off from the notifications page', async ({ page, context }) => {
  const c = await freshCustomer();
  const push = await apiCall<{ enabled: boolean }>(c.token, 'GET', '/me/push');
  test.skip(!push.enabled, 'the API under test has no VAPID keys');
  await context.grantPermissions(['notifications']);
  // a browser push service is outside the test: the subscription the browser would return is stood in for
  await context.addInitScript(() => {
    let sub: { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null = null;
    const proto = (window as unknown as { PushManager?: { prototype: Record<string, unknown> } }).PushManager?.prototype;
    if (!proto) return;
    proto.getSubscription = async () => sub;
    proto.subscribe = async () => {
      sub = {
        endpoint: `https://push.example.test/e2e/${Date.now()}`,
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }; },
        async unsubscribe() { sub = null; return true; },
      };
      return sub;
    };
  });
  await signIn(page, c.email, c.password);
  await page.goto('/en/account/notifications');
  const toggle = page.getByTestId('browser-push-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId('browser-push')).toContainText('Notifications are on for this browser');
  expect((await apiCall<{ browsers: number }>(c.token, 'GET', '/me/push')).browsers).toBe(1);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect((await apiCall<{ browsers: number }>(c.token, 'GET', '/me/push')).browsers).toBe(0);
});
