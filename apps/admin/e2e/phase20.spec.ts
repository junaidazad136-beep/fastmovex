import { expect, test } from '@playwright/test';
import { ADMIN, apiCall, apiToken, fleetOrder, placeOrder, signIn } from './helpers';

/** Phase 20: invoice PDF, packing slips and picking list, credit notes, return receipts, a customer's data on request. */
const FINANCE = 'finance@demo.jovia.test';
const FINANCE2 = 'finance2@demo.jovia.test';

test('picking & packing: the waiting shipments, what to pick in shelf order, packing slips and picking list print', async ({ page }) => {
  // a FastMoveX-store product (the warehouse is FastMoveX's), bought by the demo customer
  const t = await apiToken(ADMIN);
  const inv = await apiCall<{ items: { variantId: string; available: number; status: string }[] }>(t, 'GET', '/admin/inventory?house=true&limit=100');
  const v = inv.items.find((i) => i.status === 'ACTIVE' && i.available > 2)!;
  const o = { orderNumber: await placeOrder(v.variantId) };
  await signIn(page);
  await page.goto('/fulfilment');
  const row = page.getByTestId('pack-shipment').filter({ hasText: o.orderNumber });
  await expect(row).toBeVisible();
  await expect(page.getByTestId('pick-line').first()).toBeVisible();
  await row.getByRole('checkbox').check();
  await expect(page.getByTestId('print-slips')).toContainText('(1)');
  let popup = page.waitForEvent('popup');
  await page.getByTestId('print-slips').click();
  await (await popup).close();
  popup = page.waitForEvent('popup');
  await page.getByTestId('print-pick-list').click();
  await (await popup).close();

  // and from the order page
  await page.goto(`/orders/${o.orderNumber}`);
  popup = page.waitForEvent('popup');
  await page.getByTestId('packing-slip').first().click();
  await (await popup).close();
  popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Invoice' }).click();
  await (await popup).close();
});

test('a paid refund has a credit note on the order and in Refunds; a checked return has a receipt', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const o = await fleetOrder('Latifa Credit-Test', '31', 'velvet-majlis-floor-cushion');
  await apiCall(t, 'POST', `/admin/orders/shipments/${o.shipmentId}/status`, { status: 'SHIPPED' });
  await apiCall(t, 'POST', `/admin/orders/shipments/${o.shipmentId}/status`, { status: 'DELIVERED', code: await o.code() });
  // goodwill refund asked by finance, paid by the second finance person → credit note
  const f1 = await apiToken(FINANCE);
  await apiCall(f1, 'POST', '/admin/refunds', { orderNumber: o.orderNumber, sellerOrderId: o.shipmentId, amountMinor: '700', reason: 'Goodwill: late delivery' });
  const pending = await apiCall<{ items: { id: string; order: { orderNumber: string } }[] }>(f1, 'GET', '/admin/refunds?status=PENDING');
  const refund = pending.items.find((r) => r.order.orderNumber === o.orderNumber)!;
  const f2 = await apiToken(FINANCE2);
  await apiCall(f2, 'POST', `/admin/refunds/${refund.id}/approve`);
  const paid = await apiCall<{ items: { id: string; status: string; creditNoteNo: string | null }[] }>(f1, 'GET', '/admin/refunds?status=SUCCEEDED');
  const cn = paid.items.find((r) => r.id === refund.id);
  // cash-on-delivery refunds are paid by bank transfer: finance marks them paid
  if (!cn) await apiCall(f2, 'POST', `/admin/refunds/${refund.id}/mark-paid`, { reference: 'TRF-77821' });

  await signIn(page, FINANCE);
  await page.goto(`/orders/${o.orderNumber}`);
  const btn = page.getByTestId('credit-note').first();
  await expect(btn).toContainText(/CN-QA-\d{6}-\d{6}/);
  let popup = page.waitForEvent('popup');
  await btn.click();
  await (await popup).close();
  await page.goto('/refunds?status=SUCCEEDED');
  await expect(page.getByRole('row').filter({ hasText: o.orderNumber }).getByTestId('credit-note')).toBeVisible();

  // return → checked → receipt
  const order = await apiCall<{ sellerOrders: { items: { id: string }[] }[] }>(o.customer, 'GET', `/orders/${o.orderNumber}`);
  const ret = await apiCall<{ id: string }>(o.customer, 'POST', `/orders/${o.orderNumber}/returns`, { orderItemId: order.sellerOrders[0].items[0].id, quantity: 1, reason: 'Colour not as shown' });
  await apiCall(t, 'POST', `/admin/returns/${ret.id}/decision`, { decision: 'APPROVED' });
  await apiCall(t, 'POST', `/admin/returns/${ret.id}/received`, { condition: 'SELLABLE' });
  const admin = await page.context().browser()!.newPage();
  await signIn(admin);
  await admin.goto('/returns?status=RECEIVED');
  popup = admin.waitForEvent('popup');
  await admin.getByRole('row').filter({ hasText: o.orderNumber }).getByTestId('return-receipt').click();
  await (await popup).close();
});

test('support downloads a customer’s data for a data request', async ({ page }) => {
  const o = await fleetOrder('Data Request-Test', '25');
  const t = await apiToken(ADMIN);
  const detail = await apiCall<{ user: { id: string } }>(t, 'GET', `/admin/orders/${o.orderNumber}`);
  await signIn(page);
  await page.goto(`/customers/${detail.user.id}`);
  const download = page.waitForEvent('download');
  await page.getByTestId('data-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^fastmovex-user-data-[0-9a-f]{8}\.json$/);
});
