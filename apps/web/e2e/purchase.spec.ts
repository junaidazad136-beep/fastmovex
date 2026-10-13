import { expect, test } from './fixtures';
import { API, freshCustomer, signIn } from './helpers';

test.describe.serial('Purchase: guest cart → sign in → coupon → checkout → order → cancel', () => {
  let email = '';
  let password = '';

  test.beforeAll(async () => {
    ({ email, password } = await freshCustomer());
  });

  test('two stores in one cart, server-side totals, coupon, cash on delivery, cancel', async ({ page }) => {
    // 1. Guest adds from two different stores
    await page.goto('/en/p/nova-65w-gan-usb-c-charger');
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByTestId('qty')).toHaveText('2');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('2');

    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('3');

    // 2. Cart: split per seller, delivery per seller, totals from the server
    await page.goto('/en/cart');
    await expect(page.getByText('Items from different stores are delivered separately')).toBeVisible();
    await expect(page.getByTestId('cart-line')).toHaveCount(2);
    await expect(page.getByTestId('cart-total')).toHaveText('QAR 233.00'); // 158.00 + 65.00 + 10.00 delivery for the small shipment
    await expect(page.getByText('Sign in to use a promo code')).toBeVisible();

    // 3. Sign in from the cart; the guest cart is merged into the account
    await page.getByTestId('sign-in-checkout').click();
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    await page.getByLabel('Email or mobile number').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/en\/checkout$/);
    await expect(page.getByTestId('cart-count').first()).toHaveText('3');

    // 4. Promo codes are checked by the server
    await page.goto('/en/cart');
    await page.getByLabel('Promo code').fill('NOPE99');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('This code is not valid')).toBeVisible();
    await page.getByLabel('Promo code').fill('welcome10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('coupon-state')).toContainText('WELCOME10');
    await expect(page.getByTestId('cart-total')).toHaveText('QAR 210.70'); // 10% off goods (22.30), delivery unchanged

    // 5. Checkout with cash on delivery
    await page.getByTestId('go-checkout').click();
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Home/ })).toBeChecked();
    await page.getByTestId('pay-COD').check();
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/en\/account\/orders\/FMX-QA-\d{6}-[A-Z0-9]{6}\?placed=1/);
    await expect(page.getByTestId('order-placed')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveText('QAR 210.70');
    await expect(page.getByTestId('shipment')).toHaveCount(2);
    await expect(page.getByText('Pay in cash on delivery')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveCount(0); // cart emptied

    // 6. The customer can cancel before the seller starts preparing
    await page.getByTestId('cancel-order').click();
    await page.getByTestId('cancel-reason').fill('Ordered by mistake');
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByText('Your order was cancelled')).toBeVisible();
    await expect(page.getByTestId('order-status').first()).toHaveText('Cancelled');
    await expect(page.getByTestId('cancel-order')).toHaveCount(0);

    // 7. Orders list shows it
    await page.goto('/en/account/orders');
    await expect(page.getByTestId('order-row').first()).toContainText('Cancelled');
  });

  test('card payment (sandbox gateway) is captured and the order shows as paid', async ({ page }) => {
    const market = (await (await fetch(`${API}/markets`)).json())[0] as { cardProvider?: string | null };
    test.skip(market.cardProvider !== 'test', 'The API runs with a real gateway (see dibsy.spec.ts)');
    await signIn(page, email, password);
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/checkout');
    await page.getByTestId('pay-CARD').check();
    await expect(page.getByTestId('test-mode')).toBeVisible();
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\?placed=1/);
    await expect(page.getByText('Paid')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveText('QAR 75.00');
  });
});
