import { expect, test } from './fixtures';
import { apiCall, apiToken, freshCustomer, signIn } from './helpers';

/** Phase 22 on the website: before packing the customer moves the order to another saved address; staff changes show as order updates. */

test('the customer changes the delivery address before packing, and sees staff changes as order updates', async ({ page }) => {
  const c = await freshCustomer();
  await apiCall(c.token, 'POST', '/addresses', { label: 'Work', recipientName: 'Aisha Tester', phone: '+97455501235', countryCode: 'QA', city: 'Doha', zone: '25', street: '230', building: '41' });
  const product = await apiCall<{ variants: { id: string }[] }>(null, 'GET', '/products/premium-khalas-dates-1kg');
  const addresses = await apiCall<{ id: string; isDefault: boolean }[] | { items: { id: string; isDefault: boolean }[] }>(c.token, 'GET', '/addresses');
  const home = (Array.isArray(addresses) ? addresses : addresses.items).find((a) => a.isDefault)!;
  await apiCall(c.token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 2 });
  const { orderNumber } = await apiCall<{ orderNumber: string }>(c.token, 'POST', '/checkout', { addressId: home.id, paymentMethod: 'COD' }, { 'idempotency-key': `chg-${Date.now()}-${Math.random()}` });

  await signIn(page, c.email, c.password);
  await page.goto(`/en/account/orders/${orderNumber}`);
  const box = page.getByTestId('change-delivery');
  await expect(box).toContainText('3 changes left');
  await box.getByTestId('change-address').click();
  await page.getByTestId('change-address-form').getByText('Work').click();
  await page.getByTestId('change-address-save').click();
  await expect(page.getByText('Delivery address changed.').first()).toBeVisible();
  await expect(page.getByTestId('order-updates')).toContainText('Zone 25');
  await expect(box).toContainText('2 changes left');

  // our team removes one unit: the customer sees it and the lower total
  const admin = await apiToken('admin@demo.jovia.test');
  const detail = await apiCall<{ sellerOrders: { items: { id: string }[] }[] }>(admin, 'GET', `/admin/orders/${orderNumber}`);
  await apiCall(admin, 'PATCH', `/admin/orders/${orderNumber}/items`, { changes: [{ itemId: detail.sellerOrders[0].items[0].id, quantity: 1 }], reason: 'Customer asked for one box' });
  await page.reload();
  await expect(page.getByTestId('order-updates')).toContainText('Items changed by our team');
  await expect(page.getByTestId('order-updates')).toContainText('Total reduced by');

  // in Arabic too
  await page.goto(`/ar/account/orders/${orderNumber}`);
  await expect(page.getByTestId('order-updates')).toContainText('تحديثات الطلب');
  await expect(page.getByTestId('change-delivery')).toContainText('تغيير العنوان');
});
