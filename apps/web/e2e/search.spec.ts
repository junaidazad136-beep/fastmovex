import { expect, test } from './fixtures';
import { API, DEMO_PASSWORD } from './helpers';

async function adminToken() {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }) });
  return ((await r.json()) as { accessToken: string }).accessToken;
}
async function searchSettings(value?: Record<string, unknown>) {
  const auth = { authorization: `Bearer ${await adminToken()}` };
  const countries = (await (await fetch(`${API}/admin/countries`, { headers: auth })).json()) as { code: string; searchSettings: Record<string, unknown> }[];
  const before = countries.find((c) => c.code === 'QA')!.searchSettings ?? {};
  if (value) await fetch(`${API}/admin/countries/QA`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ searchSettings: value }) });
  return before;
}

test.describe.serial('Search help', () => {
  let saved: Record<string, unknown> = {};
  test.beforeAll(async () => { saved = await searchSettings({ pinned: ['Khalas dates'] }); });
  test.afterAll(async () => { await searchSettings(saved); });

  test('a typo shows results for the right word, with a way back to what was typed', async ({ page }) => {
    await page.goto('/en/search?q=khalas+dattes');
    await expect(page.getByTestId('spelling-auto')).toContainText('Showing results for khalas dates.');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results for “khalas dates”');
    await expect(page.locator('a[href*="/en/p/premium-khalas-dates-1kg"]').first()).toBeVisible();
    await page.getByTestId('spelling-exact').click();
    await expect(page).toHaveURL(/q=khalas\+dattes.*exact=1|exact=1.*q=khalas\+dattes/);
    await expect(page.getByTestId('spelling-suggest')).toContainText('Did you mean khalas dates?');
  });

  test('Arabic: letter forms and the article do not matter', async ({ page }) => {
    await page.goto(`/ar/search?q=${encodeURIComponent('التمر الخلاص')}`);
    await expect(page.locator('a[href*="/ar/p/premium-khalas-dates-1kg"]').first()).toBeVisible();
  });

  test('nothing found: popular searches and best sellers instead of a dead end', async ({ page }) => {
    await page.goto('/en/search?q=qqxxzzvvnothing');
    const help = page.getByTestId('no-results');
    await expect(help).toContainText('No products found');
    await expect(help.getByTestId('no-results-popular').first()).toHaveText('Khalas dates');
    await expect(help.getByRole('heading', { name: 'Best sellers' })).toBeVisible();
    await help.getByTestId('no-results-popular').first().click();
    await expect(page).toHaveURL(/\/en\/search\?q=Khalas\+dates/);
  });

  test('the empty search box offers popular and recent searches', async ({ page }) => {
    await page.goto('/en');
    const box = page.getByRole('combobox').first();
    await box.click();
    await expect(page.getByTestId('search-option-popular').first()).toHaveText('Khalas dates');
    await box.fill('dates');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=dates/);
    await page.goto('/en');
    await page.getByRole('combobox').first().click();
    await expect(page.getByTestId('search-option-recent').first()).toHaveText('dates');
    await page.getByTestId('search-clear-recent').click();
    await expect(page.getByTestId('search-option-recent')).toHaveCount(0);
  });
});
