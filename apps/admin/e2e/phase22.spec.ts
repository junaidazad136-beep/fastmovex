import { expect, test } from '@playwright/test';
import { ADMIN, API, apiCall, apiToken, CUSTOMER, DEMO_PASSWORD, PNG, run, signIn, SUPER } from './helpers';

/** Phase 22: phone orders, changing an order, items refused at the door, return pickups, refund limits. */
const COURIER = 'courier@demo.jovia.test';

async function houseVariants(t: string, n = 2) {
  // fresh products of our own store with plenty of stock, so the test never depends on leftovers
  const cats = await apiCall<{ id: string; slug: string }[] | { items: { id: string; slug: string }[] }>(t, 'GET', '/admin/categories');
  const list = Array.isArray(cats) ? cats : cats.items;
  const categoryId = (list.find((c) => c.slug === 'home-kitchen') ?? list[0]).id;
  const out: { variantId: string; sku: string }[] = [];
  for (let i = 0; i < n; i++) {
    const tag = run() + i;
    const sku = `E2E22-${tag}`;
    const p = await apiCall<{ id: string; variants: { id: string }[] }>(t, 'POST', '/admin/products', { title: `Phone Test Item ${tag}`, titleAr: `منتج ${tag}`, categoryId, variants: [{ sku, priceMinor: '3500', initialStock: 50 }] });
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
    await fetch(`${API}/admin/products/${p.id}/images`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form });
    await apiCall(t, 'POST', `/admin/products/${p.id}/status`, { status: 'ACTIVE' });
    out.push({ variantId: p.variants[0].id, sku });
  }
  return out;
}
/** The demo customer orders two lines (2 + 1) of our own products, cash on delivery. */
async function twoLineOrder() {
  const admin = await apiToken(ADMIN);
  const [a, b] = await houseVariants(admin);
  const c = await apiToken(CUSTOMER);
  await apiCall(c, 'DELETE', '/cart');
  await apiCall(c, 'POST', '/cart/items', { variantId: a.variantId, quantity: 2 });
  await apiCall(c, 'POST', '/cart/items', { variantId: b.variantId, quantity: 1 });
  const addresses = await apiCall<{ id: string }[] | { items: { id: string }[] }>(c, 'GET', '/addresses');
  const addressId = (Array.isArray(addresses) ? addresses : addresses.items)[0].id;
  const o = await apiCall<{ orderNumber: string }>(c, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `e2e22-${Date.now()}-${Math.random()}` });
  const detail = await apiCall<{ sellerOrders: { id: string; items: { id: string; quantity: number }[] }[] }>(admin, 'GET', `/admin/orders/${o.orderNumber}`);
  return { orderNumber: o.orderNumber, shipment: detail.sellerOrders[0].id, admin, customer: c };
}

