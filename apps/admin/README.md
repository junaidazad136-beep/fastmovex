# FastMoveX admin panel (`apps/admin`)

The back office for running the FastMoveX store: products and stock, orders and shipping, customers, returns and
refunds, marketing, settings and staff. Next.js 16 (App Router) + Tailwind CSS 4, English UI with Arabic content
fields. It talks only to the FastMoveX API; it has no database and no secrets of its own.

```bash
cp .env.example .env.local      # PUBLIC_API_URL, STOREFRONT_URL, MEDIA_URL
npm install
npm run dev                     # http://localhost:3001
```

The API must allow this origin: add `http://localhost:3001` (production: the panel's https origin) to the API's
`CORS_ORIGINS`.

## Sign-in and access

- Only staff accounts can sign in (the API refuses customers and delivery drivers for the panel).
- The panel's session is separate from the shop's: its refresh token is an httpOnly cookie named `fmx_admin_rt`,
  so a staff member can be signed in to the shop as a customer and to the panel at the same time.
- The menu shows only what the staff member's role allows; every call is checked again by the API.
- Role changes apply within one access-token lifetime (15 minutes) or at the next sign-in.

| Role | Can do |
|---|---|
| Super admin | Everything, including staff, roles and seller payouts |
| Admin | Runs the store; not staff/roles management or marking payouts as paid |
| Catalogue & content | Products, stock, categories, banners, coupons, flash sales, reports |
| Inventory | Sees products; changes stock |
| Orders | Orders and shipping, returns, delivery, reads customers |
| Operations | Orders, delivery, catalogue, stock, sellers, returns |
| Finance | Payments, refunds, payouts, commissions, reports, audit log |
| Customer support | Tickets, reviews, returns; reads orders and customers |

Roles and their permissions are edited in **Roles & permissions** (super admin).

## Screens

| Area | Screens |
|---|---|
| Dashboard | Revenue, orders, average order, refunds; sales chart; best sellers; "needs your attention" |
| Sales | Orders (to ship, awaiting payment…, delivery-date filter with each window's bookings), order page with shipping steps, cancel, refund, printable invoice; returns; refunds; customers (guest shoppers marked "Guest") |
| Catalogue | Products (filters, bulk publish/archive/feature, duplicate); product editor (EN/AR, photos, options & variants, cost, barcode, dimensions, specs, tags, SEO); inventory (spreadsheet-style price/stock editing with history); CSV import/export; categories; brands |
| Marketing | Coupons, flash sales with deal prices, banners with schedules, **Home page** (order, titles and visibility of the home sections; product collections by category, tag, hand-picked products or on-sale, with a live preview; back to the standard layout in one click) |
| Customer care | **Messages** from the website's Contact form (reply by email/phone, internal note, handled / spam), support tickets (replies and internal notes), review moderation |
| Settings | Connected services; delivery fee and free-delivery threshold, VAT, payment methods, guest checkout on/off, **delivery times** (windows, orders per window, days, lead time, closed days, holidays), **cart reminders** (timing, quiet hours, results), company details for invoices and the WhatsApp chat number; **Pages** (About, Privacy, Terms and others — English + Arabic editor with preview, publish, footer links); sellers, staff, roles, audit log |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server on port 3001 |
| `npm run build` / `npm start` | Production build (standalone) / start |
| `npm run typecheck` | Route types + TypeScript |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against a running panel + API with the demo seed |

## Production

`Dockerfile` builds a small non-root image. All settings are read at runtime (see `.env.example`). Put the panel on
its own hostname (e.g. `admin.fastmovex.qa`) on the same site as the API so the session cookie works, and consider
limiting access to it (VPN or IP allow-list) in addition to the staff login.
