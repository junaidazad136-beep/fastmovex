import { pickWarehouse, type Candidate } from '../src/warehouses/warehouses';

const wh = (id: string, free: Record<string, number>, extra: Partial<Candidate> = {}): Candidate => ({ id, isDefault: false, priority: 100, zones: [], free: new Map(Object.entries(free)), ...extra });
const need = [{ variantId: 'a', quantity: 2 }, { variantId: 'b', quantity: 1 }];

describe('which warehouse sends a shipment', () => {
  it('the one that has everything wins over a bigger one that does not', () => {
    expect(pickWarehouse([wh('main', { a: 50, b: 0 }, { isDefault: true }), wh('wakrah', { a: 2, b: 1 })], need)).toBe('wakrah');
  });
  it('among those with everything: closest to the delivery zone, then priority, then the default', () => {
    const both = { a: 5, b: 5 };
    expect(pickWarehouse([wh('main', both, { isDefault: true }), wh('wakrah', both, { zones: ['90', '91'] })], need, '91')).toBe('wakrah');
    expect(pickWarehouse([wh('main', both, { isDefault: true }), wh('wakrah', both, { zones: ['90'] })], need, '25')).toBe('main');
    expect(pickWarehouse([wh('main', both, { isDefault: true, priority: 100 }), wh('lusail', both, { priority: 10 })], need, null)).toBe('lusail');
  });
  it('nobody has everything: the one that has the most of the order', () => {
    expect(pickWarehouse([wh('x', { a: 1, b: 1 }), wh('y', { a: 2, b: 0 }), wh('z', { a: 0, b: 0 }, { isDefault: true })], need)).toBe('x');
  });
  it('no warehouses: none', () => {
    expect(pickWarehouse([], need)).toBeNull();
  });
});
