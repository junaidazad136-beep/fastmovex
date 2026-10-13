/**
 * FastMoveX DEMO DATA — for local development, staging and demos ONLY.
 *
 *   npm run db:seed         # base config first (countries, roles, categories)
 *   npm run db:seed:demo    # then this
 *
 * Refuses to run when NODE_ENV=production. Every demo account uses the @demo.fastmovex.test domain
 * (".test" is a reserved TLD, so these can never be real inboxes). Demo sellers use a fake IBAN.
 * Safe to run repeatedly: everything is upserted.
 */
import 'dotenv/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { LedgerAccountType, Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, randomBytes } from 'crypto';
import PDFDocument from 'pdfkit';
import { crc32, deflateSync } from 'zlib';
import { poolTls } from '../src/prisma/pool-tls';
import sharp from 'sharp';
import { DEMO_ART, heroDevicesArt, heroPerfumeArt } from './demo-art';

/** SVG illustration → PNG (sharp draws SVG; transparent where the SVG has no background). */
function svgToPng(svgText: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svgText), { density: 144 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

// A test copy (free hosting) may load demo data on purpose: DEMO_SEED_ALLOW=yes plus a private DEMO_PASSWORD
// (12+ characters, not the public default) — otherwise anyone could sign in to the demo admin account.
if (process.env.NODE_ENV === 'production') {
  const pw = process.env.DEMO_PASSWORD ?? '';
  if (process.env.DEMO_SEED_ALLOW !== 'yes' || pw.length < 12 || pw === 'Demo-Pass-2026') {
    console.error('Refusing to load demo data into a production environment. For a private test server set DEMO_SEED_ALLOW=yes and a private DEMO_PASSWORD (12+ characters).');
    process.exit(1);
  }
  console.warn('Loading demo data into a test server (DEMO_SEED_ALLOW=yes). Never do this on the real shop.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ ...poolTls(process.env.DATABASE_URL ?? '', process.env.DATABASE_CA_CERT), options: '-c TimeZone=UTC' }) });
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const DOMAIN = 'demo.fastmovex.test';
const COUNTRY = 'QA';
const CURRENCY = 'QAR';
const DAY = 86_400_000;

// ------------------------------------------------------------------ helpers

type RGB = [number, number, number];

/** Tiny PNG encoder (vertical gradient) so demo products have real image files without any external assets. */
function gradientPng(w: number, h: number, top: RGB, bottom: RGB): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const px = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
    const off = y * (w * 3 + 1);
    raw[off] = 0;
    for (let x = 0; x < w; x++) raw.set(px, off + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function demoPdf(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(title).moveDown();
    doc.fontSize(11).fillColor('#b00020').text('DEMO DOCUMENT — NOT A REAL COMMERCIAL REGISTRATION').fillColor('#000').moveDown();
    lines.forEach((l) => doc.text(l));
    doc.end();
  });
}

/** Same format as src/common/crypto/crypto.service.ts so the API can decrypt it. */
function encrypt(plain: string): string | null {
  const key = process.env.FIELD_ENCRYPTION_KEY ? Buffer.from(process.env.FIELD_ENCRYPTION_KEY, 'base64') : null;
  if (!key || key.length !== 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

class Storage {
  private s3?: S3Client;
  enabled = false;
  constructor() {
    const e = process.env;
    if (e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && e.S3_BUCKET_PUBLIC && e.S3_BUCKET_PRIVATE) {
      this.s3 = new S3Client({
        region: e.S3_REGION || 'auto', endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true', requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
      });
      this.enabled = true;
    }
  }
  async put(visibility: 'public' | 'private', key: string, body: Buffer, type: string): Promise<boolean> {
    if (!this.enabled || !this.s3) return false;
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: visibility === 'public' ? process.env.S3_BUCKET_PUBLIC : process.env.S3_BUCKET_PRIVATE, Key: key, Body: body, ContentType: type,
        CacheControl: visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
      }));
      return true;
    } catch (err) {
      console.warn(`  ! storage unavailable (${(err as Error).message}) — continuing without images`);
      this.enabled = false;
      return false;
    }
  }
}

/** Each seller's main warehouse (made by the warehouses migration for existing sellers, here for new ones). */
async function mainWarehouse(sellerId: string): Promise<string> {
  const found = await prisma.warehouse.findFirst({ where: { sellerId, isDefault: true }, select: { id: true } });
  if (found) return found.id;
  return (await prisma.warehouse.create({ data: { sellerId, code: 'MAIN', name: 'Main warehouse', nameAr: 'المستودع الرئيسي', city: 'Doha', isDefault: true } })).id;
}

async function roleIds(codes: string[]) {
  const roles = await prisma.role.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  if (roles.length !== codes.length) throw new Error(`Missing roles — run "npm run db:seed" first (${codes.join(', ')})`);
  return roles.map((r) => r.id);
}

async function upsertUser(email: string, fullName: string, roles: string[], hash: string, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName },
    create: { email, fullName, passwordHash: hash, countryCode: COUNTRY, emailVerifiedAt: new Date(), ...extra },
    select: { id: true },
  });
  for (const roleId of await roleIds(roles)) {
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId } }, update: {}, create: { userId: user.id, roleId } });
  }
  return user.id;
}

// ---------------------------------------------------------------- the data

interface DemoVariant { sku: string; options?: Record<string, string>; price: number; compareAt?: number; stock: number }
interface DemoProduct {
  slug: string; category: string; brand: string; title: string; titleAr: string; description: string; descriptionAr: string;
  specs: Record<string, string>; returnDays?: number; warrantyMonths?: number; colors: [RGB, RGB]; variants: DemoVariant[]; featured?: boolean;
}
interface DemoSeller {
  key: string; owner: string; business: string; store: string; storeAr: string; description: string; descriptionAr: string;
  cr: string; phone: string; lat: number; lng: number; featured: boolean; brandColor: [RGB, RGB]; products: DemoProduct[];
}

