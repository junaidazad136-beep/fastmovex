# Local setup

Everything you need to run the FastMoveX API on a laptop, from an empty machine.

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **22.12 or newer** | runtime (`node -v`) |
| npm | 10+ | ships with Node |
| Docker Desktop (or Docker Engine + Compose) | recent | local PostgreSQL, Redis and MinIO |
| Git | any | |

No global packages are needed. Windows users: use WSL2.

## 2. Install

```bash
git clone <your-repo-url> fastmovex
cd fastmovex/apps/api
npm install
```

## 3. Configure

```bash
cp .env.example .env
```

Fill in the two secrets (everything else already points at the local Docker services):

```bash
# JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# FIELD_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Optional, for the first admin account created by the base seed:

```
SEED_SUPERADMIN_EMAIL=you@example.com
SEED_SUPERADMIN_PASSWORD=A-strong-password-2026
```

All variables are explained in [ENVIRONMENT.md](ENVIRONMENT.md).

## 4. Start the infrastructure

```bash
docker compose up -d
```

This starts:

| Service | Address | Notes |
|---|---|---|
| PostgreSQL 16 | `localhost:5432` (fastmovex / fastmovex) | created as **UTF8** — required for Arabic |
| Redis 7 | `localhost:6379` | optional cache |
| MinIO (S3) | API `localhost:9000`, console `http://localhost:9001` (fastmovex / fastmovex-minio-secret) | buckets `fastmovex-public` (public read) and `fastmovex-private` are created automatically |

## 5. Database

```bash
npx prisma migrate deploy     # all tables, enums, triggers, search indexes, integrity checks
npm run db:seed               # countries (QA active), currencies, 8 roles, 38 permissions, 23 categories, Qatar 10% default commission
npm run db:seed:demo          # OPTIONAL demo data — refuses to run when NODE_ENV=production
```

Both seeds are idempotent: run them as often as you like.

## 6. Run

```bash
npm run dev                   # watch mode
# or
npm run build && npm start    # compiled, like production
```

- API: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/api/docs` (disabled in production)
- Health: `http://localhost:4000/api/v1/health`

With `NOTIFY_EMAIL_DRIVER=log` and `NOTIFY_SMS_DRIVER=log` (the `.env.example` default), verification and
password-reset codes are printed in the API console instead of being sent.

## 7. Website (apps/web)

In a second terminal, with the API running:

```bash
cd apps/web
cp .env.example .env.local     # defaults work with the local API and MinIO
npm install
npm run dev                    # http://localhost:3000  (redirects to /en or /ar)
```

For a production-like run: `npm run build`, then
`cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static && node .next/standalone/server.js`.

Set the same random value as `INTERNAL_API_KEY` in both `apps/api/.env` and `apps/web/.env.local` so server-side
page renders are not rate-limited like a single visitor (optional locally, required in production).

## 8. Admin panel (apps/admin)

In a third terminal, with the API running:

```bash
cd apps/admin
cp .env.example .env.local     # defaults work with the local API and MinIO
npm install
npm run dev                    # http://localhost:3001
```

The API must allow the panel's origin: `CORS_ORIGINS=http://localhost:3000,http://localhost:3001` in `apps/api/.env`.
Sign in with a staff account: the super admin from `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` (base seed), or
`admin@demo.fastmovex.test` from the demo seed. Customer accounts are refused.

FastMoveX's own store (the "house" store every staff-created product goes into) is created by the base seed; set
`HOUSE_STORE_NAME`, `HOUSE_STORE_NAME_AR`, `HOUSE_STORE_EMAIL`, `HOUSE_STORE_PHONE` before seeding to change its details
(defaults: FastMoveX / فاست موف إكس). Company details for invoices are set in the panel under **Store & delivery**.

The base seed also creates starting **About / Privacy / Terms** pages (edit them under **Pages**). Guest checkout is on
by default (Settings → Checkout). Set `STOREFRONT_URL=http://localhost:3000` in `apps/api/.env` so guest confirmation
emails (printed in the API log with the `log` driver) contain a working tracking link.

## Delivery times, WhatsApp and cart reminders locally

- **Delivery times** and **cart reminders**: switch them on in the admin panel → Settings. Reminders are checked every
  5 minutes and only for customers with marketing consent; quiet hours apply (set 00:00–00:00 to test at night).
- **WhatsApp**: `WHATSAPP_DRIVER=log` (in `.env.example`) prints the template and its values to the API console instead
  of sending. The chat button appears once Settings → Company details → *WhatsApp number for customers* is filled.
- With `STOREFRONT_URL=http://localhost:3000` and the same `INTERNAL_API_KEY` in both apps, admin changes show on the
  website immediately.

## Card payments locally (Dibsy)

Without Dibsy settings, card payments use a built-in test sandbox (instant result; totals ending in .13 are declined).
To try the real Dibsy flow — FastMoveX checkout → Dibsy payment page → back to the shop — without a Dibsy account, run the
local stand-in in another terminal:

```bash
cd apps/api
npm run dibsy:sandbox          # http://localhost:4010 — a local copy of Dibsy's API and payment page, no real money
```

and set in `apps/api/.env` (then restart the API):

```
DIBSY_SECRET_KEY=sk_test_local_sandbox_key
DIBSY_API_URL=http://localhost:4010/v2
API_PUBLIC_URL=http://localhost:4000
```

