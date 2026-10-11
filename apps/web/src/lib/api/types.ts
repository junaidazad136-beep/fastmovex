/**
 * Response shapes of the FastMoveX API (apps/api) that the website uses.
 * Money is always a string of minor units; dates are ISO strings.
 */

export type Minor = string;

export interface Market {
  code: string;
  name: string;
  nameAr: string;
  currency: { code: string; symbol: string; minorUnits: number };
  defaultLocale: string;
  locales: string[];
  vatRateBps: number;
  pricesIncludeTax: boolean;
  paymentMethods: PaymentMethod[];
  delivery: { flatFeeMinor: Minor | null; freeOverMinor: Minor | null; label: string | null };
  addressFormat: { fields: AddressField[]; required: AddressField[] };
  legal: { termsUrl?: string; privacyUrl?: string; [k: string]: unknown };
  isDefault: boolean;
  testPayments: boolean;
  /** Gateway serving card payments ('dibsy' = hosted page with cards, Apple Pay, Google Pay, Himyan). */
  cardProvider?: string | null;
  /** Shoppers may order without an account (set per market in the admin panel). */
  guestCheckout: boolean;
  /** updates: order updates can be sent on WhatsApp; chat: number customers can message (digits) */
  whatsapp?: { updates: boolean; chat: string | null };
  /** Cash-on-delivery limits (the API checks them again): largest COD order; guests/accounts verify their mobile first. */
  cod?: { maxOrderMinor: Minor | null; guestPhoneCheck: boolean; accountPhoneCheck: boolean; guestAvailable: boolean };
  /** search-engine verification codes and the shop's social profiles */
  seo?: { googleVerification: string | null; bingVerification: string | null; social: Partial<Record<'instagram' | 'facebook' | 'tiktok' | 'x' | 'youtube' | 'snapchat' | 'linkedin', string>> };
}

/** Text written for search engines (category and brand pages), both languages. */
export interface SeoText {
  description?: string | null; descriptionAr?: string | null;
  seoTitle?: string | null; seoTitleAr?: string | null;
  seoDescription?: string | null; seoDescriptionAr?: string | null;
}
export interface FaqEntry { q: string; qAr: string; a: string; aAr: string }
export interface BrandDetail extends SeoText { slug: string; name: string; nameAr: string | null; logoUrl: string | null; productCount: number }

export type PaymentMethod = 'CARD' | 'APPLE_PAY' | 'GOOGLE_PAY' | 'COD';
export type AddressField = 'city' | 'zone' | 'street' | 'building' | 'unit' | 'line1' | 'postalCode';

export interface StoreRef { slug: string; name: string; nameAr: string | null }

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  titleAr: string | null;
  imageUrl: string | null;
  priceMinor: Minor;
  compareAtMinor: Minor | null;
  discountPercent: number;
  currencyCode: string;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  inStock: boolean;
  lowStockCount: number | null;
  store: StoreRef;
  isSponsored: boolean;
  dealPriceMinor: Minor | null;
  dealEndsAt: string | null;
  dealStockLeft?: number | null;
  /** Set when the card's "Add" can put the product straight in the cart (one option, in stock). */
  quickAddVariantId?: string | null;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  nameAr: string;
  iconUrl: string | null;
  sortOrder: number;
  children: CategoryNode[];
}

export interface Crumb { slug: string; name: string; nameAr: string }

export interface CategoryDetail extends SeoText {
  faq?: FaqEntry[];
  id: string;
  slug: string;
  name: string;
  nameAr: string;
  imageUrl: string | null;
  breadcrumbs: Crumb[];
  children: { slug: string; name: string; nameAr: string; iconUrl?: string | null }[];
}

