import { test as base, expect } from '@playwright/test';
import { settle } from './helpers';

/**
 * Playwright's `test`, with one change: after every `page.goto` it waits until the page that streamed in behind a
 * loading skeleton has been put in place (see `settle`), so no test sees React's brief hidden copy of the page.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = (async (...args: Parameters<typeof goto>) => {
      const res = await goto(...args);
      await settle(page);
      return res;
    }) as typeof page.goto;
    await use(page);
  },
});
export { expect };
