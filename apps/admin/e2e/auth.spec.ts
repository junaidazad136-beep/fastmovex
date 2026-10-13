import { expect, test } from '@playwright/test';
import { CUSTOMER, DEMO_PASSWORD, signIn } from './helpers';

test('customers cannot sign in to the admin panel', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or phone').fill(CUSTOMER);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('does not have access to the admin panel');
  await expect(page).toHaveURL(/\/login/);
});

test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or phone').fill('admin@demo.fastmovex.test');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Incorrect email/phone or password.');
});

test('staff sign in, land on the dashboard, stay signed in on reload, and sign out', async ({ page, context }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login\?next=%2Forders/);
  await page.getByLabel('Email or phone').fill('admin@demo.fastmovex.test');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  // The refresh token lives in the panel's own httpOnly cookie, never readable by scripts.
  const cookies = await context.cookies('http://localhost:4000/api/v1/auth');
  expect(cookies.find((c) => c.name === 'fmx_admin_rt')?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === 'fmx_rt')).toBeUndefined();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('the dashboard shows sales and what needs attention', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByText('Revenue', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Revenue per/ })).toBeVisible();
});
