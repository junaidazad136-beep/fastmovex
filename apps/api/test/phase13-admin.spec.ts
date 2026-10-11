import { ADMIN_ROLES } from '../src/admin/admin-users';
import { startOfTodayUtcForQatar } from '../src/admin/dashboard';
import { canUsePanel, isStaff } from '../src/auth/auth.service';
import { isAdminClient, isMobileClient } from '../src/common/utils/request-meta';
import { decimalToMinorStrict, minorToDecimal } from '../src/products/catalog-csv.service';
import { AdjustStockDto } from '../src/products/dto/product.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Request } from 'express';

describe('CSV money cells (people type prices, never floats inside)', () => {
  it('parses what a spreadsheet contains', () => {
    expect(decimalToMinorStrict('79', 2, 'price')).toBe(7900n);
    expect(decimalToMinorStrict('79.5', 2, 'price')).toBe(7950n);
    expect(decimalToMinorStrict('1,299.00', 2, 'price')).toBe(129900n);
    expect(decimalToMinorStrict('12.345', 3, 'price')).toBe(12345n); // KWD
    expect(decimalToMinorStrict('', 2, 'price')).toBeNull();
    expect(() => decimalToMinorStrict('1.234', 2, 'price')).toThrow('at most 2 decimals');
    expect(() => decimalToMinorStrict('-5', 2, 'price')).toThrow('not a valid amount');
    expect(() => decimalToMinorStrict('=1+1', 2, 'price')).toThrow('not a valid amount');
  });
  it('exports minor units back exactly', () => {
    expect(minorToDecimal(129900n, 2)).toBe('1299.00');
    expect(minorToDecimal(5n, 3)).toBe('0.005');
    expect(minorToDecimal(null, 2)).toBe('');
  });
});

describe('dashboard "today" is a Doha day', () => {
  it('starts at 00:00 in Qatar (21:00 UTC the day before)', () => {
    expect(startOfTodayUtcForQatar(new Date('2026-09-30T20:59:00Z')).toISOString()).toBe('2026-09-29T21:00:00.000Z');
    expect(startOfTodayUtcForQatar(new Date('2026-09-30T21:01:00Z')).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });
});


const req = (h: Record<string, string>) => ({ headers: h }) as unknown as Request;

describe('admin panel sessions', () => {
  it('only staff may open an admin session; couriers and customers may not', () => {
    expect(isStaff({ permissions: ['orders.read'] })).toBe(true);
    expect(isStaff({ permissions: ['products.read', 'inventory.manage'] })).toBe(true);
    expect(isStaff({ permissions: [] })).toBe(false);
    expect(isStaff({ permissions: ['delivery.update_own'] })).toBe(false);
    // drivers sign in to the same app, but only reach the driver page
    expect(canUsePanel({ permissions: ['delivery.update_own'] })).toBe(true);
    expect(canUsePanel({ permissions: [] })).toBe(false);
  });
  it('the admin panel is recognised by its client header (separate refresh cookie)', () => {
    expect(isAdminClient(req({ 'x-client-type': 'admin' }))).toBe(true);
    expect(isAdminClient(req({}))).toBe(false);
    expect(isMobileClient(req({ 'x-client-type': 'admin' }))).toBe(false);
  });
});

describe('staff roles', () => {
  it('every seeded staff role can be granted from the Staff screen', () => {
    for (const r of ['CATALOG_MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'SUPER_ADMIN', 'SUPPORT_ADMIN']) {
      expect(ADMIN_ROLES as readonly string[]).toContain(r);
    }
    expect(ADMIN_ROLES as readonly string[]).not.toContain('CUSTOMER');
    expect(ADMIN_ROLES as readonly string[]).not.toContain('SELLER');
  });
});

describe('stock changes', () => {
  const check = (o: object) => validateSync(plainToInstance(AdjustStockDto, o)).map((e) => e.property);
  it('accepts a quantity change, or an alert-level change on its own', () => {
    expect(check({ delta: 5, reason: 'RESTOCK' })).toEqual([]);
    expect(check({ delta: -2, reason: 'ADJUSTMENT', note: 'damaged' })).toEqual([]);
    expect(check({ delta: 0, reason: 'ADJUSTMENT', lowStockThreshold: 3 })).toEqual([]);
    expect(check({ delta: 1.5, reason: 'RESTOCK' })).toContain('delta');
    expect(check({ delta: 5, reason: 'COMMIT' })).toContain('reason');
  });
});
