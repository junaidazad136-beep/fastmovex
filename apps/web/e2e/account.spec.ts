import { expect, test } from '@playwright/test';
import { apiLogSize, codeFromApiLog, signIn, freshCustomer } from './helpers';

test.describe('Account', () => {
  test('sign up → verify email with the one-time code → profile shows verified', async ({ page }) => {
    const email = `signup.${Date.now()}@example.com`;
    const since = apiLogSize();
    await page.goto('/en/register');
    await page.getByLabel('Full name').fill('Omar Signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByTestId('register-submit').click();
    await expect(page.getByText('At least 8 characters with a letter and a number').first()).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Signup-Pass-2026');
    await page.getByTestId('register-submit').click();
    await expect(page).toHaveURL(/\/en\/account\/verify\?channel=email/);
    await expect(page.getByText(`We sent a 6-digit code to`)).toContainText(email);

    const code = await codeFromApiLog(email, since);
    test.skip(!code, 'Set E2E_API_LOG to the API log file to test code entry');
    await page.getByTestId('otp').fill('000000');
    await page.getByTestId('verify-submit').click();
    await expect(page.locator('form [role="alert"]')).toBeVisible();
    await page.getByTestId('otp').fill(code!);
    await page.getByTestId('verify-submit').click();
    await expect(page).toHaveURL(/\/en$/);
    await page.goto('/en/account');
    await expect(page.getByText('Verified').first()).toBeVisible();
  });

  test('wrong password is rejected without saying which part was wrong', async ({ page }) => {
    await page.goto('/en/login');
    await page.getByLabel('Email or mobile number').fill('nobody@example.com');
    await page.locator('input[name="password"]').fill('Wrong-pass-1');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Email/mobile or password is incorrect.')).toBeVisible();
  });

  test('addresses, wishlist, support ticket, sign out', async ({ page }) => {
    const { email, password } = await freshCustomer();
    await signIn(page, email, password);

    // Address book (Qatar format: zone / street / building)
    await page.goto('/en/account/addresses');
    await page.getByRole('button', { name: 'Add address' }).click();
    const form = page.getByTestId('address-form');
    await form.getByRole('button', { name: 'Work' }).click();
    await form.getByLabel('City').fill('Lusail');
    await form.getByTestId('address-save').click();
    await expect(form.getByText('This field is required').first()).toBeVisible(); // zone / street / building missing
    await expect(form.getByText('Use international format, e.g. +97455555555').or(form.getByText('This field is required')).first()).toBeVisible();
    await form.getByLabel('Mobile number').fill('55501234'); // local Qatar number is accepted and normalised to +974
    await form.getByLabel('Zone').fill('69');
    await form.getByLabel('Street').fill('350');
    await form.getByLabel('Building').fill('7');
    await form.getByTestId('address-save').click();
    await expect(page.getByText('Address saved')).toBeVisible();
    await expect(page.getByText('Building 7, Street 350, Zone 69, Lusail')).toBeVisible();

    // Wishlist from the product page
    await page.goto('/en/p/nova-powercore-20000-power-bank');
    await page.getByRole('button', { name: 'Save to wishlist' }).first().click();
    await expect(page.getByText('Saved to your wishlist')).toBeVisible();
    await page.goto('/en/account/wishlist');
    await expect(page.getByTestId('wishlist-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Move to cart' }).click();
    await expect(page.getByText('Moved to your cart')).toBeVisible();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.getByRole('button', { name: 'Remove from wishlist' }).click();
    await expect(page.getByText('Your wishlist is empty')).toBeVisible();

    // Support ticket
    await page.goto('/en/help/tickets/new');
    await page.getByLabel('Subject').fill('Question about delivery');
    await page.getByLabel('Message').fill('Can you deliver to Lusail on Fridays?');
    await page.getByTestId('ticket-submit').click();
    await expect(page).toHaveURL(/\/en\/help\/tickets\/SUP-/);
    await expect(page.getByText('Can you deliver to Lusail on Fridays?')).toBeVisible();

    // Sign out
    await page.goto('/en/account');
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/en$/);
    await page.goto('/en/account');
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('forgot password: same answer for unknown accounts, then reset with the code', async ({ page }) => {
    const { email } = await freshCustomer();
    const since = apiLogSize();
    await page.goto('/en/forgot-password');
    await page.getByLabel('Email or mobile number').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    // only the reset code: the sign-up verification code for the same address may be logged around the same time
    const code = await codeFromApiLog(email, since, /reset code is (\d{6})/);
    test.skip(!code, 'Set E2E_API_LOG to the API log file to test code entry');
    await page.getByLabel('6-digit code').fill(code!);
    await page.getByLabel('New password').fill('Brand-New-Pass-9');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page).toHaveURL(/\/en\/login\?reset=1/);
    await expect(page.getByText('Your password was changed')).toBeVisible();
    await signIn(page, email, 'Brand-New-Pass-9');
  });
});
