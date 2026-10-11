import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from '../src/categories/categories.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { SellerProductsService } from '../src/products/seller-products.service';
import { AdminSellersService } from '../src/sellers/admin-sellers.service';
import { SellerOnboardingService } from '../src/sellers/seller-onboarding.service';

const audit = { log: jest.fn() };
const storage = { put: jest.fn(), delete: jest.fn().mockResolvedValue(undefined), signedUrl: jest.fn().mockResolvedValue('https://signed'), publicUrl: (k?: string | null) => (k ? `https://cdn/${k}` : null) };
const crypto = new CryptoService({ get: () => Buffer.alloc(32, 1).toString('base64') } as never);
const sellerA = { id: 'seller-A', status: 'APPROVED', countryCode: 'QA' };

describe('Seller onboarding', () => {
  const make = (prisma: object) => new SellerOnboardingService(prisma as never, audit as never, crypto, storage as never);

  it('approved seller cannot change legal details', async () => {
    await expect(make({}).updateProfile(sellerA, { commercialRegNo: '999' }, 'u')).rejects.toThrow('through support');
  });

  it('invalid IBAN rejected', async () => {
    await expect(make({}).updateBank(sellerA, { bankName: 'QNB', accountHolder: 'X', iban: 'QA00XXXX' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('IBAN is stored encrypted, only last 4 in clear', async () => {
    const update = jest.fn();
    await make({ seller: { update } }).updateBank(sellerA, { bankName: 'QNB', accountHolder: 'X', iban: 'QA58DOHB00001234567890ABCDEFG' }, 'u');
    const data = update.mock.calls[0][0].data;
    expect(data.ibanEncrypted).not.toContain('DOHB');
    expect(crypto.decrypt(data.ibanEncrypted)).toBe('QA58DOHB00001234567890ABCDEFG');
    expect(data.ibanLast4).toBe('DEFG');
  });

  it('cannot submit without CR document and bank', async () => {
    const prisma = { seller: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ibanEncrypted: null, commercialRegNo: '123', documents: [] }) } };
    await expect(make(prisma).submitForReview({ ...sellerA, status: 'PENDING' }, 'u')).rejects.toMatchObject({
      response: { missing: expect.arrayContaining(['Bank account (IBAN) for payouts']) },
    });
  });

  it('rejected CR document does not count', async () => {
    const prisma = { seller: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ibanEncrypted: 'x', commercialRegNo: '1', documents: [{ type: 'COMMERCIAL_REGISTRATION', status: 'REJECTED' }] }) } };
    await expect(make(prisma).submitForReview({ ...sellerA, status: 'REJECTED' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('complete application goes UNDER_REVIEW', async () => {
    const update = jest.fn();
    const prisma = { seller: { update, findUniqueOrThrow: jest.fn().mockResolvedValue({ ibanEncrypted: 'x', commercialRegNo: '1', documents: [{ type: 'COMMERCIAL_REGISTRATION', status: 'PENDING' }] }) } };
    await expect(make(prisma).submitForReview({ ...sellerA, status: 'PENDING' }, 'u')).resolves.toEqual({ status: 'UNDER_REVIEW' });
  });

  it('user who already has a seller account cannot apply again', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'QA', seller: { id: 's' } }) } };
    await expect(make(prisma).apply('u', { businessName: 'B', storeName: 'S', contactEmail: 'a@b.c', contactPhone: '+97455555555' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Admin seller approval', () => {
  const tx = { seller: { update: jest.fn() }, store: { update: jest.fn() }, ledgerAccount: { upsert: jest.fn() }, auditLog: { create: jest.fn() } };
  const prismaFor = (seller: unknown) => ({ seller: { findUnique: jest.fn().mockResolvedValue(seller) }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) });
  const make = (p: object) => new AdminSellersService(p as never, audit as never, storage as never);

  it('only UNDER_REVIEW can be approved', async () => {
    await expect(make(prismaFor({ status: 'PENDING', country: { currencyCode: 'QAR' }, documents: [] })).approve('s1', 'admin')).rejects.toThrow('under review');
  });

  it('requires approved CR document', async () => {
    await expect(make(prismaFor({ status: 'UNDER_REVIEW', country: { currencyCode: 'QAR' }, documents: [{ type: 'COMMERCIAL_REGISTRATION', status: 'PENDING' }] })).approve('s1', 'admin')).rejects.toThrow('Commercial Registration');
  });

  it('approval activates store and opens 3 QAR ledger accounts', async () => {
    await make(prismaFor({ status: 'UNDER_REVIEW', country: { currencyCode: 'QAR' }, documents: [{ type: 'COMMERCIAL_REGISTRATION', status: 'APPROVED' }] })).approve('s1', 'admin');
    expect(tx.store.update).toHaveBeenCalledWith({ where: { sellerId: 's1' }, data: { isActive: true } });
    const types = tx.ledgerAccount.upsert.mock.calls.map((c) => c[0].create.type);
    expect(types).toEqual(['SELLER_PENDING', 'SELLER_AVAILABLE', 'SELLER_PAID']);
    expect(tx.ledgerAccount.upsert.mock.calls.every((c) => c[0].create.currencyCode === 'QAR')).toBe(true);
  });

  it('viewing a private document is audited and uses a short-lived URL', async () => {
    const svc = make({ sellerDocument: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', fileKey: 'k', sellerId: 's' }) } });
    await expect(svc.documentUrl('d1', 'admin')).resolves.toEqual({ url: 'https://signed', expiresIn: 300 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'seller.document_view' }));
  });
});

describe('Seller products: isolation & stock', () => {
  const warehouses = { ownWarehouse: jest.fn().mockResolvedValue('wh-main'), move: jest.fn() };
  const make = (p: object) => new SellerProductsService(p as never, audit as never, storage as never, undefined, warehouses as never);
  beforeEach(() => warehouses.move.mockClear());

  it("seller A requesting seller B's product: query is scoped to seller A, result 404", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await expect(make({ product: { findFirst } }).get(sellerA, 'product-of-B')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 'product-of-B', store: { sellerId: 'seller-A' } });
  });

  it("seller A editing seller B's variant -> 404", async () => {
    const prisma = { productVariant: { findUnique: jest.fn().mockResolvedValue({ id: 'v', productId: 'p', priceMinor: 100n, compareAtMinor: null, product: { deletedAt: null, store: { sellerId: 'seller-B' } } }) } };
    await expect(make(prisma).updateVariant(sellerA, 'v', { priceMinor: '50' }, 'u')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('concurrent stock edit -> 409 instead of lost update', async () => {
    const tx = {
      inventory: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'i', onHand: 10, reserved: 0, version: 3 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      inventoryMovement: { create: jest.fn() },
    };
    const prisma = {
      productVariant: { findUnique: jest.fn().mockResolvedValue({ id: 'v', productId: 'p', priceMinor: 1n, compareAtMinor: null, product: { deletedAt: null, store: { sellerId: 'seller-A' } } }) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    await expect(make(prisma).adjustStock(sellerA, 'v', { delta: 5, reason: 'RESTOCK' }, 'u')).rejects.toBeInstanceOf(ConflictException);
    expect(warehouses.move).not.toHaveBeenCalled();
  });

  it('successful restock writes an inventory movement', async () => {
    const tx = {
      // before, then after: the total follows the warehouse (database trigger)
      inventory: { findUniqueOrThrow: jest.fn().mockResolvedValueOnce({ id: 'i', onHand: 10, reserved: 2, version: 3 }).mockResolvedValueOnce({ onHand: 15, reserved: 2 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inventoryMovement: { create: jest.fn() },
    };
    const prisma = {
      productVariant: { findUnique: jest.fn().mockResolvedValue({ id: 'v', productId: 'p', priceMinor: 1n, compareAtMinor: null, product: { deletedAt: null, store: { sellerId: 'seller-A' } } }) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    await expect(make(prisma).adjustStock(sellerA, 'v', { delta: 5, reason: 'RESTOCK' }, 'u')).resolves.toEqual({ variantId: 'v', warehouseId: 'wh-main', onHand: 15, reserved: 2, available: 13 });
    expect(warehouses.move).toHaveBeenCalledWith(tx, expect.objectContaining({ warehouseId: 'wh-main', variantId: 'v', delta: 5, reason: 'RESTOCK', actorId: 'u' }));
  });

  it('cannot submit for review without images', async () => {
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p', status: 'DRAFT', countryCode: 'QA' }) },
      productImage: { count: jest.fn().mockResolvedValue(0) },
      productVariant: { count: jest.fn().mockResolvedValue(1) },
    };
    await expect(make(prisma).update(sellerA, 'p', { submitForReview: true }, 'u')).rejects.toThrow('at least one product image');
  });
});

describe('Categories admin', () => {
  it('cannot move a category inside its own subtree', async () => {
    const cats: Record<string, object> = {
      c1: { id: 'c1', parentId: null, slug: 'electronics', path: 'electronics', depth: 0, isActive: true },
      c2: { id: 'c2', parentId: 'c1', slug: 'phones', path: 'electronics/phones', depth: 1, isActive: true },
    };
    const prisma = { category: { findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(cats[where.id] ?? null)) } };
    const svc = new CategoriesService(prisma as never, audit as never, storage as never);
    await expect(svc.update('c1', { parentId: 'c2' }, 'admin')).rejects.toThrow('inside its own subcategory');
  });

  it('cannot delete a category that has products', async () => {
    const prisma = { category: { findUnique: jest.fn().mockResolvedValue({ id: 'c', slug: 's', _count: { products: 3, children: 0 } }) } };
    const svc = new CategoriesService(prisma as never, audit as never, storage as never);
    await expect(svc.remove('c', 'admin')).rejects.toBeInstanceOf(ConflictException);
  });
});