const BRANDS = ['Nova', 'Falcon Gear', 'Dana Oud', 'Pearl Home', 'Sahara Farms', 'Lumen Care'];

const SELLERS: DemoSeller[] = [
  {
    key: 'gadgets', owner: 'Yousef Al-Kuwari', business: 'Doha Gadgets Hub Trading WLL', store: 'Doha Gadgets Hub', storeAr: 'مركز الدوحة للأجهزة',
    description: 'Audio, charging and gaming accessories with local warranty.', descriptionAr: 'إكسسوارات الصوت والشحن والألعاب مع ضمان محلي.',
    cr: 'DEMO-CR-100201', phone: '+97450000101', lat: 25.2854, lng: 51.531, featured: true, brandColor: [[20, 24, 38], [76, 92, 150]],
    products: [
      {
        slug: 'nova-x12-wireless-earbuds', category: 'electronics', brand: 'Nova', featured: true,
        title: 'Nova X12 Wireless Earbuds', titleAr: 'سماعات نوفا X12 اللاسلكية',
        description: 'Active noise cancelling earbuds with 32 hours of total battery life, USB-C fast charging and IPX5 sweat resistance.',
        descriptionAr: 'سماعات بخاصية إلغاء الضوضاء، بطارية حتى 32 ساعة، شحن سريع USB-C ومقاومة للعرق IPX5.',
        specs: { 'Battery life': '8 h + 24 h case', Bluetooth: '5.3', 'Water resistance': 'IPX5', Charging: 'USB-C, wireless' },
        warrantyMonths: 12, colors: [[30, 30, 36], [110, 110, 125]],
        variants: [
          { sku: 'NX12-BLK', options: { Color: 'Black' }, price: 14900, compareAt: 19900, stock: 42 },
          { sku: 'NX12-WHT', options: { Color: 'White' }, price: 14900, compareAt: 19900, stock: 3 },
        ],
      },
      {
        slug: 'nova-powercore-20000-power-bank', category: 'phones-accessories', brand: 'Nova',
        title: 'Nova PowerCore 20,000 mAh Power Bank', titleAr: 'باور بانك نوفا 20,000 مللي أمبير',
        description: 'Charges a phone about four times. 22.5 W fast charging with two USB-C ports and one USB-A.',
        descriptionAr: 'يشحن الهاتف حوالي أربع مرات. شحن سريع 22.5 واط مع منفذين USB-C ومنفذ USB-A.',
        specs: { Capacity: '20,000 mAh', Output: '22.5 W max', Ports: '2× USB-C, 1× USB-A', Weight: '350 g' },
        warrantyMonths: 12, colors: [[40, 44, 52], [90, 96, 110]],
        variants: [{ sku: 'NPC20K', price: 9900, stock: 60 }],
      },
      {
        slug: 'nova-65w-gan-usb-c-charger', category: 'phones-accessories', brand: 'Nova',
        title: 'Nova 65W GaN USB-C Charger', titleAr: 'شاحن نوفا 65 واط GaN',
        description: 'Compact three-port charger that powers a laptop, a phone and earbuds at the same time. Qatar 3-pin plug.',
        descriptionAr: 'شاحن صغير بثلاثة منافذ يشحن الحاسوب والهاتف والسماعات معاً. قابس قطري ثلاثي.',
        specs: { Power: '65 W', Ports: '2× USB-C, 1× USB-A', Plug: 'Type G (Qatar)' },
        warrantyMonths: 18, colors: [[235, 235, 240], [180, 184, 196]],
        variants: [{ sku: 'NGAN65', price: 7900, compareAt: 9900, stock: 35 }],
      },
      {
        slug: 'falcon-pro-wireless-controller', category: 'gaming', brand: 'Falcon Gear', featured: true,
        title: 'Falcon Pro Wireless Controller', titleAr: 'يد تحكم فالكون برو اللاسلكية',
        description: 'Hall-effect sticks that do not drift, 4 back buttons and 30-hour battery. Works with PC, Android and consoles.',
        descriptionAr: 'عصي بتقنية Hall لا تنحرف، 4 أزرار خلفية وبطارية 30 ساعة. تعمل مع الحاسوب وأندرويد وأجهزة الألعاب.',
        specs: { Connection: 'Bluetooth, 2.4 GHz, USB-C', Battery: '30 h', Sticks: 'Hall-effect' },
        warrantyMonths: 12, colors: [[18, 18, 22], [150, 30, 40]],
        variants: [
          { sku: 'FPC-BLK', options: { Color: 'Black' }, price: 19900, stock: 25 },
          { sku: 'FPC-WHT', options: { Color: 'Arctic White' }, price: 19900, stock: 0 },
        ],
      },
      {
        slug: 'falcon-tkl-mechanical-keyboard', category: 'computers', brand: 'Falcon Gear',
        title: 'Falcon TKL Mechanical Keyboard', titleAr: 'لوحة مفاتيح فالكون الميكانيكية',
        description: 'Hot-swappable tenkeyless keyboard with English/Arabic keycaps and per-key RGB.',
        descriptionAr: 'لوحة مفاتيح بدون أرقام، مفاتيح قابلة للتبديل، حروف عربية وإنجليزية وإضاءة لكل مفتاح.',
        specs: { Layout: 'TKL, EN/AR', Switches: 'Hot-swappable', Connection: 'USB-C' },
        warrantyMonths: 12, colors: [[28, 28, 34], [60, 70, 90]],
        variants: [
          { sku: 'FTKL-RED', options: { Switch: 'Red (linear)' }, price: 32900, stock: 12 },
          { sku: 'FTKL-BRN', options: { Switch: 'Brown (tactile)' }, price: 32900, stock: 9 },
        ],
      },
      {
        slug: 'aluminium-adjustable-laptop-stand', category: 'computers', brand: 'Nova',
        title: 'Aluminium Adjustable Laptop Stand', titleAr: 'حامل لابتوب ألمنيوم قابل للتعديل',
        description: 'Raises the screen to eye level for better posture. Folds flat, fits 10–17 inch laptops.',
        descriptionAr: 'يرفع الشاشة إلى مستوى العين لوضعية أفضل. قابل للطي ويناسب 10–17 بوصة.',
        specs: { Material: 'Aluminium', Fits: '10–17"', 'Max load': '10 kg' },
        colors: [[200, 202, 206], [140, 144, 150]],
        variants: [{ sku: 'NLS-ALU', price: 11900, stock: 40 }],
      },
      {
        slug: 'nova-clear-shockproof-case-6-1', category: 'phones-accessories', brand: 'Nova',
        title: 'Nova Clear Shockproof Case — 6.1"', titleAr: 'غطاء نوفا شفاف مقاوم للصدمات — 6.1 بوصة',
        description: 'Anti-yellowing clear case with raised camera edges and 2 m drop protection.',
        descriptionAr: 'غطاء شفاف لا يصفر مع حواف مرتفعة للكاميرا وحماية من السقوط حتى مترين.',
        specs: { Size: '6.1"', Protection: '2 m drop', Material: 'TPU + polycarbonate' },
        returnDays: 7, colors: [[210, 225, 235], [150, 170, 190]],
        variants: [
          { sku: 'NCASE61-CLR', options: { Finish: 'Clear' }, price: 4900, stock: 120 },
          { sku: 'NCASE61-SMK', options: { Finish: 'Smoke' }, price: 4900, stock: 80 },
        ],
      },
      {
        slug: 'nova-smart-watch-s3', category: 'electronics', brand: 'Nova',
        title: 'Nova Smart Watch S3', titleAr: 'ساعة نوفا الذكية S3',
        description: 'AMOLED display, heart-rate and SpO2 tracking, prayer time reminders and 10-day battery.',
        descriptionAr: 'شاشة AMOLED، قياس نبض القلب والأكسجين، تذكير بأوقات الصلاة وبطارية 10 أيام.',
        specs: { Display: '1.43" AMOLED', Battery: 'Up to 10 days', 'Water resistance': '5 ATM' },
        warrantyMonths: 12, colors: [[25, 35, 30], [90, 120, 100]],
        variants: [
          { sku: 'NWS3-BLK', options: { Strap: 'Black' }, price: 39900, compareAt: 49900, stock: 15 },
          { sku: 'NWS3-OLV', options: { Strap: 'Olive' }, price: 39900, compareAt: 49900, stock: 6 },
        ],
      },
    ],
  },
  {
    key: 'oud', owner: 'Mariam Al-Sulaiti', business: 'Al Dana Perfumes Trading', store: 'Al Dana Oud & Perfumes', storeAr: 'الدانة للعود والعطور',
    description: 'Oud, bakhoor and fragrances blended in Doha.', descriptionAr: 'عود وبخور وعطور ممزوجة في الدوحة.',
    cr: 'DEMO-CR-100202', phone: '+97450000102', lat: 25.3185, lng: 51.4381, featured: true, brandColor: [[60, 30, 20], [180, 120, 60]],
    products: [
      {
        slug: 'dana-royal-oud-eau-de-parfum', category: 'perfumes', brand: 'Dana Oud', featured: true,
        title: 'Dana Royal Oud Eau de Parfum', titleAr: 'عطر الدانة رويال عود',
        description: 'Deep oud with saffron and rose, long-lasting on skin and clothes.', descriptionAr: 'عود عميق مع الزعفران والورد، ثبات طويل على البشرة والملابس.',
        specs: { Notes: 'Oud, saffron, Taif rose', Concentration: 'Eau de Parfum' },
        returnDays: 0, colors: [[70, 35, 20], [200, 150, 80]],
        variants: [
          { sku: 'DRO-50', options: { Size: '50 ml' }, price: 34900, stock: 30 },
          { sku: 'DRO-100', options: { Size: '100 ml' }, price: 54900, compareAt: 64900, stock: 18 },
        ],
      },
      {
        slug: 'dana-musk-al-tahara', category: 'perfumes', brand: 'Dana Oud',
        title: 'Dana Musk Al Tahara', titleAr: 'مسك الطهارة من الدانة',
        description: 'Soft white musk, alcohol-free, 20 ml roll-on.', descriptionAr: 'مسك أبيض ناعم، خالٍ من الكحول، 20 مل.',
        specs: { Volume: '20 ml', 'Alcohol-free': 'Yes' },
        returnDays: 0, colors: [[240, 238, 235], [210, 200, 190]],
        variants: [{ sku: 'DMT-20', price: 8900, stock: 75 }],
      },
      {
        slug: 'cambodian-oud-bakhoor-50g', category: 'perfumes', brand: 'Dana Oud',
        title: 'Cambodian Oud Bakhoor — 50 g', titleAr: 'بخور عود كمبودي — 50 جم',
        description: 'Hand-mixed bakhoor chips for majlis and home.', descriptionAr: 'بخور ممزوج يدوياً للمجلس والمنزل.',
        specs: { Weight: '50 g', Origin: 'Cambodian oud' },
        returnDays: 0, colors: [[50, 30, 25], [120, 80, 50]],
        variants: [{ sku: 'DBK-50', price: 12900, stock: 40 }],
      },
      {
        slug: 'electric-bakhoor-burner', category: 'home-kitchen', brand: 'Dana Oud',
        title: 'Electric Bakhoor Burner', titleAr: 'مبخرة كهربائية',
        description: 'Rechargeable burner, heats bakhoor in 30 seconds without coal.', descriptionAr: 'مبخرة قابلة للشحن تسخن البخور خلال 30 ثانية بدون فحم.',
        specs: { Battery: 'Rechargeable, USB-C', 'Heat-up': '30 s' },
        warrantyMonths: 6, colors: [[30, 30, 30], [170, 140, 90]],
        variants: [{ sku: 'DEB-01', price: 14900, stock: 22 }],
      },
      {
        slug: 'rose-amber-body-mist', category: 'beauty', brand: 'Lumen Care',
        title: 'Rose & Amber Body Mist', titleAr: 'معطر الجسم ورد وعنبر',
        description: 'Light everyday mist, 200 ml.', descriptionAr: 'معطر خفيف للاستخدام اليومي، 200 مل.',
        specs: { Volume: '200 ml' },
        returnDays: 0, colors: [[230, 190, 200], [200, 140, 120]],
        variants: [{ sku: 'LRA-200', price: 6900, compareAt: 8900, stock: 50 }],
      },
      {
        slug: 'luxury-oud-gift-set', category: 'gifts', brand: 'Dana Oud', featured: true,
        title: 'Luxury Oud Gift Set', titleAr: 'طقم هدايا العود الفاخر',
        description: 'Royal Oud 50 ml, Musk Al Tahara and 50 g bakhoor in a gift box.', descriptionAr: 'رويال عود 50 مل ومسك الطهارة و50 جم بخور في علبة هدايا.',
        specs: { Contents: '3 items', Packaging: 'Gift box' },
        returnDays: 0, colors: [[40, 20, 15], [190, 150, 90]],
        variants: [{ sku: 'DGS-01', price: 49900, stock: 10 }],
      },
      {
        slug: 'argan-hair-oil', category: 'health-personal-care', brand: 'Lumen Care',
        title: 'Argan Hair Oil', titleAr: 'زيت الأرغان للشعر',
        description: 'Cold-pressed argan oil for frizz control, 100 ml.', descriptionAr: 'زيت أرغان معصور على البارد للتحكم في التجعد، 100 مل.',
        specs: { Volume: '100 ml' },
        returnDays: 0, colors: [[220, 180, 110], [160, 110, 50]],
        variants: [{ sku: 'LAH-100', price: 5900, stock: 64 }],
      },
      {
        slug: 'saffron-face-serum', category: 'beauty', brand: 'Lumen Care',
        title: 'Saffron Brightening Face Serum', titleAr: 'سيروم الزعفران لتفتيح الوجه',
        description: 'Niacinamide and saffron extract for even skin tone, 30 ml.', descriptionAr: 'نياسيناميد ومستخلص الزعفران لتوحيد لون البشرة، 30 مل.',
        specs: { Volume: '30 ml', 'Key ingredients': 'Niacinamide 5%, saffron' },
        returnDays: 0, colors: [[250, 220, 170], [230, 150, 70]],
        variants: [{ sku: 'LSS-30', price: 11900, stock: 2 }],
      },
    ],
  },
  {
    key: 'home', owner: 'Ahmed Rahman', business: 'Pearl Home Living Trading', store: 'Pearl Home Living', storeAr: 'بيرل للمنزل',
    description: 'Kitchen, majlis and everyday home essentials.', descriptionAr: 'مستلزمات المطبخ والمجلس والمنزل.',
    cr: 'DEMO-CR-100203', phone: '+97450000103', lat: 25.2632, lng: 51.4453, featured: false, brandColor: [[20, 60, 70], [120, 180, 180]],
    products: [
      {
        slug: 'arabic-coffee-dallah-set', category: 'home-kitchen', brand: 'Pearl Home',
        title: 'Arabic Coffee Dallah Set', titleAr: 'طقم دلة القهوة العربية',
        description: 'Stainless steel dallah with 12 finjan cups and tray.', descriptionAr: 'دلة من الستانلس ستيل مع 12 فنجان وصينية.',
        specs: { Material: 'Stainless steel', Cups: '12' },
        colors: [[190, 160, 90], [120, 90, 40]],
        variants: [
          { sku: 'PDS-GLD', options: { Finish: 'Gold' }, price: 18900, stock: 14 },
          { sku: 'PDS-SLV', options: { Finish: 'Silver' }, price: 17900, stock: 20 },
        ],
      },
      {
        slug: 'premium-khalas-dates-1kg', category: 'groceries', brand: 'Sahara Farms', featured: true,
        title: 'Premium Khalas Dates — 1 kg', titleAr: 'تمر خلاص فاخر — 1 كجم',
        description: 'Soft Khalas dates, this season’s harvest, packed in Qatar.', descriptionAr: 'تمر خلاص طري من محصول هذا الموسم، معبأ في قطر.',
        specs: { Weight: '1 kg', Variety: 'Khalas' },
        returnDays: 0, colors: [[120, 70, 30], [60, 30, 10]],
        variants: [{ sku: 'SKD-1KG', price: 6500, compareAt: 7500, stock: 90 }],
      },
      {
        slug: 'sidr-honey-500g', category: 'food-snacks', brand: 'Sahara Farms',
        title: 'Sidr Honey — 500 g', titleAr: 'عسل سدر — 500 جم',
        description: 'Raw Sidr honey, lab-tested for purity.', descriptionAr: 'عسل سدر خام، مختبر للتأكد من نقائه.',
        specs: { Weight: '500 g', Type: 'Raw' },
        returnDays: 0, colors: [[240, 180, 40], [180, 110, 10]],
        variants: [{ sku: 'SSH-500', price: 15900, stock: 26 }],
      },
      {
        slug: 'memory-foam-prayer-mat', category: 'home-kitchen', brand: 'Pearl Home',
        title: 'Memory Foam Prayer Mat', titleAr: 'سجادة صلاة إسفنج ميموري فوم',
        description: 'Thick cushioned prayer mat that is kind to knees, with a travel pouch.', descriptionAr: 'سجادة صلاة سميكة مريحة للركبتين مع حقيبة للسفر.',
        specs: { Thickness: '12 mm', Size: '70 × 115 cm' },
        colors: [[30, 90, 60], [15, 45, 30]],
        variants: [
          { sku: 'PPM-GRN', options: { Color: 'Green' }, price: 12900, stock: 30 },
          { sku: 'PPM-NVY', options: { Color: 'Navy' }, price: 12900, stock: 30 },
          { sku: 'PPM-BEI', options: { Color: 'Beige' }, price: 12900, stock: 0 },
        ],
      },
      {
        slug: 'non-stick-cookware-set-10pc', category: 'home-kitchen', brand: 'Pearl Home',
        title: 'Non-stick Cookware Set — 10 pieces', titleAr: 'طقم أواني طبخ غير لاصقة — 10 قطع',
        description: 'PFOA-free granite coating, works on gas, electric and induction.', descriptionAr: 'طلاء جرانيت خالٍ من PFOA، يعمل على الغاز والكهرباء والحث.',
        specs: { Pieces: '10', Induction: 'Yes' },
        warrantyMonths: 24, colors: [[60, 60, 60], [20, 20, 20]],
        variants: [{ sku: 'PCS-10', price: 39900, compareAt: 52900, stock: 11 }],
      },
      {
        slug: 'velvet-majlis-floor-cushion', category: 'furniture', brand: 'Pearl Home',
        title: 'Velvet Majlis Floor Cushion', titleAr: 'مسند مجلس مخمل',
        description: 'Firm floor cushion with removable, washable velvet cover.', descriptionAr: 'مسند أرضي متين بغطاء مخمل قابل للإزالة والغسيل.',
        specs: { Size: '120 × 60 cm', Cover: 'Removable velvet' },
        colors: [[110, 30, 40], [60, 15, 20]],
        variants: [{ sku: 'PFC-120', price: 17900, stock: 8 }],
      },
      {
        slug: 'kids-arabic-alphabet-blocks', category: 'baby-kids', brand: 'Pearl Home',
        title: 'Kids Arabic Alphabet Blocks', titleAr: 'مكعبات الحروف العربية للأطفال',
        description: '28 wooden blocks with Arabic letters and pictures. Ages 2+.', descriptionAr: '28 مكعباً خشبياً بالحروف العربية والصور. من عمر سنتين.',
        specs: { Pieces: '28', Age: '2+' },
        colors: [[250, 200, 80], [240, 110, 90]],
        variants: [{ sku: 'PKB-28', price: 7900, stock: 33 }],
      },
      {
        slug: 'yoga-mat-6mm', category: 'sports-fitness', brand: 'Pearl Home',
        title: 'Non-slip Yoga Mat — 6 mm', titleAr: 'حصيرة يوغا غير قابلة للانزلاق — 6 مم',
        description: 'Dense TPE mat with carry strap.', descriptionAr: 'حصيرة TPE كثيفة مع حزام للحمل.',
        specs: { Thickness: '6 mm', Material: 'TPE' },
        colors: [[90, 60, 140], [40, 25, 70]],
        variants: [
          { sku: 'PYM-PRP', options: { Color: 'Purple' }, price: 8900, stock: 24 },
          { sku: 'PYM-BLK', options: { Color: 'Black' }, price: 8900, stock: 19 },
        ],
      },
    ],
  },
];

