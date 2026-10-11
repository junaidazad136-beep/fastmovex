# FastMoveX — online shopping in Qatar, delivered fast

FastMoveX is a Qatar-first online store built on a multi-vendor marketplace engine. It **launches as a single
merchant**: FastMoveX sells its own products from its own store, run from the admin panel. The same platform can later
open to verified sellers (one cart across stores, per-seller fulfilment, configurable commission) without a rebuild.
Country, currency, VAT, payment methods, delivery and commission rules are all data, not code.

> **Status:** the backend API, the customer website and the admin panel are complete and tested end to end (real
> database, real browser), including guest checkout, order tracking, About / Contact / Offers / Privacy / Terms pages
> and a home page staff arrange themselves. Card payments go through **Dibsy** (cards, Himyan debit, Apple Pay, Google Pay);
> it switches on with the Dibsy keys once the merchant account is approved. Delivery time slots, WhatsApp (chat button +
> order updates) and abandoned-cart reminders are in, plus **cash and fraud controls** (delivery code proof, cash-on-delivery
> handover with receipts, refund four-eyes, fake-COD protection, inspected returns), **staff two-step sign-in** (authenticator
app, required in production, lockout, sign-in history), **failed-delivery proof** (driver GPS + photo, customer picks a new
time), **stock control** (write-off reasons and approval, expiry dates with oldest-first shipping, blind stocktakes,
suppliers and purchase orders received by a second person) and **payment checks** (problem list, gateway settlement
matching, daily closing report) and **documents & privacy** (customer invoice PDF in English/Arabic, credit notes and
return receipts, packing slips and shelf-ordered picking lists, download my data and account deletion under Qatar's
PDPPL). Next: the Flutter app on the same API
> (OpenAPI spec: [`apps/api/openapi.json`](apps/api/openapi.json)).

## What is in this repository

```
fastmovex/
├── apps/
│   ├── api/                    NestJS + PostgreSQL backend
│   │   ├── src/                feature modules (auth, catalogue, search, cart, checkout, guest orders, content, ledger, delivery, …)
│   │   ├── prisma/             schema, migrations, base seed, demo seed
│   │   ├── test/               492 unit/API tests + 164 integration tests (real DB)
│   │   ├── Dockerfile          production image (non-root, engine-free Prisma)
│   │   └── docker-compose.yml  local Postgres, Redis, MinIO
│   ├── web/                    Next.js 16 customer website (English + Arabic RTL, SEO, PWA)
│   │   ├── src/app/[locale]/   pages: home, search, category, product, store, cart, checkout, track, offers, contact, content pages, account, help
│   │   ├── src/components/     design system + feature components
│   │   ├── src/lib/            API clients, session, cart, i18n, money, SEO
│   │   ├── e2e/                77 Playwright browser tests (desktop, phone, accessibility, SEO, app-style home)
│   │   └── Dockerfile          production image (standalone output, non-root)
│   └── admin/                  Next.js 16 admin panel (staff only, role-based menu)
│       ├── src/app/(panel)/    dashboard, orders, products, inventory, customers, returns, refunds, marketing, home page, pages, messages, settings, staff
│       ├── src/components/     UI kit, product editor, charts
│       ├── e2e/                57 Playwright browser tests (banner text, roles, SEO texts, phone orders, add items, offline driver page, order changes, catalogue, orders, fulfilment, cash, driver, live map, margin, customer notes, alerts, security, stock, payments, documents, content, settings, phone, accessibility)
│       └── Dockerfile          production image (standalone output, non-root)
├── brand/                      logo (SVG + PNG), app icon, social pictures, colours — see brand/README.md
├── .github/workflows/          CI for the API, the website and the admin panel
└── *.md                        documentation (below)
```

## Quick start (local)

```bash
cd apps/api
cp .env.example .env            # then set JWT_ACCESS_SECRET and FIELD_ENCRYPTION_KEY (see SETUP.md)
docker compose up -d            # Postgres 16 (UTF8), Redis, MinIO + buckets
npm install
npx prisma migrate deploy       # create all tables, triggers and indexes
npm run db:seed                 # countries, currencies, roles, permissions, categories
npm run db:seed:demo            # optional: demo sellers, products, staff, coupons (never in production)
npm run dev                     # http://localhost:4000/api/docs

# second terminal: the website
cd apps/web
cp .env.example .env.local
npm install
npm run dev                     # http://localhost:3000

# third terminal: the admin panel (add http://localhost:3001 to the API's CORS_ORIGINS)
cd apps/admin
cp .env.example .env.local
npm install
npm run dev                     # http://localhost:3001
```

