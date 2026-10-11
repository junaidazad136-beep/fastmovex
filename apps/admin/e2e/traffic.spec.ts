import { expect, test } from '@playwright/test';
import { API, signIn } from './helpers';

test('staff see the shopping funnel and where visits come from', async ({ page }) => {
  // one anonymous visit from a WhatsApp link that reached the cart
  const sessionId = crypto.randomUUID();
  await fetch(`${API}/analytics/events?country=QA`, {
    method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' },
    body: JSON.stringify({ sessionId, touch: { referrerHost: 'web.whatsapp.com' }, events: [{ type: 'page_view', path: '/ar' }, { type: 'product_view' }, { type: 'add_to_cart' }] }),
  });
  await signIn(page);
  await page.goto('/traffic?range=today');
  await expect(page.getByTestId('funnel')).toContainText('Added to cart');
  // the report is cached for a few seconds: reload until the new visit is in
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('sources')).toContainText('whatsapp', { timeout: 3_000 });
  }).toPass({ timeout: 40_000 });
  await expect(page.getByTestId('traffic-stats')).toContainText('Visits');
});
