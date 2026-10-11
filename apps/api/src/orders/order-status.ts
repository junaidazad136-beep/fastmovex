import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

export type Actor = 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'SYSTEM';

/** Progress order of a seller shipment. Used to derive the customer-facing status of a mixed order. */
export const STAGE: Record<OrderStatus, number> = {
  PENDING: 0, CONFIRMED: 1, PREPARING: 2, READY_FOR_PICKUP: 3, SHIPPED: 4, OUT_FOR_DELIVERY: 5, DELIVERED: 6,
  RETURN_REQUESTED: 7, RETURNED: 8, REFUNDED: 9, CANCELLED: 10,
};

const SELLER_FLOW: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'SHIPPED', 'CANCELLED'],
  READY_FOR_PICKUP: ['SHIPPED', 'OUT_FOR_DELIVERY'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};

/** Stock is physically committed when the shipment leaves the seller. */
export const COMMITS_STOCK: OrderStatus[] = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PENDING', 'CONFIRMED'];

export function allowedNext(from: OrderStatus, actor: Actor): OrderStatus[] {
  if (actor === 'CUSTOMER') return CUSTOMER_CANCELLABLE.includes(from) ? ['CANCELLED'] : [];
  const flow = SELLER_FLOW[from] ?? [];
  if (actor === 'ADMIN') {
    // Admin can also cancel anything that has not left the seller yet (support / fraud cases)
    const canCancel = !COMMITS_STOCK.includes(from) && from !== 'CANCELLED';
    return [...new Set([...flow, ...(canCancel ? (['CANCELLED'] as OrderStatus[]) : [])])];
  }
  return flow;
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor) {
  if (from === to) throw new BadRequestException(`Order is already ${to.toLowerCase().replace(/_/g, ' ')}`);
  if (!allowedNext(from, actor).includes(to)) {
    throw new BadRequestException(`Cannot change a ${from.toLowerCase().replace(/_/g, ' ')} order to ${to.toLowerCase().replace(/_/g, ' ')}`);
  }
}

/**
 * One customer order can contain several seller shipments. The customer sees a single status:
 * the least advanced live shipment, or CANCELLED only when every shipment was cancelled.
 */
export function deriveOrderStatus(sellerStatuses: OrderStatus[]): OrderStatus {
  if (!sellerStatuses.length) return 'PENDING';
  const live = sellerStatuses.filter((s) => s !== 'CANCELLED');
  if (!live.length) return 'CANCELLED';
  if (live.every((s) => s === 'REFUNDED')) return 'REFUNDED';
  if (live.every((s) => s === 'DELIVERED')) return 'DELIVERED';
  return live.reduce((min, s) => (STAGE[s] < STAGE[min] ? s : min), live[0]);
}

/** FMX-QA-260922-4F9A2C */
export function buildOrderNumber(countryCode: string, now: Date, random: string): string {
  const d = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `FMX-${countryCode}-${d}-${random.toUpperCase()}`;
}
