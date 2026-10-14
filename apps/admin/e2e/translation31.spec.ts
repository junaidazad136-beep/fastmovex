import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/** Phase 31: staff see whether automatic Arabic is on and how to switch it on (no DeepL key in the test stack). */
test('the Arabic translation page explains how to switch it on and counts the products', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Arabic translation' }).click();
  await expect(page.getByRole('heading', { name: 'Arabic translation' })).toBeVisible();
  const status = page.getByTestId('translation-status');
  await expect(status).toContainText('Not connected');
  await expect(status).toContainText('DEEPL_API_KEY');
  await expect(page.getByTestId('translation-waiting')).toHaveText(/^\d[\d,]*$/);
  await expect(page.getByTestId('translation-run')).toHaveCount(0);
});
