import { expect, test } from '@playwright/test';
import { API, apiToken, run, signIn, ADMIN } from './helpers';

/** Phase 24: writing for Google — category and brand text, Google & social settings with the feed addresses. */

test('category: the Google (SEO) tab saves text, titles and questions; the preview follows', async ({ page }) => {
  await signIn(page);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Edit Beauty' }).click();
  await page.getByTestId('category-tab-seo').click();
  const ed = page.getByTestId('seo-editor');
  await ed.getByLabel(/^Google title \(English\)/).fill('Beauty & perfume online in Qatar');
  await expect(page.getByTestId('google-preview')).toContainText('Beauty & perfume online in Qatar | FastMoveX');
  await ed.getByLabel(/^Text on the page \(English\)/).fill('Oud, perfumes and skincare from brands you trust.');
  // start from no questions (the test may run again on the same data)
  for (const b of await page.getByTestId('faq-editor').getByRole('button', { name: 'Remove' }).all()) await b.click();
  await page.getByTestId('faq-editor').getByRole('button', { name: 'Add question' }).click();
  await ed.getByLabel('Question 1 (English)').fill('Are the perfumes genuine?');
  await ed.getByLabel('Question 1 (Arabic)').fill('هل العطور أصلية؟');
  await ed.getByLabel('Answer 1 (English)').fill('Yes, straight from the brands.');
  await ed.getByLabel('Answer 1 (Arabic)').fill('نعم، مباشرة من العلامات.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Category saved')).toBeVisible();
  const t = await apiToken(ADMIN);
  const cat = await (await fetch(`${API}/categories/beauty`, { headers: { authorization: `Bearer ${t}` } })).json();
  expect(cat).toMatchObject({ seoTitle: 'Beauty & perfume online in Qatar', faq: [{ q: 'Are the perfumes genuine?', aAr: 'نعم، مباشرة من العلامات.' }] });
});

test('brand: Arabic name and Google text; the list shows which brands still miss it', async ({ page }) => {
  await signIn(page);
  await page.goto('/brands');
  const name = `E2E Brand ${run()}`;
  await page.getByRole('button', { name: 'Add brand' }).click();
  await page.getByRole('dialog').getByLabel(/^Name/).first().fill(name);
  await page.getByRole('dialog').getByLabel('Name in Arabic').fill('ماركة تجربة');
  await page.getByTestId('seo-editor').getByLabel(/^Text on the page \(English\)/).fill('A test brand for the browser tests.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Brand added')).toBeVisible();
  await page.getByPlaceholder('Search brands').fill(name);
  const row = page.getByTestId('brand-row').filter({ hasText: name });
  await expect(row).toContainText('ماركة تجربة');
  await expect(row).toContainText('Written');
});

test('Google & social: verification code and social pages saved; the feed addresses are listed', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  const card = page.getByTestId('seo-settings');
  await card.getByLabel('Google Search Console code').fill('<meta name="google-site-verification" content="adm-e2e-123456" />');
  await card.getByLabel('Instagram').fill('https://www.instagram.com/fastmovex.qa');
  await card.getByLabel('TikTok').fill('not a link');
  await card.getByTestId('seo-save').click();
  await expect(page.getByText(/tiktok: enter the full https/i)).toBeVisible();
  await card.getByLabel('TikTok').fill('https://www.tiktok.com/@fastmovex.qa');
  await card.getByTestId('seo-save').click();
  await expect(page.getByText('Search engine settings saved')).toBeVisible();
  await expect(card.getByLabel('Google Search Console code')).toHaveValue('adm-e2e-123456');
  await expect(page.getByTestId('seo-links')).toContainText('/feeds/google-en.xml');
  await expect(page.getByTestId('seo-links')).toContainText('/sitemap.xml');
});
