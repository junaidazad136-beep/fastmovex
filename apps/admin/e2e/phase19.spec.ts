import { devices, expect, test } from '@playwright/test';
import { ADMIN, apiCall, apiToken, DEMO_PASSWORD, fleetOrder, freshTotp, run, signIn, SUPER } from './helpers';

/** Phase 19: staff two-step sign-in, failed-delivery proof, stock control (suppliers, POs, stocktake, expiry), payment checks. */
const OPS = 'ops@demo.fastmovex.test';

/** A FastMoveX-store product (the warehouses belong to the FastMoveX store). */
async function houseVariant(token: string): Promise<{ id: string; sku: string }> {
  const r = await apiCall<{ items: { variantId: string; sku: string }[] }>(token, 'GET', '/admin/inventory?house=true&q=FMX-PFC-120&limit=1');
  return { id: r.items[0].variantId, sku: r.items[0].sku };
}

/** Puts units on the shelf of a warehouse (the default one unless given), so counts and write-offs have something to work on. */
async function stockUp(token: string, variantId: string, n: number, warehouseId?: string) {
  await apiCall(token, 'POST', `/admin/variants/${variantId}/stock`, { delta: n, reason: 'RESTOCK', note: 'e2e', warehouseId });
}
const FINANCE = 'finance@demo.fastmovex.test';

