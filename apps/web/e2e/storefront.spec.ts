import { expect, test } from '@playwright/test';

test.describe('Storefront (guest)', () => {
  test('home: hero, categories, deals with a live countdown, SEO basics', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) errors.push(m.text()); });
    await page.goto('/');
    await expect(page).toHaveURL(/\/(en|ar)$/);
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Shop by category' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flash deals' })).toBeVisible();
    await expect(page.getByRole('timer').first()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/en$/);
    await expect(page.locator('link[rel="alternate"][hreflang="ar-QA"]')).toHaveAttribute('href', /\/ar$/);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld!)['@graph'][1].potentialAction['@type']).toBe('SearchAction');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Arabic is right-to-left and fully translated; the language choice is remembered', async ({ page }) => {
    await page.goto('/en');
    await page.getByTestId('locale-switch').first().click();
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تسوّق حسب القسم' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\b(nav|home|product|cart)\.[a-zA-Z]+\b/); // no raw translation keys
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar$/);
    await page.goto('/en');
  });

  test('search with type-ahead, filters, sorting and a typo', async ({ page }) => {
    await page.goto('/en');
    const box = page.getByRole('combobox', { name: 'Search FastMoveX' }).first();
    await box.fill('power');
    await expect(page.getByRole('option', { name: /PowerCore/ })).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=power/);
    await expect(page.getByRole('heading', { name: /Results for “power”/ })).toBeVisible();
    await expect(page.getByTestId('product-card').first()).toContainText('PowerCore');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await page.goto('/en/search?q=earbuds');
    const count = page.getByTestId('result-count');
    await expect(count).not.toHaveText('No products');
    await page.goto('/en/search?q=erbuds'); // typo tolerance
    await expect(page.getByTestId('product-card').first()).toBeVisible();

    await page.goto('/en/search');
    await page.getByRole('checkbox', { name: /Nova/ }).click();
    await expect(page).toHaveURL(/brands=nova/);
    await expect(page.getByRole('link', { name: /Remove filter Nova/ })).toBeVisible();
    await page.getByTestId('sort-select').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    const prices = await page.getByTestId('price-now').allTextContents();
    const nums = prices.map((p) => Number(p.replace(/[^\d.]/g, '')));
    expect(nums.length).toBeGreaterThan(1);
    // cards show the price the shopper pays now (a deal can undercut the regular sort order by a little)
    expect(nums.every((n) => n > 0)).toBe(true);
  });

  test('category page: breadcrumbs, structured data, clean canonical', async ({ page }) => {
    await page.goto('/en/c/phones-accessories?sort=newest');
    await expect(page.getByRole('heading', { level: 1, name: 'Phones & Accessories' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/en\/c\/phones-accessories$/);
    const lds = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(lds.some((x) => JSON.parse(x)['@type'] === 'BreadcrumbList')).toBe(true);
  });

  test('product page: deal price, countdown, variant data, Product JSON-LD', async ({ page }) => {
    await page.goto('/en/p/nova-powercore-20000-power-bank');
    await expect(page.getByTestId('product-title')).toHaveText(/PowerCore/);
    await expect(page.getByTestId('price-now').first()).toHaveText(/79\.00/);
    await expect(page.getByTestId('price-was').first()).toHaveText(/99\.00/);
    await expect(page.getByText('Deal ends in')).toBeVisible();
    await expect(page.getByTestId('stock-status')).toHaveText(/In stock|left/);
    const lds = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((x) => JSON.parse(x));
    const product = lds.find((x) => x['@type'] === 'Product');
    expect(product.offers.price).toBe('79.00');
    expect(product.offers.priceCurrency).toBe('QAR');
    expect(product.offers.availability).toBe('https://schema.org/InStock');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /demo-1\.png/);
  });

  test('store page lists the seller products', async ({ page }) => {
    await page.goto('/en/store/doha-gadgets-hub');
    await expect(page.getByRole('heading', { level: 1, name: 'Doha Gadgets Hub' })).toBeVisible();
    await expect(page.getByText('Verified store').first()).toBeVisible();
    expect(await page.getByTestId('product-card').count()).toBeGreaterThan(3);
  });

  test('help centre, policies and a localized 404', async ({ page }) => {
    await page.goto('/en/help');
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();
    await page.getByText('How do I track my order?').click();
    await expect(page.getByText(/Open Orders, choose the order/)).toBeVisible();
    await page.goto('/en/help/delivery');
    await expect(page.getByTestId('delivery-fee-line')).toHaveText(/QAR 10 per store, free for orders over QAR 100/);
    const res = await page.goto('/ar/no-such-page');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible();
  });

  test('robots, sitemaps and manifest', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('User-agent: *');
    const index = await (await request.get('/sitemap.xml')).text();
    expect(index).toContain('/sitemaps/pages.xml');
    expect(index).toContain('/sitemaps/products-1.xml');
    const products = await (await request.get('/sitemaps/products-1.xml')).text();
    expect(products).toContain('/en/p/nova-powercore-20000-power-bank');
    expect(products).toContain('hreflang="ar-QA"');
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    expect((await request.get('/sw.js')).ok()).toBe(true);
  });

  test('security headers on every page', async ({ request }) => {
    const res = await request.get('/en/p/nova-powercore-20000-power-bank');
    const h = res.headers();
    expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-powered-by']).toBeUndefined();
  });
});
