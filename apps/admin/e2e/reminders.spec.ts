import { expect, test } from '@playwright/test';
import { ADMIN, apiCall, apiToken, signIn } from './helpers';

test.afterAll(async () => {
  await apiCall(await apiToken(ADMIN), 'PATCH', '/admin/countries/QA', { cartReminders: { enabled: false } });
});

test('staff see connected services and switch on cart reminders with their timing', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  await expect(page.getByTestId('integrations')).toContainText('Card payments');
  await expect(page.getByTestId('integrations')).toContainText('WhatsApp');
  const card = page.getByTestId('reminders-card');
  await expect(card).toContainText('Reminders sent (30 days)');
  await card.getByRole('switch', { name: /Send cart reminders/ }).click();
  await card.getByLabel('First reminder').selectOption('120');
  await card.getByLabel('Second reminder').selectOption('0');
  await card.getByRole('button', { name: 'Save cart reminders' }).click();
  await expect(page.getByText('Cart reminders are on.')).toBeVisible();
  const qa = (await apiCall<{ code: string; cartReminders: Record<string, unknown> }[]>(await apiToken(ADMIN), 'GET', '/admin/countries')).find((c) => c.code === 'QA')!;
  expect(qa.cartReminders).toMatchObject({ enabled: true, firstAfterMinutes: 120, secondAfterHours: null, quietFrom: 21, quietTo: 9 });
});
