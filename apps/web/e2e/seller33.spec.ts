import { expect, test } from './fixtures';
import { apiCall, apiToken, signIn } from './helpers';

const SELLER = 'seller.gadgets@demo.fastmovex.test';
const PRODUCT = '/en/p/nova-powercore-20000-power-bank';

/** Phase 33: Account Health and holiday mode in the Seller Center, and what customers see while the store is away. */
test.describe('Account health and holiday mode (phase 33)', () => {
  test.afterAll(async () => {
    // never leave the demo store closed
    await apiCall(await apiToken(SELLER), 'PUT', '/seller/away', { until: null });
  });

  test('the store sees its measures against targets', async ({ page }) => {
    await signIn(page, SELLER);
    await page.goto('/en/seller');
    await page.getByRole('link', { name: 'Account health' }).first().click();
    await expect(page.getByTestId('health-status')).toBeVisible();
    for (const k of ['cancellations', 'lateDispatch', 'returns', 'rating', 'questions']) await expect(page.getByTestId(`health-${k}`)).toContainText('Target');
  });

  test('closed for a holiday: customers cannot buy and are told when it is back; opening again is one tap', async ({ page, browser }) => {
    await signIn(page, SELLER);
    await page.goto('/en/seller/store');
    const card = page.getByTestId('holiday-card');
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await card.getByLabel('Closed until').fill(until);
    await card.getByLabel('Note for customers (optional)').fill('Back soon, thank you!');
    await card.getByTestId('holiday-on-save').click();
    await expect(card.getByTestId('holiday-on')).toContainText('Your store is closed until');
    await expect(page.getByTestId('away-banner')).toBeVisible();

    // a shopper (fresh page, product page data refreshes within the cache time)
    const shopper = await browser.newPage();
    await expect(async () => {
      await shopper.goto(PRODUCT);
      await expect(shopper.getByTestId('store-away')).toContainText('on holiday', { timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000, 5_000, 10_000] });
    await expect(shopper.getByTestId('store-away')).toContainText('Back soon, thank you!');
    await expect(shopper.getByTestId('add-to-cart')).toBeDisabled();
    await shopper.close();

    await card.getByTestId('holiday-off').click();
    await expect(card.getByTestId('holiday-on-save')).toBeVisible();
    await expect(page.getByTestId('away-banner')).toHaveCount(0);
  });
});
