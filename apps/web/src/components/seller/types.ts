import type { OrderStatus } from '@/lib/api/types';

export type SellerStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type ProductStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED';

export interface SellerMe {
  id: string;
  businessName: string;
  legalName: string | null;
  commercialRegNo: string | null;
  contactEmail: string;
  contactPhone: string;
  status: SellerStatus;
  rejectionReason: string | null;
  bankName: string | null;
  accountHolder: string | null;
  ibanLast4: string | null;
  store: {
    id: string; slug: string; name: string; nameAr: string | null; description: string | null; descriptionAr: string | null;
    logoUrl: string | null; bannerUrl: string | null; city: string | null; isActive: boolean;
  } | null;
  documents: { id: string; type: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; note: string | null; createdAt: string }[];
  checklist: { key: string; label: string; done: boolean }[];
}

export interface SellerSummary {
  orders: { new: number; packing: number; ready: number; onTheWay: number; delivered: number; cancelled: number };
  newestNew: { id: string; at: string } | null;
  products: { live: number; inReview: number; draft: number; rejected: number; lowStock: number };
}

export interface SellerOrderRow {
  id: string;
  status: OrderStatus;
  orderNumber: string;
  currencyCode: string;
  placedAt: string;
  itemCount: number;
  city: string | null;
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  commissionMinor: string;
  sellerNetMinor: string;
}

export interface SellerOrderDetail {
  id: string;
  status: OrderStatus;
  deliveryMethod: string;
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  commissionMinor: string;
  sellerNetMinor: string;
  order: { orderNumber: string; currencyCode: string; placedAt: string; customerNote: string | null; deliverySlotStart: string | null; deliverySlotEnd: string | null; shipments: number };
  cashToCollectMinor: string | null;
  customer: { name: string };
  shippingAddress: { recipientName?: string; phone?: string; city?: string; zone?: string; street?: string; building?: string; unit?: string; line1?: string; lat?: number; lng?: number };
  items: { id: string; productTitle: string; sku: string; quantity: number; refundedQty: number; unitPriceMinor: string; lineTotalMinor: string; status: string; imageUrl: string | null }[];
  history: { fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string }[];
  delivery: { status: string; courierUserId: string | null } | null;
}

export interface SellerProductRow {
  id: string;
  title: string;
  slug: string;
  status: ProductStatus;
  minPriceMinor: string | null;
  soldCount: number;
  createdAt: string;
  moderationNote: string | null;
  category: { name: string } | null;
  imageUrl: string | null;
  variantCount: number;
  availableStock: number;
  lowStock: boolean;
}

export interface SellerProductDetail {
  id: string;
  title: string;
  titleAr: string | null;
  slug: string;
  status: ProductStatus;
  description: string | null;
  descriptionAr: string | null;
  shortDescription?: string | null;
  shortDescriptionAr?: string | null;
  brandId?: string | null;
  categoryId: string;
  warrantyMonths: number | null;
  returnPolicyDays: number | null;
  moderationNote: string | null;
  images: { id: string; url: string | null; sortOrder: number; variantId?: string | null }[];
  variants: {
    id: string; sku: string; barcode: string | null; priceMinor: string; compareAtMinor: string | null; isActive: boolean;
    optionValues: Record<string, string> | null; inventory: { onHand: number; reserved: number; lowStockThreshold: number } | null;
  }[];
}

export interface SellerBalance {
  pendingMinor: string;
  availableMinor: string;
  inPayoutMinor: string;
  requestableMinor: string;
  paidOutMinor: string;
  minimumPayoutMinor: string;
}

export interface SellerPayout { id: string; amountMinor: string; status: 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED'; requestedAt: string; paidAt?: string | null }

export interface StatementRow {
  id: string;
  amountMinor: string;
  createdAt: string;
  account: { type: string; currencyCode: string };
  transaction: { type: string; refType: string | null; refId: string | null; description: string | null };
}
