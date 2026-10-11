import { expect, test } from '@playwright/test';
import { ADMIN, API, apiCall, apiToken, CUSTOMER, DEMO_PASSWORD, fleetOrder, PNG, run, signIn } from './helpers';

/** Phase 23: adding an item to an order, promo codes on phone orders, the driver page without signal. */
const COURIER = 'courier@demo.jovia.test';

async function houseVariant(t: string, price = '1500') {
  const cats = await apiCall<{ id: string; slug: string }[] | { items: { id: string; slug: string }[] }>(t, 'GET', '/admin/categories');
  const list = Array.isArray(cats) ? cats : cats.items;
  const categoryId = (list.find((c) => c.slug === 'home-kitchen') ?? list[0]).id;
  const tag = run() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const sku = `E2E23-${tag}`;
  const p = await apiCall<{ id: string; variants: { id: string }[] }>(t, 'POST', '/admin/products', { title: `Extra Item ${tag}`, titleAr: `منتج ${tag}`, categoryId, variants: [{ sku, priceMinor: price, initialStock: 50 }] });
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  await fetch(`${API}/admin/products/${p.id}/images`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form });
  await apiCall(t, 'POST', `/admin/products/${p.id}/status`, { status: 'ACTIVE' });
  return { variantId: p.variants[0].id, sku, title: `Extra Item ${tag}` };
}

test('add an item to a cash order before dispatch: product found, quantity, reason — the change shows with the higher total', async ({ page }) => {
  const admin = await apiToken(ADMIN);
  const [a, extra] = [await houseVariant(admin, '3000'), await houseVariant(admin, '1500')];
  const c = await apiToken(CUSTOMER);
  await apiCall(c, 'DELETE', '/cart');
  await apiCall(c, 'POST', '/cart/items', { variantId: a.variantId, quantity: 1 });
  const addresses = await apiCall<{ id: string }[] | { items: { id: string }[] }>(c, 'GET', '/addresses');
  const addressId = (Array.isArray(addresses) ? addresses : addresses.items)[0].id;
  const o = await apiCall<{ orderNumber: string }>(c, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `e2e23-${Date.now()}` });

  await signIn(page);
  await page.goto(`/orders/${o.orderNumber}`);
  await page.getByTestId('add-item').click();
  await page.getByLabel('Find product to add').fill(extra.sku);
  await page.getByLabel('Find product to add').press('Enter');
  await page.getByTestId('addable-results').getByRole('button', { name: new RegExp(extra.title) }).click();
  await page.getByTestId('add-item-pick').getByRole('button', { name: 'One more' }).click();
  await expect(page.getByTestId('add-item-qty')).toHaveText('2');
  await page.getByLabel(/^Why\?/).fill('Customer called: two more of these');
  await page.getByTestId('save-add-item').click();
  await expect(page.getByTestId('order-changes')).toContainText('Items added');
  await expect(page.getByTestId('order-changes')).toContainText(/total \+QAR\s?30\.00/);
});

test('phone order with a promo code: the discount shows in the price check', async ({ page }) => {
  const admin = await apiToken(ADMIN);
  const v = await houseVariant(admin, '5000');
  const code = `PH${run()}`;
  const now = Date.now();
  await apiCall(admin, 'POST', '/admin/coupons', { code, countryCode: 'QA', type: 'PERCENTAGE', valueBps: 1000, startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString(), perUserLimit: 1 });
  const mobile = `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
  await signIn(page);
  await page.goto('/orders/new');
  await page.getByLabel('Find customer').fill(mobile);
  await page.getByTestId('new-customer-btn').click();
  await page.getByTestId('new-customer').getByLabel('Name').fill(`Promo ${run()}`);
  await page.getByLabel('Find product').fill(v.sku);
  await page.getByLabel('Find product').press('Enter');
  await page.getByTestId('product-results').getByRole('button', { name: /^Add / }).first().click();
  await page.getByTestId('new-address').getByLabel('Zone').fill('61');
  await page.getByTestId('new-address').getByLabel('Street').fill('840');
  await page.getByTestId('new-address').getByLabel('Building').fill('3');
  await page.getByTestId('phone-coupon').fill(code.toLowerCase());
  await page.getByTestId('phone-check').click();
  await expect(page.getByTestId('phone-discount')).toContainText('5.00');
  await expect(page.getByTestId('phone-quote')).toContainText(`Promo ${code}`);
});

test('driver page without signal: the run stays on screen, a step waits on the phone and is sent when back online', async ({ page, context }) => {
  const o = await fleetOrder('Offline Test');
  const admin = await apiToken(ADMIN);
  let jobId = '';
  for (let i = 0; i < 30 && !jobId; i++) {
    const list = await apiCall<{ id: string; sellerOrder: { order: { orderNumber: string } } }[]>(admin, 'GET', '/admin/deliveries?unassigned=true');
    jobId = list.find((d) => d.sellerOrder.order.orderNumber === o.orderNumber)?.id ?? '';
    if (!jobId) await page.waitForTimeout(200);
  }
  const couriers = await apiCall<{ id: string; fullName: string }[]>(admin, 'GET', '/admin/deliveries/couriers');
  await apiCall(admin, 'POST', `/admin/deliveries/${jobId}/assign`, { courierUserId: (couriers.find((c) => c.fullName.includes('Khalid')) ?? couriers[0]).id });

  await signIn(page, COURIER, DEMO_PASSWORD).catch(() => undefined);
  await page.goto('/driver');
  const card = page.locator('article').filter({ hasText: o.orderNumber });
  await expect(card).toBeVisible();
  // let the small service worker take over and keep the page
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(card).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('driver-offline')).toContainText('No connection');
  await expect(card).toBeVisible();
  await card.getByTestId('job-pickup').click();
  await expect(page.getByTestId('driver-pending')).toContainText('1 step waiting');
  await expect(card).toContainText('Picked up');

  await context.setOffline(false);
  await expect(page.getByTestId('driver-offline')).toHaveCount(0, { timeout: 20_000 });
  const t = await apiToken(COURIER);
  const runNow = await apiCall<{ jobs: { id: string; status: string }[] }>(t, 'GET', '/courier/jobs/run');
  expect(runNow.jobs.find((j) => j.id === jobId)?.status).toBe('PICKED_UP');
});
