import { describe, expect, it } from 'vitest';
import { bannerHref, paths, pick, safeNext, switchLocalePath } from '../urls';

describe('urls', () => {
  it('only allows same-site paths after sign-in (no open redirect)', () => {
    expect(safeNext('/en/checkout', 'en')).toBe('/en/checkout');
    expect(safeNext('//evil.com', 'en')).toBe('/en');
    expect(safeNext('https://evil.com', 'en')).toBe('/en');
    expect(safeNext('/\\evil.com', 'ar')).toBe('/ar');
    expect(safeNext(null, 'ar')).toBe('/ar');
  });

  it('banner links: site paths get the language, only https leaves the site', () => {
    expect(bannerHref('ar', '/search?category=perfumes')).toEqual({ href: '/ar/search?category=perfumes', external: false });
    expect(bannerHref('en', 'https://partner.example/offer')).toEqual({ href: 'https://partner.example/offer', external: true });
    expect(bannerHref('en', 'javascript:alert(1)')).toBeNull();
    expect(bannerHref('en', '//evil.com')).toBeNull();
    expect(bannerHref('en', 'http://insecure.example')).toBeNull();
    expect(bannerHref('en', null)).toBeNull();
  });

  it('switches language keeping the page and query', () => {
    expect(switchLocalePath('/en/p/abc', '?v=1', 'ar')).toBe('/ar/p/abc?v=1');
    expect(switchLocalePath('/ar', '', 'en')).toBe('/en');
    expect(switchLocalePath('/', '', 'ar')).toBe('/ar/');
  });

  it('builds search URLs without empty parameters', () => {
    expect(paths.search('en', { q: 'oud', brands: '', page: undefined })).toBe('/en/search?q=oud');
    expect(paths.login('ar', '/ar/checkout')).toBe('/ar/login?next=%2Far%2Fcheckout');
  });

  it('prefers Arabic names when present', () => {
    expect(pick('ar', 'Perfumes', 'العطور')).toBe('العطور');
    expect(pick('ar', 'Nova', null)).toBe('Nova');
    expect(pick('en', 'Perfumes', 'العطور')).toBe('Perfumes');
  });
});
