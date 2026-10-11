import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContactDto, PageDto, RESERVED_SLUGS } from '../src/content/content';
import { OrderAccessService } from '../src/common/order-access.service';
import { BUILTIN_KEYS, BUILTIN_SECTIONS, parseCollectionConfig } from '../src/home/home-layout';
import { GuestCheckoutDto, OrderLookupDto } from '../src/orders/guest-checkout';

const errorsOf = <T extends object>(cls: new () => T, body: object) => validateSync(plainToInstance(cls, body) as object).map((e) => e.property);
const UUID = '5c16d269-edad-4cd0-8934-95be42dd5d20';

function access(secret = 'x'.repeat(40), storefront?: string) {
  const values: Record<string, unknown> = { JWT_ACCESS_SECRET: secret, STOREFRONT_URL: storefront };
  return new OrderAccessService({ get: (k: string) => values[k] } as unknown as ConfigService<never, true>);
}

describe('guest order access tokens', () => {
  const s = access();
  it('open exactly one order and cannot be forged', () => {
    const t = s.sign(UUID);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.verify(UUID, t)).toBe(true);
    expect(s.verify('9c704b04-cbc4-4503-8748-425f5db36265', t)).toBe(false); // another order
    expect(s.verify(UUID, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(s.verify(UUID, undefined)).toBe(false);
    expect(s.verify(UUID, '')).toBe(false);
    expect(s.verify(UUID, 'a'.repeat(500))).toBe(false);
  });
  it('change when the server secret changes (rotating the secret revokes every link)', () => {
    expect(access('y'.repeat(40)).verify(UUID, s.sign(UUID))).toBe(false);
  });
  it('build a tracking link only when the storefront address is configured', () => {
    expect(s.trackUrl('FMX-QA-1', UUID, 'en')).toBeNull();
    const url = access('x'.repeat(40), 'https://fastmovex.qa/').trackUrl('FMX-QA-1', UUID, 'ar');
    expect(url).toBe(`https://fastmovex.qa/ar/track?order=FMX-QA-1&t=${s.sign(UUID)}`);
    expect(access('x'.repeat(40), 'https://fastmovex.qa').trackUrl('FMX-QA-1', UUID, 'fr')).toContain('/en/track');
  });
});

describe('guest checkout input', () => {
  const address = { recipientName: 'Sara', phone: '+97455500011', city: 'Doha', zone: '60', street: '800', building: '3' };
  it('needs a name, a real email and an international phone', () => {
    expect(errorsOf(GuestCheckoutDto, { contact: { fullName: 'Sara Ahmed', email: 'Sara@Example.com ', phone: '+97455500011' }, address, paymentMethod: 'COD' })).toEqual([]);
    expect(errorsOf(GuestCheckoutDto, { contact: { fullName: 'S', email: 'nope', phone: '55500011' }, address, paymentMethod: 'COD' })).toEqual(['contact']);
    expect(errorsOf(GuestCheckoutDto, { contact: { fullName: 'Sara', email: 'a@b.qa', phone: '+97455500011' }, address, paymentMethod: 'BITCOIN' })).toEqual(['paymentMethod']);
  });
  it('normalises the email and order number for lookups', () => {
    const q = plainToInstance(OrderLookupDto, { orderNumber: ' fmx-qa-260930-3b6afe ', contact: ' Sara@Example.COM ' });
    expect(q.orderNumber).toBe('FMX-QA-260930-3B6AFE');
    expect(q.contact).toBe('sara@example.com');
  });
});

describe('home layout', () => {
  it('knows every built-in section once', () => {
    expect(new Set(BUILTIN_KEYS).size).toBe(BUILTIN_KEYS.length);
    for (const k of ['hero', 'categories', 'flash_deals', 'best_sellers', 'new_arrivals', 'value_props']) expect(BUILTIN_KEYS).toContain(k);
    expect(BUILTIN_KEYS).not.toContain('collection');
    expect(BUILTIN_SECTIONS.filter((s) => s.personal).map((s) => s.key)).toEqual(expect.arrayContaining(['recently_viewed', 'recommended']));
  });
  it('accepts valid collections with sensible defaults', () => {
    expect(parseCollectionConfig({ source: 'sale' })).toEqual({ source: 'sale', sort: 'popular', limit: 12 });
    expect(parseCollectionConfig({ source: 'category', categoryId: UUID, sort: 'newest', limit: 8 })).toEqual({ source: 'category', categoryId: UUID, sort: 'newest', limit: 8 });
    expect(parseCollectionConfig({ source: 'tag', tag: '  Ramadan ' })).toMatchObject({ tag: 'ramadan' });
    expect(parseCollectionConfig({ source: 'products', productIds: [UUID, UUID, 'x'] })).toMatchObject({ productIds: [UUID] });
  });
  it('rejects collections that would show nothing or too much', () => {
    const bad = [
      null, {}, { source: 'everything' }, { source: 'category' }, { source: 'category', categoryId: 'home' }, { source: 'tag', tag: ' ' },
      { source: 'products', productIds: [] }, { source: 'products', productIds: Array.from({ length: 25 }, (_, i) => UUID.slice(0, -2) + String(i).padStart(2, '0')) },
      { source: 'sale', limit: 2 }, { source: 'sale', limit: 50 }, { source: 'sale', limit: 5.5 }, { source: 'sale', sort: 'random' },
    ];
    for (const b of bad) expect(() => parseCollectionConfig(b)).toThrow(BadRequestException);
  });
});

describe('content pages and contact form', () => {
  it('pages cannot take the address of a website screen', () => {
    for (const s of ['cart', 'checkout', 'track', 'offers', 'contact', 'account', 'search', 'p', 'c', 'store', 'login']) expect(RESERVED_SLUGS).toContain(s);
    expect(RESERVED_SLUGS).not.toContain('about');
  });
  it('page addresses are lowercase words with dashes', () => {
    const base = { title: 'About us', titleAr: 'من نحن', body: 'x', bodyAr: 'x' };
    expect(errorsOf(PageDto, { ...base, slug: 'shipping-policy' })).toEqual([]);
    for (const slug of ['About', 'a b', '../x', '-x', 'x-', 'a']) expect(errorsOf(PageDto, { ...base, slug })).toContain('slug');
  });
  it('contact messages need a real email and a real message', () => {
    expect(errorsOf(ContactDto, { name: 'Ali', email: 'ali@example.com', message: 'Do you deliver to Al Khor?' })).toEqual([]);
    expect(errorsOf(ContactDto, { name: 'Ali', email: 'ali', message: 'hi' }).sort()).toEqual(['email', 'message']);
  });
});
