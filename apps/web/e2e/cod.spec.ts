import { expect, test } from './fixtures';
import { API, DEMO_PASSWORD, freshCustomer, signIn } from './helpers';

/** Phase 18: the customer's delivery code and the driver on the map; cash-on-delivery limits at checkout. */
const PRODUCT = 'premium-khalas-dates-1kg';

async function call<T>(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}
const login = async (identifier: string) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier, password: DEMO_PASSWORD }) });
  return ((await r.json()) as { accessToken: string }).accessToken;
};

test('the customer sees the code to give the driver, and where the driver is while on the way', async ({ page }) => {
  const c = await freshCustomer();
  const product = await (await fetch(`${API}/products/${PRODUCT}`)).json() as { variants: { id: string }[] };
  await call(c.token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
  const addresses = await call<{ id: string }[]>(c.token, 'GET', '/addresses');
  const order = await call<{ orderNumber: string }>(c.token, 'POST', '/checkout', { addressId: addresses[0].id, paymentMethod: 'COD' }, { 'idempotency-key': `code-${Date.now()}` });

  const admin = await login('admin@demo.jovia.test');
  const courier = await login('courier@demo.jovia.test');
  const detail = await call<{ sellerOrders: { id: string }[] }>(admin, 'GET', `/admin/orders/${order.orderNumber}`);
  for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await call(admin, 'POST', `/admin/orders/shipments/${detail.sellerOrders[0].id}/status`, { status });
  let job: { id: string } | undefined;
  for (let i = 0; i < 30 && !job; i++) {
    job = (await call<{ id: string; sellerOrder: { order: { orderNumber: string } } }[]>(admin, 'GET', '/admin/deliveries?unassigned=true')).find((d) => d.sellerOrder.order.orderNumber === order.orderNumber);
    if (!job) await new Promise((r) => setTimeout(r, 200));
  }
  const me = (await call<{ user: { id: string } }>(courier, 'GET', '/courier/cash')).user.id;
  await call(admin, 'POST', `/admin/deliveries/${job!.id}/assign`, { courierUserId: me });

  await signIn(page, c.email, c.password);
  await page.goto(`/en/account/orders/${order.orderNumber}`);
  const box = page.getByTestId('delivery-code');
  await expect(box).toBeVisible();
  await expect(box).toContainText('Give this code to the FastMoveX driver only when you have your order in hand');
  const code = (await page.getByTestId('delivery-code-value').textContent())!.trim();
  expect(code).toMatch(/^\d{4}$/);
  await expect(page.getByTestId('driver-location')).toHaveCount(0);

  await call(courier, 'POST', `/courier/jobs/${job!.id}/pickup`);
  await call(courier, 'POST', `/courier/jobs/${job!.id}/out-for-delivery`);
  await call(courier, 'POST', `/courier/jobs/${job!.id}/location`, { lat: 25.2854, lng: 51.531 });
  await page.reload();
  await expect(page.getByTestId('driver-location')).toContainText('Khalid is on the way');
  await expect(page.getByTestId('driver-location').getByRole('link', { name: 'See on map' })).toHaveAttribute('href', /25\.2854,51\.531/);

  // the driver uses the code; afterwards it is gone from the page
  const form = new FormData();
  form.set('code', code);
  const delivered = await fetch(`${API}/courier/jobs/${job!.id}/deliver`, { method: 'POST', headers: { authorization: `Bearer ${courier}` }, body: form });
  expect(delivered.status).toBe(200);
  await page.reload();
  await expect(page.getByTestId('delivery-code')).toHaveCount(0);

  // Arabic
  await page.goto(`/ar/account/orders/${order.orderNumber}`);
  await expect(page.getByText('تم التوصيل').first()).toBeVisible();
});

test('cash on delivery is offered only up to the market limit', async ({ page }) => {
  const admin = await login('admin@demo.jovia.test');
  const before = (await call<{ code: string; codRules: Record<string, unknown> }[]>(admin, 'GET', '/admin/countries')).find((c) => c.code === 'QA')!.codRules;
  await call(admin, 'PATCH', '/admin/countries/QA', { codRules: { maxOrderMinor: '5000' } }); // QAR 50
  try {
    const c = await freshCustomer();
    const product = await (await fetch(`${API}/products/${PRODUCT}`)).json() as { variants: { id: string }[] };
    await call(c.token, 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 }); // QAR 75 with delivery
    await signIn(page, c.email, c.password);
    await page.goto('/en/checkout');
    await expect(page.getByTestId('pay-COD')).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByText('Cash on delivery is available for orders up to QAR 50.00. Please pay by card.')).toBeVisible();
    await expect(page.getByTestId('pay-CARD')).toBeChecked();
  } finally {
    await call(admin, 'PATCH', '/admin/countries/QA', { codRules: { maxOrderMinor: (before.maxOrderMinor as string | null) ?? null } });
  }
});
