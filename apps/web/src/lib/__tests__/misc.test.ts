import { describe, expect, it } from 'vitest';
import { normalizeIdentifier, normalizePhone } from '@/components/auth/fields';
import { buildCsp } from '../../proxy';
import { clip, languageAlternates } from '../seo';
import { sitemapIndex, urlset } from '../sitemap';

describe('phone numbers', () => {
  it('normalizes what Qatar shoppers type to E.164', () => {
    expect(normalizePhone('5550 1234')).toBe('+97455501234');
    expect(normalizePhone('+974 5550 1234')).toBe('+97455501234');
    expect(normalizePhone('0097455501234')).toBe('+97455501234');
    expect(normalizePhone('٥٥٥٠١٢٣٤')).toBe('+97455501234');
    expect(normalizeIdentifier('  Sara@Example.COM ')).toBe('sara@example.com');
  });
});

describe('content security policy', () => {
  it('allows scripts only with the nonce and calls only to our API', () => {
    const csp = buildCsp('abc', { dev: false, apiOrigin: 'https://api.fastmovex.qa', mediaOrigin: 'https://media.fastmovex.qa' });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self' https://api.fastmovex.qa");
    expect(csp).toContain('img-src \'self\' data: blob: https://media.fastmovex.qa');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(buildCsp('x', { dev: true, apiOrigin: '', mediaOrigin: '' })).toContain("'unsafe-eval'");
    // sign in with Google / Apple: only their own sign-in origins are let in
    expect(csp).toContain('frame-src https://accounts.google.com/gsi/ https://appleid.apple.com');
    expect(csp).toContain("connect-src 'self' https://api.fastmovex.qa https://accounts.google.com/gsi/");
    const off = buildCsp('abc', { dev: false, apiOrigin: 'https://api.fastmovex.qa', mediaOrigin: '', social: false });
    expect(off).toContain("frame-src 'none'");
    expect(off).not.toContain('google');
  });
});

describe('SEO helpers', () => {
  it('hreflang for every language plus x-default', () => {
    expect(languageAlternates('/p/x')).toEqual({ 'en-QA': '/en/p/x', 'ar-QA': '/ar/p/x', 'x-default': '/en/p/x' });
  });
  it('clips descriptions on a word boundary', () => {
    const s = clip('word '.repeat(60), 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith('…')).toBe(true);
    expect(clip(null)).toBe('');
  });
  it('sitemaps escape XML and list both languages', () => {
    const xml = urlset('https://fastmovex.qa', [{ path: '/p/a&b', lastmod: '2026-09-28T10:00:00Z' }]);
    expect(xml).toContain('<loc>https://fastmovex.qa/en/p/a&amp;b</loc>');
    expect(xml).toContain('<loc>https://fastmovex.qa/ar/p/a&amp;b</loc>');
    expect(xml).toContain('<lastmod>2026-09-28</lastmod>');
    expect(sitemapIndex('https://fastmovex.qa', ['pages.xml'])).toContain('<loc>https://fastmovex.qa/sitemaps/pages.xml</loc>');
  });
});
