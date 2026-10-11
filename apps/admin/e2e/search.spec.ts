import { expect, test } from '@playwright/test';
import { ADMIN, API, apiCall, apiToken, signIn } from './helpers';

let saved: unknown = {};
const word = `jawwal${Date.now().toString(36).replace(/[0-9]/g, '')}`;

test.beforeAll(async () => {
  const qa = (await apiCall<{ code: string; searchSettings: unknown }[]>(await apiToken(ADMIN), 'GET', '/admin/countries')).find((c) => c.code === 'QA')!;
  saved = qa.searchSettings ?? {};
});
test.afterAll(async () => {
  await apiCall(await apiToken(ADMIN), 'PATCH', '/admin/countries/QA', { searchSettings: saved });
});

test('staff see what customers did not find and fix it with a synonym', async ({ page }) => {
  // a customer searches a word the catalogue does not use
  // (three times: the list is ordered by how often, and earlier test runs leave many one-off words)
  for (let i = 0; i < 3; i++) await fetch(`${API}/search/log`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-country': 'QA' }, body: JSON.stringify({ q: word, total: 0 }) });

  await signIn(page);
  await page.goto('/search-insights?tab=zero&days=7');
  await expect(page.getByTestId('search-stats')).toContainText('Found nothing');
  const row = page.getByTestId('search-row').filter({ hasText: word });
  await expect(row).toBeVisible();
  await row.getByTestId('add-synonym').click();
  await page.getByLabel('Same meaning as').fill('dates');
  await page.getByTestId('save-synonym').click();
  await expect(page.getByText(`Searching “${word}” now also finds “dates”.`)).toBeVisible();
  await expect(page.getByTestId('search-settings').getByLabel('Synonyms')).toHaveValue(new RegExp(`${word}, dates`));

  // the shop finds the dates for that word now
  const res = (await (await fetch(`${API}/search?q=${word}`, { headers: { 'x-country': 'QA' } })).json()) as { items: { slug: string }[] };
  expect(res.items.map((i) => i.slug)).toContain('premium-khalas-dates-1kg');

  // hiding a search from the popular list
  await row.getByTestId('toggle-hidden').click();
  await expect(row).toContainText('Hidden');
});
