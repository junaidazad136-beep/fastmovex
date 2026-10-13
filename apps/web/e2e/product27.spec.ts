import { expect, test } from './fixtures';

const PRODUCT = '/en/p/nova-x12-wireless-earbuds';

test.describe('Product page, phone order (phase 27)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the store and the title come first, then the photos; no path on phones', async ({ page }) => {
    await page.goto(PRODUCT);
    const head = page.getByTestId('product-head');
    await expect(head.getByTestId('product-store')).toHaveAttribute('href', /\/en\/store\//);
    await expect(head.getByTestId('product-title')).toBeVisible();
    const headBox = (await head.boundingBox())!;
    const galleryBox = (await page.getByTestId('gallery-track').boundingBox())!;
    expect(headBox.y).toBeLessThan(galleryBox.y);
    expect(galleryBox.x).toBeLessThanOrEqual(1); // edge to edge
    await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeHidden();
    await expect(page.getByTestId('share')).toBeVisible();
  });

  test('colours with their own photo are picture cards with a price', async ({ page }) => {
    await page.goto(PRODUCT);
    const cards = page.getByTestId('option-card');
    if ((await cards.count()) === 0) test.skip(true, 'this product has no photo per colour');
    await expect(cards.first()).toContainText('QAR');
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  });
});
