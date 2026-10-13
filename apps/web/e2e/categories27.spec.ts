import { expect, test } from './fixtures';

test.describe('All categories page (phase 27)', () => {
  test('each category is a picture tile that opens the category', async ({ page }) => {
    await page.goto('/en/categories');
    const cards = page.getByTestId('category-card');
    expect(await cards.count()).toBeGreaterThan(10);
    const first = cards.first();
    await expect(first).toContainText('Electronics');
    await expect(first.locator('img')).toHaveAttribute('src', /categories/);
    await first.click();
    await expect(page).toHaveURL(/\/en\/c\/electronics/);
  });

  test('Arabic: names in Arabic, right to left', async ({ page }) => {
    await page.goto('/ar/categories');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('category-card').first()).toContainText('إلكترونيات');
  });
});
