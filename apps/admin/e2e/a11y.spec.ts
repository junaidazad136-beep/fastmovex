import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const PAGES = ['/', '/products', '/products/new', '/inventory', '/orders', '/customers', '/coupons', '/settings', '/home-page', '/pages', '/pages/new', '/messages'];

test('main screens have no serious accessibility problems', async ({ page }) => {
  await page.goto('/login');
  const login = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(login.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await signIn(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('nextjs-portal').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${path}: ${v.id} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
    expect(bad, bad.join('\n')).toEqual([]);
  }
});
