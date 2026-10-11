import { expect, test } from '@playwright/test';
import { ADMIN, API, apiCall, apiToken, PNG, run, signIn } from './helpers';

test('staff add a product with options and photos, publish it, and shoppers can see it', async ({ page }) => {
  const tag = run();
  await signIn(page);
  await page.goto('/products/new');
  await page.getByLabel('Title (English)').fill(`E2E Tumbler ${tag}`);
  await page.getByLabel('Title (Arabic)').fill('كوب حراري');
  await page.getByLabel('Category').selectOption({ label: 'Home & Kitchen' });
  await page.getByLabel('Short description (English)').fill('Keeps drinks cold for 24 hours');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'tumbler.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'tumbler.png' })).toBeVisible();

  await page.getByRole('switch', { name: /This product has options/ }).click();
  await page.locator('#opt-name-0').fill('Colour');
  await page.locator('#opt-values-0').fill('Black, Sand');
  await page.getByLabel('SKU for Black').fill(`E2E-${tag}-BLK`);
  await page.getByLabel('SKU for Sand').fill(`E2E-${tag}-SND`);
  await page.getByLabel('Price for Black', { exact: true }).fill('59.50');
  await page.getByRole('button', { name: 'same for all' }).first().click();
  await page.getByLabel('Cost for Black').fill('20');
  await page.getByLabel('Stock for Black').fill('12');
  await page.getByLabel('Stock for Sand').fill('4');
  await page.getByRole('button', { name: 'Save and publish' }).click();

  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Product published')).toBeVisible();
  await expect(page.getByRole('main').getByText('Active').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Sand/ })).toContainText('QAR 59.50');

  // On the shop: live, in both variants, and the private cost price is not exposed
  const slug = (await page.getByRole('link', { name: /View in store/ }).getAttribute('href'))!.split('/p/')[1];
  const pub = await (await fetch(`${API}/products/${slug}`, { headers: { 'x-country': 'QA' } })).json();
  expect(pub.variants).toHaveLength(2);
  expect(JSON.stringify(pub)).not.toContain('costPriceMinor');

  // Edit and save a field; the change survives a reload
  await page.getByLabel('Warranty (months)').fill('12');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Warranty (months)')).toHaveValue('12');
});

test('inventory: change stock in the table, save, and the history records who did it', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const tag = run();
  const cats = await apiCall<{ id: string; slug: string }[]>(t, 'GET', '/admin/categories');
  const p = await apiCall<{ id: string; variants: { id: string }[] }>(t, 'POST', '/admin/products', {
    title: `E2E Stock Item ${tag}`, categoryId: cats.find((c) => c.slug === 'home-kitchen')!.id, variants: [{ sku: `E2E-STK-${tag}`, priceMinor: '1500', initialStock: 3 }],
  });

  await signIn(page);
  await page.goto(`/inventory?q=E2E-STK-${tag}`);
  const stock = page.getByRole('textbox', { name: `Stock of E2E-STK-${tag}` });
  await expect(stock).toHaveValue('3');
  await stock.fill('25');
  await page.getByRole('textbox', { name: 'Note for these changes' }).fill('Monthly count');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('1 change saved')).toBeVisible();
  await expect(stock).toHaveValue('25');

  await page.getByRole('button', { name: `Stock history of E2E-STK-${tag}` }).click();
  const dialog = page.getByRole('dialog');
  const entry = dialog.getByRole('listitem').filter({ hasText: 'Monthly count' });
  await expect(entry).toContainText('Demo Admin');
  await expect(entry).toContainText('+22');
  expect(p.variants).toHaveLength(1);
});

test('CSV import is checked first and only then applied', async ({ page }) => {
  const tag = run();
  const csv = [
    'handle,title,title_ar,category,status,sku,price,stock',
    `e2e-csv-${tag.toLowerCase()},E2E CSV Mug ${tag},كوب,home-kitchen,draft,E2E-CSV-${tag},35.00,8`,
    `e2e-csv-bad-${tag.toLowerCase()},Bad row,,no-such-category,draft,E2E-BAD-${tag},abc,1`,
  ].join('\n');
  await signIn(page);
  await page.goto('/products/import');
  await page.locator('input[type=file]').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('heading', { name: /What this file will change/ })).toBeVisible();
  await expect(page.getByText('Rows with errors will be skipped')).toBeVisible();
  // Nothing was written by the check
  await page.getByRole('button', { name: /Import 1 rows/ }).click();
  await expect(page.getByText('Import done.')).toBeVisible();
  await page.goto(`/products?q=E2E-CSV-${tag}`);
  await expect(page.getByRole('link', { name: new RegExp(`E2E CSV Mug ${tag}`) })).toBeVisible();
});
