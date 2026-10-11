import { expect, test } from '@playwright/test';
import { API, apiToken, run, signIn, ADMIN } from './helpers';

/** Phase 25: slider banners with their own text (badge, two-line headline with *accent*, line, button), both languages. */
test('a slider banner gets its text with a live preview; the website receives it', async ({ page }) => {
  await signIn(page);
  await page.goto('/banners');
  await page.getByRole('button', { name: 'Add banner' }).click();
  const d = page.getByRole('dialog');
  // 1×1 PNG as the picture
  await d.locator('input[type=file]').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') });
  await d.getByLabel('Link').fill('/offers');
  await d.getByLabel('Order', { exact: true }).fill('998');
  await d.getByLabel('Small badge', { exact: true }).fill('Limited time');
  await d.getByLabel('Headline', { exact: true }).fill(`Big deals ${run()}\nUp to *50% off*\nthird line is dropped`);
  await d.getByLabel('Headline (Arabic)').fill('عروض كبيرة\nخصم حتى *50%*');
  await d.getByLabel('Line under it', { exact: true }).fill('Top brands • Best prices');
  await d.getByLabel('Button', { exact: true }).fill('Shop now');
  await expect(d.getByText('50% off', { exact: true }).first()).toBeVisible(); // the preview colours the starred words
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Banner added')).toBeVisible();
  await expect(page.getByTestId('banner-headline').filter({ hasText: 'Up to 50% off' }).first()).toBeVisible();

  const t = await apiToken(ADMIN);
  const list = (await (await fetch(`${API}/admin/banners`, { headers: { authorization: `Bearer ${t}` } })).json()) as { id: string; sortOrder: number; headline: string | null; kicker: string | null }[];
  const b = list.find((x) => x.sortOrder === 998 && x.headline?.startsWith('Big deals'))!;
  expect(b.headline!.split('\n')).toHaveLength(2);
  expect(b.kicker).toBe('Limited time');
  await fetch(`${API}/admin/banners/${b.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
});
