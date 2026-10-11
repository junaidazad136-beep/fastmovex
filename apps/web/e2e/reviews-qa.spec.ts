import { expect, test } from '@playwright/test';
import { API, DEMO_PASSWORD, freshCustomer, signIn } from './helpers';

const PRODUCT = 'premium-khalas-dates-1kg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function call<T>(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}
async function admin() {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }) });
  return ((await r.json()) as { accessToken: string }).accessToken;
}

/** A new customer who bought the dates and received them. */
async function deliveredBuyer() {
  const c = await freshCustomer();
  const product = await (await fetch(`${API}/products/${PRODUCT}`)).json() as { variants: { id: string }[] };
  await call(c.token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
  const addresses = await call<{ id: string }[] | { items: { id: string }[] }>(c.token, 'GET', '/addresses');
  const addressId = (Array.isArray(addresses) ? addresses : addresses.items)[0].id;
  const order = await call<{ orderNumber: string }>(c.token, 'POST', '/checkout', { addressId, paymentMethod: 'COD' }, { 'idempotency-key': `rv-${Date.now()}` });
  const a = await admin();
  const detail = await call<{ sellerOrders: { id: string }[]; items?: { id: string }[] }>(a, 'GET', `/admin/orders/${order.orderNumber}`);
  for (const status of ['PREPARING', 'SHIPPED', 'DELIVERED']) await call(a, 'POST', `/admin/orders/shipments/${detail.sellerOrders[0].id}/status`, { status });
  return { ...c, admin: a };
}

test('a buyer adds photos to a review; once published they lead the reviews and open full size', async ({ page }) => {
  const c = await deliveredBuyer();
  const text = `Fresh, soft dates. Lovely box too. (${Date.now().toString(36)})`;
  await signIn(page, c.email, c.password);
  await page.goto('/en/account/reviews');
  await page.getByTestId('write-review').first().click();
  await page.getByTestId('star-5').first().click();
  await page.getByLabel('Your review').fill(text);
  await page.getByTestId('review-photos-input').setInputFiles([{ name: 'box.png', mimeType: 'image/png', buffer: PNG }, { name: 'dates.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.getByRole('button', { name: /Remove photo/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove photo 2' }).click();
  await page.getByTestId('review-submit').click();
  await expect(page.getByText('Thank you! Your review was sent.')).toBeVisible();
  const mine = page.locator('li', { hasText: text });
  await expect(mine).toContainText('Under review');
  await expect(mine.locator('img')).toHaveCount(1);

  // staff publish it
  const reviews = await call<{ id: string; body: string; images: string[] }[]>(c.token, 'GET', '/me/reviews');
  const review = reviews.find((r) => r.body === text)!;
  expect(review.images[0]).toMatch(/\.webp$/); // cleaned on the server
  await call(c.admin, 'POST', `/admin/reviews/${review.id}/moderate`, { status: 'APPROVED' });

  await page.goto(`/en/p/${PRODUCT}`);
  const photos = page.getByTestId('review-photos');
  await expect(photos).toBeVisible();
  await photos.getByRole('button').first().click();
  await expect(page.getByTestId('photo-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('reviews-with-photos').click();
  await expect(page.locator('#reviews li', { hasText: text })).toBeVisible();
});

test('a customer asks about a product; the answer shows on the product page and in their account', async ({ page }) => {
  await page.goto(`/en/p/${PRODUCT}`);
  await expect(page.getByTestId('ask-signin')).toBeVisible(); // guests sign in first

  const c = await freshCustomer();
  await signIn(page, c.email, c.password);
  await page.goto(`/en/p/${PRODUCT}`);
  const question = `Are these dates from this season? (${Date.now().toString(36)})`;
  await page.getByTestId('ask-open').click();
  await page.getByLabel('Your question').fill('short');
  await page.getByTestId('ask-send').click();
  await expect(page.getByTestId('ask-form').getByRole('alert')).toHaveText('At least 10 characters');
  await page.getByLabel('Your question').fill(question);
  await page.getByTestId('ask-send').click();
  await expect(page.getByTestId('ask-sent')).toBeVisible();
  await expect(page.getByTestId('questions')).not.toContainText(question); // private until answered

  const a = await admin();
  const queue = await call<{ items: { id: string; body: string }[] }>(a, 'GET', '/admin/questions?status=PENDING');
  const q = queue.items.find((x) => x.body === question)!;
  await call(a, 'POST', `/admin/questions/${q.id}/answer`, { answer: 'Yes — packed in September from this year’s harvest.' });

  await page.goto(`/en/p/${PRODUCT}`);
  const shown = page.getByTestId('question').filter({ hasText: question });
  await expect(shown).toContainText('Yes — packed in September');
  await expect(shown).toContainText('Answer from');

  await page.goto('/en/account/reviews');
  await expect(page.getByTestId('my-questions')).toContainText(question);
  await expect(page.getByTestId('my-questions')).toContainText('Answered');
});
