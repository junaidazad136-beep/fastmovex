// FastMoveX seed — Qatar launch config. Safe to run multiple times (upserts).
import 'dotenv/config';
import { DEFAULT_PAGES } from './content/pages';
import { PrismaPg } from '@prisma/adapter-pg';
import { PaymentMethod, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { poolTls } from '../src/prisma/pool-tls';

const prisma = new PrismaClient({ adapter: new PrismaPg({ ...poolTls(process.env.DATABASE_URL ?? '', process.env.DATABASE_CA_CERT), options: '-c TimeZone=UTC' }) });

const CURRENCIES = [
  { code: 'QAR', minorUnits: 2, symbol: 'QAR' },
  { code: 'AED', minorUnits: 2, symbol: 'AED' },
  { code: 'SAR', minorUnits: 2, symbol: 'SAR' },
  { code: 'KWD', minorUnits: 3, symbol: 'KWD' },
  { code: 'BHD', minorUnits: 3, symbol: 'BHD' },
  { code: 'OMR', minorUnits: 3, symbol: 'OMR' },
  { code: 'PKR', minorUnits: 2, symbol: 'Rs' },
  { code: 'USD', minorUnits: 2, symbol: '$' },
  { code: 'EUR', minorUnits: 2, symbol: '€' },
];

// Only Qatar is active at launch. Others exist but stay OFF until configured.
const COUNTRIES = [
  { code: 'QA', name: 'Qatar', nameAr: 'قطر', currencyCode: 'QAR', vatRateBps: 0, isActive: true,
    addressFormat: { fields: ['city', 'zone', 'street', 'building', 'unit'], required: ['city', 'zone', 'street', 'building'] } },
  { code: 'AE', name: 'United Arab Emirates', nameAr: 'الإمارات', currencyCode: 'AED', vatRateBps: 500, isActive: false,
    addressFormat: { fields: ['city', 'line1', 'building', 'unit'], required: ['city', 'line1'] } },
  { code: 'SA', name: 'Saudi Arabia', nameAr: 'السعودية', currencyCode: 'SAR', vatRateBps: 1500, isActive: false,
    addressFormat: { fields: ['city', 'line1', 'postalCode'], required: ['city', 'line1', 'postalCode'] } },
  { code: 'PK', name: 'Pakistan', nameAr: 'باكستان', currencyCode: 'PKR', vatRateBps: 0, isActive: false,
    addressFormat: { fields: ['city', 'line1', 'postalCode'], required: ['city', 'line1'] } },
];

const PERMISSIONS: Record<string, string[]> = {
  users: ['users.read', 'users.update', 'users.suspend'],
  sellers: ['sellers.read', 'sellers.approve', 'sellers.suspend', 'sellers.documents.read'],
  catalog: ['products.read', 'products.manage', 'products.moderate', 'categories.manage', 'banners.manage'],
  inventory: ['inventory.manage', 'inventory.approve'],
  orders: ['orders.read', 'orders.update', 'orders.cancel', 'orders.create'],
  finance: ['payments.read', 'refunds.create', 'refunds.approve', 'payouts.read', 'payouts.approve',
            'payouts.mark_paid', 'commissions.manage', 'ledger.read', 'payments.reconcile', 'reports.margin'],
  // suppliers and purchase orders; receiving goods is separate so the buyer is not the one who confirms delivery
  purchasing: ['purchasing.manage', 'purchasing.receive'],
  marketing: ['coupons.manage', 'campaigns.manage', 'featured.manage'],
  support: ['tickets.read', 'tickets.reply', 'reviews.moderate', 'returns.manage'],
  delivery: ['delivery.read', 'delivery.manage', 'delivery.update_own'],
  system: ['settings.manage', 'countries.manage', 'admins.manage', 'roles.manage', 'audit.read', 'analytics.read'],
  // cash on delivery: see who holds cash, and receive it from drivers (cashier)
  cash: ['cash.read', 'cash.receive'],
  // senior powers that skip a safety check (always with a written reason, always audited)
  control: ['delivery.override'],
};

const ALL = Object.values(PERMISSIONS).flat();
const pick = (...groups: string[]) => groups.flatMap((g) => PERMISSIONS[g]);

const ROLES: Record<string, { name: string; perms: string[] }> = {
  SUPER_ADMIN: { name: 'Super Admin', perms: ALL },
  ADMIN: { name: 'Admin', perms: ALL.filter((p) => !['admins.manage', 'roles.manage', 'payouts.mark_paid'].includes(p)) },
  FINANCE_ADMIN: { name: 'Finance Admin', perms: [...pick('finance', 'cash'), 'orders.read', 'sellers.read', 'analytics.read', 'audit.read'] },
  OPERATIONS_ADMIN: { name: 'Operations Admin', perms: [...pick('orders', 'delivery', 'catalog', 'inventory', 'sellers', 'purchasing'), 'returns.manage', 'cash.read'] },
  CATALOG_MANAGER: { name: 'Catalogue & Content Manager', perms: [...pick('catalog', 'marketing'), 'inventory.manage', 'analytics.read'] },
  INVENTORY_MANAGER: { name: 'Inventory Manager', perms: ['products.read', 'inventory.manage', 'purchasing.receive'] },
  ORDER_MANAGER: { name: 'Order Manager', perms: [...pick('orders', 'delivery'), 'returns.manage', 'cash.read', 'users.read', 'products.read'] },
  SUPPORT_ADMIN: { name: 'Support Admin', perms: [...pick('support'), 'orders.read', 'orders.create', 'users.read', 'sellers.read'] },
  // Seller/customer/driver access is ownership-based in code (own store, own orders), not admin perms
  SELLER: { name: 'Seller', perms: [] },
  CUSTOMER: { name: 'Customer', perms: [] },
  DELIVERY_AGENT: { name: 'Delivery Agent', perms: ['delivery.update_own'] },
};

const CATEGORIES: [string, string, string][] = [
  ['electronics', 'Electronics', 'إلكترونيات'],
  ['phones-accessories', 'Phones & Accessories', 'الهواتف والإكسسوارات'],
  ['computers', 'Computers', 'أجهزة الكمبيوتر'],
  ['gaming', 'Gaming', 'الألعاب'],
  ['fashion', 'Fashion', 'الأزياء'],
  ['shoes', 'Shoes', 'الأحذية'],
  ['bags', 'Bags', 'الحقائب'],
  ['beauty', 'Beauty', 'الجمال'],
  ['perfumes', 'Perfumes', 'العطور'],
  ['health-personal-care', 'Health & Personal Care', 'الصحة والعناية الشخصية'],
  ['home-kitchen', 'Home & Kitchen', 'المنزل والمطبخ'],
  ['furniture', 'Furniture', 'الأثاث'],
  ['groceries', 'Groceries', 'البقالة'],
  ['food-snacks', 'Food & Snacks', 'الأطعمة والوجبات الخفيفة'],
  ['baby-kids', 'Baby & Kids', 'الأطفال والرضع'],
  ['sports-fitness', 'Sports & Fitness', 'الرياضة واللياقة'],
  ['automotive', 'Automotive', 'السيارات'],
  ['tools', 'Tools', 'العدد والأدوات'],
  ['pet-supplies', 'Pet Supplies', 'مستلزمات الحيوانات الأليفة'],
  ['office-stationery', 'Office & Stationery', 'المكتب والقرطاسية'],
  ['travel', 'Travel', 'السفر'],
  ['gifts', 'Gifts', 'الهدايا'],
  ['other', 'Other', 'أخرى'],
];

async function main() {
  // Automatic deploys (scripts/render-build.sh) seed a NEW database only: running it again would reset settings,
  // role permissions and category names the team changed in the admin panel.
  if (process.env.SEED_ONLY_IF_EMPTY === 'yes' && (await prisma.country.count()) > 0) {
    console.log('FastMoveX seed skipped: the database is already set up.');
    return;
  }
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }

  for (const c of COUNTRIES) {
    const data = {
      ...c,
      paymentMethods: [PaymentMethod.CARD, PaymentMethod.APPLE_PAY, PaymentMethod.GOOGLE_PAY, PaymentMethod.COD],
      deliveryProviders: ['seller', 'jovia_fleet'],
      // Starting defaults only — admin changes these from the dashboard. Minor units: 1000 = QAR 10.00
      deliveryConfig: c.code === 'QA' ? { flatFeeMinor: '1000', freeOverMinor: '10000', label: 'Standard delivery' } : {},
    };
    await prisma.country.upsert({ where: { code: c.code }, update: data, create: data });
  }

  for (const [group, codes] of Object.entries(PERMISSIONS)) {
    for (const code of codes) {
      await prisma.permission.upsert({ where: { code }, update: { group }, create: { code, group } });
    }
  }

  for (const [code, r] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({ where: { code }, update: { name: r.name }, create: { code, name: r.name } });
    const perms = await prisma.permission.findMany({ where: { code: { in: r.perms } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) {
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
  }

  for (const [i, [slug, name, nameAr]] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, nameAr, sortOrder: i },
      create: { slug, name, nameAr, path: slug, depth: 0, sortOrder: i },
    });
  }

  // Default Qatar commission: 10%. Admin changes this from dashboard — never in code.
  const existing = await prisma.commissionRule.findFirst({ where: { scope: 'COUNTRY', countryCode: 'QA' } });
  if (!existing) {
    await prisma.commissionRule.create({
      data: { name: 'Qatar default', scope: 'COUNTRY', countryCode: 'QA', type: 'PERCENTAGE', rateBps: 1000 },
    });
  }

  // Platform ledger accounts for QAR
  for (const type of ['CUSTOMER_CLEARING', 'PLATFORM_REVENUE', 'PLATFORM_DISCOUNT', 'DELIVERY_REVENUE', 'TAX_PAYABLE'] as const) {
    const found = await prisma.ledgerAccount.findFirst({ where: { type, sellerId: null, currencyCode: 'QAR' } });
    if (!found) await prisma.ledgerAccount.create({ data: { type, currencyCode: 'QAR' } });
  }

  await ensureHouseStore();
  await ensurePages();

  // Super admin from env only — no hard-coded credentials
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (email && password) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, fullName: 'FastMoveX Super Admin', countryCode: 'QA', passwordHash: await argon2.hash(password), emailVerifiedAt: new Date() },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  console.log('FastMoveX seed complete (Qatar active).');
}

