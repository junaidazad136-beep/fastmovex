import { test as base, expect } from '@playwright/test';
import { settle } from './helpers';

/**
 * Playwright's `test`, with one change to `page.goto`: before it, a cart change still on its way to the server is let
 * through; after it, the page that streamed in behind a loading skeleton is put in place (see `settle`), so no test
 * sees React's brief hidden copy of the page.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = (async (...args: Parameters<typeof goto>) => {
      // the cart shows a tapped change at once and sends it a moment later: let it arrive before leaving the page
      await expect(page.locator('html[data-cart-sync]')).toHaveCount(0, { timeout: 15_000 });
      const res = await goto(...args);
      await settle(page);
      return res;
    }) as typeof page.goto;
    await use(page);
  },
});
export { expect };
