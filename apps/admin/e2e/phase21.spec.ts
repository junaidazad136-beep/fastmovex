import { expect, test } from '@playwright/test';
import { ADMIN, apiCall, apiToken, fleetOrder, placeOrder, run, signIn } from './helpers';

/** Phase 21: drivers' live map and performance, profit & margin, customer tags and notes, staff alerts. */
const COURIER = 'courier@demo.fastmovex.test';
const OPS = 'ops@demo.fastmovex.test';

test('live map: the driver on the map with their jobs; the drivers tab lists performance', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const o = await fleetOrder('Mariam Map-Test', '66', 'premium-khalas-dates-1kg', { lat: 25.31, lng: 51.52 });
  const couriers = await apiCall<{ id: string; fullName: string }[]>(t, 'GET', '/admin/deliveries/couriers');
  const courier = couriers.find((c) => c.fullName.includes('Khalid')) ?? couriers[0];
  const jobs = await apiCall<{ id: string; sellerOrder: { order: { orderNumber: string } } }[]>(t, 'GET', '/admin/deliveries?unassigned=true');
  const job = jobs.find((j) => j.sellerOrder.order.orderNumber === o.orderNumber)!;
  await apiCall(t, 'POST', `/admin/deliveries/${job.id}/assign`, { courierUserId: courier.id });
  const c = await apiToken(COURIER);
  await apiCall(c, 'POST', `/courier/jobs/${job.id}/pickup`);
  await apiCall(c, 'POST', `/courier/jobs/${job.id}/location`, { lat: 25.29, lng: 51.53 });

  await signIn(page);
  await page.goto('/deliveries?view=map');
  const map = page.getByTestId('live-map');
  await expect(map).toBeVisible();
  const driver = page.getByTestId('live-driver').filter({ hasText: courier.fullName });
  await expect(driver).toContainText('Live');
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();
  await driver.getByRole('button').first().click();
  await expect(page.getByTestId('live-driver-jobs')).toContainText(o.orderNumber);

  await page.getByRole('tab', { name: 'Drivers' }).click();
  await expect(page.getByTestId('perf-row').filter({ hasText: courier.fullName })).toBeVisible();
});

test('profit & margin: totals, groups and CSV for finance roles; hidden from operations', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Profit & margin' }).click();
  await expect(page.getByRole('heading', { name: 'Profit & margin' })).toBeVisible();
  await expect(page.getByTestId('margin-totals')).toContainText('Gross profit');
  await page.getByRole('tab', { name: 'By category' }).click();
  await expect(page).toHaveURL(/group=category/);
  await expect(page.getByTestId('margin-row').first()).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByTestId('margin-csv').click();
  expect((await dl).suggestedFilename()).toMatch(/^fastmovex-margin-category-.*\.csv$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, OPS);
  await expect(page.getByRole('link', { name: 'Profit & margin' })).toHaveCount(0);
});

test('customer tags and notes: tag VIP, pin a note, see both on the order, filter the list by tag', async ({ page }) => {
  const name = `Tagged Customer ${run()}`;
  const o = await fleetOrder(name, '61');
  const t = await apiToken(ADMIN);
  const user = (await apiCall<{ items: { id: string }[] }>(t, 'GET', `/admin/users?q=${encodeURIComponent(name)}`)).items[0];

  await signIn(page);
  await page.goto(`/customers/${user.id}`);
  await page.getByTestId('edit-tags').click();
  await page.getByTestId('tags-editor').getByRole('button', { name: 'VIP' }).click();
  await page.getByLabel('New tag').fill('night owl');
  await page.getByTestId('tags-editor').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('save-tags').click();
  await expect(page.getByTestId('customer-tags').first()).toContainText('VIP');
  await expect(page.getByTestId('customer-tags').first()).toContainText('NIGHT OWL');

  await page.getByLabel('New note').fill('Gate code 4411. Call on arrival.');
  await page.getByText('Pin (shows on their orders)').click();
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('note').first()).toContainText('Gate code 4411');

  await page.goto(`/orders/${o.orderNumber}`);
  await expect(page.getByTestId('pinned-note')).toContainText('Gate code 4411');
  await expect(page.getByTestId('customer-tags').first()).toContainText('VIP');
  await page.getByLabel('New order note').fill('Customer asked for the morning.');
  await page.getByTestId('order-note-form').getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('order-notes')).toContainText('Customer asked for the morning.');

  await page.goto('/customers?tag=NIGHT_OWL');
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('alerts: a new order rings the bell, opens the order; each alert can be set to bell + email', async ({ page }) => {
  const t = await apiToken(ADMIN);
  await apiCall(t, 'PATCH', '/me/alert-prefs', { prefs: { STAFF_NEW_ORDER: 'app' } });
  const inv = await apiCall<{ items: { variantId: string; available: number; status: string }[] }>(t, 'GET', '/admin/inventory?house=true&limit=100');
  const v = inv.items.find((i) => i.status === 'ACTIVE' && i.available > 2)!;
  const orderNumber = await placeOrder(v.variantId);

  await signIn(page);
  await expect(page.getByTestId('alerts-unread')).toBeVisible();
  await page.getByTestId('alerts-bell').click();
  const item = page.getByTestId('alerts-menu').getByRole('button', { name: new RegExp(`New order ${orderNumber}`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderNumber}$`));

  await page.goto('/alerts');
  await expect(page.getByTestId('alerts-list')).toContainText(`New order ${orderNumber}`);
  await page.getByTestId('pref-STAFF_NEW_ORDER-email').click();
  await expect(page.getByTestId('pref-STAFF_NEW_ORDER-email')).toHaveAttribute('aria-checked', 'true');
  await apiCall(t, 'PATCH', '/me/alert-prefs', { prefs: { STAFF_NEW_ORDER: 'app' } });
});