Demo logins (password `Demo-Pass-2026`): `customer@demo.jovia.test`, `seller.gadgets@demo.jovia.test`,
`admin@demo.jovia.test`, `finance@demo.jovia.test` — full list in [SETUP.md](SETUP.md).

## Documentation

| Document | What it covers |
|---|---|
| [SETUP.md](SETUP.md) | Local development from zero (API + website), demo accounts, troubleshooting |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Every environment variable, defaults, production values |
| [SEO.md](SEO.md) | Getting found on Google: what the website does, and the Search Console / Business Profile / Merchant Center steps |
| [DATABASE.md](DATABASE.md) | Schema, money rules, the double-entry ledger, migrations, seeding |
| [API.md](API.md) | Conventions (auth, money, errors, pagination, idempotency) and all 246 endpoints |
| [FREE-TEST.md](FREE-TEST.md) | Try everything online for free (Vercel + Render + Supabase), step by step — for testing, not the launch |
| [DEPLOYMENT.md](DEPLOYMENT.md) | API, website and admin panel deployment (Railway / Render / Docker / Vercel), backups, go-live checklist |
| [apps/admin/README.md](apps/admin/README.md) | The admin panel: screens, roles, sign-in model |
| [SECURITY.md](SECURITY.md) | Security controls, roles & permissions, financial integrity |
| [TESTING.md](TESTING.md) | Test layers, how to run them, edge cases covered, CI |

## Technology

