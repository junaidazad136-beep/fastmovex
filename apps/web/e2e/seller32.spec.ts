import { expect, test } from './fixtures';
import { apiCall, freshCustomer, returnRequest, signIn } from './helpers';

const SELLER = 'seller.gadgets@demo.fastmovex.test';

/** Phase 32: the Seller Center pages for returns, customer questions, reviews, coupons and the sales report. */
test.describe('Seller Center pages (phase 32)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a return: the home shows it, the seller approves it and takes it back as sellable', async ({ page }) => {
    const { orderNumber } = await returnRequest();
    await signIn(page, SELLER);
    await page.goto('/en/seller');
    await expect(page.getByTestId('seller-todo')).toContainText(/return/);
    await page.getByRole('link', { name: /^Returns/ }).first().click();
    const card = page.getByTestId('seller-return').filter({ hasText: orderNumber });
    await expect(card).toContainText('Stopped charging after a day');
    await card.getByTestId('return-approve').click();
    await expect(page.getByText('Return approved')).toBeVisible();
    await page.getByTestId('tab-APPROVED').click();
    const back = page.getByTestId('seller-return').filter({ hasText: orderNumber });
    await back.getByTestId('return-received').click();
    await page.getByRole('dialog').getByText('Good, can be sold again').click();
    await page.getByTestId('return-received-send').click();
    await expect(page.getByText('Saved. Thank you!')).toBeVisible();
    await page.getByTestId('tab-ALL').click();
    await expect(page.getByTestId('seller-return').filter({ hasText: orderNumber })).toContainText(/Refunded|Received/);
  });

  test('a customer question is answered from the Seller Center', async ({ page }) => {
    const { token } = await freshCustomer();
    const body = `Is a cable in the box? ${Math.random().toString(36).slice(2, 7)}`;
    await apiCall(token, 'POST', '/products/nova-powercore-20000-power-bank/questions', { body });
    await signIn(page, SELLER);
    await page.goto('/en/seller/questions');
    const card = page.getByTestId('seller-question').filter({ hasText: body });
    await card.getByLabel('Your answer').fill('Yes, a USB-C cable is in the box.');
    await card.getByTestId('question-answer').click();
    await expect(page.getByText('Answer published')).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByTestId('tab-ANSWERED').click();
    await expect(page.getByTestId('seller-question').filter({ hasText: body })).toContainText('a USB-C cable is in the box');
  });

  test('a coupon is made and turned off; reviews and the sales report open', async ({ page }) => {
    const code = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await signIn(page, SELLER);
    await page.goto('/en/seller/coupons');
    await page.getByTestId('coupon-new').click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Code').fill(code);
    await d.getByLabel('Percent (1–90)').fill('15');
    await d.getByTestId('coupon-save').click();
    const card = page.getByTestId('seller-coupon').filter({ hasText: code });
    await expect(card).toContainText('15% off');
    await expect(card).toContainText('Active');
    await card.getByTestId('coupon-toggle').click();
    await expect(card).toContainText('Off');

    await page.goto('/en/seller/reports');
    await expect(page.getByTestId('report-tiles')).toContainText('You earn');
    await page.getByTestId('tab-12m').click();
    await expect(page.getByTestId('report-top')).toContainText('Nova');

    await page.goto('/en/seller/reviews');
    await expect(page.getByRole('heading', { name: 'Customer reviews' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('in Arabic', async ({ page }) => {
    await signIn(page, SELLER, undefined, 'ar');
    await page.goto('/ar/seller/returns');
    await expect(page.getByRole('heading', { name: 'المرتجعات' })).toBeVisible();
    await page.goto('/ar/seller/reports');
    await expect(page.getByTestId('report-tiles')).toContainText('أرباحك');
  });

  test('bulk upload: the file is checked line by line, then saved as drafts', async ({ page }) => {
    const run = Math.random().toString(36).slice(2, 7);
    const csv = ['handle,title,category,sku,option1_name,option1_value,price,stock',
      `e2e-cap-${run},E2E Cap ${run},fashion,CAP-R-${run},Colour,Red,39.00,5`,
      `e2e-cap-${run},,,CAP-B-${run},Colour,Blue,39.00,4`,
      `e2e-bad-${run},E2E Bad ${run},no-such-category,BAD-${run},,,10.00,1`].join('\n');
    await signIn(page, SELLER);
    await page.goto('/en/seller/products');
    await page.getByTestId('bulk-link').click();
    await expect(page.getByRole('heading', { name: 'Bulk upload (spreadsheet)' })).toBeVisible();
    await page.getByTestId('bulk-file').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByTestId('bulk-check').click();
    const report = page.getByTestId('bulk-report');
    await expect(report).toContainText('Check result');
    await expect(page.getByTestId('bulk-errors')).toContainText('Line 4');
    await expect(page.getByTestId('bulk-errors')).toContainText('category "no-such-category" not found');
    await page.getByTestId('bulk-save').click();
    await expect(report).toContainText('Saved');
    await page.getByRole('link', { name: 'Go to my products' }).click();
    await expect(page.getByTestId('seller-products')).toContainText(`E2E Cap ${run}`);
  });
});
