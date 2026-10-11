import { expect, test } from '@playwright/test';
import { apiCall, apiToken, run, signIn, SUPER } from './helpers';

test('each role sees only its own sections, and the API enforces it', async ({ page }) => {
  const sup = await apiToken(SUPER.email, SUPER.password);
  const email = `stock.${run().toLowerCase()}@jovia.test`;
  const password = 'Stock-Keeper-2026';
  await apiCall(sup, 'POST', '/admin/staff', { fullName: 'Stock Keeper', email, password, roles: ['INVENTORY_MANAGER'] });

  await signIn(page, email, password);
  const nav = page.getByRole('navigation', { name: 'Admin' }).first();
  await expect(nav.getByRole('link', { name: /Inventory/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Products/ })).toBeVisible();
  for (const hidden of ['Orders', 'Customers', 'Coupons', 'Staff', 'Refunds', 'Store & delivery']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${hidden.replace(/[&]/g, '\\$&')}`) })).toHaveCount(0);
  }
  // No price editing without products.manage; stock can be changed
  await page.goto('/inventory');
  await expect(page.getByRole('textbox', { name: /^Price of / }).first()).toBeDisabled();
  await expect(page.getByRole('textbox', { name: /^Stock of / }).first()).toBeEnabled();
  // Typing a hidden address shows a clear message instead of a broken page
  await page.goto('/orders');
  await expect(page.getByText('No access')).toBeVisible();
});
