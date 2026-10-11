import { poolTls } from '../src/prisma/pool-tls';
import { BadRequestException } from '@nestjs/common';
import { buildBaseQuery, orderBy } from '../src/search/postgres-search.engine';
import { cleanFaq, parseSeoSettings, validGtin } from '../src/seo/seo-rules';

const sqlText = (s: { strings: readonly string[] } | { sql: string }) => ('sql' in s ? s.sql : (s as { strings: readonly string[] }).strings.join('?'));

describe('Phase 24 — product barcodes for Google', () => {
  it('accepts real GTINs only (check digit)', () => {
    expect(validGtin('6281100411111')).toBeNull(); // wrong check digit
    expect(validGtin('4006381333931')).toBe('4006381333931'); // EAN-13
    expect(validGtin('036000291452')).toBe('036000291452'); // UPC-A
    expect(validGtin('96385074')).toBe('96385074'); // EAN-8
    expect(validGtin('4006-3813-33931')).toBe('4006381333931');
    expect(validGtin('00000000')).toBeNull();
    expect(validGtin('SKD-1KG')).toBeNull();
    expect(validGtin(null)).toBeNull();
  });
});

describe('Phase 24 — category questions & answers', () => {
  it('keeps complete questions in both languages, trimmed, at most 20', () => {
    const one = { q: ' Fast? ', qAr: 'سريع؟', a: 'Same day. ', aAr: 'نفس اليوم' };
    expect(cleanFaq([one, { q: 'Only English', a: 'x' }, 'junk', null])).toEqual([{ q: 'Fast?', qAr: 'سريع؟', a: 'Same day.', aAr: 'نفس اليوم' }]);
    expect(cleanFaq(Array.from({ length: 30 }, () => one))).toHaveLength(20);
    expect(cleanFaq({ not: 'a list' })).toEqual([]);
  });
});

describe('Phase 24 — search engine settings', () => {
  it('takes the code out of a pasted meta tag; social links must be the network’s own https page', () => {
    const s = parseSeoSettings({ googleVerification: '<meta name="google-site-verification" content="AbC_123-xyz" />', bingVerification: '1234567890ABCDEF', social: { instagram: 'https://www.instagram.com/fastmovex.qa', x: 'https://twitter.com/fastmovex' } });
    expect(s).toEqual({ googleVerification: 'AbC_123-xyz', bingVerification: '1234567890ABCDEF', social: { instagram: 'https://www.instagram.com/fastmovex.qa', x: 'https://twitter.com/fastmovex' }, merchantFeed: true });
    expect(() => parseSeoSettings({ social: { instagram: 'https://evil.example/jovia' } })).toThrow(BadRequestException);
    expect(() => parseSeoSettings({ social: { facebook: 'javascript:alert(1)' } })).toThrow(BadRequestException);
    expect(() => parseSeoSettings({ googleVerification: '"><script>' })).toThrow(BadRequestException);
    // stored values are read leniently (a bad old value is dropped, never an error on the shop)
    expect(parseSeoSettings({ googleVerification: '"><script>', social: { tiktok: 'http://tiktok.com/x' }, merchantFeed: false }, false)).toEqual({ googleVerification: null, bingVerification: null, social: {}, merchantFeed: false });
  });
});

describe('Phase 24 — search order', () => {
  it('sold-out products come after buyable ones; rating counts in relevance', () => {
    const base = { countryCode: 'QA', limit: 24, offset: 0, sort: 'relevance' } as const;
    expect(sqlText(orderBy({ ...base, sort: 'relevance', q: 'dates' }))).toMatch(/"inStock" DESC, b\."rank" DESC/);
    expect(sqlText(orderBy({ ...base, sort: 'relevance' }))).toMatch(/"inStock" DESC, b\."soldCount" DESC/);
    expect(sqlText(orderBy({ ...base, sort: 'price_asc' }))).not.toMatch(/inStock/); // an explicit sort is respected
    const q = sqlText(buildBaseQuery({ ...base, q: 'oud perfume' }));
    expect(q).toMatch(/"ratingAvg" \/ 5\.0\) \* ln\(1 \+ p\."ratingCount"\)/);
    expect(q).toMatch(/AS "inStock"/);
  });
});

describe('Hosted database TLS (free test deploy)', () => {
  it('with the provider CA the pool verifies the server; URL ssl options cannot override it', () => {
    const r = poolTls('postgresql://postgres.ref:pa%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=10', '-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----');
    expect(r.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----', rejectUnauthorized: true });
    expect(r.connectionString).toBe('postgresql://postgres.ref:pa%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?connect_timeout=10');
  });
  it('without it the URL is used as it is (local Postgres)', () => {
    expect(poolTls('postgresql://jovia:x@localhost:5432/jovia', undefined)).toEqual({ connectionString: 'postgresql://jovia:x@localhost:5432/jovia' });
    expect(poolTls('postgresql://jovia:x@localhost:5432/jovia', '  ')).toEqual({ connectionString: 'postgresql://jovia:x@localhost:5432/jovia' });
  });
});
