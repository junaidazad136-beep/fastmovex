import { expect, test } from '@playwright/test';
import { API, apiCall, signIn } from './helpers';

const PRODUCT = 'premium-khalas-dates-1kg';

async function newCustomer() {
  const email = `qa.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ fullName: 'Hessa Al-Thani', email, password: 'E2e-Pass-2026', countryCode: 'QA', locale: 'ar' }) });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test('staff answer a product question; it is published and leaves the queue', async ({ page }) => {
  const customer = await newCustomer();
  const question = `هل التمر طازج؟ ${Date.now().toString(36)}`;
  await apiCall(customer, 'POST', `/products/${PRODUCT}/questions`, { body: question });
  const spam = `Buy cheap followers at my site ${Date.now().toString(36)}`;
  await apiCall(customer, 'POST', `/products/${PRODUCT}/questions`, { body: spam });

  await signIn(page);
  await page.goto('/questions');
  const row = page.getByTestId('question-row').filter({ hasText: question });
  await expect(row).toContainText('Hessa A.');
  await expect(row).toContainText('Arabic');
  await row.getByTestId('answer-input').fill('نعم، من حصاد هذا الموسم.');
  await row.getByTestId('publish-answer').click();
  await expect(page.getByText('Answer published — the customer has been told.')).toBeVisible();
  await expect(row).toHaveCount(0);

  const other = page.getByTestId('question-row').filter({ hasText: spam });
  await other.getByTestId('reject-question').click();
  await expect(other).toHaveCount(0);

  await page.getByRole('tab', { name: 'Answered' }).click();
  await expect(page.getByTestId('question-row').filter({ hasText: question })).toContainText('نعم، من حصاد هذا الموسم.');

  const pub = (await (await fetch(`${API}/products/${PRODUCT}/questions`)).json()) as { items: { question: string; answer: string }[] };
  expect(pub.items.find((q) => q.question === question)?.answer).toBe('نعم، من حصاد هذا الموسم.');
  expect(pub.items.some((q) => q.question === spam)).toBe(false);
  const mine = await apiCall<{ question: string; status: string }[]>(customer, 'GET', '/me/questions');
  expect(mine.find((q) => q.question === spam)?.status).toBe('REJECTED');
});