export interface Banner {
  id: string; imageUrl: string | null; linkUrl: string | null; placement: string;
  /** Text drawn on the banner (hero): badge, headline (≤2 lines, *accent*), line under it, button. */
  kicker?: string | null; kickerAr?: string | null; headline?: string | null; headlineAr?: string | null;
  subline?: string | null; sublineAr?: string | null; ctaLabel?: string | null; ctaLabelAr?: string | null;
}
export interface StoreCard extends StoreRef { ratingAvg: number; ratingCount: number; logoUrl: string | null }

/** Where a section's "View all" leads (built by the website into a search, category or offers link). */
export type ViewAll = { category?: string; q?: string; sort?: string; offers?: boolean } | null;
/** Titles set in the admin panel override the built-in ones. */
type SectionCommon = { key: string; title?: string | null; titleAr?: string | null; viewAll?: ViewAll };
export type HomeSection = SectionCommon & (
  | { type: 'banners'; items: Banner[] }
  | { type: 'categories'; items: { slug: string; name: string; nameAr: string; iconUrl: string | null; imageUrl?: string | null }[] }
  | { type: 'deals'; items: ProductCard[]; endsAt: string | null }
  | { type: 'products'; items: ProductCard[] }
  | { type: 'stores'; items: StoreCard[] }
  | { type: 'value_props'; items: never[] }
);

export interface HomeFeed { country: string; currencyCode: string; sections: HomeSection[] }

export type SearchSort = 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest' | 'popular';

export interface SearchResult {
  items: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
  facets: {
    categories: { slug: string; name: string; nameAr: string; count: number }[];
    brands: { slug: string; name: string; count: number }[];
    price: { minMinor: Minor | null; maxMinor: Minor | null };
  };
  query: { q?: string; sort: SearchSort; matchMode?: 'all' | 'any' };
  /** auto: these are results for `corrected` (nothing matched what was typed); otherwise a "Did you mean" suggestion */
  spelling?: { original: string; corrected: string; auto: boolean };
  /** only when nothing was found */
  noResults?: { popular: string[]; products: ProductCard[] };
}

export interface Suggestions {
  /** with the first photo, lowest price, stock and category (older API answers lack them) */
  products: { slug: string; title: string; titleAr: string | null; priceMinor?: Minor; imageUrl?: string | null; inStock?: boolean; category?: string; categoryAr?: string }[];
  categories: { slug: string; name: string; nameAr: string }[];
  brands: { slug: string; name: string; nameAr?: string | null }[];
  /** popular searches starting like the text typed */
  queries?: string[];
}

export interface Variant {
  id: string;
  sku: string;
  optionValues: Record<string, string>;
  priceMinor: Minor;
  compareAtMinor: Minor | null;
  currencyCode: string;
  discountPercent: number;
  inStock: boolean;
  lowStockCount: number | null;
  dealPriceMinor: Minor | null;
  dealEndsAt: string | null;
  dealStockLeft: number | null;
  /** a real barcode number (EAN/UPC), for search engines */
  gtin?: string | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  titleAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  specs: Record<string, string> | null;
  returnPolicyDays: number | null;
  returnWindowDays: number;
  warrantyMonths: number | null;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  minPriceMinor: Minor;
  countryCode: string;
  brand: { name: string; nameAr?: string | null; slug: string } | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  category: { slug: string; name: string; nameAr: string };
  breadcrumbs: Crumb[];
  store: StoreRef & { ratingAvg: number; ratingCount: number; logoUrl: string | null };
  images: { id: string; kind: 'IMAGE' | 'VIDEO'; altText: string | null; variantId: string | null; url: string | null }[];
  variants: Variant[];
}

export interface Review {
  id: string;
  rating: number;
  body: string | null;
  images: string[];
  isVerifiedPurchase: boolean;
  createdAt: string;
  author: string;
}

export interface ReviewPhoto { url: string; reviewId: string; rating: number }

export interface ReviewPage {
  summary: { ratingAvg: number; ratingCount: number; photoReviews?: number };
  histogram?: { rating: number; count: number }[];
  /** "Customer photos" (first page only) */
  photos?: ReviewPhoto[];
  nextCursor: string | null;
  items: Review[];
}

