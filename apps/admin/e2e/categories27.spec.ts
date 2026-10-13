import { expect, test } from '@playwright/test';
import { API, apiToken, signIn, ADMIN } from './helpers';

/** Phase 27: a category's tile picture is uploaded from its edit dialog and previewed on the same tile customers see. */
test('a category gets its tile picture, previewed as the customer tile', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const cats = (await (await fetch(`${API}/admin/categories`, { headers: { authorization: `Bearer ${t}` } })).json()) as { id: string; slug: string; imageUrl: string | null }[];
  const gifts = cats.find((c) => c.slug === 'gifts')!;
  await signIn(page);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Edit Gifts' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('category-picture')).toContainText('Tile picture');
  await d.getByTestId('category-picture-input').setInputFiles({ name: 'gift.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.getByText('Picture saved')).toBeVisible();
  await expect(d.getByTestId('category-picture-preview')).toHaveAttribute('src', /categories\/gifts-[0-9a-f]{8}\.webp$/);

  const after = (await (await fetch(`${API}/categories`)).json()) as { slug: string; imageUrl: string | null }[];
  expect(after.find((c) => c.slug === 'gifts')!.imageUrl).toMatch(/categories\/gifts-/);
  // tidy up: the deploy step draws the default picture again
  await fetch(`${API}/admin/categories/${gifts.id}/image`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
});