| Layer | Choice |
|---|---|
| Website | Next.js 16 (App Router, server rendering), React 19, TypeScript, Tailwind CSS 4, self-hosted Inter + IBM Plex Sans Arabic, no UI framework |
| Admin panel | Next.js 16 + React 19 + Tailwind CSS 4 (same design tokens), client-rendered behind a staff login, hand-built SVG charts, no UI framework |
| API | NestJS 10, TypeScript (strict), REST, versioned under `/api/v1`, OpenAPI/Swagger |
| Database | PostgreSQL 16+ (UTF8), Prisma 6 in engine-free mode (WebAssembly query compiler + node-postgres) |
| Search | PostgreSQL full-text + trigram (typo tolerance, Arabic + English) behind a `SearchEngine` interface — swap for Typesense/Meilisearch without touching callers |
| Cache | Redis (optional; in-memory fallback), fails open |
| Files | Any S3-compatible storage (AWS S3, Cloudflare R2, MinIO) — public bucket behind CDN, private bucket with signed URLs |
| Money | `BigInt` minor units everywhere, integer-only maths, immutable double-entry ledger |
| Notifications | Outbox pattern; in-app, email (Resend), SMS (Twilio), WhatsApp (Meta Cloud API, approved templates, opt-in), push (FCM with the mobile app) |
| Payments | Provider abstraction: cash on delivery, **Dibsy** (Qatar: Visa/Mastercard, Himyan/NAPS debit, Apple Pay, Google Pay on Dibsy's hosted page), a test sandbox for development, and a local Dibsy stand-in (`npm run dibsy:sandbox`) |

## The customer website

- **English and Arabic** on every page (`/en/…`, `/ar/…`), full right-to-left layout, Arabic plural rules, prices as `QAR 79.00` / `79.00 ر.ق.`; the language is picked from the browser and remembered.
- **Shopping:** home (admin-managed banners, categories, flash deals with countdown, best sellers, new arrivals, top stores, recently viewed), search with type-ahead, popular and recent searches, spelling correction ("Showing results for … / Did you mean …"), Arabic letter forms and the article ignored, staff synonyms, and help instead of an empty page, filters (category, brand, price, rating, in stock) and sorting, category and store pages, product page (gallery, variants, deal price, stock, return window, warranty, specs, reviews with customer photos, questions & answers, more from the store).
- **Guest checkout:** order with just a name, email and mobile number — no account. The confirmation email carries a private tracking link; "Track order" finds it again with the order number and email or phone; the guest can cancel before it ships and later claim the orders by setting a password (forgot-password with the same email). Staff can switch it off per market.
- **Delivery time slots:** the customer picks a day and a window at checkout ("Sat 3 Oct, 13:00–17:00"); each window takes a limited number of orders, full windows show as full, the last place goes to exactly one customer, and cancelled orders give their place back.
- **WhatsApp:** a "Chat with us" button and "Ask about this product / order" links (pre-written message), and — for customers who tick it — order updates on WhatsApp (confirmation with delivery time, out for delivery, delivered, cancelled).
- **Missed delivery:** if the driver could not deliver, the customer is told at once (SMS / email / WhatsApp) and the order page says why ("We missed you") — they pick a new delivery window or leave a note for the driver (guests too, from their tracking link).
- **Documents:** download the invoice (English/Arabic), a credit note for every refund paid and a receipt for every returned item, from the order page (guests from their tracking link).
- **Your data and privacy:** download everything FastMoveX holds about you; delete the account (14-day waiting period, sign in to keep it; orders and invoices kept without your details).
- **Sign in with Google / Apple:** one tap on the sign-in and sign-up pages (shown only for the providers set up); an existing account with the same confirmed email is linked; the account page lists linked sign-ins and asks such customers to set a password.
- **Browser notifications:** "Notifications on this browser" on the Notifications page — order updates as system notifications even when the site is closed; a tap opens the order.
- **Buy again:** one button on a past order (and in the orders list) puts its products back in the cart at today's price; what is no longer available is named.
- **Arrival estimate:** while the FastMoveX driver is on the way: "Arriving around 4:35 PM · about 20 minutes away · 2 stops before yours".
- **Two-step sign-in:** accounts with it on are asked for the authenticator code (or a recovery code) after the password; repeated wrong attempts pause the account with a clear message.
- **Delivery code:** for FastMoveX-driver deliveries the order page (and an SMS, email or WhatsApp when the order leaves) shows a 4-digit code to give the driver only when the order is in hand; while on the way, "Khalid is on the way" with a map link.
- **Safe cash on delivery:** guests confirm their mobile with a texted code; cash is offered up to a set order size and number of open cash orders; blocked customers (or their phone) pay by card.
- **Cart and checkout:** guest cart merged at sign-in, one delivery fee per store shown before paying, promo codes with clear reasons, price-change and stock problems explained, saved Qatar addresses (zone / street / building, map pin), cash on delivery and card (3-D Secure return handled), double-tap safe.
- **Account:** orders with per-shipment tracking, cancel and return where the rules allow, reviews of delivered items (with up to 5 photos, cleaned of location data), questions asked and their answers, wishlist with price-drop / back-in-stock alerts (also on WhatsApp, and "Tell me when it is back" on sold-out products), addresses, notifications, support tickets, email/phone verification, password change, sign out everywhere, marketing consent.
- **Cart reminders:** customers who agreed to offers get a reminder (email, WhatsApp, in-app) when they leave items in the cart — at most one a day, never at night, stopped as soon as they change the cart or order.
- **Content:** About, Privacy and Terms (editable in the admin panel, English + Arabic, starting templates included), Contact form (goes to the admin "Messages" inbox), Offers page (flash sales + everything on sale), store promises strip on the home page.
- **Speed:** Lighthouse mobile 88–98 on the main pages, light product grids (one-element ratings, short markup), product data cached for seconds in the API (~2,000 product reads/s on 2 vCPU), and staff changes refresh the website's cache instantly.
- **Found on Google:** own titles, intro text and questions for categories and brands (written in the admin panel), a page per brand, rich product data (price, stock, delivery, returns, barcode), photo sitemap, Google Shopping feeds in English and Arabic, Search Console / Bing verification from the admin panel — see SEO.md.
- **App-style home (FastMoveX look):** logo with “Shop smart · Live better”, Qatar delivery choice, wishlist dot and cart count, search with **voice** and **camera barcode scan**, popular-search chips, a slider whose text staff write in the admin panel (badge, two-line headline with purple words, button), trust strip, photo category tiles, Flash Deals with a countdown, Trending Now with badges, product cards with rating, old/new price, delivery day (“Tomorrow”) and a one-tap **Add**, five-tab bottom bar on phones. The demo shop comes with product illustrations so a fresh install looks like a real store.
- **Search that sells:** suggestions with photo, price and category as you type, "see all results", buyable products before sold-out ones, best sellers and well-rated products higher, matching categories and the brand's page on the results.
- **Quality:** server-rendered for speed and SEO (metadata, canonical + hreflang, Product / Breadcrumb / Organization / FAQ structured data, sitemaps, robots), strict CSP, WCAG 2.1 AA checks, installable PWA with an offline page.

## The admin panel

- **Dashboard:** revenue, orders, average order, refunds, sales chart (Qatar time), best sellers and top categories, and a "needs your attention" list (orders to ship, low / out of stock, returns, refunds, tickets, reviews).
- **Products:** list with search, filters and bulk actions; editor with English + Arabic text, photos (drag and drop, reorder), options → variants (SKU, barcode, price, compare-at, cost, stock, weight, dimensions), specs, tags, SEO preview, publish / unpublish / archive / feature; CSV export, template and import with a checked preview.
- **Inventory:** prices and stock edited like a spreadsheet and saved together, in total or for one warehouse; every change recorded with who and why.
- **Warehouses:** several stock locations with the delivery zones they are nearest to; each order ships from the one that has everything nearest to the customer (staff can change it, shortages are flagged); stock transfers; the shop's total always equals the sum of the shelves (enforced by the database).
- **Deliveries and the driver page:** shipments ready for pickup are assigned to FastMoveX drivers; drivers sign in on their phone and see today's stops in driving order (delivery window, then zone) with call / WhatsApp / map buttons, cash to collect, the customer's code as proof plus an optional doorstep photo, failed-attempt reasons, and optional live location for the customer (which also gives the customer an arrival estimate). **Works without signal:** the day's run stays on screen and steps taken offline wait on the phone and are sent by themselves when the signal is back.
- **Cash on delivery:** who holds the company's cash right now (drivers and staff), with today's collected / handed over / short totals; the cashier ticks the orders, enters what was counted — a shortage needs a note and stays on record — and a PDF receipt prints for both. Nobody receives their own cash; records cannot be edited or deleted; cash held for over a day shows on the dashboard; drivers over the cash limit must hand over before picking up more.
- **Fraud controls:** a driver delivery is closed only with the customer's code (managers can override with a written, audited reason); refunds need a second person; returned items are inspected (sellable → back on the shelf, damaged → refunded but kept off stock, not accepted → no refund); customers can be blocked from cash on delivery (automatically after refusing orders at the door); **Settings → Cash on delivery safety** for the rules.
- **Staff security (My security):** two-step sign-in with an authenticator app (QR code, 10 recovery codes) — required for every staff account in production; signed-in devices (end any of them); recent sign-ins; email on a new device; accounts pause after 5 wrong attempts. The Staff page shows who has it on, each person's sign-ins, and resets it for someone who lost their phone.
- **Failed-delivery proof:** the driver's failed attempt saves the phone's location and a door photo; Deliveries flags attempts far from the customer's map pin and shows what the customer asked for (new time or a note).
- **Stock control:** every stock change has a reason (damaged, expired, lost, found, correction), big write-offs need a manager; **Expiry dates** (dated products ship oldest first, expired stock is written off every night, what expires soon); **Stocktake** (blind counting with a barcode scanner, a second person approves); **Losses** report; **Suppliers** and **Purchase orders** (PDF, received in parts with batch and expiry by someone other than the buyer, average cost updated).
- **Picking & packing:** shipments waiting to be packed per warehouse, delivery day or window; a picking list in shelf order with the total per product and its orders; packing slips (no prices, barcodes, cash to collect) one by one or in bulk; invoice PDF, credit notes and return receipts from the order, refunds and returns pages; a customer's data file for a data request.
- **Live map & driver performance:** Deliveries → *Live map* shows every driver's last position (grey when older than 10 minutes), their open jobs as numbered pins at the customers' addresses, late jobs, cash in hand and jobs waiting for a driver, refreshed every 30 s; *Drivers* compares drivers over a period — delivered, not delivered / refused, success and on-time %, average drop time, cash collected and short, failures far from the address, wrong codes.
- **Profit & margin:** our own store's sales without VAT against the cost price frozen on each sale, after refunds — by day, product or category, with margin %, delivery fees and marketplace commission alongside, products sold without a cost price listed, CSV export (finance and admins only).
- **Customer tags & notes:** VIP / Risky / Wholesale or any tag, filter customers by tag; staff-only notes with one pinned note that shows on every order of that customer; staff notes on orders. Never visible to the customer.
- **Staff alerts:** a bell with unread count and an Alerts page — new order, failed delivery, refund to approve, low stock, stocktake to approve, cash short — sent to the people whose role covers it; each person picks off / bell / bell + email per alert.
- **Phone orders & order changes:** take an order on the phone (find or add the caller, search products, a promo code the caller gives, check the price, cash on delivery — the order shows who took it); before dispatch, **add an item** (cash orders: today's price, the cash to collect goes up), reduce or remove items (stock back, cash or refund follows), change the address or the delivery window; every change is kept with who and why, and the customer is told. Customers can move their own order to another window or saved address before packing (3 times).
- **At the door & returns pickups:** the driver records items the customer refused (cash to collect drops at once) and the warehouse books them back in (Returns → Back from the door); approved returns get a driver pickup on a chosen day, shown on the driver's page and to the customer.
- **Refund limits:** each finance person can have a maximum refund they may approve; bigger refunds wait for someone with a higher limit.
- **Payments & closing:** a list of payments that do not add up (cancelled but charged, delivered but unpaid, wrong amount, stuck card payments, cash not collected or not handed in), Dibsy settlement file matching, and the daily closing report (PDF).
- **Driver run sheet:** a printable PDF of the day's stops (customer, phone, address, items, cash, signature boxes), from the driver's phone or the Deliveries page; Arabic names print correctly.
- **Orders:** "to ship" queue, delivery-date filter with each window's bookings, shipping steps, cancel, refunds, timeline, invoice PDF with company details (the same file the customer downloads), packing slip per shipment; returns (approve → received → refund) and refunds (card automatic, cash-on-delivery by transfer).
- **Customers (guest shoppers marked "Guest"), support tickets (replies and internal notes), review moderation (remove single photos), product questions (answer → published, customer told).**
- **Marketing:** coupons, flash sales with deal prices and unit limits, scheduled banners, and the **home page editor** — reorder, hide or retitle sections and add product collections (a category, a tag, hand-picked products or everything on sale) with a live preview; **Traffic & funnel** (visits → product → cart → checkout → order with drop-off, sales by source such as Google, Instagram, WhatsApp, devices, landing pages — anonymous, no cookies) and **Search** (what customers search and do not find, one-click synonyms, pinned/hidden popular searches).
- **Content:** website pages (English + Arabic editor with preview, publish, footer links) and the Contact form inbox (mark handled / spam, internal note).
- **Audit:** every staff, seller and driver change is in the audit log — including product photos, stock adjustments, variant changes, failed deliveries and wrong delivery codes, support replies and stocktake counts.
- **Google & social (Settings):** Search Console and Bing codes, social pages, the Google Shopping feed on/off with its addresses; **Categories / Brands → Google (SEO)** tab with a Google preview and the questions editor; brands list shows which still miss their text.
- **Settings:** delivery fee and free-delivery threshold, VAT, payment methods, guest checkout on/off, **delivery times** (windows, orders per window, days, closed days, holidays), **cart reminders** (timing, quiet hours, results), connected services, WhatsApp number, company details; categories and brands; staff, roles and permissions; audit log; sellers (for when the marketplace opens).

## Core business rules (enforced by the backend)

- The client never sends prices, commissions, stock or permissions. Every total is recalculated on the server.
- Commission is resolved per line: product → campaign → seller → category → country → global, with min/max caps, and a snapshot is stored on every order line.
- One customer order can contain several sellers; it is split into one shipment per seller internally.
- Every money movement (capture, release, refund, payout, late payment) is an immutable, balanced ledger transaction. Balances are always the sum of ledger entries.
- FastMoveX promises **competitive prices**, never "always the cheapest": deals are explicit admin campaigns whose price must be below the regular price.
