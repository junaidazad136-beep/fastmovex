import { expect, test } from './fixtures';
import { API, freshCustomer, signIn } from './helpers';

/**
 * Card payments through Dibsy's hosted page. Runs when the API is started with Dibsy settings pointing at the local
 * stand-in (apps/api/scripts/dibsy-sandbox.mjs); skipped otherwise.
 */
test.describe('Dibsy payment page', () => {
  test.beforeEach(async () => {
    const market = (await (await fetch(`${API}/markets`)).json())[0] as { cardProvider?: string | null };
    test.skip(market.cardProvider !== 'dibsy', 'API is not connected to Dibsy');
  });

  test('a customer pays with Apple Pay on the Dibsy page and comes back to a paid order', async ({ page }) => {
    const { email, password } = await freshCustomer();
    await signIn(page, email, password);
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/checkout');
    await expect(page.getByText('Card, Apple Pay or Google Pay')).toBeVisible();
    await expect(page.getByTestId('test-mode')).toHaveCount(0); // a real gateway, not the sandbox notice
    await page.getByTestId('pay-CARD').check();
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/checkout\/pt_/); // on the payment page
    await page.getByTestId('sandbox-applepay').click();
    await expect(page).toHaveURL(/\/en\/account\/orders\/FMX-QA-\d{6}-[A-Z0-9]{6}\?placed=1/, { timeout: 30_000 });
    await expect(page.getByText('Paid')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveText('QAR 75.00');
  });

  test('a guest whose card is declined gets a clear message and keeps the items', async ({ page }) => {
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/checkout');
    await page.getByLabel('Full name', { exact: true }).fill('Guest Card');
    await page.getByLabel('Mobile number', { exact: true }).fill('55512399');
    await page.getByLabel('Email', { exact: true }).fill(`guest.card.${Date.now()}@example.com`);
    await page.getByLabel('Zone').fill('66');
    await page.getByLabel('Street').fill('901');
    await page.getByLabel('Building').fill('12');
    await page.getByTestId('pay-CARD').check();
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/checkout\/pt_/);
    await page.getByTestId('sandbox-decline').click();
    await expect(page.getByText('Your payment was not completed')).toBeVisible({ timeout: 30_000 });
    await page.goto('/en/cart');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
  });
});
