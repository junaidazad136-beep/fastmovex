import { expect, test } from './fixtures';
import { API, DEMO_PASSWORD, confirmGuestPhone, freshMobile } from './helpers';

// a normal phone browser: the API does not count headless/bot user agents
test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });

test('a visit from an Instagram campaign is followed to its order and shows in the staff report', async ({ page }) => {
  const source = `e2e-${Date.now().toString(36)}`;
  await page.goto(`/en/p/premium-khalas-dates-1kg?utm_source=${source}&utm_medium=social&utm_campaign=eid`);
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('cart-count').first()).toHaveText('1');
  await page.goto('/en'); // moving on: the source stays with the visit
  await page.goto('/en/checkout');
  await page.getByLabel('Full name', { exact: true }).fill('Analytics Guest');
  const mobile = freshMobile();
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
  await page.getByLabel('Email', { exact: true }).fill(`an.e2e.${Date.now()}@example.com`);
  await page.getByLabel('Zone').fill('66');
  await page.getByLabel('Street').fill('901');
  await page.getByLabel('Building').fill('12');
  await page.getByTestId('pay-COD').check();
  await confirmGuestPhone(page, mobile); // cash on delivery: the mobile is confirmed by a texted code
  await page.getByTestId('place-order').click();
  await expect(page).toHaveURL(/\/en\/track\?order=/, { timeout: 20_000 });

  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }) });
  const token = ((await login.json()) as { accessToken: string }).accessToken;
  await expect.poll(async () => {
    const r = (await (await fetch(`${API}/admin/analytics/traffic?range=today`, { headers: { authorization: `Bearer ${token}` } })).json()) as { sources: { source: string; sessions: number; carts: number; purchases: number; orders: number }[] };
    return r.sources.find((s) => s.source === source);
  }, { timeout: 40_000, intervals: [1000, 3000, 5000] }).toMatchObject({ sessions: 1, carts: 1, purchases: 1, orders: 1 });
});
