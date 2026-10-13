import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

const PAGES = ['/en', '/ar', '/en/search?q=phone', '/en/c/electronics', '/en/p/nova-powercore-20000-power-bank', '/ar/p/nova-powercore-20000-power-bank', '/en/cart', '/en/login', '/ar/register', '/en/help', '/en/checkout', '/en/track', '/en/contact', '/en/offers', '/ar/about'];

for (const path of PAGES) {
  test(`no serious accessibility violations: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
}
