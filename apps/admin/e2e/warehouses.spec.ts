import { expect, test } from '@playwright/test';
import { ADMIN, apiCall, apiToken, signIn } from './helpers';

interface Warehouse { id: string; code: string; isActive: boolean; isDefault: boolean }

test.afterAll(async () => {
  // put the stock back and close the test warehouse, so other tests keep one warehouse
  const t = await apiToken(ADMIN);
  const list = await apiCall<{ items: Warehouse[] }>(t, 'GET', '/admin/warehouses');
  const main = list.items.find((w) => w.isDefault)!;
  for (const w of list.items.filter((x) => x.code.startsWith('E2E') && x.isActive)) {
    const stock = await apiCall<{ items: { variantId: string; onHand: number }[] }>(t, 'GET', `/admin/warehouses/${w.id}/stock`);
    const items = stock.items.filter((s) => s.onHand > 0).map((s) => ({ variantId: s.variantId, quantity: s.onHand }));
    if (items.length) {
      const tr = await apiCall<{ id: string }>(t, 'POST', '/admin/stock-transfers', { fromWarehouseId: w.id, toWarehouseId: main.id, items });
      await apiCall(t, 'POST', `/admin/stock-transfers/${tr.id}/receive`);
    }
    await apiCall(t, 'PATCH', `/admin/warehouses/${w.id}`, { isActive: false }).catch(() => undefined);
  }
});

test('staff add a warehouse, move stock into it and see it per warehouse', async ({ page }) => {
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-5)}`;
  await signIn(page);
  await page.goto('/warehouses');
  await expect(page.getByTestId('warehouses')).toContainText('Main warehouse');
  await page.getByTestId('new-warehouse').click();
  await page.locator('input[name="name"]').fill('Lusail pick-up room');
  await page.getByLabel('Code').fill(code);
  await page.getByLabel('Nearest for zones').fill('69, 70');
  await page.getByTestId('save-warehouse').click();
  await expect(page.getByText('Warehouse added')).toBeVisible();
  await expect(page.getByTestId('warehouses')).toContainText('Lusail pick-up room');

  // move 3 Khalas dates there
  await page.getByTestId('new-transfer').click();
  await page.locator('#tr-to').selectOption({ label: 'Lusail pick-up room' });
  await page.getByPlaceholder('Find a product or SKU to add').fill('Khalas');
  await page.getByTestId('transfer-pick').first().click();
  await page.getByRole('textbox', { name: /Quantity of/ }).fill('3');
  await page.getByTestId('save-transfer').click();
  await expect(page.getByText('Transfer created')).toBeVisible();
  const row = page.getByTestId('transfer-row').filter({ hasText: 'Lusail pick-up room' }).first();
  await expect(row).toContainText('3×');
  await row.getByTestId('receive-transfer').click();
  await expect(page.getByText(/received — stock moved/)).toBeVisible();

  // the inventory shows it per warehouse
  await page.goto('/inventory?q=Khalas');
  await expect(page.locator('td', { hasText: `${code} 3` }).first()).toBeVisible();
  await page.getByTestId('inventory-warehouse').selectOption({ label: 'Lusail pick-up room' });
  await expect(page.getByRole('columnheader', { name: `In ${code}` })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Stock of/ }).first()).toHaveValue('3');
});