/**
 * The platform's own store: FastMoveX sells directly from day one. It is a normal (approved) seller in the data model,
 * owned by a system user that cannot sign in, so marketplace sellers can be added later without any migration.
 * Staff manage its products from the admin dashboard (products.manage / inventory.manage permissions).
 */
/** Starting content pages; an existing page (edited by the team) is never overwritten. */
async function ensurePages() {
  for (const p of DEFAULT_PAGES) {
    const exists = await prisma.page.findUnique({ where: { slug: p.slug }, select: { id: true } });
    if (!exists) await prisma.page.create({ data: { ...p, isPublished: true, showInFooter: true } });
  }
}

async function ensureHouseStore() {
  const country = 'QA';
  const name = process.env.HOUSE_STORE_NAME || 'FastMoveX';
  const nameAr = process.env.HOUSE_STORE_NAME_AR || 'فاست موف إكس';
  const slug = process.env.HOUSE_STORE_SLUG || 'fastmovex';
  const existing = await prisma.seller.findFirst({ where: { isHouse: true }, select: { id: true } });
  if (existing) return;
  const owner = await prisma.user.upsert({
    where: { email: 'house-store@system.jovia.invalid' },
    update: {},
    // No password: this account can never sign in. ".invalid" is a reserved domain, so no mail can reach it.
    create: { email: 'house-store@system.jovia.invalid', fullName: `${name} (system)`, countryCode: country },
  });
  const seller = await prisma.seller.create({
    data: {
      ownerUserId: owner.id, businessName: name, contactEmail: process.env.HOUSE_STORE_EMAIL || 'store@fastmovex.qa',
      contactPhone: process.env.HOUSE_STORE_PHONE || '+97400000000', countryCode: country, status: 'APPROVED', approvedAt: new Date(), isHouse: true,
      store: { create: { slug, name, nameAr, city: 'Doha', isActive: true, description: 'Sold and delivered by FastMoveX.', descriptionAr: 'تبيعه وتوصله فاست موف إكس.' } },
    },
  });
  for (const type of ['SELLER_PENDING', 'SELLER_AVAILABLE', 'SELLER_PAID'] as const) {
    await prisma.ledgerAccount.upsert({
      where: { type_sellerId_currencyCode: { type, sellerId: seller.id, currencyCode: 'QAR' } },
      update: {},
      create: { type, sellerId: seller.id, currencyCode: 'QAR' },
    });
  }
  // The platform does not charge itself commission; its whole margin is the price.
  await prisma.commissionRule.create({ data: { name: `${name} — own store, no commission`, scope: 'SELLER', sellerId: seller.id, type: 'PERCENTAGE', rateBps: 0, priority: 100 } });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