test.describe.serial('Staff two-step sign-in', () => {
  const email = `staff2fa.${Date.now().toString(36)}@example.com`;
  const password = 'Staff-Pass-2026x';
  let secret = '';
  const used = new Set<number>();

  test('a staff member turns it on: QR / key, first code, recovery codes shown once', async ({ page }) => {
    const t = await apiToken(SUPER.email, SUPER.password);
    await apiCall(t, 'POST', '/admin/staff', { fullName: 'Two Step Tester', email, password, roles: ['ORDER_MANAGER'] });
    await signIn(page, email, password);
    await page.getByTestId('my-security').click();
    await expect(page.getByTestId('2fa-status')).toContainText('Off');
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    await dialog.getByText('Can’t scan? Enter this key instead').click();
    secret = (await dialog.getByTestId('2fa-secret').textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await dialog.getByLabel('Code from the app').fill('000000');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    await expect(dialog.getByRole('alert')).toContainText('not right');
    await dialog.getByLabel('Code from the app').fill(await freshTotp(secret, used));
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    const codes = page.getByTestId('recovery-codes');
    await expect(codes.getByRole('listitem')).toHaveCount(10);
    await expect(page.getByTestId('codes-done')).toBeDisabled(); // save them first
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    expect((await download).suggestedFilename()).toBe('fastmovex-recovery-codes.txt');
    await page.getByTestId('codes-done').click();
    await expect(page.getByTestId('2fa-status')).toContainText('On');
    await expect(page.getByTestId('2fa-status')).toContainText('10 recovery codes left');
    await expect(page.getByTestId('session-row').filter({ hasText: 'This device' })).toContainText('2-step');
  });

  test('signing in now asks for the code; a wrong code is refused and recorded', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or phone').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const step = page.getByTestId('two-step');
    await expect(step).toBeVisible();
    await step.getByLabel('Code').fill('111111');
    await step.getByRole('button', { name: 'Verify' }).click();
    await expect(step.getByRole('alert')).toContainText('That code is not right');
    await step.getByLabel('Code').fill(await freshTotp(secret, used));
    await step.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.goto('/security');
    await expect(page.getByTestId('login-row').first()).toContainText('Signed in');
    await expect(page.getByTestId('login-row').filter({ hasText: 'Wrong code' })).toHaveCount(1);
  });

  test('an admin sees who has it on and can reset it for someone who lost their phone', async ({ page }) => {
    await signIn(page, SUPER.email, SUPER.password);
    await page.goto('/staff');
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row.getByTestId('staff-2fa')).toContainText('On');
    await row.getByRole('button', { name: 'Sign-ins' }).click();
    await expect(page.getByRole('dialog').getByTestId('login-row').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: 'Reset two-step' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reset two-step sign-in' }).click();
    await expect(page.getByText('Two-step sign-in reset')).toBeVisible();
    await expect(row.getByTestId('staff-2fa')).toContainText('Off');
    // their next sign-in is password only again
    const login = await fetch(`${process.env.API_URL || 'http://localhost:4000/api/v1'}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: email, password }) });
    expect(((await login.json()) as { accessToken?: string }).accessToken).toBeTruthy();
  });
});

test('a failed delivery carries the driver’s location and photo; far from the pin is flagged; the customer’s answer shows', async ({ browser }) => {
  // the customer's pin is in West Bay; the driver says "not at home" from 2 km away
  const o = await fleetOrder('Fatima Proof-Test', '61', 'premium-khalas-dates-1kg', { lat: 25.3220, lng: 51.5310 });
  const t = await apiToken(ADMIN);
  const order = await apiCall<{ sellerOrders: { delivery: { id: string } | null }[] }>(t, 'GET', `/admin/orders/${o.orderNumber}`);
  const deliveryId = order.sellerOrders[0].delivery!.id;
  const couriers = await apiCall<{ id: string; fullName: string }[]>(t, 'GET', '/admin/deliveries/couriers');
  await apiCall(t, 'POST', `/admin/deliveries/${deliveryId}/assign`, { courierUserId: couriers.find((c) => c.fullName === 'Khalid Courier')!.id });
  const driverApi = await apiToken('courier@demo.fastmovex.test');
  await apiCall(driverApi, 'POST', `/courier/jobs/${deliveryId}/pickup`);
  await apiCall(driverApi, 'POST', `/courier/jobs/${deliveryId}/out-for-delivery`);

  const phone = await browser.newContext({ ...devices['Pixel 7'], geolocation: { latitude: 25.3040, longitude: 51.5310 }, permissions: ['geolocation'] });
  const page = await phone.newPage();
  await signIn(page, 'courier@demo.fastmovex.test', DEMO_PASSWORD).catch(() => undefined);
  const job = page.getByTestId('driver-job').filter({ hasText: o.orderNumber });
  await job.getByTestId('job-fail').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('fail-location')).toContainText('Your location is saved');
  await dialog.getByLabel('Customer not at home').check();
  await dialog.getByTestId('fail-photo').setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') });
  await dialog.getByTestId('fail-submit').click();
  await expect(page.getByText('The customer was told and can pick a new time')).toBeVisible();
  await phone.close();

  // the customer answers from their order page (API here; the website has its own test)
  await apiCall(o.customer, 'POST', `/orders/${o.orderNumber}/reschedule`, { note: 'Tomorrow after 5 pm please' });

  const staff = await browser.newPage();
  await signIn(staff, OPS);
  await staff.goto('/deliveries?view=problems');
  const row = staff.getByTestId('delivery-row').filter({ hasText: o.orderNumber });
  await expect(row.getByTestId('failure-proof')).toContainText(/\d\.\d km from address — check/);
  await expect(row.getByTestId('customer-request')).toContainText('Tomorrow after 5 pm please');
  const popup = staff.waitForEvent('popup');
  await row.getByRole('button', { name: 'Door photo' }).click();
  await (await popup).close();
});

test.describe.serial('Buying stock', () => {
  const supplier = `Gulf Dates Trading ${run()}`;
  let poUrl = '';

  test('purchasing adds a supplier and raises a purchase order; the PDF opens', async ({ page }) => {
    await signIn(page);
    await page.goto('/suppliers');
    await page.getByRole('button', { name: 'Add supplier' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Company name').fill(supplier);
    await d.getByLabel('Phone').fill('+974 4444 1234');
    await d.getByLabel('Payment terms').fill('30 days');
    await d.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('supplier-row').filter({ hasText: supplier })).toContainText('30 days');

    await page.goto('/purchase-orders');
    await page.getByRole('button', { name: 'New purchase order' }).click();
    const po = page.getByRole('dialog');
    await po.getByLabel('Supplier', { exact: true }).selectOption({ label: supplier });
    await po.getByPlaceholder('Search product, SKU or barcode').fill('Khalas');
    await po.getByRole('button', { name: /Premium Khalas Dates/ }).first().click();
    await po.getByLabel(/^Quantity /).fill('12');
    await po.getByLabel(/^Unit cost /).fill('35.50');
    await expect(po.getByTestId('po-total')).toContainText('426.00');
    await po.getByTestId('po-create').click();
    await expect(page).toHaveURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
    poUrl = page.url();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'PDF' }).click();
    await (await popup).close();
    await page.getByTestId('po-order').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.locator('span', { hasText: /^Ordered$/ }).first()).toBeVisible(); // the status badge (the table also has an "Ordered" column)
    await expect(page.getByTestId('own-po')).toBeVisible(); // the person who raised it cannot receive it
  });

  test('someone else receives it in two deliveries, with batch and expiry; dated stock shows on the expiry page', async ({ page }) => {
    await signIn(page, OPS);
    await page.goto(poUrl);
    await page.getByTestId('po-receive').click();
    const d = page.getByRole('dialog');
    await d.getByLabel(/^Arrived /).fill('20');
    await expect(d.getByRole('alert')).toContainText('only 12 expected');
    await d.getByLabel(/^Arrived /).fill('5');
    await d.getByLabel(/^Batch /).fill('KH-2611');
    await d.getByLabel(/^Expiry /).fill('2027-02-28');
    await d.getByLabel('Supplier delivery note / invoice no.').fill('DN-5531');
    await d.getByTestId('grn-submit').click();
    await expect(page.getByText(/GRN-QA-\d{6}-[0-9A-F]{4}: 5 units added/)).toBeVisible();
    await expect(page.getByText('Part received', { exact: true })).toBeVisible();
    await expect(page.getByTestId('po-detail-line')).toContainText('Batch KH-2611 · expires');

    await page.getByTestId('po-receive').click();
    await page.getByRole('dialog').getByLabel(/^Expiry /).fill('2027-03-31');
    await page.getByRole('dialog').getByTestId('grn-submit').click();
    await expect(page.locator('span', { hasText: /^Received$/ })).toBeVisible(); // the status badge (the table also has a "Received" column)
    await expect(page.getByTestId('grn')).toHaveCount(2);

    await page.goto('/expiry?days=365');
    await expect(page.getByTestId('lot-row').filter({ hasText: 'KH-2611' }).first()).toBeVisible();
  });
});

test('a blind stocktake: counters do not see expected numbers; another person approves and the loss is reported', async ({ browser }) => {
  // the counter: an inventory manager (counts, cannot approve)
  const t = await apiToken(ADMIN);
  const email = `counter.${Date.now().toString(36)}@example.com`;
  await apiCall(await apiToken(SUPER.email, SUPER.password), 'POST', '/admin/staff', { fullName: 'Shelf Counter', email, password: 'Count-Pass-2026x', roles: ['INVENTORY_MANAGER'] });
  const v = await houseVariant(t);
  const whs = await apiCall<{ items: { id: string; isDefault: boolean }[] }>(t, 'GET', '/admin/warehouses');
  const wh = whs.items.find((w) => w.isDefault) ?? whs.items[0];
  await stockUp(t, v.id, 2, wh.id);
  const open = await apiCall<{ id: string; status: string; warehouse: { name: string } }[]>(t, 'GET', '/admin/stock-counts');
  for (const c of open.filter((x) => x.status === 'OPEN' || x.status === 'SUBMITTED')) await apiCall(t, 'POST', `/admin/stock-counts/${c.id}/cancel`);
  const counter = await apiToken(email, 'Count-Pass-2026x');
  const count = await apiCall<{ id: string; number: string }>(counter, 'POST', '/admin/stock-counts', { warehouseId: wh.id, variantIds: [v.id], note: 'Cushion shelf' });

  const page = await browser.newPage();
  await signIn(page, email, 'Count-Pass-2026x');
  await page.goto('/stock-counts');
  await page.getByRole('link', { name: count.number }).click();
  await expect(page.getByText('Expected numbers hidden')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Expected' })).toHaveCount(0);
  await page.getByTestId('scan').fill(v.sku);
  await page.getByTestId('scan').press('Enter');
  const qty = page.getByLabel(`Counted ${v.sku}`);
  await expect(qty).toBeFocused();
  const shelf = (await apiCall<{ id: string; onHand: number }[]>(t, 'GET', `/admin/variants/${v.id}/warehouses`)).find((x) => x.id === wh.id)!.onHand;
  await qty.fill(String(Math.max(0, shelf - 1))); // one cushion missing
  await page.getByTestId('save-counts').click();
  await expect(page.getByText('1 count saved')).toBeVisible();
  await page.getByTestId('submit-count').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expect(page.getByTestId('approve-count')).toHaveCount(0); // no approval rights
  await page.close();

  const mgr = await browser.newPage();
  await signIn(mgr, OPS);
  await mgr.goto(`/stock-counts/${count.id}`);
  await expect(mgr.getByTestId('count-line')).toContainText('-1');
  await mgr.getByTestId('approve-count').click();
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve and post' }).click();
  await expect(mgr.getByText(/Approved: 1 units removed/)).toBeVisible();
  await mgr.goto('/shrinkage');
  await expect(mgr.getByTestId('loss-row').filter({ hasText: v.sku }).filter({ hasText: 'Stocktake difference' })).toBeVisible();
});

test('a damaged write-off is recorded with its reason', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const v = await houseVariant(t);
  await stockUp(t, v.id, 3);
  await signIn(page);
  await page.goto(`/inventory?q=${encodeURIComponent(v.sku)}`);
  await page.getByRole('button', { name: `Stock history of ${v.sku}` }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Remove (damaged, lost)' }).click();
  await d.getByLabel('Reason').selectOption('DAMAGED');
  await d.getByLabel('Quantity', { exact: true }).fill('1');
  await d.getByLabel('Note', { exact: true }).fill('Torn in the store room');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Stock updated')).toBeVisible();
  const history = await apiCall<{ reason: string; note: string | null }[]>(t, 'GET', `/admin/variants/${v.id}/stock`);
  expect(history[0]).toMatchObject({ reason: 'DAMAGED', note: 'Torn in the store room' });
});

test.describe('Payments', () => {
  test('finance sees payment problems, the daily closing with its PDF, and matches a settlement file', async ({ page }) => {
    await signIn(page, FINANCE);
    await page.goto('/payments');
    await expect(page.getByTestId('exception-kinds')).toContainText('Card payment stuck');
    await page.getByRole('tab', { name: 'Daily closing' }).click();
    await expect(page.getByTestId('closing')).toContainText('Net money in');
    const popup = page.waitForEvent('popup');
    await page.getByTestId('closing-pdf').click();
    await (await popup).close();

    await page.getByRole('tab', { name: 'Gateway settlement' }).click();
    await page.getByTestId('settlement-file').setInputFiles({ name: 'dibsy-settlement.csv', mimeType: 'text/csv', buffer: Buffer.from('reference,amount,date\nnot-a-fmx-ref,99.00,2026-10-04\nbad-row,abc,2026-10-04\n') });
    await expect(page.getByText(/0 of 1 rows match/)).toBeVisible();
    const result = page.getByTestId('settlement-result');
    await expect(result).toContainText('Not in FastMoveX');
    await expect(result).toContainText('Could not read this row');
    await expect(page.getByTestId('settlement-row').first()).toContainText('dibsy-settlement.csv');
  });

  test('operations cannot upload settlements', async ({ page }) => {
    await signIn(page, OPS);
    await page.goto('/payments?tab=settlement');
    await expect(page.getByTestId('settlement-file')).toHaveCount(0);
  });
});
