import { expect, test } from '@playwright/test';
import { API, DEMO_PASSWORD, freshCustomer, signIn } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/** A sold-out product made through the admin API, so the test never depends on the demo stock. */
async function soldOutProduct() {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }) });
  const auth = { authorization: `Bearer ${((await login.json()) as { accessToken: string }).accessToken}` };
  const categoryId = ((await (await fetch(`${API}/categories/home-kitchen`)).json()) as { id: string }).id;
  const tag = Date.now().toString(36);
  const res = await fetch(`${API}/admin/products`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `Sold Out Lamp ${tag}`, titleAr: `مصباح ${tag}`, categoryId, variants: [{ sku: `E2E-SO-${tag}`, priceMinor: '9900', initialStock: 0 }] }),
  });
  if (!res.ok) throw new Error(`product: ${res.status} ${await res.text()}`);
  const p = (await res.json()) as { id: string; slug: string; variants: { id: string }[] };
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  await fetch(`${API}/admin/products/${p.id}/images`, { method: 'POST', headers: auth, body: form });
  await fetch(`${API}/admin/products/${p.id}/status`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
  return { ...p, auth };
}

test('a sold-out product offers "Tell me when it is back": guests sign in first, then one tap turns the alert on', async ({ page }) => {
  const p = await soldOutProduct();
  await page.goto(`/en/p/${p.slug}`);
  await expect(page.getByTestId('add-to-cart')).toBeDisabled();
  const notify = page.getByTestId('notify-me');
  await expect(notify).toHaveAttribute('href', new RegExp(`/en/login\\?next=.*${p.slug}`));

  const c = await freshCustomer();
  await signIn(page, c.email, c.password);
  await page.goto(`/en/p/${p.slug}`);
  await page.getByTestId('notify-me').click();
  await expect(page.getByTestId('notify-me-done')).toBeVisible();

  // saved to the wishlist with the back-in-stock alert on
  const lists = (await (await fetch(`${API}/wishlists`, { headers: { authorization: `Bearer ${c.token}` } })).json()) as { id: string }[];
  const items = (await (await fetch(`${API}/wishlists/${lists[0].id}`, { headers: { authorization: `Bearer ${c.token}` } })).json()) as { items?: { productId: string; notifyBackInStock: boolean }[] } | { productId: string; notifyBackInStock: boolean }[];
  const rows = Array.isArray(items) ? items : items.items ?? [];
  expect(rows.find((r) => r.productId === p.id)?.notifyBackInStock).toBe(true);

  // restocking tells the customer (in-app inbox)
  await fetch(`${API}/admin/variants/${p.variants[0].id}/stock`, { method: 'POST', headers: { ...p.auth, 'content-type': 'application/json' }, body: JSON.stringify({ delta: 4, reason: 'RESTOCK' }) });
  await expect.poll(async () => {
    const r = (await (await fetch(`${API}/me/notifications`, { headers: { authorization: `Bearer ${c.token}` } })).json()) as { items?: { type: string }[] } | { type: string }[];
    return (Array.isArray(r) ? r : r.items ?? []).some((n) => n.type === 'BACK_IN_STOCK');
  }, { timeout: 10_000 }).toBe(true);
});