export interface StoreDetail {
  slug: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  city: string | null;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  productCount: number;
  verified: boolean;
}

export type LineIssue = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'PRICE_CHANGED' | 'WRONG_COUNTRY';
export type CouponReason =
  | 'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'USAGE_LIMIT' | 'LOGIN_REQUIRED'
  | 'PER_USER_LIMIT' | 'FIRST_ORDER_ONLY' | 'NEW_CUSTOMERS_ONLY' | 'MIN_ORDER' | 'NO_ELIGIBLE_ITEMS';

export interface CartItem {
  id: string;
  variantId: string;
  productSlug: string;
  title: string;
  titleAr: string | null;
  imageUrl: string | null;
  sku: string;
  options: Record<string, string>;
  quantity: number;
  available: number;
  maxQuantity: number;
  unitPriceMinor: Minor;
  listPriceMinor: Minor;
  compareAtMinor: Minor | null;
  onDeal: boolean;
  lineSubtotalMinor: Minor;
  discountMinor: Minor;
  priceChangedFromMinor: Minor | null;
  issues: LineIssue[];
}

export interface CartGroup {
  store: StoreRef;
  items: CartItem[];
  subtotalMinor: Minor;
  discountMinor: Minor;
  deliveryFeeMinor: Minor;
  deliveryWaived: boolean;
  deliveryLabel: string | null;
  taxMinor: Minor;
  totalMinor: Minor;
}

export type CartCoupon =
  | { code: string; applied: true; discountMinor: Minor; freeDelivery: boolean }
  | { code: string; applied: false; message: string; reason?: CouponReason; shortByMinor?: Minor | null };

export interface Cart {
  cartToken: string | null;
  currencyCode: string;
  groups: CartGroup[];
  coupon: CartCoupon | null;
  totals: {
    itemCount: number;
    subtotalMinor: Minor;
    discountMinor: Minor;
    deliveryFeeMinor: Minor;
    taxMinor: Minor;
    taxIncluded: boolean;
    totalMinor: Minor;
  };
  canCheckout: boolean;
  notices: string[];
}

/** POST /auth/login when the account has two-step sign-in on: no tokens yet, send the code to POST /auth/2fa/login. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
  /** seconds the challenge stays valid (300) */
  expiresIn: number;
}

export interface Me {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  locale: string;
  countryCode: string;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  createdAt: string;
  marketingOptIn: boolean;
  whatsappOptIn?: boolean;
  seller: { id: string; status: string; store: { slug: string; name: string } | null } | null;
  roles: string[];
  /** account deletion scheduled (PDPPL): the date it happens unless the customer keeps the account */
  deletion?: { deleteOn: string } | null;
  /** false for accounts made with Google / Apple that never set a password */
  hasPassword?: boolean;
  /** linked sign-ins */
  signIns?: SocialProvider[];
}

export type SocialProvider = 'GOOGLE' | 'APPLE';
export interface SocialProviders { google: string | null; apple: string | null }
export interface LinkedSignIn { provider: SocialProvider; email: string | null; createdAt: string; lastUsedAt: string | null }
export interface BuyAgainResult { added: { variantId: string; title: string; quantity: number }[]; skipped: { variantId: string; title: string; reason: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'CART_FULL' }[] }
export interface DeliveryEta { at: string; minutes: number; stopsBefore: number }

export interface DeletionStatus {
  requested: boolean;
  requestedAt: string | null;
  deleteOn: string | null;
  graceDays: number;
  blockers: { reason: 'OPEN_ORDERS' | 'OPEN_RETURNS' | 'REFUNDS_PENDING'; count: number }[];
}

export interface Address {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  countryCode: string;
  city: string;
  zone: string | null;
  street: string | null;
  building: string | null;
  unit: string | null;
  line1: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt: string;
}

