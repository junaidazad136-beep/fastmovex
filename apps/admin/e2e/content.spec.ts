import { expect, test } from '@playwright/test';
import { ADMIN, API, PNG, apiCall, apiToken, run, signIn } from './helpers';

const home = async () => (await (await fetch(`${API}/home`, { headers: { 'x-country': 'QA' } })).json()) as { sections: { key: string; title?: string; items?: { id: string }[] }[] };

test('staff write a page in English and Arabic, publish it, and it is on the website', async ({ page }) => {
  const tag = run().toLowerCase();
  const slug = `e2e-shipping-${tag}`;
  await signIn(page);
  await page.goto('/pages');
  await expect(page.getByRole('link', { name: 'About FastMoveX', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New page' }).click();

  await page.getByLabel('Title', { exact: true }).fill(`Shipping ${tag}`);
  await page.getByLabel('Text', { exact: true }).fill('We deliver across Qatar.\n\n## Timing\n- Doha: next day\n- **Al Khor**: 2 days');
  await expect(page.getByRole('heading', { name: 'Timing' })).toBeVisible(); // live preview
  await page.getByRole('tab', { name: 'العربية' }).click();
  await page.getByLabel('Title (Arabic)').fill('الشحن');
  await page.getByLabel('Text', { exact: true }).fill('نوصل إلى جميع أنحاء قطر.');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('switch', { name: /Published/ }).click();
  await page.getByRole('button', { name: 'Create page' }).click();
  await expect(page.getByText('Page created')).toBeVisible();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/);

  const pub = await (await fetch(`${API}/pages/${slug}`)).json();
  expect(pub).toMatchObject({ slug, title: `Shipping ${tag}`, titleAr: 'الشحن' });

  // editing an existing page saves (and the change is public)
  await page.getByLabel('Title', { exact: true }).fill(`Shipping & delivery ${tag}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Page saved')).toBeVisible();
  expect((await (await fetch(`${API}/pages/${slug}`)).json()).title).toBe(`Shipping & delivery ${tag}`);

  // a website address that belongs to a shop screen is refused
  await page.getByLabel('Web address').fill('checkout');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(/address/i);
  await page.getByLabel('Web address').fill(slug);

  await page.getByRole('button', { name: 'Delete page' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/pages$/);
  expect((await fetch(`${API}/pages/${slug}`)).status).toBe(404);
});

test('staff arrange the home page: add a collection, reorder, hide a section, then go back to standard', async ({ page }) => {
  const t = await apiToken(ADMIN);
  await apiCall(t, 'POST', '/admin/home-sections/reset', { countryCode: 'QA' });
  const tag = `e2e${run().toLowerCase()}`;
  const cats = await apiCall<{ id: string; slug: string }[]>(t, 'GET', '/admin/categories');
  const p = await apiCall<{ id: string }>(t, 'POST', '/admin/products', {
    title: `E2E Lantern ${tag}`, categoryId: cats.find((c) => c.slug === 'home-kitchen')!.id, tags: [tag], variants: [{ sku: `E2E-LAN-${tag}`, priceMinor: '3900', initialStock: 5 }],
  });
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  await fetch(`${API}/admin/products/${p.id}/images`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: fd });
  await apiCall(t, 'POST', `/admin/products/${p.id}/status`, { status: 'ACTIVE' });

  try {
    await signIn(page);
    await page.goto('/home-page');
    await expect(page.getByText('Shop by category')).toBeVisible();

    await page.getByRole('button', { name: 'Add collection' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title (English)').fill(`Lanterns ${tag}`);
    await dialog.getByRole('radio', { name: /Products with a tag/ }).check();
    await dialog.getByLabel('Tag', { exact: true }).fill(tag);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(`Lanterns ${tag}`)).toBeVisible();

    await page.getByRole('button', { name: `Move Lanterns ${tag} up` }).click();
    await page.locator('li', { hasText: 'New arrivals' }).getByRole('button', { name: 'Hide section' }).click();
    await page.getByRole('button', { name: 'Save home page' }).click();
    await expect(page.getByText('Home page saved')).toBeVisible();

    let feed = await home();
    const keys = feed.sections.map((s) => s.title ?? s.key);
    expect(keys).toContain(`Lanterns ${tag}`);
    expect(keys).not.toContain('new_arrivals');
    expect(feed.sections.find((s) => s.title === `Lanterns ${tag}`)!.items!.map((i) => i.id)).toContain(p.id);

    await page.getByRole('button', { name: 'Standard layout' }).click();
    await page.getByRole('button', { name: 'Use standard layout' }).click();
    await expect(page.getByText('Back to the standard home page')).toBeVisible();
    feed = await home();
    expect(feed.sections.some((s) => s.title === `Lanterns ${tag}`)).toBe(false);
  } finally {
    await apiCall(t, 'POST', '/admin/home-sections/reset', { countryCode: 'QA' });
  }
});

test('contact form messages are read and marked handled', async ({ page }) => {
  const email = `e2e.contact.${run().toLowerCase()}@example.com`;
  const res = await fetch(`${API}/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mariam', email, subject: 'Gift wrapping', message: 'Can you gift wrap an order for Eid?' }) });
  expect(res.status).toBe(202);

  await signIn(page);
  await page.goto('/messages');
  await page.getByRole('button', { name: new RegExp(email) }).click();
  await expect(page.getByRole('link', { name: email })).toHaveAttribute('href', /^mailto:/);
  await page.getByLabel('Internal note').fill('Replied: yes, free for Eid');
  await page.getByRole('button', { name: 'Mark handled' }).click();
  await expect(page.getByRole('button', { name: new RegExp(email) })).toHaveCount(0); // left the "New" tab
  await page.getByRole('tab', { name: 'Handled' }).click();
  await page.getByRole('button', { name: new RegExp(email) }).click();
  await expect(page.getByText('Note: Replied: yes, free for Eid')).toBeVisible();
});

test('guest checkout can be switched off in settings', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  const sw = page.getByRole('switch', { name: /Allow guest checkout/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  const off = (await (await fetch(`${API}/markets`)).json()) as { code: string; guestCheckout: boolean }[];
  expect(off.find((m) => m.code === 'QA')!.guestCheckout).toBe(false);
  await page.getByRole('switch', { name: /Allow guest checkout/ }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved').first()).toBeVisible();
  await expect.poll(async () => ((await (await fetch(`${API}/markets`)).json()) as { code: string; guestCheckout: boolean }[]).find((m) => m.code === 'QA')!.guestCheckout).toBe(true);
});