At checkout choose **Card, Apple Pay or Google Pay**; the sandbox page lets you pay with card / Apple Pay / Google Pay,
decline or cancel. With a real Dibsy test key, remove `DIBSY_API_URL` and use Dibsy's test cards instead. The website caches
market settings for up to 5 minutes, so restart it after switching.

## Demo accounts (`npm run db:seed:demo`)

Password for all: **`Demo-Pass-2026`** (override with `DEMO_PASSWORD`). The `.test` domain is reserved, so these can never be real inboxes.

| Role | Login | Use it to try |
|---|---|---|
| Customer | `customer@demo.fastmovex.test` | the website: browse, cart, checkout (address in Doha pre-filled) |
| Seller — Doha Gadgets Hub | `seller.gadgets@demo.fastmovex.test` | electronics, FastMoveX-fleet delivery |
| Seller — Al Dana Oud & Perfumes | `seller.oud@demo.fastmovex.test` | perfumes, seller-funded coupon `DANA20` |
| Seller — Pearl Home Living | `seller.home@demo.fastmovex.test` | home, groceries |
| Admin | `admin@demo.fastmovex.test` | the admin panel: products, orders, marketing, settings, analytics |
| Finance | `finance@demo.fastmovex.test` | refunds, payout approval |
| Finance (second approver) | `finance2@demo.fastmovex.test` | marks payouts paid (four-eyes rule) |
| Operations | `ops@demo.fastmovex.test` | deliveries, courier assignment |
| Support | `support@demo.fastmovex.test` | tickets, returns |
| Courier | `courier@demo.fastmovex.test` | the **driver page**: sign in to the admin panel on a phone (`http://localhost:3001/driver`) |

Demo data also includes 24 products (34 variants, with generated images when MinIO is running), a live
"Weekend Flash Deals" campaign, home banners, FAQ and three coupons:
`WELCOME10` (10% first order, max QAR 50), `DANA20` (QAR 20 off Al Dana, min QAR 150), `FREESHIP` (free delivery, min QAR 30).

**Test payments:** card / Apple Pay / Google Pay go to the built-in test gateway (never enabled in production).
An order total ending in **.13** is declined, one ending in **.01** waits for a webhook (3-D Secure simulation),
anything else is captured immediately. Cash on delivery works everywhere.

**Phase 17 to try:** search a typo (`erbuds`, `khals dates`) or Arabic without the article; Admin → Marketing → Search
and Traffic & funnel (fill up after a few visits); a sold-out product's "Tell me when it is back"; review photos from
Account → Reviews after an order is delivered; "Ask a question" on a product, answered in Admin → Customer care →
Product questions; Admin → Catalogue → Warehouses (add one with zones, Move stock); mark an order's shipment
"Ready for pickup", assign it in Admin → Sales → Deliveries, then deliver it as the courier on `/driver`
(the customer's code is on their order page).

## Common commands

| Task | Command |
|---|---|
| Type-check | `npm run typecheck` |
| Unit + API tests | `npm test` |
| Integration tests (needs the DB + MinIO + both seeds) | `npm run test:int` |
| New migration after editing `schema.prisma` | `npx prisma migrate dev --name <what-changed>` |
| Browse data | `npm run db:studio` |
| Reset local database | `docker compose down -v && docker compose up -d`, then step 5 |
| Export the OpenAPI spec | `curl localhost:4000/api/docs-json > openapi.json` |
| Website: type-check / unit tests | `cd apps/web && npm run typecheck && npm test` |
| Website: browser tests (API + website running) | `cd apps/web && E2E_API_LOG=<api log file> npm run test:e2e` |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FastMoveX needs a UTF8 database` during migration | The database was created with another encoding. Recreate it: `CREATE DATABASE fastmovex ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;` |
| `Invalid environment variables` on start | The message lists every missing/invalid variable. Compare with `.env.example`. |
| `Unsafe production configuration` on start | You set `NODE_ENV=production` with a development-only value (log drivers, localhost CORS, placeholder secret). See [ENVIRONMENT.md](ENVIRONMENT.md#production-guard-rails). |
| Product images don't upload | MinIO not running or buckets missing: `docker compose up -d minio minio-init`. |
| Prisma cannot download engines (corporate firewall) | The running API does not need them (engine-free). Only `prisma migrate` does: run migrations from CI or a machine with access to `binaries.prisma.sh`. |
| Arabic search returns nothing | Database not UTF8 or created with the `C`/`POSIX` ctype — see the first row. |
| Website images are broken locally | `NEXT_PUBLIC_MEDIA_URL` must match the API's `PUBLIC_MEDIA_BASE_URL`, and `IMAGE_ALLOW_LOCAL_IP=true` for MinIO on 127.0.0.1 (both read at build time — rebuild after changing). |
| Website shows "FastMoveX is taking a short break" | The website cannot reach the API: check `API_INTERNAL_URL` / `PUBLIC_API_URL` and that the API is up. |
| Signed in on the website but API calls fail with CORS errors | Add the website origin to the API's `CORS_ORIGINS`. |
| `429 Too Many Requests` while testing | Auth routes are rate-limited (5/min). Wait a minute, or set `RATE_LIMIT_DISABLED=true` (ignored in production). |