export type OrderStatus =
  | 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'SHIPPED' | 'OUT_FOR_DELIVERY'
  | 'DELIVERED' | 'CANCELLED' | 'RETURN_REQUESTED' | 'RETURNED' | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type DeliveryStatus = 'CREATED' | 'ASSIGNED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED' | 'CANCELLED';

export interface CheckoutResult {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalMinor: Minor;
  currencyCode: string;
  placedAt: string;
  payment: { status: PaymentStatus; redirectUrl: string | null; failureReason: string | null };
  /** Guest checkout only: opens the order page without an account. */
  orderAccessToken?: string;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currencyCode: string;
  placedAt: string;
  createdAt: string;
  totalMinor: Minor;
  itemCount: number;
  preview: { title: string; quantity: number; imageUrl: string | null }[];
}

export interface OrderItem {
  id: string;
  variantId: string;
  productTitle: string;
  productSlug: string;
  sku: string;
  imageUrl: string | null;
  unitPriceMinor: Minor;
  quantity: number;
  discountMinor: Minor;
  taxMinor: Minor;
  lineTotalMinor: Minor;
  refundedQty: number;
  status: OrderStatus;
  returnDeadline: string | null;
  returnableQty: number;
  openReturnQty: number;
}

export interface SellerOrder {
  id: string;
  status: OrderStatus;
  deliveryMethod: 'SELLER' | 'JOVIA' | 'THIRD_PARTY' | 'PICKUP';
  subtotalMinor: Minor;
  discountMinor: Minor;
  deliveryFeeMinor: Minor;
  taxMinor: Minor;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  seller: { store: StoreRef };
  items: OrderItem[];
  delivery: {
    method?: string;
    status: DeliveryStatus; trackingUrl: string | null; etaAt: string | null; courierName: string | null;
    /** FastMoveX driver deliveries: give this code to the driver when the order arrives (null once delivered). */
    deliveryCode?: string | null;
    /** where the driver is, while on the way */
    location?: { lat: number; lng: number; mapUrl: string } | null;
    /** The last attempt failed (only while the delivery is FAILED): why, and whether the customer can choose what happens next. */
    attempt?: DeliveryAttempt | null;
    /** What the customer already asked for after the missed delivery (API wording, e.g. "Customer: After 5 pm, call first"). */
    request?: { text: string; at: string | null } | null;
    /** While out for delivery: when the driver should arrive (from the driver's position and stops before yours). */
    eta?: DeliveryEta | null;
  } | null;
}

export type DeliveryFailureKind = 'NO_ANSWER' | 'NOT_HOME' | 'ADDRESS' | 'ANOTHER_DAY' | 'REFUSED' | 'OTHER';

export interface DeliveryAttempt {
  failedAt: string | null;
  kind: DeliveryFailureKind | null;
  /** false when the order was refused at the door (it goes back to the seller) */
  canReschedule: boolean;
}

/** POST /orders/:orderNumber/reschedule (and the guest twin) */
export interface RescheduleResult { ok: true; request: string }

export interface OrderDetail {
  /** true when opened with a guest order link (no account). */
  guest?: boolean;
  /** Delivery window the customer chose (null = as soon as possible) */
  deliverySlotStart?: string | null;
  deliverySlotEnd?: string | null;
  id: string;
  orderNumber: string;
  countryCode: string;
  currencyCode: string;
  status: OrderStatus;
  subtotalMinor: Minor;
  discountMinor: Minor;
  deliveryFeeMinor: Minor;
  taxMinor: Minor;
  totalMinor: Minor;
  shippingAddress: Partial<Address> & { recipientName: string; phone: string; city: string };
  customerNote: string | null;
  placedAt: string;
  canCancel: boolean;
  sellerOrders: SellerOrder[];
  payments: { method: PaymentMethod; status: PaymentStatus; amountMinor: Minor; createdAt: string }[];
  history: { fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string }[];
  /** what the customer can download: the invoice (once confirmed), credit notes for refunds paid, receipts for returned items */
  documents?: OrderDocuments;
  /** changes after checkout (by our team, by the customer, at the door) */
  changes?: OrderChange[];
  /** whether the customer may still change the window / address themselves */
  changeOptions?: { canChange: boolean; changesLeft: number };
}

