import { expect, test } from './fixtures';
import { API, DEMO_PASSWORD, freshCustomer, signIn } from './helpers';

const SELLER = 'seller.gadgets@demo.fastmovex.test';

/** A signed-in customer buys one of Doha Gadgets Hub's products, cash on delivery. Returns the order number. */
async function orderFromGadgets(): Promise<string> {
  const c = await freshCustomer();
  const h = { 'content-type': 'application/json', authorization: `Bearer ${c.token}` };
  const s = await (await fetch(`${API}/stores/doha-gadgets-hub`)).json() as { slug: string };
  expect(s.slug).toBe('doha-gadgets-hub');
  const search = await (await fetch(`${API}/search?store=doha-gadgets-hub&limit=20`)).json() as { items: { slug: string; inStock: boolean }[] };
  const slug = search.items.find((i) => i.inStock)!.slug;
  const p = await (await fetch(`${API}/products/${slug}`)).json() as { variants: { id: string; inStock: boolean }[] };
  const v = p.variants.find((x) => x.inStock)!.id;
  expect((await fetch(`${API}/cart/items`, { method: 'POST', headers: h, body: JSON.stringify({ variantId: v, quantity: 1 }) })).status).toBe(201);
  const addr = await (await fetch(`${API}/addresses`, { headers: h })).json() as { id: string }[] | { items: { id: string }[] };
  const addressId = (Array.isArray(addr) ? addr : addr.items)[0].id;
  const o = await (await fetch(`${API}/checkout`, { method: 'POST', headers: { ...h, 'idempotency-key': `s26-${Date.now()}` }, body: JSON.stringify({ addressId, paymentMethod: 'COD' }) })).json() as { orderNumber: string };
  expect(o.orderNumber).toMatch(/^FMX-/);
  return o.orderNumber;
}

test.describe('Seller Center (phase 26)', () => {
  test('a seller sees the new order, prints its label + packing list, packs it and hands it to the FastMoveX driver', async ({ page }) => {
    const orderNumber = await orderFromGadgets();
    await signIn(page, SELLER, DEMO_PASSWORD);
    await page.goto('/en/seller');
    await expect(page.getByTestId('seller-dashboard')).toBeVisible();
    await expect(page.getByTestId('tile-new')).toContainText(/[1-9]/);

    await page.goto('/en/seller/orders?tab=new');
    const row = page.getByTestId('seller-order-row').filter({ hasText: orderNumber });
    await expect(row).toBeVisible();
    await row.getByRole('link').click();
    await expect(page.getByTestId('seller-order')).toContainText(orderNumber);
    await expect(page.getByTestId('order-cash')).toContainText('cash');

    // one click: the label + packing list open in a new tab, ready to print
    const [tab] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('print-label').click()]);
    await expect.poll(() => tab.url(), { timeout: 15_000 }).toMatch(/^blob:/);
    await tab.close();

    await page.getByTestId('step-start').click();
    await expect(page.getByTestId('order-status')).toHaveText('Preparing');
    await page.getByTestId('step-ready').click();
    await expect(page.getByTestId('order-status')).toHaveText('Ready for pickup');
    await expect(page.getByTestId('seller-order')).toContainText('A FastMoveX driver will come to pick it up.');
    await expect(page.getByTestId('step-ready')).toHaveCount(0);
  });

  test('a shopper opens a seller account from "Sell on FastMoveX" and lands on the application steps', async ({ page }) => {
    const c = await freshCustomer();
    await signIn(page, c.email, c.password);
    await page.goto('/en');
    await page.getByTestId('footer-sell').click();
    await expect(page.getByTestId('become-seller')).toBeVisible();
    await page.getByLabel('Business name (as on your CR)').fill('E2E Trading WLL');
    await page.getByLabel('Store name customers see').fill(`E2E Shop ${Date.now() % 100000}`);
    await page.getByLabel('Business phone').fill('+97455501234');
    await expect(page.getByTestId('become-seller-submit')).toBeDisabled(); // the seller policy must be accepted first
    await page.getByTestId('seller-agree').check();
    await page.getByTestId('become-seller-submit').click();
    await expect(page.getByTestId('seller-onboarding')).toBeVisible();
    await expect(page.getByTestId('seller-status')).toContainText('Finish the steps below');
    await expect(page.getByTestId('seller-submit')).toBeDisabled(); // CR, its document and the bank account are still missing
  });

  test('signed out, "Sell on FastMoveX" shows the pitch and the whole seller policy before sign-in', async ({ page }) => {
    await page.goto('/en');
    await page.getByTestId('footer-sell').click();
    await expect(page.getByTestId('become-seller')).toBeVisible();
    await expect(page.getByTestId('seller-policy-summary')).toContainText('Commission of 5–15%');
    await page.getByTestId('seller-policy-full').locator('summary').click();
    await expect(page.getByTestId('policy-payouts')).toContainText('within 14 days of delivery');
    await expect(page.getByTestId('policy-data')).toContainText('Law (No. 13 of 2016)');
    await expect(page.getByTestId('become-seller-signin')).toHaveAttribute('href', /\/en\/login\?next=%2Fen%2Fseller/);
  });

  test('a seller adds a product with a photo and sends it for review; price and stock are changed on the spot', async ({ page }) => {
    await signIn(page, SELLER, DEMO_PASSWORD);
    await page.goto('/en/seller/products');
    await page.getByTestId('add-product').click();
    await expect(page.getByTestId('new-product')).toBeVisible();
    const title = `E2E Phone Stand ${Date.now() % 100000}`;
    await page.getByLabel('Product name (English)').fill(title);
    await page.getByLabel('Category').selectOption({ index: 1 });
    await page.getByLabel('Price (QAR)').fill('35');
    await page.getByLabel('How many do you have?').fill('7');
    await expect(page.getByLabel('Your item code (SKU)')).toHaveValue(/^E2E-PHONE-[A-Z0-9]{4}$/);
    await page.getByTestId('create-product').click();

    await expect(page.getByTestId('edit-product')).toBeVisible();
    await expect(page.getByTestId('product-status')).toHaveText('Draft');
    await expect(page.getByTestId('send-review')).toBeDisabled(); // a photo first
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('add-photo-input').setInputFiles({ name: 'stand.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('button', { name: 'Remove photo' })).toHaveCount(1);

    await expect(page.getByTestId('stock-now')).toHaveText('In stock now: 7');
    await page.getByLabel('Quantity').fill('3');
    await page.getByTestId('stock-add').click();
    await expect(page.getByTestId('stock-now')).toHaveText('In stock now: 10');

    // the brand (shown above the name) and the grey line under the name are the seller's to write
    await page.getByLabel('Short line under the name (English)').fill('Aluminium, folds flat, fits 4–7" phones');
    await page.getByLabel('Brand').selectOption({ label: 'Nova' });
    await page.getByTestId('save-product').click();
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Short line under the name (English)')).toHaveValue('Aluminium, folds flat, fits 4–7" phones');
    await expect(page.getByLabel('Brand')).toHaveValue(/[0-9a-f-]{36}/);

    await page.getByTestId('send-review').click();
    await expect(page.getByTestId('product-status')).toHaveText('In review');
    await page.goto('/en/seller/products');
    await expect(page.getByTestId('seller-product-row').filter({ hasText: title })).toContainText('In review');
  });

  test('Arabic: Seller Center reads right to left', async ({ page }) => {
    await signIn(page, SELLER, DEMO_PASSWORD, 'ar');
    await page.goto('/ar/seller');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('seller-dashboard')).toContainText('طلبات جديدة');
  });
});
