import { expect, test } from './fixtures';
import { apiCall, apiToken } from './helpers';

/** Phase 24: what search engines and shoppers see — category text and questions, brand pages, Google feed, the search box. */

test('a category page has its own Google title, the intro text and questions (with FAQ data), in both languages', async ({ page }) => {
  const admin = await apiToken('admin@demo.fastmovex.test');
  const cats = await apiCall<{ id: string; slug: string }[]>(admin, 'GET', '/admin/categories');
  const g = cats.find((c) => c.slug === 'groceries')!;
  await apiCall(admin, 'PATCH', `/admin/categories/${g.id}`, {
    seoTitle: 'Groceries online in Qatar', seoTitleAr: 'بقالة أونلاين في قطر', description: 'Dates, coffee and pantry staples delivered in Doha.', descriptionAr: 'تمور وقهوة ومؤن مع التوصيل في الدوحة.',
    faq: [{ q: 'Can I pay cash?', qAr: 'هل أستطيع الدفع نقداً؟', a: 'Yes, cash on delivery.', aAr: 'نعم، الدفع عند الاستلام.' }],
  });
  await page.goto('/en/c/groceries');
  await expect(page).toHaveTitle('Groceries online in Qatar | FastMoveX');
  const text = page.getByTestId('seo-text');
  await expect(text).toContainText('Dates, coffee and pantry staples delivered in Doha.');
  await text.getByText('Can I pay cash?').click();
  await expect(text).toContainText('Yes, cash on delivery.');
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.some((s) => s.includes('"FAQPage"'))).toBe(true);
  expect(ld.some((s) => s.includes('"ItemList"'))).toBe(true);
  await page.goto('/ar/c/groceries');
  await expect(page).toHaveTitle(/بقالة أونلاين في قطر/);
  await expect(page.getByTestId('seo-text')).toContainText('تمور وقهوة ومؤن');
});

test('a brand has its own page, reached from the product page and from a search for the brand', async ({ page }) => {
  await page.goto('/en/brand/dana-oud');
  await expect(page.getByTestId('brand-page').getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Qatar/);
  const first = page.locator('[data-testid="brand-page"] a[href*="/en/p/"]').first();
  await first.click();
  await expect(page.getByTestId('product-brand')).toBeVisible();
  await page.getByTestId('product-brand').click();
  await expect(page).toHaveURL(/\/en\/brand\/dana-oud/);
  await page.goto('/en/search?q=dana%20oud');
  await expect(page.getByTestId('search-brand-link')).toBeVisible();
});

test('the search box shows photos, prices and a link to all results', async ({ page }) => {
  await page.goto('/en');
  const box = page.getByRole('combobox', { name: 'Search FastMoveX' });
  await box.click();
  await box.fill('dates');
  const product = page.getByTestId('search-option-product').first();
  await expect(product).toContainText('QAR');
  await expect(product.locator('img')).toHaveCount(1);
  await expect(page.getByTestId('search-option-all')).toContainText('See all results for “dates”');
  await page.getByTestId('search-option-all').click();
  await expect(page).toHaveURL(/\/en\/search\?q=dates/);
});

test('Google Shopping feed, image sitemap and the Search Console code are served', async ({ page, request }) => {
  const feed = await request.get('/feeds/google-en.xml');
  expect(feed.status()).toBe(200);
  const xml = await feed.text();
  expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
  expect(xml).toMatch(/<g:price>\d+\.\d{2} QAR<\/g:price>/);
  expect((await request.get('/feeds/google-xx.xml')).status()).toBe(404);
  const products = await (await request.get('/sitemaps/products-1.xml')).text();
  expect(products).toContain('<image:image>');
  const pages = await (await request.get('/sitemaps/pages.xml')).text();
  expect(pages).toContain('/en/brand/');
  const admin = await apiToken('admin@demo.fastmovex.test');
  await apiCall(admin, 'PATCH', '/admin/countries/QA', { seoSettings: { googleVerification: 'e2e-verify-code-1' } });
  await expect.poll(async () => { await page.goto('/en/help'); return page.locator('meta[name="google-site-verification"]').getAttribute('content'); }, { timeout: 15_000 }).toBe('e2e-verify-code-1');
});
