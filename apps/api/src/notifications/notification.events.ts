/** Domain events. Services emit these AFTER their transaction commits; listeners never block the request. */
export const EVENTS = {
  ORDER_PLACED: 'order.placed',
  ORDER_CONFIRMED: 'order.confirmed',
  PAYMENT_FAILED: 'payment.failed',
  SHIPMENT_STATUS: 'shipment.status',
  REFUND_SUCCEEDED: 'refund.succeeded',
  RETURN_UPDATED: 'return.updated',
  SELLER_APPROVED: 'seller.approved',
  SELLER_REJECTED: 'seller.rejected',
  PAYOUT_PAID: 'payout.paid',
  TICKET_REPLIED: 'ticket.replied',
  PRICE_CHANGED: 'product.price_changed',
  VARIANT_RESTOCKED: 'variant.restocked',
  // staff alerts
  DELIVERY_FAILED: 'delivery.failed',
  REFUND_REQUESTED: 'refund.requested',
  STOCKTAKE_SUBMITTED: 'stocktake.submitted',
  CASH_SHORT: 'cash.short',
} as const;

export interface OrderEvent { orderId: string }
export interface ShipmentStatusEvent { sellerOrderId: string; status: string }
export interface IdEvent { id: string; reason?: string; status?: string }
