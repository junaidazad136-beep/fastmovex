import type { OrderStatus } from '@/lib/api/types';

const TONE: Record<OrderStatus, string> = {
  PENDING: 'bg-warning-50 text-warning-600',
  CONFIRMED: 'bg-sky-50 text-sky-700',
  PREPARING: 'bg-sky-50 text-sky-700',
  READY_FOR_PICKUP: 'bg-sky-50 text-sky-700',
  SHIPPED: 'bg-indigo-50 text-indigo-700',
  OUT_FOR_DELIVERY: 'bg-indigo-50 text-indigo-700',
  DELIVERED: 'bg-success-50 text-success-700',
  CANCELLED: 'bg-ink-100 text-ink-600',
  RETURN_REQUESTED: 'bg-warning-50 text-warning-600',
  RETURNED: 'bg-ink-100 text-ink-700',
  REFUNDED: 'bg-ink-100 text-ink-700',
};

export function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[status]}`} data-testid="order-status">{label}</span>;
}
