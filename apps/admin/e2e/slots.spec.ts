import { expect, test } from '@playwright/test';
import { ADMIN, API, apiCall, apiToken, signIn } from './helpers';

test.afterAll(async () => {
  await apiCall(await apiToken(ADMIN), 'PATCH', '/admin/countries/QA', { deliverySlots: { enabled: false } });
});

test('staff set delivery times in Settings; the shop offers them and Orders shows the day plan', async ({ page }) => {
  const t = await apiToken(ADMIN);
  await apiCall(t, 'PATCH', '/admin/countries/QA', { deliverySlots: { enabled: false } });
  await signIn(page);
  await page.goto('/settings');
  const card = page.getByTestId('slots-card');
  await card.getByRole('switch', { name: /Customers choose a delivery time/ }).click();
  await card.getByRole('switch', { name: /A delivery time is required/ }).click();
  await card.getByLabel('Book at least').selectOption('0');
  await card.getByRole('button', { name: 'Fri' }).click();
  await card.getByLabel('Window 1 orders').fill('5');
  await card.getByRole('button', { name: 'Remove window 3' }).click();
  await card.getByRole('button', { name: 'Save delivery times' }).click();
  await expect(page.getByText('Delivery times saved')).toBeVisible();

  const slots = (await (await fetch(`${API}/delivery/slots`, { headers: { 'x-country': 'QA' } })).json()) as { enabled: boolean; required: boolean; days: { date: string; weekday: number; slots: { from: string; left: number }[] }[] };
  expect(slots).toMatchObject({ enabled: true, required: true });
  expect(slots.days.every((d) => d.weekday !== 5)).toBe(true); // Friday closed
  const last = slots.days.at(-1)!;
  expect(last.slots.map((s) => s.from)).toEqual(['09:00', '13:00']);
  expect(last.slots[0].left).toBe(5);

  // an impossible window is refused with a clear message
  await card.getByLabel('Window 2 to').fill('10:00');
  await card.getByRole('button', { name: 'Save delivery times' }).click();
  await expect(page.getByText(/must end after it starts/).first()).toBeVisible();

  // Orders: pick a delivery date, see each window's bookings
  await page.goto(`/orders?date=${last.date}`);
  await expect(page.getByTestId('slot-schedule')).toContainText('09:00–13:00');
  await expect(page.getByTestId('slot-schedule')).toContainText('0 of 5 booked');
});
