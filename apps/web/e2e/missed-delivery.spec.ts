import { expect, test } from './fixtures';
import { apiCall, freshCustomer, missedDeliveryOrder, setDeliverySlots, signIn } from './helpers';

/** The driver could not deliver: the order page explains why and lets the customer choose what happens next. */
test.describe.serial('Missed delivery', () => {
  test.beforeAll(async () => {
    await setDeliverySlots({ enabled: true, required: false, daysAhead: 3, leadMinutes: 0, closedWeekdays: [], closedDates: [], windows: [{ start: '10:00', end: '14:00', capacity: 50 }, { start: '16:00', end: '20:00', capacity: 50 }] });
  });
  test.afterAll(async () => {
    await setDeliverySlots({ enabled: false });
  });

  test('a signed-in customer sees the missed delivery and picks a new time with a note for the driver', async ({ page }) => {
    const { email, password, token } = await freshCustomer();
    const orderNumber = await missedDeliveryOrder(token, 'Customer not answering');

    await signIn(page, email, password);
    await page.goto(`/en/account/orders/${orderNumber}`);
    const card = page.getByTestId('missed-delivery');
    await expect(card).toContainText('We missed you');
    await expect(card).toContainText('The driver could not reach you by phone.');
    await expect(card).toContainText('Delivery attempt:');
    await expect(page.getByTestId('customer-request')).toHaveCount(0);

    const form = page.getByTestId('reschedule-form');
    await form.getByTestId('reschedule-submit').click();
    await expect(form.getByRole('alert')).toHaveText('Choose a new delivery time or write a note for the driver.');

    // the last offered day is always fully in the future
    const picker = form.getByTestId('slot-picker');
    await picker.locator('[data-testid^="slot-day-"]').last().click();
    const window = picker.getByTestId('slot-window').first();
    await window.check({ force: true });
    const label = (await window.locator('xpath=..').locator('span').first().textContent())!.trim();
    await form.getByLabel('Note for the driver').fill('After 5 pm, call first');
    await form.getByTestId('reschedule-submit').click();

    await expect(card.getByTestId('reschedule-done')).toHaveText('Thanks — we’ll deliver at the new time.');
    await expect(page.getByTestId('customer-request')).toContainText('Your request:');
    await expect(page.getByTestId('customer-request')).toContainText('After 5 pm, call first');
    await expect(page.getByTestId('customer-request')).toContainText('New time');
    await expect(page.getByTestId('reschedule-form')).toHaveCount(0);
    await expect(page.getByTestId('order-slot')).toContainText(label.split('–')[0].trim());

    // after a reload the request is still there and can be changed
    await page.reload();
    await expect(page.getByTestId('customer-request')).toContainText('After 5 pm, call first');
    await expect(page.getByTestId('reschedule-form')).toHaveCount(0);
    await page.getByTestId('reschedule-change').click();
    await page.getByTestId('reschedule-note').fill('Please come after Maghrib');
    await page.getByTestId('reschedule-submit').click();
    await expect(page.getByTestId('customer-request')).toContainText('Please come after Maghrib');

    // the API has it too
    const order = await apiCall<{ sellerOrders: { delivery: { request: { text: string } | null } }[] }>(token, 'GET', `/orders/${orderNumber}`);
    expect(order.sellerOrders[0].delivery.request?.text).toContain('Please come after Maghrib');
  });

  test('from the guest order link (Arabic), the customer leaves a note for the driver', async ({ page }) => {
    const { email, token } = await freshCustomer();
    const orderNumber = await missedDeliveryOrder(token, 'Customer not at home');
    const access = await apiCall<{ orderNumber: string; token: string }>(null, 'POST', '/orders/guest/lookup', { orderNumber, contact: email });

    await page.goto(`/ar/track?order=${orderNumber}&t=${encodeURIComponent(access.token)}`);
    const card = page.getByTestId('missed-delivery');
    await expect(card).toContainText('تعذّر تسليم طلبك');
    await expect(card).toContainText('لم يكن أحد في المنزل عند وصول السائق.');
    await page.getByTestId('reschedule-note').fill('بعد الساعة 5 مساءً، اتصل أولاً');
    await page.getByTestId('reschedule-submit').click();
    await expect(card.getByTestId('reschedule-done')).toContainText('شكراً لك');
    await expect(page.getByTestId('customer-request')).toContainText('بعد الساعة 5 مساءً، اتصل أولاً');
  });

  test('a refused order says it goes back to the seller, with nothing to rearrange', async ({ page }) => {
    const { email, token } = await freshCustomer();
    const orderNumber = await missedDeliveryOrder(token, 'Did not want the order any more', true);
    const access = await apiCall<{ orderNumber: string; token: string }>(null, 'POST', '/orders/guest/lookup', { orderNumber, contact: email });

    await page.goto(`/en/track?order=${orderNumber}&t=${encodeURIComponent(access.token)}`);
    const card = page.getByTestId('missed-delivery');
    await expect(card).toContainText('The order was refused at the door.');
    await expect(card).toContainText('will be returned to the seller');
    await expect(page.getByTestId('reschedule-form')).toHaveCount(0);
    await expect(page.getByTestId('reschedule-change')).toHaveCount(0);
  });
});
