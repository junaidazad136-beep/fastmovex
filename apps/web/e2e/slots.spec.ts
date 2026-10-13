import { expect, test } from './fixtures';
import { API, DEMO_PASSWORD, freshCustomer, signIn, confirmGuestPhone, freshMobile } from './helpers';

/** Delivery time slots at checkout. Turns slots on for these tests only (and off again afterwards). */
async function setSlots(deliverySlots: Record<string, unknown>) {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }) });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await fetch(`${API}/admin/countries/QA`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ deliverySlots }) });
  if (!res.ok) throw new Error(`slots: ${res.status} ${await res.text()}`);
}

test.describe.serial('Delivery time at checkout', () => {
  test.beforeAll(async () => {
    await setSlots({ enabled: true, required: true, daysAhead: 4, leadMinutes: 0, closedWeekdays: [], closedDates: [], windows: [{ start: '08:00', end: '12:00', capacity: 50 }, { start: '12:00', end: '16:00', capacity: 50 }, { start: '16:00', end: '20:00', capacity: 50 }] });
  });
  test.afterAll(async () => {
    await setSlots({ enabled: false });
  });

  test('the customer must pick a time; the order shows it', async ({ page }) => {
    const { email, password } = await freshCustomer();
    await signIn(page, email, password);
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/checkout');
    const picker = page.getByTestId('slot-picker');
    await expect(picker.getByRole('heading', { name: 'Delivery time' })).toBeVisible();
    await expect(page.getByTestId('slot-asap')).toHaveCount(0); // required: no "as soon as possible"

    await page.getByTestId('pay-COD').check();
    await page.getByTestId('place-order').click();
    await expect(page.getByText('Choose a delivery time to continue.')).toBeVisible();
    await expect(page).toHaveURL(/\/en\/checkout$/);

    // the last offered day is always fully in the future
    await picker.locator('[data-testid^="slot-day-"]').last().click();
    const window = picker.getByTestId('slot-window').first();
    await window.check({ force: true });
    const label = (await window.locator('xpath=..').locator('span').first().textContent())!.trim();
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/en\/account\/orders\/FMX-QA-\d{6}-[A-Z0-9]{6}\?placed=1/);
    await expect(page.getByTestId('order-slot')).toContainText('Delivery time');
    await expect(page.getByTestId('order-slot')).toContainText(label.split('–')[0].trim());
  });

  test('optional mode offers "As soon as possible" and guests can choose too', async ({ page }) => {
    await setSlots({ enabled: true, required: false, daysAhead: 3, leadMinutes: 0, closedWeekdays: [], closedDates: [], windows: [{ start: '10:00', end: '14:00', capacity: 50 }] });
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/checkout');
    await expect(page.getByTestId('slot-asap')).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Full name', { exact: true }).fill('Guest Slot');
    const mobile = freshMobile();
    await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
    await page.getByLabel('Email', { exact: true }).fill(`guest.slot.${Date.now()}@example.com`);
    await page.getByLabel('Zone').fill('66');
    await page.getByLabel('Street').fill('901');
    await page.getByLabel('Building').fill('12');
    await page.getByTestId('slot-picker').locator('[data-testid^="slot-day-"]').last().click();
    await page.getByTestId('slot-window').first().check({ force: true });
    await page.getByTestId('pay-COD').check();
    await confirmGuestPhone(page, mobile); // cash on delivery: the mobile is confirmed by a texted code
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/en\/track\?order=/, { timeout: 20_000 });
    await expect(page.getByTestId('order-slot')).toContainText('10:00');
  });
});
