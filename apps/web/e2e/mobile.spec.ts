import { expect, test } from './fixtures';
import { freshCustomer, signIn } from './helpers';

test('phone layout: bottom tabs, filter sheet, add to cart', async ({ page }) => {
  await page.goto('/ar');
  const tabs = page.getByRole('navigation', { name: 'القائمة' });
  await expect(tabs).toBeVisible();
  await tabs.getByRole('link', { name: 'الأقسام' }).click();
  await expect(page).toHaveURL(/\/ar\/categories/);
  await page.getByRole('main').getByRole('link', { name: 'إلكترونيات', exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/c\/electronics/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/ar/search');
  await page.getByTestId('open-filters').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByText('المتوفر فقط').click();
  await expect(page).toHaveURL(/inStock=1/);
  // product page: the tab bar steps aside for a price + "Add to cart" bar that stays at the bottom without scrolling
  await page.goto('/ar/p/nova-powercore-20000-power-bank');
  await expect(tabs).toBeHidden();
  const bar = page.getByTestId('sticky-buy');
  await expect(bar).toBeInViewport();
  await expect(page.getByTestId('sticky-price')).toContainText(/\d/);
  await page.getByTestId('sticky-add').click();
  await expect(page.getByTestId('sticky-add')).toContainText('تمت الإضافة');
  // no horizontal scrolling on a phone
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto('/ar');
  await expect(tabs.getByText('1')).toBeVisible();
});

test('account pages fit a phone screen in both languages (the tab strip scrolls, the page does not)', async ({ page }) => {
  const c = await freshCustomer();
  await signIn(page, c.email, c.password);
  for (const path of ['/en/account', '/en/account/orders', '/ar/account', '/ar/account/addresses']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: /My account|حسابي/ }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
