import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/** Phase 33: staff open a seller's Account Health from the Sellers list. */
test("staff see a seller's account health", async ({ page }) => {
  await signIn(page);
  await page.goto('/sellers?status=APPROVED&q=gadget');
  const row = page.locator('tr').filter({ hasText: 'Doha Gadgets' }).first();
  await row.getByTestId('seller-health').click();
  const view = page.getByTestId('seller-health-view');
  await expect(view).toContainText('Overall');
  await expect(view).toContainText('Orders the store cancelled');
  await expect(view).toContainText('Questions answered in 48 h');
});
