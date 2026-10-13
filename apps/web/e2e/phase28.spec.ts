import { expect, test } from './fixtures';
import { freshCustomer, settle, signIn } from './helpers';

test.describe('Phase 28: Buy Now, delivery promise, free-delivery bar, bought together', () => {
  test('Buy Now checks out only that item; the cart keeps what was in it', async ({ page }) => {
    const { email, password } = await freshCustomer();
    await signIn(page, email, password);

    await page.goto('/en/p/nova-65w-gan-usb-c-charger');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');

    await page.goto('/en/p/premium-khalas-dates-1kg');
    await settle(page);
    // the price card promises a delivery day (or "in 1–2 days" when the market has no windows)
    await expect(page.getByTestId('delivery-line')).toContainText(/delivery/i);
    await page.getByTestId('buy-now').click();
    await expect(page).toHaveURL(/\/en\/checkout\?buy=[A-Za-z0-9_-]{20,64}$/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByText(/Items \(1 item\)/)).toBeVisible();
    await page.getByTestId('pay-COD').check();
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/en\/account\/orders\/FMX-QA-\d{6}-[A-Z0-9]{6}\?placed=1/);
    await expect(page.getByTestId('shipment')).toHaveCount(1);
    await expect(page.getByText(/Khalas/).first()).toBeVisible();

    // the charger is still in the cart
    await page.goto('/en/cart');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-line')).toContainText(/charger/i);
  });

  test('the cart shows how much more is needed for free delivery', async ({ page }) => {
    await page.goto('/en/p/nova-65w-gan-usb-c-charger');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/cart');
    const bar = page.getByTestId('free-delivery-bar');
    await expect(bar).toContainText(/Add QAR [\d.]+ more from .+ for FREE delivery/);
    await expect(bar.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/);
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('the bottom bar has Add to cart and Buy Now side by side, in Arabic too', async ({ page }) => {
      await page.goto('/ar/p/premium-khalas-dates-1kg');
      await settle(page);
      const add = page.getByTestId('sticky-add');
      const buy = page.getByTestId('sticky-buy-now');
      await expect(add).toBeInViewport();
      await expect(buy).toBeInViewport();
      await expect(buy).toContainText('اشترِ الآن');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await buy.click();
      await expect(page).toHaveURL(/\/ar\/checkout\?buy=/);
      await expect(page.getByTestId('guest-checkout')).toBeVisible();
    });
  });
});
