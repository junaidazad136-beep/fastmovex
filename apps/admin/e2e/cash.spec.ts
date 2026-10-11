import { expect, test } from '@playwright/test';
import { ADMIN, apiCall, apiToken, fleetOrder, signIn } from './helpers';

/** Phase 18: closing a driver delivery needs the customer's code, cash is counted in, refunds need two people, returns are inspected. */
const OPS = 'ops@demo.jovia.test';
const FINANCE = 'finance@demo.jovia.test';

test.describe.serial('Cash and fraud controls', () => {
  let opsOrder = '';
  let managerOrder = '';
  let managerShipment = '';

  test('staff need the customer’s code to mark a driver delivery delivered', async ({ page }) => {
    const o = await fleetOrder('Hessa Code-Test', '25');
    opsOrder = o.orderNumber;
    await signIn(page, OPS);
    await page.goto(`/orders/${o.orderNumber}`);
    await page.getByRole('button', { name: 'Mark as shipped' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark as shipped' }).click();
    await expect(page.getByText('Shipment shipped')).toBeVisible();
    await page.getByRole('button', { name: 'Mark as delivered' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('no-code')).toHaveCount(0); // only managers may skip the code
    await expect(dialog).toContainText('Ask a manager');
    const code = await o.code();
    await dialog.getByTestId('delivery-code-input').fill(code === '0000' ? '1111' : '0000');
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click();
    await expect(page.getByText('Wrong delivery code')).toBeVisible();
    await dialog.getByTestId('delivery-code-input').fill(code);
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click();
    await expect(page.getByText('Shipment delivered')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(o.orderNumber);
  });

  test('a manager can close it without the code, with a reason that stays on the order', async ({ page }) => {
    const o = await fleetOrder('Maryam Override-Test', '70');
    managerOrder = o.orderNumber;
    managerShipment = o.shipmentId;
    await signIn(page);
    await page.goto(`/orders/${o.orderNumber}`);
    await page.getByRole('button', { name: 'Mark as shipped' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark as shipped' }).click();
    await expect(page.getByText('Shipment shipped')).toBeVisible();
    await page.getByRole('button', { name: 'Mark as delivered' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('no-code').check();
    await dialog.getByLabel('Why? (recorded and audited)').fill('Customer lost her phone, ID checked at the door');
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click();
    await expect(page.getByText('Shipment delivered')).toBeVisible();
    await expect(page.getByTestId('override-reason')).toContainText('Customer lost her phone, ID checked at the door');
  });

  test('the cashier counts the cash in: a shortage needs a note and stays on record, with a receipt', async ({ page }) => {
    await signIn(page, FINANCE);
    await page.goto('/cash');
    await expect(page.getByTestId('cash-today')).toContainText('Collected today');
    const row = page.getByTestId('cash-holder').filter({ hasText: 'Demo Admin' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Receive' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('cash-orders')).toContainText(managerOrder);
    const expected = Number((await dialog.getByTestId('cash-expected').textContent())!.replace(/[^\d.]/g, ''));
    await dialog.getByTestId('cash-counted').fill((expected - 5).toFixed(2));
    await expect(dialog.getByTestId('cash-diff')).toContainText('Short by QAR 5.00');
    await expect(dialog.getByTestId('receive-cash')).toBeDisabled(); // a note first
    await dialog.getByLabel('Note (required)').fill('Five riyals missing, driver will bring them tomorrow');
    const popup = page.waitForEvent('popup');
    await dialog.getByTestId('receive-cash').click();
    const receipt = await popup; // the receipt opens to print
    await receipt.close();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Short or over' }).click();
    await expect(page.getByTestId('handover-row').first()).toContainText(/CH-QA-\d{6}-[0-9A-F]{6}/);
    await expect(page.getByTestId('handover-row').first()).toContainText('Short QAR 5.00');
    await expect(page.getByTestId('handover-row').first()).toContainText('Five riyals missing');

    // operations can see, not receive
    const ops = await page.context().browser()!.newPage();
    await signIn(ops, OPS);
    await ops.goto('/cash');
    await expect(ops.getByTestId('cash-holder').first()).toBeVisible();
    await expect(ops.getByRole('button', { name: 'Receive' })).toHaveCount(0);
    await ops.close();
  });

  test('a refund needs a second person', async ({ page }) => {
    const t = await apiToken(ADMIN);
    await apiCall(t, 'POST', '/admin/refunds', { orderNumber: managerOrder, sellerOrderId: managerShipment, amountMinor: '500', reason: 'Dented box, goodwill' });
    await signIn(page);
    await page.goto('/refunds?status=PENDING');
    const mine = page.getByRole('row').filter({ hasText: managerOrder });
    await expect(mine).toContainText('Asked by Demo Admin');
    await expect(mine.getByTestId('own-refund')).toHaveText('Needs another approver');
    await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    const fin = await page.context().browser()!.newPage();
    await signIn(fin, FINANCE);
    await fin.goto('/refunds?status=PENDING');
    const row = fin.getByRole('row').filter({ hasText: managerOrder });
    await row.getByRole('button', { name: 'Approve' }).click();
    await fin.getByRole('dialog').getByRole('button', { name: 'Approve refund' }).click();
    await expect(fin.getByText(/Approved\. Pay it by bank transfer|Refund sent/)).toBeVisible();
    await fin.close();
  });

  test('a returned item is inspected: damaged is refunded but kept off the shelf', async ({ page }) => {
    const t = await apiToken(ADMIN);
    const o = await fleetOrder('Return Inspect-Test', '31', 'velvet-majlis-floor-cushion'); // the dates cannot be returned (food)
    await apiCall(t, 'POST', `/admin/orders/shipments/${o.shipmentId}/status`, { status: 'SHIPPED' });
    await apiCall(t, 'POST', `/admin/orders/shipments/${o.shipmentId}/status`, { status: 'DELIVERED', code: await o.code() });
    const order = await apiCall<{ sellerOrders: { items: { id: string }[] }[] }>(o.customer, 'GET', `/orders/${o.orderNumber}`);
    const ret = await apiCall<{ id: string }>(o.customer, 'POST', `/orders/${o.orderNumber}/returns`, { orderItemId: order.sellerOrders[0].items[0].id, quantity: 1, reason: 'Box arrived crushed' });
    await apiCall(t, 'POST', `/admin/returns/${ret.id}/decision`, { decision: 'APPROVED' });

    await signIn(page);
    await page.goto('/returns?status=APPROVED');
    const row = page.getByRole('row').filter({ hasText: o.orderNumber });
    await row.getByRole('button', { name: 'Item received' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('receive-confirm')).toBeDisabled();
    await dialog.getByLabel(/Damaged/).check();
    await expect(dialog.getByTestId('receive-confirm')).toBeDisabled(); // what is wrong with it?
    await dialog.getByLabel('What is wrong with it? (required)').fill('Dates squashed, box torn');
    await dialog.getByTestId('receive-confirm').click();
    await expect(page.getByText('Kept off stock; refund created for approval')).toBeVisible();
    await page.goto('/returns?status=RECEIVED');
    await expect(page.getByRole('row').filter({ hasText: o.orderNumber })).toContainText('Damaged');
  });

  test('staff switch cash on delivery off for a customer, with a reason; the COD rules are in Settings', async ({ page }) => {
    const t = await apiToken(ADMIN);
    const o = await apiCall<{ user: { id: string } }>(t, 'GET', `/admin/orders/${opsOrder}`);
    await signIn(page);
    await page.goto(`/customers/${o.user.id}`);
    await expect(page.getByTestId('cod-status')).toContainText('Allowed');
    await page.getByTestId('cod-toggle').click();
    await page.getByRole('dialog').getByLabel('Reason (kept in the audit log)').fill('Three fake orders last week');
    await page.getByRole('dialog').getByRole('button', { name: 'Block COD' }).click();
    await expect(page.getByTestId('cod-status')).toContainText('Blocked — card payments only');
    await expect(page.getByTestId('cod-status')).toContainText('Three fake orders last week');
    await page.getByTestId('cod-toggle').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Allow COD' }).click();
    await expect(page.getByTestId('cod-status')).toContainText('Allowed');

    await page.goto('/settings');
    const card = page.getByTestId('cod-rules');
    await expect(card.getByLabel('Confirm mobile by SMS code')).toHaveValue('GUESTS');
    await expect(card.getByLabel('Refusals before COD is switched off')).toHaveValue('2');
    await card.getByLabel('Largest cash order').fill('abc');
    await card.getByRole('button', { name: 'Save COD rules' }).click();
    await expect(page.getByText('Enter amounts like 1500 or 1500.50')).toBeVisible();
    await card.getByLabel('Largest cash order').fill('');
    await card.getByRole('button', { name: 'Save COD rules' }).click();
    await expect(page.getByText('Cash-on-delivery rules saved')).toBeVisible();
  });
});
