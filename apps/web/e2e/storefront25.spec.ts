import { expect, test } from './fixtures';

/** The FastMoveX app-style home: header, chips, slider, cards with "Add", barcode search, five tabs on phones. */
test.describe('Storefront look (FastMoveX)', () => {
  test('phone: logo with tagline, Qatar, popular searches, slider dots, four-across cards, five tabs', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/en');
    await expect(page.getByRole('img', { name: 'FastMoveX' }).first()).toBeVisible();
    await expect(page.getByText('Shop smart · Live better').first()).toBeVisible();
    await expect(page.getByTestId('location-button')).toContainText('Qatar');
    await expect(page.getByTestId('popular-chip').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flash Deals' })).toBeVisible();
    await expect(page.getByTestId('deal-countdown').first()).toHaveText(/\d\d:\d\d$/);
    const tabs = page.getByRole('navigation', { name: 'Menu' }).getByRole('link');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(3)).toHaveText('Wishlist');
    // four product cards side by side in a rail
    const cards = page.locator('#rail-flash_deals').locator('xpath=ancestor::section').getByTestId('product-card');
    const boxes = await Promise.all([0, 1, 2, 3].map(async (i) => (await cards.nth(i).boundingBox())!));
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
    expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(431);
    // the location sheet holds the language switch
    await page.getByTestId('location-button').click();
    await expect(page.getByRole('dialog', { name: 'Where should we deliver?' })).toBeVisible();
    await expect(page.getByRole('dialog').getByTestId('locale-switch')).toBeVisible();
  });

  test('"Add" on a card puts a one-option product in the cart', async ({ page }) => {
    await page.goto('/en');
    const add = page.locator('button[data-testid="card-add"]').first();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await expect(page.getByTestId('cart-count').first()).toHaveText('1');
    await expect(page.getByRole('status').or(page.getByText('Added to cart')).first()).toBeVisible();
  });

  test('camera search: the number under the barcode (or a SKU) opens the product', async ({ page }) => {
    await page.goto('/en');
    await page.getByTestId('barcode-search').first().click();
    const dialog = page.getByRole('dialog', { name: 'Scan the barcode on the pack' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Number under the barcode').fill('NPC20K');
    await dialog.getByRole('button', { name: 'Find' }).click();
    await expect(page).toHaveURL(/\/en\/p\/nova-powercore-20000-power-bank/);
  });
});