const FAQ = [
  ['orders', 'How do I track my order?', 'كيف أتتبع طلبي؟', 'Open Orders, choose the order and tap Track. Each seller in your order has its own tracking.', 'افتح الطلبات واختر الطلب ثم اضغط تتبع. لكل بائع في طلبك تتبع خاص.'],
  ['payment', 'Which payment methods can I use?', 'ما طرق الدفع المتاحة؟', 'Card, Apple Pay, Google Pay and cash on delivery, depending on your country.', 'البطاقة وApple Pay وGoogle Pay والدفع عند الاستلام، حسب دولتك.'],
  ['delivery', 'Why did my order arrive in more than one package?', 'لماذا وصل طلبي في أكثر من طرد؟', 'Items from different sellers are shipped separately. You still pay one delivery fee per seller, shown in your cart.', 'المنتجات من بائعين مختلفين تُشحن بشكل منفصل. رسوم التوصيل لكل بائع تظهر في السلة.'],
  ['return', 'How do I return an item?', 'كيف أرجع منتجاً؟', 'Go to the order, choose the item and tap Return within the return window shown on the product page.', 'اذهب إلى الطلب واختر المنتج واضغط إرجاع خلال مدة الإرجاع الظاهرة في صفحة المنتج.'],
  ['refund', 'When will I get my refund?', 'متى أستلم المبلغ المسترد؟', 'After the seller receives the item we send the refund to your original payment method. Banks usually take 5–10 working days.', 'بعد استلام البائع للمنتج نرسل المبلغ إلى وسيلة الدفع الأصلية. تستغرق البنوك عادة 5–10 أيام عمل.'],
  ['seller', 'How do I sell on FastMoveX?', 'كيف أبيع على FastMoveX؟', 'Create an account, tap Become a seller and upload your commercial registration. Our team reviews applications within 2 working days.', 'أنشئ حساباً واضغط كن بائعاً وارفع السجل التجاري. يراجع فريقنا الطلبات خلال يومي عمل.'],
];

