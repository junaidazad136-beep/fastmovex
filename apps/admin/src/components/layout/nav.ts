import {
  CalendarClock, ClipboardCheck, PackageCheck, ClipboardList, CreditCard, Factory, TrendingDown,
  Banknote, BadgePercent, BarChart3, Boxes, Truck, MessageCircleQuestion, FileSpreadsheet, FileText, LayoutTemplate, Mail, FolderTree, Image as ImageIcon, LayoutDashboard, LifeBuoy, MessageSquareText,
  Languages, Package, Phone, PiggyBank, Receipt, Ruler, Search, Warehouse, RotateCcw, ScrollText, Settings, ShieldCheck, ShoppingBag, Store, Tag, Users, UserCog, Zap, type LucideIcon,
} from 'lucide-react';

export type SummaryKey =
  | 'shipmentsToFulfil' | 'ordersAwaitingPayment' | 'lowStockVariants' | 'outOfStockVariants' | 'productsPendingReview'
  | 'openReturns' | 'refundsToApprove' | 'cashOverdue' | 'reviewsPending' | 'questionsPending' | 'deliveriesToAssign' | 'openTickets' | 'sellersPending' | 'newMessages'
  | 'lotsExpiringSoon' | 'purchaseOrdersToReceive' | 'stockCountsToApprove' | 'cardPaymentsStuck';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Every listed permission is needed (same rule as the API). */
  perms: string[];
  badge?: SummaryKey;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard, perms: [] }] },
  {
    label: 'Sales',
    items: [
      { href: '/orders', label: 'Orders', icon: ShoppingBag, perms: ['orders.read'], badge: 'shipmentsToFulfil' },
      { href: '/orders/new', label: 'Phone order', icon: Phone, perms: ['orders.create'] },
      { href: '/fulfilment', label: 'Picking & packing', icon: PackageCheck, perms: ['orders.read'] },
      { href: '/returns', label: 'Returns', icon: RotateCcw, perms: ['returns.manage'], badge: 'openReturns' },
      { href: '/deliveries', label: 'Deliveries', icon: Truck, perms: ['delivery.read'], badge: 'deliveriesToAssign' },
      { href: '/payments', label: 'Payments & closing', icon: CreditCard, perms: ['payments.read'], badge: 'cardPaymentsStuck' },
      { href: '/refunds', label: 'Refunds', icon: Receipt, perms: ['payments.read'], badge: 'refundsToApprove' },
      { href: '/cash', label: 'Cash on delivery', icon: Banknote, perms: ['cash.read'], badge: 'cashOverdue' },
      { href: '/reports/margin', label: 'Profit & margin', icon: PiggyBank, perms: ['reports.margin'] },
      { href: '/customers', label: 'Customers', icon: Users, perms: ['users.read'] },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { href: '/products', label: 'Products', icon: Package, perms: ['products.read'], badge: 'productsPendingReview' },
      { href: '/products/import', label: 'Import / export', icon: FileSpreadsheet, perms: ['products.manage'] },
      { href: '/categories', label: 'Categories', icon: FolderTree, perms: ['categories.manage'] },
      { href: '/brands', label: 'Brands', icon: Tag, perms: ['products.moderate'] },
      { href: '/size-charts', label: 'Size guides', icon: Ruler, perms: ['products.read'] },
      { href: '/translation', label: 'Arabic translation', icon: Languages, perms: ['products.read'] },
    ],
  },
  {
    label: 'Stock',
    items: [
      { href: '/inventory', label: 'Inventory', icon: Boxes, perms: ['products.read'], badge: 'lowStockVariants' },
      { href: '/purchase-orders', label: 'Purchase orders', icon: ClipboardList, perms: ['products.read'], badge: 'purchaseOrdersToReceive' },
      { href: '/suppliers', label: 'Suppliers', icon: Factory, perms: ['products.read'] },
      { href: '/stock-counts', label: 'Stocktake', icon: ClipboardCheck, perms: ['products.read'], badge: 'stockCountsToApprove' },
      { href: '/expiry', label: 'Expiry dates', icon: CalendarClock, perms: ['products.read'], badge: 'lotsExpiringSoon' },
      { href: '/shrinkage', label: 'Losses', icon: TrendingDown, perms: ['products.read'] },
      { href: '/warehouses', label: 'Warehouses', icon: Warehouse, perms: ['products.read'] },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/coupons', label: 'Coupons', icon: BadgePercent, perms: ['coupons.manage'] },
      { href: '/campaigns', label: 'Flash sales', icon: Zap, perms: ['campaigns.manage'] },
      { href: '/home-page', label: 'Home page', icon: LayoutTemplate, perms: ['banners.manage'] },
      { href: '/banners', label: 'Banners', icon: ImageIcon, perms: ['banners.manage'] },
      { href: '/traffic', label: 'Traffic & funnel', icon: BarChart3, perms: ['analytics.read'] },
      { href: '/search-insights', label: 'Search', icon: Search, perms: ['analytics.read'] },
    ],
  },
  {
    label: 'Customer care',
    items: [
      { href: '/messages', label: 'Messages', icon: Mail, perms: ['tickets.read'], badge: 'newMessages' },
      { href: '/tickets', label: 'Support tickets', icon: LifeBuoy, perms: ['tickets.read'], badge: 'openTickets' },
      { href: '/reviews', label: 'Reviews', icon: MessageSquareText, perms: ['reviews.moderate'], badge: 'reviewsPending' },
      { href: '/questions', label: 'Product questions', icon: MessageCircleQuestion, perms: ['reviews.moderate'], badge: 'questionsPending' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings', label: 'Store & delivery', icon: Settings, perms: ['countries.manage'] },
      { href: '/pages', label: 'Pages', icon: FileText, perms: ['settings.manage'] },
      { href: '/sellers', label: 'Sellers', icon: Store, perms: ['sellers.read'], badge: 'sellersPending' },
      { href: '/staff', label: 'Staff', icon: UserCog, perms: ['admins.manage'] },
      { href: '/roles', label: 'Roles & permissions', icon: ShieldCheck, perms: ['roles.manage'] },
      { href: '/audit', label: 'Audit log', icon: ScrollText, perms: ['audit.read'] },
    ],
  },
];

/** The nav entry a path belongs to (longest matching prefix), for highlighting and page access checks. */
export function navItemFor(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const g of NAV) {
    for (const i of g.items) {
      const match = i.href === '/' ? pathname === '/' : pathname === i.href || pathname.startsWith(`${i.href}/`);
      if (match && (!best || i.href.length > best.href.length)) best = i;
    }
  }
  return best;
}

