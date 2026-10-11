/** Shapes of the admin API answers used across screens. Money is always a string of minor units. */

export interface CursorPage<T> { items: T[]; nextCursor: string | null }
export interface NumberedPage<T> { items: T[]; total: number; page: number; pageCount: number; limit?: number }

export interface Overview {
  currencyCode: string;
  from: string;
  to: string;
  orders: number;
  gmvMinor: string;
  averageOrderValueMinor: string;
  commissionRevenueMinor: string;
  refunds: { count: number; amountMinor: string; rateBps: number };
  buyers: number;
  newCustomers: number;
  cartToOrderRateBps: number;
  activeSellers: number;
  activeProducts: number;
  pendingApprovals: { sellers: number; products: number };
  pendingPayouts: { count: number; amountMinor: string };
}

export interface Timeseries { bucket: string; timezone: string; currencyCode: string; points: { t: string; orders: number; gmvMinor: string }[] }
export interface TopItems { kind: string; currencyCode: string; items: { id: string; name: string; units: number; orders: number; gmvMinor: string }[] }

export interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  currencyCode: string;
  placedAt: string | null;
  createdAt: string;
  totalMinor: string;
  user: { id: string; fullName: string; phone: string | null; tags?: string[] } | null;
  _count: { sellerOrders: number; items: number };
  sellerOrders: { status: string; deliveryMethod: string }[];
  payment: { method: string; status: string } | null;
  deliverySlotStart?: string | null;
  deliverySlotEnd?: string | null;
}

export interface Category { id: string; name: string; nameAr: string; slug: string; parentId: string | null; sortOrder: number; isActive: boolean; _count?: { products: number; children: number } }
export interface Brand { id: string; name: string; slug: string }
