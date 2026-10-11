import { expect, test } from '@playwright/test';
import { ADMIN, API, apiCall, apiToken, placeOrder, run, signIn } from './helpers';

test('an order is prepared, shipped and delivered from the order page; the invoice prints', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const tag = run();
  const cats = await apiCall<{ id: string; slug: string }[]>(t, 'GET', '/admin/categories');
  const p = await apiCall<{ id: string; variants: { id: string }[] }>(t, 'POST', '/admin/products', {
    title: `E2E Order Item ${tag}`, categoryId: cats.find((c) => c.slug === 'home-kitchen')!.id, variants: [{ sku: `E2E-ORD-${tag}`, priceMinor: '4500', initialStock: 5 }],
  });
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'p.png');
  await fetch(`${process.env.API_URL || 'http://localhost:4000/api/v1'}/admin/products/${p.id}/images`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: fd });
  await apiCall(t, 'POST', `/admin/products/${p.id}/status`, { status: 'ACTIVE' });
  const orderNumber = await placeOrder(p.variants[0].id);

  await signIn(page);
  await page.goto('/orders?tab=to_fulfil');
  await page.getByRole('link', { name: orderNumber }).click();
  await expect(page.getByRole('heading', { name: new RegExp(orderNumber) })).toBeVisible();

  for (const [button, status] of [['Start preparing', 'Preparing'], ['Mark as shipped', 'Shipped'], ['Mark as delivered', 'Delivered']] as const) {
    await page.getByRole('button', { name: button }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: button }).click();
    await expect(page.getByRole('main').getByText(status, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  // the invoice is the same PDF the customer downloads
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Invoice' }).click();
  await (await popup).close();
  const pdf = await fetch(`${API}/admin/orders/${orderNumber}/invoice.pdf`, { headers: { authorization: `Bearer ${await apiToken(ADMIN)}` } });
  expect(pdf.headers.get('content-type')).toContain('application/pdf');
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('staff cancel an order that has not shipped; stock comes back', async ({ page }) => {
  const t = await apiToken(ADMIN);
  const inv = await apiCall<{ items: { variantId: string; available: number; status: string }[] }>(t, 'GET', '/admin/inventory?house=true&limit=100');
  const v = inv.items.find((i) => i.status === 'ACTIVE' && i.available > 2)!;
  const orderNumber = await placeOrder(v.variantId);

  await signIn(page);
  await page.goto(`/orders/${orderNumber}`);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('dialog').getByLabel(/Reason/).fill('Customer asked to cancel by phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText(/Order cancelled/)).toBeVisible();
  await expect(page.getByRole('main').getByText('Cancelled', { exact: true }).first()).toBeVisible();
  const after = await apiCall<{ items: { variantId: string; available: number }[] }>(t, 'GET', '/admin/inventory?house=true&limit=100');
  expect(after.items.find((i) => i.variantId === v.variantId)!.available).toBe(v.available);
});