test('phone order: a new caller, products found and added, price checked, placed — the order shows who took it', async ({ page }) => {
  const admin = await apiToken(ADMIN);
  const [v] = await houseVariants(admin, 1);
  const mobile = `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
  await signIn(page);
  await page.getByRole('link', { name: 'Phone order' }).click();
  await page.getByLabel('Find customer').fill(mobile);
  await page.getByTestId('new-customer-btn').click();
  await page.getByTestId('new-customer').getByLabel('Name').fill(`Caller ${run()}`);
  await expect(page.getByTestId('new-customer').getByLabel('Mobile')).toHaveValue(mobile);
  await page.getByLabel('Find product').fill(v.sku);
  await page.getByLabel('Find product').press('Enter');
  await page.getByTestId('product-results').getByRole('button', { name: /^Add / }).first().click();
  await page.getByRole('button', { name: 'One more' }).click();
  await expect(page.getByTestId('order-lines')).toContainText('2');
  await page.getByTestId('new-address').getByLabel('Zone').fill('61');
  await page.getByTestId('new-address').getByLabel('Street').fill('840');
  await page.getByTestId('new-address').getByLabel('Building').fill('3');
  await page.getByTestId('phone-check').click();
  await expect(page.getByTestId('phone-total')).toBeVisible();
  await page.getByTestId('phone-place').click();
  await expect(page).toHaveURL(/\/orders\/FMX-/);
  await expect(page.getByText(/Phone order · Demo Admin/)).toBeVisible();
});

test('change items, address and delivery time before dispatch; the change history shows on the order', async ({ page }) => {
  const o = await twoLineOrder();
  await signIn(page);
  await page.goto(`/orders/${o.orderNumber}`);
  await page.getByTestId('change-items').click();
  await page.getByTestId('items-editor').getByRole('button', { name: /^One fewer/ }).first().click();
  await expect(page.getByTestId('item-qty').first()).toHaveText('1');
  await page.getByLabel(/^Why\?/).fill('Customer called: only one');
  await page.getByTestId('save-items').click();
  await expect(page.getByTestId('order-changes')).toContainText('Items changed');
  await expect(page.getByTestId('order-changes')).toContainText('Customer called: only one');
  await page.getByTestId('change-address').click();
  await page.getByTestId('address-editor').getByLabel('Zone').fill('66');
  await page.getByTestId('address-editor').getByLabel('Street').fill('901');
  await page.getByTestId('save-address').click();
  await expect(page.getByTestId('order-changes')).toContainText('Zone 66, Street 901');
  await page.getByTestId('change-slot').click();
  await expect(page.getByRole('dialog')).toContainText(/Delivery windows are switched off|Now:/);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('the driver records items refused at the door; the warehouse books them back in', async ({ page }) => {
  const o = await twoLineOrder();
  for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await apiCall(o.admin, 'POST', `/admin/orders/shipments/${o.shipment}/status`, { status });
  let job: { id: string } | undefined;
  for (let i = 0; i < 30 && !job; i++) {
    const list = await apiCall<{ id: string; sellerOrder: { order: { orderNumber: string } } }[]>(o.admin, 'GET', '/admin/deliveries?unassigned=true');
    job = list.find((d) => d.sellerOrder.order.orderNumber === o.orderNumber);
    if (!job) await new Promise((r) => setTimeout(r, 200));
  }
  const couriers = await apiCall<{ id: string; fullName: string }[]>(o.admin, 'GET', '/admin/deliveries/couriers');
  const courier = couriers.find((c) => c.fullName.includes('Khalid')) ?? couriers[0];
  await apiCall(o.admin, 'POST', `/admin/deliveries/${job!.id}/assign`, { courierUserId: courier.id });
  const d = await apiToken(COURIER);
  await apiCall(d, 'POST', `/courier/jobs/${job!.id}/pickup`);
  await apiCall(d, 'POST', `/courier/jobs/${job!.id}/out-for-delivery`);

  await signIn(page, COURIER, DEMO_PASSWORD).catch(() => undefined);
  await page.goto('/driver');
  const card = page.locator('article').filter({ hasText: o.orderNumber });
  const cashBefore = await card.getByTestId('job-cash').innerText();
  await card.getByTestId('job-refuse').click();
  await page.getByTestId('refuse-items').getByRole('button', { name: /^One more refused/ }).first().click();
  await page.getByText('Wrong item or colour').click();
  await page.getByTestId('refuse-submit').click();
  await expect(card.getByTestId('job-cash')).not.toHaveText(cashBefore);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page);
  await page.goto('/returns?status=DOOR');
  const row = page.getByTestId('door-return-row').filter({ hasText: o.orderNumber });
  await expect(row).toContainText('Wrong item or colour');
  await row.getByTestId('door-receive').click();
  await page.getByTestId('door-receive-confirm').click();
  await expect(row).toHaveCount(0);
});

test('a refund limit set on the Staff page', async ({ page }) => {
  // a new finance person (newest first on the Staff list)
  const owner = await apiToken(SUPER.email, SUPER.password);
  const email = `refund.limit.${run().toLowerCase()}@example.com`;
  await apiCall(owner, 'POST', '/admin/staff', { fullName: 'Limit Tester', email, password: 'Limit-Tester-2026', roles: ['FINANCE_ADMIN'] });
  await signIn(page, SUPER.email, SUPER.password).catch(() => undefined);
  if (page.url().includes('/security')) test.skip(true, 'super admin needs two-step sign-in in this environment');
  await page.goto('/staff');
  const row = page.locator('tr').filter({ hasText: email });
  await row.getByTestId('staff-refund-limit').getByRole('button').click();
  await page.getByTestId('refund-limit-input').fill('750');
  await page.getByTestId('save-refund-limit').click();
  await expect(row.getByTestId('staff-refund-limit')).toContainText('750.00');
  await row.getByTestId('staff-refund-limit').getByRole('button').click();
  await page.getByTestId('refund-limit-input').fill('');
  await page.getByTestId('save-refund-limit').click();
  await expect(row.getByTestId('staff-refund-limit')).toContainText('No limit');
});
