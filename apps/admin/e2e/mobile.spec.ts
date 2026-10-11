import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('on a phone the menu opens from the header and the tables scroll sideways', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('link', { name: /Orders/ }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(menu).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
