import { expect, test } from '@playwright/test';
import { apiCall, apiToken, freshCustomer, signIn } from './helpers';

/** Phase 20 on the website: invoice and credit note downloads on the order page; download my data; delete my account (and keep it). */

async function placeCod(token: string): Promise<{ orderNumber: string; shipmentId: string }> {
  const product = await apiCall<{ variants: { id: string }[] }>(null, 'GET', '/products/premium-khalas-dates-1kg');
  const addresses = await apiCall<{ id: string }[] | { items: { id: string }[] }>(token, 'GET', '/addresses');
  const addressId = (Array.isArray(addresses) ? addresses : addresses.items)[0].id;
  await apiCall(token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
  const { orderNumber } = await apiCall<{ orderNumber: string }>(token, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `docs-${Date.now()}-${Math.random()}` });
  const admin = await apiToken('admin@demo.jovia.test');
  const shipmentId = (await apiCall<{ sellerOrders: { id: string }[] }>(admin, 'GET', `/admin/orders/${orderNumber}`)).sellerOrders[0].id;
  return { orderNumber, shipmentId };
}

test('the order page offers the invoice, and a credit note once a refund is paid', async ({ page }) => {
  const c = await freshCustomer();
  const o = await placeCod(c.token);
  await signIn(page, c.email, c.password);
  await page.goto(`/en/account/orders/${o.orderNumber}`);
  const docs = page.getByTestId('order-documents');
  await expect(docs).toContainText('Invoice');
  let download = page.waitForEvent('download');
  await docs.getByTestId('download-invoice').click();
  expect((await download).suggestedFilename()).toBe(`FastMoveX-invoice-${o.orderNumber}.pdf`);

  // goodwill refund: asked by one finance person, paid by bank transfer by the other
  const f1 = await apiToken('finance@demo.jovia.test');
  const f2 = await apiToken('finance2@demo.jovia.test');
  const admin = await apiToken('admin@demo.jovia.test');
  for (const status of ['PREPARING', 'READY_FOR_PICKUP', 'SHIPPED']) await apiCall(admin, 'POST', `/admin/orders/shipments/${o.shipmentId}/status`, { status });
  await apiCall(admin, 'POST', `/admin/orders/shipments/${o.shipmentId}/status`, { status: 'DELIVERED', overrideReason: 'Handed over at the counter (test)' });
  await apiCall(f1, 'POST', '/admin/refunds', { orderNumber: o.orderNumber, sellerOrderId: o.shipmentId, amountMinor: '500', reason: 'Goodwill: box dented' });
  const pending = await apiCall<{ items: { id: string; order: { orderNumber: string } }[] }>(f1, 'GET', '/admin/refunds?status=PENDING');
  const refund = pending.items.find((r) => r.order.orderNumber === o.orderNumber)!;
  await apiCall(f2, 'POST', `/admin/refunds/${refund.id}/approve`);
  const after = await apiCall<{ items: { id: string }[] }>(f1, 'GET', '/admin/refunds?status=SUCCEEDED');
  if (!after.items.some((r) => r.id === refund.id)) await apiCall(f2, 'POST', `/admin/refunds/${refund.id}/mark-paid`, { reference: 'TRF-1' });

  await page.reload();
  const cn = page.getByTestId('download-credit-note');
  await expect(cn).toContainText(/CN-QA-\d{6}-\d{6}/);
  download = page.waitForEvent('download');
  await cn.click();
  expect((await download).suggestedFilename()).toMatch(/^CN-QA-\d{6}-\d{6}\.pdf$/);
});

test('download my data, then delete the account — and keep it after all', async ({ page }) => {
  const c = await freshCustomer();
  await signIn(page, c.email, c.password);
  await page.goto('/en/account');
  const privacy = page.getByTestId('privacy');
  const download = page.waitForEvent('download');
  await privacy.getByTestId('export-data').click();
  expect((await download).suggestedFilename()).toMatch(/^fastmovex-my-data-\d{4}-\d{2}-\d{2}\.json$/);

  await privacy.getByTestId('delete-account').click();
  const form = page.getByTestId('delete-form');
  await expect(form.getByTestId('delete-confirm')).toBeDisabled();
  await form.getByLabel('Current password').fill('Wrong-Pass-123');
  await form.getByTestId('delete-sure').check();
  await form.getByTestId('delete-confirm').click();
  await expect(form).toContainText('Your password is not right.');
  await form.getByLabel('Current password').fill(c.password);
  await form.getByTestId('delete-confirm').click();
  await expect(page).toHaveURL(/\/en\/?$/);

  // signing in again: the date, and a way to keep the account
  await signIn(page, c.email, c.password);
  await page.goto('/en/account');
  const banner = page.getByTestId('deletion-banner');
  await expect(banner).toContainText('Your account is set to be deleted on');
  await banner.getByTestId('keep-account').click();
  await expect(page.getByText('Welcome back — your account will not be deleted.')).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test('Arabic: an open order blocks deletion with a clear reason', async ({ page }) => {
  const c = await freshCustomer();
  await placeCod(c.token);
  await signIn(page, c.email, c.password, 'ar');
  await page.goto('/ar/account');
  await page.getByTestId('delete-account').click();
  await expect(page.getByTestId('delete-blockers')).toContainText('لديك طلب واحد ما زال في الطريق.');
  await expect(page.getByTestId('delete-confirm')).toBeDisabled();
});
