import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiCall, freshCustomer, totp } from './helpers';

/** A brand-new customer who turned on two-step sign-in with an authenticator app. */
async function customerWithTwoStep() {
  const c = await freshCustomer();
  const { secret } = await apiCall<{ secret: string }>(c.token, 'POST', '/auth/2fa/setup');
  const { recoveryCodes } = await apiCall<{ recoveryCodes: string[] }>(c.token, 'POST', '/auth/2fa/enable', { code: totp(secret) });
  return { ...c, secret, recoveryCodes };
}

async function passwordStep(page: Page, email: string, password: string) {
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('two-factor-form')).toBeVisible();
}

test.describe('Two-step sign-in', () => {
  test('asks for the authenticator code after the password, then signs in as usual', async ({ page }) => {
    const { email, password, secret } = await customerWithTwoStep();
    await page.goto('/en/login?next=%2Fen%2Faccount');
    await passwordStep(page, email, password);

    await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
    const code = page.getByLabel('Enter the 6-digit code from your authenticator app');
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');

    // too short, then a wrong code
    await code.fill('123');
    await page.getByTestId('two-factor-submit').click();
    await expect(page.getByTestId('two-factor-form').getByRole('alert')).toHaveText('Enter the 6-digit code');
    const wrong = totp(secret) === '000000' ? '111111' : '000000';
    await code.fill(wrong);
    await page.getByTestId('two-factor-submit').click();
    await expect(page.getByTestId('two-factor-form').getByRole('alert')).toContainText('That code is not right');
    await expect(page).toHaveURL(/\/en\/login/);

    // recovery code toggle, and back to the password
    await page.getByTestId('two-factor-toggle').click();
    await expect(page.getByLabel('Recovery code')).toBeVisible();
    await page.getByRole('button', { name: 'Use the code from my authenticator app' }).click();
    await expect(code).toBeVisible();
    await page.getByTestId('two-factor-back').click();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveValue('');

    // the right code (the next 30-second step: the one used to turn it on can never be used again)
    await passwordStep(page, email, password);
    await page.getByLabel('Enter the 6-digit code from your authenticator app').fill(totp(secret, Date.now() + 30_000));
    await page.getByTestId('two-factor-submit').click();
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByText('Aisha Tester').first()).toBeVisible();

    // the session survives a reload (refresh cookie set by the second step)
    await page.reload();
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByText('Aisha Tester').first()).toBeVisible();
  });

  test('a recovery code works once; in Arabic the page is right-to-left', async ({ page }) => {
    const { email, password, recoveryCodes } = await customerWithTwoStep();
    await page.goto('/ar/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await passwordStep(page, email, password);
    await expect(page.getByRole('heading', { name: 'التحقق بخطوتين' })).toBeVisible();
    await page.getByRole('button', { name: 'استخدم رمز استرداد بدلاً من ذلك' }).click();
    await page.getByLabel('رمز الاسترداد').fill(recoveryCodes[0].toLowerCase());
    await page.getByTestId('two-factor-submit').click();
    await expect(page).not.toHaveURL(/\/login/);

    // signed out, the same recovery code is refused
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/ar/login');
    await passwordStep(page, email, password);
    await page.getByTestId('two-factor-toggle').click();
    await page.getByTestId('two-factor-code').fill(recoveryCodes[0]);
    await page.getByTestId('two-factor-submit').click();
    await expect(page.getByTestId('two-factor-form').getByRole('alert')).toContainText('الرمز غير صحيح');
  });

  test('after too many wrong codes the account is paused, with the minutes left', async ({ page }) => {
    const { email, password, secret } = await customerWithTwoStep();
    const wrong = totp(secret) === '000000' ? '111111' : '000000';
    await page.goto('/en/login');
    await passwordStep(page, email, password);
    const alert = page.getByTestId('two-factor-form').getByRole('alert');
    for (let i = 0; i < 6; i++) {
      await page.getByTestId('two-factor-code').fill(wrong);
      await page.getByTestId('two-factor-submit').click();
      await expect(alert).toBeVisible();
      if (/paused/.test((await alert.textContent()) ?? '')) break;
      await expect(page.getByTestId('two-factor-submit')).toBeEnabled();
    }
    await expect(alert).toContainText(/Signing in to this account is paused for 1[45] minutes/);
  });
});
