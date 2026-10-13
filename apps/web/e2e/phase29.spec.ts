import { expect, test } from './fixtures';
import { API, apiCall, apiToken, settle } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const run = Math.random().toString(36).slice(2, 8);
let slug = '';

/** Sandals in the Shoes category with sizes 41–43: the shoe guide comes from the category. */
test.beforeAll(async () => {
  const admin = await apiToken('admin@demo.fastmovex.test');
  const cats = await apiCall<{ id: string; slug: string }[]>(admin, 'GET', '/admin/categories');
  const p = await apiCall<{ id: string; slug: string }>(admin, 'POST', '/admin/products', {
    title: `E2E Sandals ${run}`, categoryId: cats.find((c) => c.slug === 'shoes')!.id,
    variants: ['41', '42', '43'].map((s) => ({ sku: `E2E29-${s}-${run}`, optionValues: { Size: s }, priceMinor: '12900', initialStock: 9 })),
  });
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  await fetch(`${API}/admin/products/${p.id}/images`, { method: 'POST', headers: { authorization: `Bearer ${admin}` }, body: fd });
  await apiCall(admin, 'POST', `/admin/products/${p.id}/status`, { status: 'ACTIVE' });
  slug = p.slug;
});

test.describe('Size guide on the product page (phase 29)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('opens from the Size option, highlights the chosen size and switches cm / inches', async ({ page }) => {
    await page.goto(`/en/p/${slug}`);
    await settle(page);
    await page.getByRole('button', { name: '42', exact: true }).click();
    await page.getByTestId('size-guide-open').click();
    const guide = page.getByTestId('size-guide');
    await expect(guide).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Shoes', { exact: true })).toBeVisible();
    const mine = guide.getByTestId('size-row-selected');
    await expect(mine).toContainText('42');
    await expect(mine).toContainText('Your size');
    await expect(mine).toContainText('26.5');
    await guide.getByTestId('size-unit-in').click();
    await expect(mine).toContainText('10.4');
    await expect(guide.getByText('How to measure')).toBeVisible();
    // the table fits a phone: the page itself does not scroll sideways
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('in Arabic', async ({ page }) => {
    await page.goto(`/ar/p/${slug}`);
    await settle(page);
    await page.getByTestId('size-guide-open').click();
    await expect(page.getByTestId('size-guide')).toContainText('طريقة القياس');
    await expect(page.getByRole('dialog')).toContainText('دليل المقاسات');
  });

  test('a product without sizes shows no guide', async ({ page }) => {
    await page.goto('/en/p/nova-powercore-20000-power-bank');
    await settle(page);
    await expect(page.getByTestId('size-guide-open')).toHaveCount(0);
  });
});
