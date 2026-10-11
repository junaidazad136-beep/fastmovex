import { NotFoundException } from '@nestjs/common';

/**
 * Use after loading any seller-owned row (product, seller order, coupon, payout...).
 * Returns 404, not 403, so nobody can probe which ids exist in other stores.
 *
 *   const product = await prisma.product.findUnique({ where: { id }, select: { id: true, store: { select: { sellerId: true } } } });
 *   assertOwnedBy(product && { sellerId: product.store.sellerId }, seller.id, 'Product');
 */
export function assertOwnedBy<T extends { sellerId: string }>(
  resource: T | null | undefined,
  sellerId: string,
  name = 'Resource',
): asserts resource is T {
  if (!resource || resource.sellerId !== sellerId) {
    throw new NotFoundException(`${name} not found`);
  }
}
