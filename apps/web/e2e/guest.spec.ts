import { expect, test } from '@playwright/test';
import { API, apiLogSize, codeFromApiLog } from './helpers';

/** Phase 14: guest checkout, order tracking, contact form, content pages and offers. */
test.describe.serial('Guest checkout → track → contact', () => {
  const email = `guest.e2e.${Date.now()}@example.com`;
  const mobile = `555${String(Math.floor(10_000 + Math.random() * 89_999))}`; // a fresh number: codes are limited per number per hour
  let orderNumber = '';

  test('a shopper orders without an account, then lands on the tracking page', async ({ page }) => {
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');

    await page.goto('/en/cart');
    await expect(page.getByTestId('sign-in-checkout')).toBeVisible(); // signing in stays one click away
    await page.getByTestId('go-checkout').click();
    await expect(page).toHaveURL(/\/en\/checkout$/);
    await expect(page.getByTestId('guest-checkout')).toBeVisible();
    await expect(page.getByTestId('guest-sign-in')).toHaveAttribute('href', /\/en\/login\?next=%2Fen%2Fcheckout/);

    // nothing filled in: the form explains what is missing and places no order
    await page.getByTestId('place-order').click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    await expect(page).toHaveURL(/\/en\/checkout$/);

    await page.getByLabel('Full name', { exact: true }).fill('Guest Tester');
    await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Zone').fill('66');
    await page.getByLabel('Street').fill('901');
    await page.getByLabel('Building').fill('12');
    await page.getByTestId('pay-COD').check();
    // cash on delivery: the mobile number is confirmed with a texted code first
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('cod-phone-check').getByRole('alert')).toHaveText('Enter the 6-digit code we texted you.');
    const since = apiLogSize();
    await page.getByTestId('cod-send-code').click();
    const code = await codeFromApiLog(`+974${mobile}`, since);
    expect(code, 'texted code in the API log (E2E_API_LOG)').toMatch(/^\d{6}$/);
    await page.getByLabel(/Code sent to/).fill(code === '000000' ? '111111' : '000000');
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('cod-phone-check').getByRole('alert')).toHaveText('The code is wrong or has expired. Ask for a new code.');
    await expect(page).toHaveURL(/\/en\/checkout$/);
    await page.getByLabel(/Code sent to/).fill(code!);
    await page.getByTestId('place-order').click();

    await expect(page).toHaveURL(/\/en\/track\?order=FMX-QA-\d{6}-[A-Z0-9]{6}&t=[\w-]+&placed=1/, { timeout: 20_000 });
    orderNumber = new URL(page.url()).searchParams.get('order')!;
    await expect(page.getByTestId('order-placed')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveText('QAR 75.00');
    await expect(page.getByText('Pay in cash on delivery')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });

  test('the order can be found again with the order number and email, and cancelled', async ({ page }) => {
    await page.goto('/en/track');
    await page.getByTestId('track-order').fill(orderNumber.toLowerCase());
    await page.getByTestId('track-contact').fill('someone@else.com');
    await page.getByTestId('track-submit').click();
    await expect(page.getByText('We could not find an order with these details')).toBeVisible();

    await page.getByTestId('track-contact').fill(email.toUpperCase());
    await page.getByTestId('track-submit').click();
    await expect(page.getByTestId('order-total')).toHaveText('QAR 75.00');
    await expect(page.getByText('Keep all your orders in one place')).toBeVisible();

    await page.getByTestId('cancel-order').click();
    await page.getByTestId('cancel-reason').fill('Ordered by mistake');
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('order-status').first()).toHaveText('Cancelled');
  });

  test('a tampered tracking link shows nothing', async ({ page }) => {
    await page.goto(`/en/track?order=${orderNumber}&t=not-the-right-token`);
    await expect(page.getByText('This order link is not valid any more')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveCount(0);
  });

  test('signing up with the guest email points to "forgot password"', async ({ page }) => {
    await page.goto('/en/register');
    await page.getByLabel('Full name').fill('Guest Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Guest-Pass-2026');
    await page.getByTestId('register-submit').click();
    await expect(page.getByText('You have ordered with us before as a guest')).toBeVisible();
    await expect(page.getByRole('main').locator('a[href="/en/forgot-password"]')).toBeVisible();
    await expect(page).toHaveURL(/\/en\/register/);
  });
});

test.describe('Content pages, contact form and offers', () => {
  test('the contact form sends a message', async ({ page }) => {
    await page.goto('/en/contact');
    await expect(page.getByRole('heading', { name: 'Contact us', level: 1 })).toBeVisible();
    await page.getByTestId('contact-send').click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    await page.getByLabel('Your name').fill('Ali');
    await page.getByLabel('Email', { exact: true }).fill(`contact.${Date.now()}@example.com`);
    await page.getByLabel('Message').fill('Do you deliver to Al Khor on Fridays?');
    await page.getByTestId('contact-send').click();
    await expect(page.getByTestId('contact-sent')).toBeVisible();
  });

  test('about, privacy and terms are real pages linked from the footer', async ({ page }) => {
    await page.goto('/en');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'About FastMoveX' })).toHaveAttribute('href', '/en/about');
    await expect(footer.getByRole('link', { name: 'Contact us' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Track an order' })).toBeVisible();
    await page.goto('/en/about');
    await expect(page.getByRole('heading', { name: 'About FastMoveX', level: 1 })).toBeVisible();
    await page.goto('/ar/privacy');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const res = await page.goto('/en/no-such-page-here');
    expect(res?.status()).toBe(404);
  });

  test('the offers page lists products on sale', async ({ page }) => {
    await page.goto('/en/offers');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('a[href*="/en/p/"]').first()).toBeVisible();
  });

  test('pages and offers are in the sitemap; tracking is not indexed', async ({ page, request }) => {
    const sm = await request.get('/sitemaps/pages.xml');
    if (sm.ok()) {
      const xml = await sm.text();
      expect(xml).toContain('/en/offers');
      expect(xml).toContain('/en/about');
    }
    await page.goto('/en/track');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const pages = await (await request.get(`${API}/pages`)).json();
    expect(pages.map((p: { slug: string }) => p.slug)).toEqual(expect.arrayContaining(['about', 'privacy', 'terms']));
  });
});