export interface OrderChange { kind: 'ITEMS' | 'ADDED' | 'ADDRESS' | 'SLOT' | 'DOOR_REFUSAL'; byRole: 'STAFF' | 'CUSTOMER' | 'DRIVER'; summary: string; amountMinor: Minor; createdAt: string }

export interface OrderDocuments {
  invoice: boolean;
  creditNotes: { id: string; number: string; at: string; amountMinor: Minor }[];
  returnReceipts: { id: string; number: string; at: string; title: string; quantity: number; condition: 'SELLABLE' | 'DAMAGED' | 'NOT_ACCEPTED' | null }[];
}

export interface ReturnRequest {
  id: string;
  quantity: number;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'REFUNDED';
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  orderItem: { productTitle: string; sku: string; order: { orderNumber: string } };
  /** a driver collects the item (date in Qatar, YYYY-MM-DD) */
  pickup?: { status: 'ASSIGNED' | 'COLLECTED' | 'FAILED' | 'CANCELLED'; date: string } | null;
}

export interface WishlistSummary { id: string; name: string; isDefault: boolean; _count: { items: number } }

export interface WishlistItem {
  productId: string;
  addedAt: string;
  notifyPriceDrop: boolean;
  notifyBackInStock: boolean;
  priceWhenAddedMinor: Minor | null;
  priceDroppedByMinor: Minor | null;
  available: boolean;
  product: ProductCard;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { orderNumber?: string; [k: string]: unknown } | null;
  readAt: string | null;
  createdAt: string;
}

export interface Paged<T> { items: T[]; nextCursor: string | null }

export interface Reviewable { orderItemId: string; title: string; imageUrl: string | null; orderNumber: string }

export interface MyReview {
  id: string;
  target: 'PRODUCT' | 'SELLER';
  rating: number;
  body: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  images: string[];
  product: { slug: string; title: string } | null;
}

export interface ProductQuestion {
  id: string;
  question: string;
  answer: string;
  askedBy: string;
  askedAt: string;
  answeredAt: string;
  answeredBy: { name: string; nameAr: string | null };
}

export interface QuestionPage { total?: number; nextCursor: string | null; items: ProductQuestion[] }

export interface MyQuestion {
  id: string;
  question: string;
  status: 'PENDING' | 'ANSWERED' | 'REJECTED';
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
  product: { slug: string; title: string; titleAr: string | null };
}

export interface Faq { id: string; category: string; question: string; questionAr: string | null; answer: string; answerAr: string | null }

export interface TicketSummary { number: string; subject: string; category: string; status: TicketStatus; updatedAt: string; order: { orderNumber: string } | null }
export type TicketStatus = 'OPEN' | 'PENDING_CUSTOMER' | 'PENDING_SELLER' | 'RESOLVED' | 'CLOSED';
export interface TicketDetail {
  number: string;
  subject: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  order: { orderNumber: string } | null;
  messages: { body: string; createdAt: string; fromYou: boolean }[];
}

export interface Brand { id: string; name: string; slug: string }

export interface PageSummary { slug: string; title: string; titleAr: string; showInFooter: boolean; sortOrder: number; updatedAt: string }
export interface ContentPage extends PageSummary { body: string; bodyAr: string }

export interface Offers {
  currencyCode: string;
  campaigns: { id: string; name: string; nameAr: string | null; type: string; endsAt: string; items: ProductCard[] }[];
  sale: ProductCard[];
}

export interface DeliverySlot {
  start: string;
  end: string;
  from: string;
  to: string;
  left: number;
  available: boolean;
}
export interface DeliverySlots {
  enabled: boolean;
  required: boolean;
  timezone: string;
  days: { date: string; weekday: number; slots: DeliverySlot[] }[];
}
