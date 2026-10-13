import { expect, test } from '@playwright/test';
import { API, apiToken, signIn, ADMIN } from './helpers';

/** Phase 29: staff keep the size guides and pick a category's default guide. */
test('staff add a size guide in the table editor, then remove it', async ({ page }) => {
  const name = `E2E Belts ${Math.random().toString(36).slice(2, 7)}`;
  await signIn(page);
  await page.goto('/size-charts');
  await expect(page.getByTestId('size-chart-card').filter({ hasText: 'Thobe / kandura' })).toBeVisible();
  await page.getByRole('button', { name: 'Add size guide' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel(/^Name/).first().fill(name);
  await d.getByLabel(/^Name in Arabic/).fill('أحزمة');
  await d.getByLabel('Remove column 3').click();
  await d.getByLabel('Column 2 name').fill('Waist');
  await d.getByLabel('Row 1, Waist').fill('70–80');
  await d.getByLabel('Row 2, Waist').fill('80–90');
  await d.getByLabel('Row 3, Waist').fill('90–100');
  await d.getByTestId('size-chart-add-row').click();
  await d.getByLabel('Row 4, Size').fill('XL');
  await d.getByLabel('Row 4, Waist').fill('100–110');
  await d.getByTestId('size-chart-save').click();
  await expect(page.getByText('Size guide added')).toBeVisible();
  const card = page.getByTestId('size-chart-card').filter({ hasText: name });
  await expect(card).toContainText('70–80');

  await page.getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
});

test("a category's default guide is chosen in its edit dialog", async ({ page }) => {
  const t = await apiToken(ADMIN);
  await signIn(page);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Edit Shoes' }).click();
  const select = page.getByRole('dialog').getByTestId('category-size-chart');
  await expect(select).toHaveValue('5a1e0001-0000-4000-8000-000000000005');
  await expect(select.locator('option', { hasText: 'Kids' })).toHaveCount(1);
  const cats = (await (await fetch(`${API}/admin/categories`, { headers: { authorization: `Bearer ${t}` } })).json()) as { slug: string; sizeChartId: string | null }[];
  expect(cats.find((c) => c.slug === 'baby-kids')!.sizeChartId).toBe('5a1e0001-0000-4000-8000-000000000006');
});
