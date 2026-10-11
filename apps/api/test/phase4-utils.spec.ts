import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { buildTree } from '../src/categories/categories.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { isValidIban } from '../src/common/utils/iban';
import { toMinor } from '../src/common/utils/money';
import { decodeCursor, encodeCursor, toPage } from '../src/common/utils/pagination';
import { slugify, uniqueSlug } from '../src/common/utils/slug';
import {
  assertCompareAt, assertDistinctOptions, assertOptionValues, assertUniqueSkus, nextStatusAfterSellerEdit, stockAfter,
} from '../src/products/product-rules';
import { sniffMime, validateUpload } from '../src/storage/file-validation';

const file = (buf: Buffer, size = buf.length) => ({ buffer: buf, size }) as Express.Multer.File;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(20)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('file validation (magic bytes)', () => {
  it('detects real types from bytes', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(PDF)).toBe('application/pdf');
  });
  it('rejects SVG even if named .png', () => {
    expect(() => validateUpload(file(SVG), 'image')).toThrow(BadRequestException);
  });
  it('rejects PDF as product image but accepts it as a document', () => {
    expect(() => validateUpload(file(PDF), 'image')).toThrow(BadRequestException);
    expect(validateUpload(file(PDF), 'document').ext).toBe('pdf');
  });
  it('rejects oversize files', () => {
    expect(() => validateUpload(file(JPEG, 6 * 1024 * 1024), 'image')).toThrow(PayloadTooLargeException);
  });
  it('requires a file', () => {
    expect(() => validateUpload(undefined, 'image')).toThrow('File is required');
  });
});

describe('money', () => {
  it('parses minor units as BigInt', () => expect(toMinor('429900')).toBe(429900n));
  it('rejects decimals, negatives and floats', () => {
    for (const bad of ['4299.00', '-100', '1e5', '']) expect(() => toMinor(bad)).toThrow(BadRequestException);
  });
});

describe('IBAN', () => {
  it('accepts a valid Qatar IBAN (with spaces, lowercase)', () => expect(isValidIban('qa58 dohb 0000 1234 5678 90ab cdef g')).toBe(true));
  it('rejects wrong checksum', () => expect(isValidIban('QA59DOHB00001234567890ABCDEFG')).toBe(false));
  it('rejects wrong length for Qatar', () => expect(isValidIban('QA58DOHB00001234567890ABCDEF')).toBe(false));
});

describe('slug', () => {
  it('normalizes titles', () => expect(slugify('iPhone 15 Pro — 256GB!')).toBe('iphone-15-pro-256gb'));
  it('Arabic-only falls back', () => expect(slugify('عطر فاخر')).toBe('item'));
  it('uniqueSlug adds a suffix', () => expect(uniqueSlug('Oud Perfume')).toMatch(/^oud-perfume-[0-9a-f]{6}$/));
});

describe('cursor pagination', () => {
  it('round-trips', () => {
    const c = { createdAt: new Date('2026-09-22T10:00:00Z'), id: 'abc' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects garbage cursors', () => expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException));
  it('returns nextCursor only when more rows exist', () => {
    const rows = [1, 2, 3].map((i) => ({ id: String(i), createdAt: new Date(2026, 0, i) }));
    expect(toPage(rows, 2).nextCursor).not.toBeNull();
    expect(toPage(rows, 3).nextCursor).toBeNull();
  });
});

describe('field encryption', () => {
  const svc = new CryptoService({ get: () => Buffer.alloc(32, 7).toString('base64') } as never);
  it('encrypts and decrypts; ciphertext differs each time', () => {
    const a = svc.encrypt('QA58DOHB00001234567890ABCDEFG');
    expect(a).not.toContain('DOHB');
    expect(svc.encrypt('QA58DOHB00001234567890ABCDEFG')).not.toBe(a);
    expect(svc.decrypt(a)).toBe('QA58DOHB00001234567890ABCDEFG');
  });
  it('tampered ciphertext fails', () => {
    const parts = svc.encrypt('secret').split(':');
    parts[3] = Buffer.from('hacked').toString('base64');
    expect(() => svc.decrypt(parts.join(':'))).toThrow();
  });
});

describe('product rules', () => {
  it('old price must be higher than price', () => {
    expect(() => assertCompareAt(1000n, 900n)).toThrow(BadRequestException);
    expect(() => assertCompareAt(1000n, 1000n)).toThrow(BadRequestException);
    expect(() => assertCompareAt(1000n, 1200n)).not.toThrow();
    expect(() => assertCompareAt(1000n, null)).not.toThrow();
  });
  it('duplicate SKUs (case-insensitive) rejected', () => expect(() => assertUniqueSkus(['A-1', 'a-1'])).toThrow('Duplicate SKU'));
  it('two variants with same options rejected', () => {
    expect(() => assertDistinctOptions([{ color: 'Black', size: 'M' }, { size: 'm', color: 'black' }])).toThrow(BadRequestException);
    expect(() => assertDistinctOptions([{ color: 'Black' }, { color: 'White' }])).not.toThrow();
  });
  it('option values validated', () => {
    expect(() => assertOptionValues({ color: 5 })).toThrow(BadRequestException);
    expect(() => assertOptionValues({ a: '1', b: '1', c: '1', d: '1', e: '1', f: '1' })).toThrow('max 5');
  });
  it('status transitions on seller edit', () => {
    expect(nextStatusAfterSellerEdit('DRAFT', true)).toBe('PENDING_REVIEW');
    expect(nextStatusAfterSellerEdit('REJECTED')).toBe('DRAFT');
    expect(nextStatusAfterSellerEdit('REJECTED', true)).toBe('PENDING_REVIEW');
    expect(nextStatusAfterSellerEdit('ACTIVE', true)).toBe('ACTIVE');
    expect(() => nextStatusAfterSellerEdit('ARCHIVED')).toThrow();
  });
  it('stock cannot go negative or below reserved units', () => {
    expect(stockAfter(10, 0, -4)).toBe(6);
    expect(() => stockAfter(3, 0, -4)).toThrow('below 0');
    expect(() => stockAfter(10, 8, -5)).toThrow('reserved');
  });
});

describe('category tree', () => {
  const rows = [
    { id: '1', parentId: null, slug: 'electronics', name: 'Electronics', nameAr: 'إ', iconKey: null, sortOrder: 1 },
    { id: '2', parentId: '1', slug: 'phones', name: 'Phones', nameAr: 'ه', iconKey: 'i.png', sortOrder: 0 },
    { id: '3', parentId: null, slug: 'beauty', name: 'Beauty', nameAr: 'ج', iconKey: null, sortOrder: 0 },
    { id: '4', parentId: '99', slug: 'orphan', name: 'Orphan', nameAr: 'x', iconKey: null, sortOrder: 0 }, // parent inactive
  ];
  const tree = buildTree(rows, (k) => (k ? `https://cdn/${k}` : null));
  it('nests and sorts', () => {
    expect(tree.map((n) => n.slug)).toEqual(['beauty', 'electronics']);
    expect(tree[1].children[0]).toMatchObject({ slug: 'phones', iconUrl: 'https://cdn/i.png' });
  });
  it('hides children of inactive parents', () => expect(JSON.stringify(tree)).not.toContain('orphan'));
});
