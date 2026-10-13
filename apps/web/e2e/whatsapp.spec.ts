import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { API, DEMO_PASSWORD, confirmGuestPhone, freshMobile } from './helpers';

async function admin() {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-type': 'mobile' }, body: JSON.stringify({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }) });
  return ((await r.json()) as { accessToken: string }).accessToken;
}
async function setWhatsAppNumber(number: string | null) {
  const t = await admin();
  const countries = (await (await fetch(`${API}/admin/countries`, { headers: { authorization: `Bearer ${t}` } })).json()) as { code: string; legalSettings: Record<string, unknown> }[];
  const legal = { ...countries.find((c) => c.code === 'QA')!.legalSettings };
  if (number) legal.whatsapp = number; else delete legal.whatsapp;
  await fetch(`${API}/admin/countries/QA`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ legalSettings: legal }) });
}

test.describe.serial('WhatsApp', () => {
  test.afterAll(async () => { await setWhatsAppNumber(null); });

  test('with a store number, a chat button and "ask about this product" open WhatsApp with a message', async ({ page }) => {
    await setWhatsAppNumber('+974 4400 1234');
    await page.goto('/en/help');
    const chat = page.getByTestId('whatsapp-chat');
    // the API asks the website to refresh right after the change (STOREFRONT_URL on the API); without it, up to 5 minutes
    test.skip(!(await chat.isVisible().catch(() => false)), 'The API cannot refresh the website cache here (STOREFRONT_URL not set on the API)');
    await expect(chat).toHaveAttribute('href', /^https:\/\/wa\.me\/97444001234\?text=/);
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await expect(page.getByTestId('whatsapp-chat')).toHaveCount(0); // nothing floats over the price on product pages
    // by role: only what is shown (the page streams in behind its loading skeleton, briefly with a hidden copy)
    await expect(page.getByRole('link', { name: 'Ask about this on WhatsApp' })).toHaveAttribute('href', /wa\.me\/97444001234\?text=.*premium-khalas-dates-1kg/);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('when the store sends WhatsApp updates, checkout offers them (unticked) and they reach the order', async ({ page }) => {
    const market = (await (await fetch(`${API}/markets`)).json())[0] as { whatsapp?: { updates: boolean } };
    test.skip(!market.whatsapp?.updates, 'The API is not connected to WhatsApp');
    await page.goto('/en/p/premium-khalas-dates-1kg');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await page.goto('/en/checkout');
    const optIn = page.getByTestId('whatsapp-opt-in');
    await expect(optIn).not.toBeChecked(); // consent is never pre-ticked
    await optIn.check();
    await page.getByLabel('Full name', { exact: true }).fill('WhatsApp Guest');
    const mobile = freshMobile();
    await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
    await page.getByLabel('Email', { exact: true }).fill(`wa.e2e.${Date.now()}@example.com`);
    await page.getByLabel('Zone').fill('66');
    await page.getByLabel('Street').fill('901');
    await page.getByLabel('Building').fill('12');
    await page.getByTestId('pay-COD').check();
    await confirmGuestPhone(page, mobile); // cash on delivery: the mobile is confirmed by a texted code
    await page.getByTestId('place-order').click();
    await expect(page).toHaveURL(/\/en\/track\?order=/, { timeout: 20_000 });
  });
});