// --------------------------------------------------------------------- main

async function main() {
  console.log('Loading FastMoveX demo data (development only)…');
  const country = await prisma.country.findUnique({ where: { code: COUNTRY } });
  if (!country) throw new Error('Run "npm run db:seed" first.');
  const storage = new Storage();
  if (!storage.enabled) console.warn('  ! S3 not configured — products will have no photos');
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  // Staff, customer, courier
  const adminId = await upsertUser(`admin@${DOMAIN}`, 'Demo Admin', ['ADMIN'], hash);
  await upsertUser(`finance@${DOMAIN}`, 'Demo Finance', ['FINANCE_ADMIN'], hash);
  await upsertUser(`finance2@${DOMAIN}`, 'Demo Finance (second approver)', ['FINANCE_ADMIN'], hash);
  await upsertUser(`ops@${DOMAIN}`, 'Demo Operations', ['OPERATIONS_ADMIN'], hash);
  await upsertUser(`support@${DOMAIN}`, 'Demo Support', ['SUPPORT_ADMIN'], hash);
  await upsertUser(`courier@${DOMAIN}`, 'Khalid Courier', ['DELIVERY_AGENT'], hash, { phone: '+97450000201', phoneVerifiedAt: new Date() });
  const customerId = await upsertUser(`customer@${DOMAIN}`, 'Sara Demo', ['CUSTOMER'], hash, { phone: '+97450000001', phoneVerifiedAt: new Date(), marketingOptIn: true });
  const existingAddress = await prisma.address.findFirst({ where: { userId: customerId } });
  if (!existingAddress) {
    await prisma.address.create({
      data: { userId: customerId, label: 'Home', recipientName: 'Sara Demo', phone: '+97450000001', countryCode: COUNTRY, city: 'Doha', zone: '66', street: '901', building: '12', unit: '4', lat: 25.3203, lng: 51.5259, isDefault: true },
    });
  }
  if (!(await prisma.wishlist.findFirst({ where: { userId: customerId, isDefault: true } }))) {
    await prisma.wishlist.create({ data: { userId: customerId, name: 'My Wishlist', isDefault: true } });
  }

  // Brands
  const brandIds = new Map<string, string>();
  for (const name of BRANDS) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const b = await prisma.brand.upsert({ where: { slug }, update: { name }, create: { name, slug } });
    brandIds.set(name, b.id);
  }
  const categories = new Map((await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));

  const variantIdsBySku = new Map<string, string>();
  const ibanEncrypted = encrypt('QA58DOHB00001234567890ABCDEFG'); // valid-format FAKE Qatar IBAN
  if (!ibanEncrypted) console.warn('  ! FIELD_ENCRYPTION_KEY missing — demo sellers get no bank account (payout requests will ask for one)');

  for (const s of SELLERS) {
    const email = `seller.${s.key}@${DOMAIN}`;
    const ownerId = await upsertUser(email, s.owner, ['CUSTOMER', 'SELLER'], hash, { phone: s.phone, phoneVerifiedAt: new Date() });
    const seller = await prisma.seller.upsert({
      where: { ownerUserId: ownerId },
      update: { status: 'APPROVED' },
      create: {
        ownerUserId: ownerId, businessName: s.business, legalName: s.business, commercialRegNo: s.cr, contactEmail: email, contactPhone: s.phone,
        countryCode: COUNTRY, status: 'APPROVED', approvedAt: new Date(), approvedById: adminId,
        bankName: ibanEncrypted ? 'Demo Bank (fake account)' : null, accountHolder: ibanEncrypted ? s.business : null,
        ibanEncrypted, ibanLast4: ibanEncrypted ? 'DEFG' : null,
      },
    });
    const storeSlug = s.store.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const store = await prisma.store.upsert({
      where: { sellerId: seller.id },
      update: { isActive: true, isFeatured: s.featured },
      create: { sellerId: seller.id, slug: storeSlug, name: s.store, nameAr: s.storeAr, description: s.description, descriptionAr: s.descriptionAr, city: 'Doha', lat: s.lat, lng: s.lng, isActive: true, isFeatured: s.featured },
    });
    if (!store.logoKey) {
      const key = `stores/${store.id}/logo-demo.png`;
      if (await storage.put('public', key, gradientPng(256, 256, s.brandColor[0], s.brandColor[1]), 'image/png')) {
        await prisma.store.update({ where: { id: store.id }, data: { logoKey: key } });
      }
    }
    for (const type of ['SELLER_PENDING', 'SELLER_AVAILABLE', 'SELLER_PAID'] as LedgerAccountType[]) {
      await prisma.ledgerAccount.upsert({ where: { type_sellerId_currencyCode: { type, sellerId: seller.id, currencyCode: CURRENCY } }, update: {}, create: { type, sellerId: seller.id, currencyCode: CURRENCY } });
    }
    if (!(await prisma.sellerDocument.findFirst({ where: { sellerId: seller.id } }))) {
      const key = `sellers/${seller.id}/documents/demo-cr.pdf`;
      const pdf = await demoPdf(`${s.business}`, [`CR number: ${s.cr}`, `Owner: ${s.owner}`, 'Issued for FastMoveX demo purposes only.']);
      if (await storage.put('private', key, pdf, 'application/pdf')) {
        await prisma.sellerDocument.create({ data: { sellerId: seller.id, type: 'COMMERCIAL_REGISTRATION', fileKey: key, mimeType: 'application/pdf', status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date() } });
      }
    }

    for (const p of s.products) {
      const categoryId = categories.get(p.category);
      if (!categoryId) throw new Error(`Unknown category ${p.category}`);
      const minPrice = Math.min(...p.variants.map((v) => v.price));
      const product = await prisma.product.upsert({
        where: { slug: p.slug },
        update: { title: p.title, titleAr: p.titleAr, description: p.description, descriptionAr: p.descriptionAr, specs: p.specs, status: 'ACTIVE', deletedAt: null, minPriceMinor: BigInt(minPrice), isFeatured: !!p.featured },
        create: {
          storeId: store.id, categoryId, brandId: brandIds.get(p.brand), countryCode: COUNTRY, slug: p.slug, title: p.title, titleAr: p.titleAr,
          description: p.description, descriptionAr: p.descriptionAr, specs: p.specs, status: 'ACTIVE', returnPolicyDays: p.returnDays ?? null,
          warrantyMonths: p.warrantyMonths ?? null, minPriceMinor: BigInt(minPrice), isFeatured: !!p.featured,
        },
      });
      for (const v of p.variants) {
        const variant = await prisma.productVariant.upsert({
          where: { productId_sku: { productId: product.id, sku: v.sku } },
          update: { priceMinor: BigInt(v.price), compareAtMinor: v.compareAt ? BigInt(v.compareAt) : null, optionValues: v.options ?? {}, isActive: true },
          create: { productId: product.id, sku: v.sku, optionValues: v.options ?? {}, priceMinor: BigInt(v.price), compareAtMinor: v.compareAt ? BigInt(v.compareAt) : null, currencyCode: CURRENCY },
        });
        variantIdsBySku.set(v.sku, variant.id);
        const inv = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
        if (!inv) {
          // the total (Inventory.onHand) follows the warehouse shelves through a database trigger
          await prisma.inventory.create({ data: { variantId: variant.id } });
          if (v.stock > 0) {
            const warehouseId = await mainWarehouse(seller.id);
            await prisma.warehouseStock.create({ data: { warehouseId, variantId: variant.id, onHand: v.stock } });
            await prisma.inventoryMovement.create({ data: { variantId: variant.id, warehouseId, qtyDelta: v.stock, reason: 'RESTOCK', refType: 'demo_seed', note: 'Demo opening stock' } });
          }
        }
      }
      if (!(await prisma.productImage.count({ where: { productId: product.id } }))) {
        const [top, bottom] = p.colors;
        const art = DEMO_ART[p.slug];
        for (let i = 0; i < 2; i++) {
          const key = `products/${product.id}/demo-${i + 1}.png`;
          const shade: RGB = i === 0 ? bottom : (bottom.map((c) => Math.min(255, c + 40)) as RGB);
          // an illustration of the product (second picture on a soft purple background); a plain gradient if none
          const png = art ? await svgToPng(i === 0 ? art() : art().replace('fill="#FFFFFF"/>', 'fill="#F6F0FF"/>'), 600) : gradientPng(600, 600, top, shade);
          if (await storage.put('public', key, png, 'image/png')) {
            await prisma.productImage.create({ data: { productId: product.id, fileKey: key, width: 600, height: 600, altText: p.title, sortOrder: i } });
          }
        }
      }
    }
  }

  // Some product views, so "Trending now" has something to show on a brand-new demo (real views replace them)
  for (const [slug, views] of [['nova-x12-wireless-earbuds', 420], ['nova-smart-watch-s3', 380], ['falcon-pro-wireless-controller', 310], ['dana-royal-oud-eau-de-parfum', 260], ['yoga-mat-6mm', 180], ['arabic-coffee-dallah-set', 150]] as [string, number][]) {
    await prisma.product.updateMany({ where: { slug, viewCount: { lt: views } }, data: { viewCount: views } });
  }

  // Flash deal campaign (deal price must be below the regular price — enforced by the API too)
  const now = Date.now();
  const flash = (await prisma.campaign.findFirst({ where: { name: 'Weekend Flash Deals', countryCode: COUNTRY } }))
    ?? (await prisma.campaign.create({ data: { name: 'Weekend Flash Deals', nameAr: 'عروض نهاية الأسبوع', type: 'FLASH_DEAL', countryCode: COUNTRY, startsAt: new Date(now - DAY), endsAt: new Date(now + 7 * DAY) } }));
  await prisma.campaign.update({ where: { id: flash.id }, data: { isActive: true, endsAt: new Date(now + 7 * DAY) } });
  for (const [sku, deal, limit] of [['NPC20K', 7900, 50], ['FPC-BLK', 16900, 20], ['DMT-20', 6900, null], ['PCS-10', 34900, 10]] as [string, number, number | null][]) {
    const variantId = variantIdsBySku.get(sku)!;
    await prisma.campaignProduct.upsert({
      where: { campaignId_variantId: { campaignId: flash.id, variantId } },
      update: { dealPriceMinor: BigInt(deal), stockLimit: limit },
      create: { campaignId: flash.id, variantId, dealPriceMinor: BigInt(deal), stockLimit: limit },
    });
  }

  // Coupons
  const oudSeller = await prisma.seller.findFirstOrThrow({ where: { owner: { email: `seller.oud@${DOMAIN}` } }, select: { id: true } });
  await prisma.coupon.upsert({
    where: { code_countryCode: { code: 'WELCOME10', countryCode: COUNTRY } },
    update: { isActive: true, endsAt: new Date(now + 90 * DAY) },
    create: { code: 'WELCOME10', countryCode: COUNTRY, type: 'PERCENTAGE', scope: 'PLATFORM', fundedBy: 'PLATFORM', valueBps: 1000, maxDiscountMinor: 5000n, minOrderMinor: 5000n, firstOrderOnly: true, startsAt: new Date(now - DAY), endsAt: new Date(now + 90 * DAY), usageLimit: 10_000, perUserLimit: 1 },
  });
  await prisma.coupon.upsert({
    where: { code_countryCode: { code: 'DANA20', countryCode: COUNTRY } },
    update: { isActive: true, endsAt: new Date(now + 30 * DAY) },
    create: { code: 'DANA20', countryCode: COUNTRY, type: 'FIXED', scope: 'SELLER', fundedBy: 'SELLER', sellerId: oudSeller.id, valueMinor: 2000n, minOrderMinor: 15000n, startsAt: new Date(now - DAY), endsAt: new Date(now + 30 * DAY), perUserLimit: 3 },
  });
  await prisma.coupon.upsert({
    where: { code_countryCode: { code: 'FREESHIP', countryCode: COUNTRY } },
    update: { isActive: true, endsAt: new Date(now + 30 * DAY) },
    create: { code: 'FREESHIP', countryCode: COUNTRY, type: 'FREE_DELIVERY', scope: 'PLATFORM', fundedBy: 'PLATFORM', minOrderMinor: 3000n, startsAt: new Date(now - DAY), endsAt: new Date(now + 30 * DAY), perUserLimit: 5 },
  });

  // Delivery windows (the cards then say "Today" / "Tomorrow"); only when the market has none yet
  const qa = await prisma.country.findUnique({ where: { code: COUNTRY }, select: { deliverySlots: true } });
  if (!(qa?.deliverySlots as { enabled?: boolean } | null)?.enabled) {
    await prisma.country.update({
      where: { code: COUNTRY },
      data: { deliverySlots: { enabled: true, required: false, daysAhead: 3, leadMinutes: 120, closedWeekdays: [], closedDates: [], windows: [{ start: '09:00', end: '13:00', capacity: 30 }, { start: '13:00', end: '17:00', capacity: 30 }, { start: '17:00', end: '21:00', capacity: 30 }] } },
    });
  }

  // Home banners: two slider banners with text (drawn by the website over the purple) and a middle strip
  if (!(await prisma.banner.count({ where: { countryCode: COUNTRY } }))) {
    const hero = [
      { linkUrl: '/offers', art: heroDevicesArt, kicker: 'Limited time', kickerAr: 'لفترة محدودة', headline: 'Big deals\nUp to *50% off*', headlineAr: 'عروض كبيرة\nخصم حتى *50%*', subline: 'Top brands • Best prices • Qatar delivery', sublineAr: 'أفضل الماركات • أفضل الأسعار • توصيل في قطر', ctaLabel: 'Shop now', ctaLabelAr: 'تسوّق الآن' },
      { linkUrl: '/search?category=perfumes', art: heroPerfumeArt, kicker: 'New in', kickerAr: 'وصل حديثاً', headline: 'Oud & perfumes\n*Gift sets*', headlineAr: 'عود وعطور\n*أطقم هدايا*', subline: 'Royal oud, musk and bakhoor', sublineAr: 'عود ملكي ومسك وبخور', ctaLabel: 'Discover', ctaLabelAr: 'اكتشف' },
    ];
    for (const [sortOrder, b] of hero.entries()) {
      const key = `banners/demo-home_hero-${sortOrder}.png`;
      const { art, ...text } = b;
      if (await storage.put('public', key, await svgToPng(art(), 800), 'image/png')) {
        await prisma.banner.create({ data: { countryCode: COUNTRY, placement: 'HOME_HERO', imageKey: key, sortOrder, isActive: true, ...text } });
      }
    }
    const key = 'banners/demo-home_mid-0.png';
    if (await storage.put('public', key, gradientPng(1200, 480, [20, 60, 70], [120, 180, 180]), 'image/png')) {
      await prisma.banner.create({ data: { countryCode: COUNTRY, placement: 'HOME_MID', imageKey: key, linkUrl: '/search?sort=newest', sortOrder: 0, isActive: true } });
    }
  }

  // FAQ
  if (!(await prisma.faqEntry.count())) {
    await prisma.faqEntry.createMany({ data: FAQ.map(([category, question, questionAr, answer, answerAr], i) => ({ category, question, questionAr, answer, answerAr, sortOrder: i })) });
  }

  // a test server's build log is not the place for its password
  console.log('\nDemo data ready. All demo accounts use the password: ' + (process.env.NODE_ENV === 'production' ? 'your DEMO_PASSWORD' : PASSWORD));
  console.table([
    { role: 'Customer', login: `customer@${DOMAIN}` },
    { role: 'Seller (gadgets)', login: `seller.gadgets@${DOMAIN}` },
    { role: 'Seller (oud)', login: `seller.oud@${DOMAIN}` },
    { role: 'Seller (home)', login: `seller.home@${DOMAIN}` },
    { role: 'Admin', login: `admin@${DOMAIN}` },
    { role: 'Finance', login: `finance@${DOMAIN}` },
    { role: 'Finance (2nd approver)', login: `finance2@${DOMAIN}` },
    { role: 'Operations', login: `ops@${DOMAIN}` },
    { role: 'Support', login: `support@${DOMAIN}` },
    { role: 'Courier', login: `courier@${DOMAIN}` },
  ]);
  console.log('Coupons: WELCOME10 (10% first order), DANA20 (QAR 20 off Al Dana, min 150), FREESHIP (free delivery, min 30)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
