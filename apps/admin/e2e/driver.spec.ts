import { devices, expect, test } from '@playwright/test';
import { DEMO_PASSWORD, fleetOrder, signIn } from './helpers';

const COURIER = 'courier@demo.jovia.test';

test('staff give a job to a driver; on the phone the driver picks it up, delivers it with the customer’s code', async ({ browser }) => {
  const { orderNumber, code: customerCode } = await fleetOrder();

  // staff: assign on the Deliveries page
  const staff = await browser.newPage();
  await signIn(staff);
  const row = staff.getByTestId('delivery-row').filter({ hasText: orderNumber });
  await expect(async () => {
    await staff.goto('/deliveries?view=assign');
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await row.getByRole('combobox').selectOption({ label: 'Khalid Courier' });
  await row.getByTestId('assign-driver').click();
  await expect(staff.getByText('Driver assigned — it is on their phone now')).toBeVisible();
  const code = await customerCode(); // what the customer reads in their order / SMS — staff never see it

  // driver: phone
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await phone.newPage();
  await signIn(page, COURIER, DEMO_PASSWORD).catch(() => undefined); // the driver lands on /driver, not the dashboard
  await expect(page).toHaveURL(/\/driver$/);
  const job = page.getByTestId('driver-job').filter({ hasText: orderNumber });
  await expect(job).toContainText('Noora Driver-Test');
  await expect(job.getByTestId('job-cash')).toContainText('Collect cash QAR');
  await expect(job.getByTestId('job-map')).toHaveAttribute('href', /google\.com\/maps\/search\/.*Zone%2066/);
  await job.getByTestId('job-pickup').click();
  await job.getByTestId('job-start').click();
  await job.getByTestId('job-deliver').click();
  await page.getByTestId('deliver-code').fill(code === '0000' ? '1111' : '0000');
  await page.getByTestId('deliver-submit').click();
  await expect(page.locator('#deliver-form').getByRole('alert')).toContainText('not right');
  await page.getByTestId('deliver-code').fill(code);
  await page.getByTestId('deliver-submit').click();
  await expect(page.locator('#deliver-form')).toHaveCount(0); // dialog closed
  await expect(job).toContainText(/Delivered \d\d:\d\d/); // "Delivered 15:31"
  await expect(job.getByTestId('job-deliver')).toHaveCount(0);
  await expect(page.getByTestId('driver-summary')).toBeVisible();
  // the cash taken is on the driver's name until the cashier receives it; the run prints as a PDF
  await expect(page.getByTestId('driver-cash')).toContainText('Cash with me');
  await expect(page.getByTestId('driver-run-sheet')).toBeVisible();

  // staff screens stay closed to the driver
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/driver$/);
  await phone.close();
});
