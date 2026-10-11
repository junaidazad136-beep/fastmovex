import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichText } from '@/components/content/RichText';
import { paths, viewAllHref } from '../urls';

const html = (text: string, locale: 'en' | 'ar' = 'en') => renderToStaticMarkup(createElement(RichText, { text, locale }));

describe('content pages (admin-written text)', () => {
  it('renders headings, lists, bold and site links in the visitor language', () => {
    const out = html('Intro line\n\n## Delivery\n- **Doha**: next day\n- See [contact](/contact)', 'ar');
    expect(out).toContain('<h2');
    expect(out).toContain('Delivery</h2>');
    expect(out).toContain('<strong');
    expect(out).toContain('<li>');
    expect(out).toContain('href="/ar/contact"');
  });

  it('never outputs markup or unsafe links from the text', () => {
    const out = html('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](//evil.com) [z](http://plain.example) <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toMatch(/href="(javascript:|\/\/evil|http:)/);
    expect(out).toContain('x'); // the link text stays as plain text
  });

  it('allows https, mailto and tel links', () => {
    const out = html('[a](https://fastmovex.qa) [b](mailto:care@fastmovex.qa) [c](tel:+97444000000)');
    expect(out).toContain('href="https://fastmovex.qa"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="mailto:care@fastmovex.qa"');
    expect(out).toContain('href="tel:+97444000000"');
  });
});

describe('phase 14 links', () => {
  it('home "view all" links go to the right listing', () => {
    expect(viewAllHref('en', { offers: true })).toBe('/en/offers');
    expect(viewAllHref('ar', { category: 'home-kitchen', sort: 'newest' })).toBe('/ar/c/home-kitchen?sort=newest');
    expect(viewAllHref('en', { sort: 'best_selling' })).toMatch(/^\/en\/search\?sort=best_selling$/);
    expect(viewAllHref('en', null)).toBeUndefined();
    expect(viewAllHref('en', {})).toBeUndefined();
  });

  it('tracking and contact links carry the order safely', () => {
    expect(paths.track('en')).toBe('/en/track');
    expect(paths.track('ar', 'FMX-QA-1', 'abc_-1')).toBe('/ar/track?order=FMX-QA-1&t=abc_-1');
    expect(paths.contact('en', 'JV QA&1')).toBe('/en/contact?order=JV%20QA%261');
    expect(paths.page('en', 'about')).toBe('/en/about');
  });
});
