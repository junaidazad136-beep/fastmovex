# Deployment

Three Docker images, all stateless: the **API** (`apps/api`), the **customer website** (`apps/web`, Next.js) and the
**admin panel** (`apps/admin`, Next.js). Run 1–N instances of each behind a load balancer, with managed PostgreSQL,
Redis and S3-compatible storage. The website and the admin panel can also be deployed to Vercel (no Docker needed).

```
                 Cloudflare (DNS, TLS, WAF, CDN)
      ┌────────────────┬──────────────────┬───────────────────────┐
 fastmovex.qa     admin.fastmovex.qa        api.fastmovex.qa             media.fastmovex.qa
 website ×N   admin panel ×1        API containers ×N        public bucket (R2/S3)
                                  │    │     │
                     PostgreSQL ◄─┘    │     └─► private bucket (signed URLs)
                     (managed, PITR)   └─► Redis (managed)
                                           Resend (email) · Twilio (SMS) · payment gateway
```

## Before the first deploy

1. **Region / data residency.** Choose infrastructure close to Qatar (latency) and check Qatar's personal-data law
   (PDPPL, Law No. 13 of 2016) with a lawyer for where customer data may be stored. Options with a Doha or GCC
   region: Google Cloud `me-central1` (Doha), Azure Qatar Central, AWS `me-central-1` (UAE) / `me-south-1` (Bahrain).
2. **PostgreSQL 16+**, UTF8 (all major providers default to UTF8), point-in-time recovery on, SSL required.
3. **Redis** (any managed Redis; 256 MB is plenty to start).
4. **Two buckets**: `fastmovex-public` (public read, custom domain `media.fastmovex.qa` through the CDN) and `fastmovex-private` (no public access). An access key limited to these two buckets.
5. **Secrets**: generate `JWT_ACCESS_SECRET` and `FIELD_ENCRYPTION_KEY` ([ENVIRONMENT.md](ENVIRONMENT.md#generating-secrets)); store them in the platform's secret manager; keep an offline copy of the encryption key.
6. **Email**: verify `fastmovex.qa` in Resend (SPF, DKIM). **SMS**: register a sender for Qatar with Twilio (or keep `NOTIFY_SMS_DRIVER=none`).

## The release process (every deploy)

1. CI passes: API (type-check, unit tests, build, migrations + integration tests on Postgres, Docker build) and website (type-check, unit tests, production build, browser tests against the real API, Docker build).
2. Snapshot the database if the release contains a migration.
3. **Run migrations before the new version takes traffic:** `npx prisma migrate deploy`
4. Roll out the new containers; the platform waits for `GET /api/v1/health` (checks the database) before routing traffic.
5. First deploy only: `npm run db:seed` (with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` set), then log in and change that password.

Migrations are additive by convention, so the old version keeps working while the new one starts.

## Option A — Railway (simplest)

```bash
npm i -g @railway/cli
railway login
railway init                                  # new project "fastmovex"
railway add --database postgres               # managed Postgres (UTF8)
railway add --database redis
```

In the dashboard:

1. **New service → GitHub repo**, root directory `apps/api`. Railway detects the `Dockerfile`.
2. **Variables**: all production values from [ENVIRONMENT.md](ENVIRONMENT.md); reference the plugins with `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `REDIS_URL=${{Redis.REDIS_URL}}`; `NODE_ENV=production`.
3. **Settings → Deploy → Pre-deploy command**: `npx prisma migrate deploy`
4. **Healthcheck path**: `/api/v1/health`
5. **Networking → custom domain** `api.fastmovex.qa` (CNAME from Cloudflare).
6. First deploy only: `railway run npm run db:seed`

## Option B — Render

1. **New → Web Service**, connect the repo, *Root Directory* `apps/api`, *Runtime* Docker.
2. **Health Check Path** `/api/v1/health`; **Pre-Deploy Command** `npx prisma migrate deploy`.
3. **New → PostgreSQL** and **New → Key Value (Redis)** in the same region; copy their internal URLs into `DATABASE_URL` / `REDIS_URL`.
4. Environment: the production values from [ENVIRONMENT.md](ENVIRONMENT.md).
5. Custom domain `api.fastmovex.qa`. First deploy only: open the service **Shell** and run `npm run db:seed`.

## Free test server (Vercel + Render + Supabase)

To try the whole shop online at no cost before buying hosting: [FREE-TEST.md](FREE-TEST.md). The repository root has
`render.yaml` (API on Render's free plan, built by `apps/api/scripts/render-build.sh`), the website and panel go on
Vercel Hobby with `API_PROXY_TARGET`, database and photos on Supabase's free plan. Free plans sleep, pause and are
non-commercial: it is for testing, not for the real launch.

## Option C — any container platform (AWS ECS/Fargate, Cloud Run, Azure Container Apps, Kubernetes)

```bash
cd apps/api
docker build -t registry.example.com/fastmovex-api:$(git rev-parse --short HEAD) .
docker push registry.example.com/fastmovex-api:<tag>

# release job (one-off container, same image and env)
docker run --rm --env-file prod.env registry.example.com/fastmovex-api:<tag> npx prisma migrate deploy
# first deploy only
docker run --rm --env-file prod.env registry.example.com/fastmovex-api:<tag> npm run db:seed
```

Service settings: container port `4000` (or `PORT`), health check `GET /api/v1/health`, 0.5 vCPU / 512 MB per
instance to start, minimum 2 instances for zero-downtime deploys, graceful shutdown (the image uses `tini`;
Nest shutdown hooks close the database pool).

## The website (apps/web)

The website only talks to the API: it has no database and no secrets except `INTERNAL_API_KEY`.

**Docker (any platform):**

```bash
cd apps/web
docker build --build-arg NEXT_PUBLIC_MEDIA_URL=https://media.fastmovex.qa -t registry.example.com/fastmovex-web:<tag> .
docker run -p 3000:3000 \
  -e PUBLIC_API_URL=https://api.fastmovex.qa/api/v1 \
  -e API_INTERNAL_URL=http://fastmovex-api.internal:4000/api/v1 \
  -e SITE_URL=https://fastmovex.qa \
  -e INTERNAL_API_KEY=<same value as the API> \
  registry.example.com/fastmovex-web:<tag>
```

Container port `3000`, health check `GET /robots.txt`, 0.5 vCPU / 512 MB per instance to start.

**Vercel:** import the repo, root directory `apps/web`, framework Next.js; set the runtime variables above plus the
build-time `NEXT_PUBLIC_MEDIA_URL`. Add the domain `fastmovex.qa`.

**Checklist for the website:**

- the API's `CORS_ORIGINS` contains `https://fastmovex.qa` (and `https://www.fastmovex.qa` if used); `COOKIE_DOMAIN=.fastmovex.qa` so the
  sign-in cookie set by `api.fastmovex.qa` is sent from `fastmovex.qa` (same site);
- `INTERNAL_API_KEY` is set to the **same** value on both services;
- `SITE_URL` is the real public address (it drives canonical URLs, the sitemap and whether `robots.txt` allows indexing);
- submit `https://fastmovex.qa/sitemap.xml` in Google Search Console and Bing Webmaster Tools;
- Cloudflare: cache `/_next/static/*` and `/icons/*` (immutable); do **not** cache HTML (pages carry a per-request CSP nonce).

## Storage and CDN (Cloudflare R2 example)

1. R2 → create `fastmovex-public` and `fastmovex-private`.
2. `fastmovex-public` → Settings → **Custom domain** `media.fastmovex.qa`. Set `PUBLIC_MEDIA_BASE_URL=https://media.fastmovex.qa`.
3. `fastmovex-private` stays private (documents and delivery photos are only served through 5-minute signed URLs).
4. R2 → Manage API tokens → token with *Object Read & Write* on the two buckets → `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`.

Every upload gets a new unique key (a replaced image is a new file) and `Cache-Control: immutable`, so the CDN can cache public files forever.

## Time zone

The API forces its own process to UTC at start (`src/common/utc.ts`), whatever `TZ` the host sets, so app-written
timestamps and the database clock always agree; days and "today" are computed per market (Qatar time) in code. Keep
the database itself on UTC (the default on managed Postgres).

## Background work

There is no separate worker to deploy. Every API instance runs:

| Job | Interval | Safe with many instances because |
|---|---|---|
| Release seller earnings after the return window | hourly | per-shipment advisory lock + ledger idempotency key |
| Notification outbox (email/SMS/push, retries with backoff) | every 15 s (+ immediately after writes) | rows leased with `FOR UPDATE SKIP LOCKED` |
| Cancel unpaid online orders after 30 min (stock, coupon, deal quota returned) | every 5 min | conditional `PENDING → CANCELLED` update |
| Abandoned-cart reminders | every 5 min | conditional claim per cart |
| Write the search log and visit analytics (counted in memory) | every 30 s / 15 s, and on shutdown | upserts that add counts (`ON CONFLICT … + EXCLUDED`) |
| Reload the catalogue words for spelling suggestions | every 10 min, in the background | read-only, per instance |
| Delete visit analytics older than 13 months | every 6 h | plain delete |
| Write off expired stock (dated lots past their date, units not promised to orders) | daily 00:10 Qatar time | rows locked `FOR UPDATE` per lot; a second run finds nothing left |
| Delete accounts whose 14-day waiting period is over (still-open activity → tried again the next day) | daily 03:30 Qatar time | each account is deleted once (`deletedAt` checked first) |
| Low-stock alerts to inventory staff (own-store products at or below their level; each once until restocked) | every 15 min | the alert flag is set before sending; a second instance finds nothing new (rarely, two instances in the same second may both send one) |
| Staff alerts on events (new order, failed delivery, refund to approve, stocktake, cash short) | right after the event | sent once by the instance that handled the request |

**Graceful shutdown**: on `SIGTERM` an instance writes its pending counts, waits up to 5 s for database work still
running (notifications, delivery updates started just before), then closes — it never hangs a deploy. Give the
container at least 15 s to stop (most platforms do).

Finance can also trigger the release manually: `POST /api/v1/admin/finance/release-due`.

## Image processing

The API re-encodes customer photos with **sharp** (a native module). The Docker image is Debian-based
(`node:22-bookworm-slim`) and `npm ci` installs the matching prebuilt binary — nothing to add. If you build on Alpine,
install with `npm ci --include=optional` so `@img/sharp-linuxmusl-*` is fetched.

## Backups

- **Database:** use the provider's point-in-time recovery (PITR, 7+ days) plus a daily logical backup (`pg_dump -Fc`) copied to
  another account/region, kept 30 days. Test a restore into a scratch database once a month.
- **Files:** enable versioning (or a nightly copy) on `fastmovex-private` (seller documents, proof-of-delivery photos).
  `fastmovex-public` can be rebuilt from uploads but versioning is cheap insurance.
- **Secrets:** `FIELD_ENCRYPTION_KEY` backed up offline — without it encrypted IBANs cannot be read.
- The ledger is append-only: a restore never needs "fixing" balances; they are recomputed from entries.

## Scaling notes

- Set `REDIS_URL` once you run more than one instance (shared caches, alert throttling).
- Connections: `instances × DATABASE_POOL_MAX` must stay under the Postgres plan limit; add PgBouncer (transaction mode) beyond ~10 instances.
- Search is fast on Postgres to roughly 500k products; after that, implement the `SearchEngine` interface for Typesense/Meilisearch (one class, swapped in `search.module.ts`).
- Put Cloudflare in front of `api.fastmovex.qa` (TLS, WAF, bot protection). The API trusts one proxy hop for client IPs (rate limits).
- **Website capacity.** Every page is rendered per request (the strict per-request CSP nonce rules out page caching), so
  capacity grows with website instances: measured on 2 vCPU, one instance renders ~30 home pages/s and ~55–70 product or
  category pages/s (the data behind them is cached). Run **2+ website instances** (or one per CPU) behind the load
  balancer for launch and add more for sale days. The API is far cheaper per request (product pages ~2,000/s, search
  ~1,500/s on the same machine). Images go through the media CDN and Next.js image cache.
- Keep `STOREFRONT_URL` (or `STOREFRONT_INTERNAL_URL`) and `INTERNAL_API_KEY` set on the API so staff changes refresh the
  website cache at once; every website instance has its own cache, so behind a load balancer point
  `STOREFRONT_INTERNAL_URL` at each instance or accept up to 1–5 minutes for the others.

## WhatsApp (order updates and the chat button)

**Chat button:** Admin → Settings → Company details → *WhatsApp number for customers*. Any WhatsApp Business number
works; nothing to set up on the server.

**Order updates and cart reminders** use the WhatsApp Business **Cloud API** (Meta):

1. Meta Business account (verified) → WhatsApp Manager → add the sending number (it cannot stay on the WhatsApp app at the same time).
2. Create a system user with `whatsapp_business_messaging`, generate a permanent token → `WHATSAPP_TOKEN`; copy the number's
   *Phone number ID* → `WHATSAPP_PHONE_NUMBER_ID`; set `WHATSAPP_DRIVER=cloud`.
3. Submit these templates in WhatsApp Manager, each in **English (`en`)** and **Arabic (`ar`)**, with exactly these names
   and variables. Until a template is approved, its messages fail and are retried, then marked failed (email still goes out).

| Name | Category | English | Arabic |
|---|---|---|---|
| `fastmovex_order_placed` | Utility | Hi {{1}}, thank you for your FastMoveX order {{2}}. Total: {{3}}. Delivery: {{4}}. We will message you here when it is on its way. | مرحباً {{1}}، شكراً لطلبك من فاست موف إكس رقم {{2}}. الإجمالي: {{3}}. التوصيل: {{4}}. سنراسلك هنا عندما يكون في الطريق. |
| `fastmovex_out_for_delivery_code` | Utility | Hi {{1}}, your FastMoveX order {{2}} is out for delivery and arrives today. Your delivery code is {{3}} — give it to the driver only when you have your order. | مرحباً {{1}}، طلبك من فاست موف إكس رقم {{2}} خرج للتوصيل ويصلك اليوم. رمز التسليم: {{3}} — أعطه للسائق فقط عند استلام طلبك. |
| `fastmovex_order_delivered` | Utility | Hi {{1}}, your FastMoveX order {{2}} was delivered. Thank you for shopping with us! | مرحباً {{1}}، تم توصيل طلبك من فاست موف إكس رقم {{2}}. شكراً لتسوقك معنا! |
| `fastmovex_order_cancelled` | Utility | Your FastMoveX order {{1}} (or part of it) was cancelled. Anything you paid by card is refunded to the same card. | تم إلغاء طلبك من فاست موف إكس رقم {{1}} (أو جزء منه). يُسترد أي مبلغ دفعته بالبطاقة إلى نفس البطاقة. |
| `fastmovex_cart_reminder` | Marketing | Hi {{1}}, you left {{2}} in your FastMoveX cart. Complete your order here: {{3}} | مرحباً {{1}}، تركت {{2}} في سلة فاست موف إكس. أكمل طلبك من هنا: {{3}} |
| `fastmovex_price_drop` | Marketing | Hi {{1}}, good news: {{2}} from your FastMoveX wishlist is now {{3}}. See it here: {{4}} | مرحباً {{1}}، خبر سار: {{2}} من قائمة أمنياتك في فاست موف إكس أصبح الآن {{3}}. شاهده هنا: {{4}} |
| `fastmovex_back_in_stock` | Utility | Hi {{1}}, {{2}} is back in stock at FastMoveX. Order it here before it runs out: {{3}} | مرحباً {{1}}، {{2}} متوفر مجدداً في فاست موف إكس. اطلبه من هنا قبل نفاده: {{3}} |
| `fastmovex_delivery_failed` | Utility | Hi {{1}}, our driver could not deliver your FastMoveX order {{2}} today. Choose a new delivery time or leave a note for the driver here: {{3}} | مرحباً {{1}}، لم يتمكن سائقنا من توصيل طلبك من فاست موف إكس رقم {{2}} اليوم. اختر موعداً جديداً للتوصيل أو اترك ملاحظة للسائق من هنا: {{3}} |
| `fastmovex_question_answered` | Utility | Hi {{1}}, we answered your question about {{2}} on FastMoveX. Read the answer here: {{3}} | مرحباً {{1}}، أجبنا على سؤالك حول {{2}} في فاست موف إكس. اقرأ الإجابة هنا: {{3}} |

Customers get WhatsApp messages only after ticking the box at checkout or in their account; cart reminders also need
marketing consent. Price-drop and back-in-stock messages go only to customers who switched that alert on for a
saved product ("Tell me when it is back" on the product page, or the bell in their wishlist). Utility messages inside Meta's free allowance cost nothing; marketing messages are charged per message
by Meta (see Meta's current Qatar rates).

## Sign in with Google / Apple

**Google** (Google Cloud console → APIs & Services → Credentials):
1. OAuth consent screen: app name FastMoveX, support email, logo, privacy and terms links (`https://fastmovex.qa/en/privacy`,
   `/en/terms`), scopes `openid email profile` only. Publish it (no review needed for these scopes).
2. Create an **OAuth client ID → Web application**; *Authorized JavaScript origins*: `https://fastmovex.qa` (and
   `https://www.fastmovex.qa` if used). No redirect URI is needed (the button works in a popup).
3. Put the client id first in the API's `GOOGLE_CLIENT_IDS`; add the iOS / Android client ids after it when the app
   ships.

**Apple** (Apple Developer → Certificates, Identifiers & Profiles; needs the paid developer account):
1. An **App ID** with *Sign in with Apple* enabled (the future app's bundle id, e.g. `qa.fastmovex.app`).
2. A **Services ID** (e.g. `qa.fastmovex.web`) → enable Sign in with Apple → primary App ID above → *Domains*: `fastmovex.qa`;
   *Return URLs*: `https://fastmovex.qa/en/login` and `https://fastmovex.qa/ar/login`. Verify the domain if Apple asks.
3. To receive email at Apple's private relay addresses, register your sending domain / `EMAIL_FROM` address under
   *Sign in with Apple for Email Communication*.
4. Put the Services ID first in `APPLE_CLIENT_IDS` (the app's bundle id after it later).

The website shows a button only for providers the API has ids for. Staff never use these buttons (the admin panel
refuses them). Test on staging with a real Google / Apple account: new account, the same account again, and an
existing email (it gets linked).

## Browser notifications (Web Push)

1. Once: `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret) on the API, and
   `VAPID_SUBJECT=mailto:tech@fastmovex.qa`.
2. Nothing to set on the website: it asks the API for the public key. Customers switch notifications on in
   **Account → Notifications** ("Notifications on this browser"). Chrome, Edge, Firefox and Safari 16.4+ on Mac work;
   on iPhone only after "Add to Home Screen" (iOS 16.4+).
3. Every order update that goes to the app also goes to those browsers; a tap opens the order.

## Google, Bing and Google Shopping

Follow **SEO.md** (in this folder): Search Console and Bing codes go into Admin → Settings → Google & social; submit
`https://fastmovex.qa/sitemap.xml`; create the Google Business Profile; in Google Merchant Center add the two feeds
`https://fastmovex.qa/feeds/google-en.xml` and `/feeds/google-ar.xml` (scheduled fetch, daily) and turn on free listings.
Product photos in the feed must be on an `https` media address (`PUBLIC_MEDIA_BASE_URL`).

## The driver page without signal

Nothing to configure: `/driver` installs a small offline helper the first time a driver opens it with signal. Tell
drivers: open the page once at the warehouse each morning; in a basement or lift they can keep marking jobs (the page
shows "steps waiting"), and the steps are sent by themselves when the phone is back online; do not sign out while
steps are waiting (the page warns). The delivery code is checked when the step is sent — take care to type it right.

## The admin panel (apps/admin)

Same pattern as the website, with no secrets at all: everything is read at runtime.

```bash
cd apps/admin
docker build -t registry.example.com/fastmovex-admin:<tag> .
docker run -p 3001:3001 \
  -e PUBLIC_API_URL=https://api.fastmovex.qa/api/v1 \
  -e STOREFRONT_URL=https://fastmovex.qa \
  -e MEDIA_URL=https://media.fastmovex.qa \
  -e MAP_TILE_URL='https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=…' \
  -e MAP_ATTRIBUTION='© MapTiler © OpenStreetMap contributors' \
  registry.example.com/fastmovex-admin:<tag>
```

Container port `3001`, health check `GET /robots.txt`, one small instance (0.25 vCPU / 256 MB) is plenty.
On Vercel: root directory `apps/admin`.

**Checklist for the panel:**

- its own hostname, e.g. `https://admin.fastmovex.qa`, added to the API's `CORS_ORIGINS`;
- same site as the API (`*.fastmovex.qa`) so its session cookie (`jovia_admin_rt`, SameSite=Strict) is sent;
- restrict who can reach it on top of the staff login: Cloudflare Access / Zero Trust, a VPN, or an IP allow-list;
- never cached by a CDN (the panel already sends `Cache-Control: no-store`) and never indexed (`X-Robots-Tag: noindex`);
- the drivers' live map: OpenStreetMap's own tiles are the default and fine for a few screens; for daily use pick a
  tile provider (MapTiler, Stadia, Mapbox — free tiers cover an operations team) and set `MAP_TILE_URL` /
  `MAP_ATTRIBUTION`; `MAP_TILE_URL=none` shows the pins without a background;
- set the API's `ADMIN_URL` so staff alert emails link to the right page;
- set refund approval limits for finance staff (Staff → Refund limit) — a manager without a limit approves the big ones;
- give the support team `orders.create` only if they take phone orders (it is in their role by default);
- create one account per person (no shared logins) with the smallest role that fits; review **Staff** and the
  **Audit log** monthly.

## Go-live checklist

- [ ] `NODE_ENV=production`; the API starts (it refuses unsafe settings).
- [ ] `CORS_ORIGINS` lists only the real web origins; `COOKIE_DOMAIN=.fastmovex.qa`.
- [ ] Website: `SITE_URL`, `PUBLIC_API_URL`, `INTERNAL_API_KEY` (same as the API) and the build-time `NEXT_PUBLIC_MEDIA_URL` set; `IMAGE_ALLOW_LOCAL_IP` **not** set.
- [ ] `robots.txt` allows indexing on the production domain and the sitemap is submitted.
- [ ] Database backups / PITR enabled and a restore tested once.
- [ ] `FIELD_ENCRYPTION_KEY` backed up offline.
- [ ] **Delivery times** set in Settings (windows, orders per window, Friday/holidays) — or left off for "as soon as possible"; **cart reminders** switched on if wanted.
- [ ] WhatsApp: chat number set; for order updates the Cloud API keys set and the templates approved (above — `fastmovex_out_for_delivery_code` replaces `jovia_out_for_delivery`: it carries the delivery code).
- [ ] 2+ website instances behind the load balancer; `STOREFRONT_URL` + `INTERNAL_API_KEY` on the API so staff changes appear at once.
- [ ] **Dibsy** merchant account approved (needs the company CR and a Qatari bank account; KYC in the Dibsy dashboard). On staging: `DIBSY_SECRET_KEY` = test key, pay with Dibsy's test cards, check the order turns *Paid*, try a decline and a refund. Then production: live key, `API_PUBLIC_URL=https://api.fastmovex.qa`, website origin in `STOREFRONT_URL`/`CORS_ORIGINS`. Ask Dibsy to enable Apple Pay (they register the domain), Google Pay and Himyan on the account. Place one real order and refund it.
- [ ] Email domain verified; SMS sender approved (or SMS off).
- [ ] Admin panel on its own hostname, access-restricted, in `CORS_ORIGINS`; company details (legal name, CR number) set in **Store & delivery** so invoices are complete.
- [ ] Super admin password changed; 2+ finance admins created (payouts **and refunds** need two people); every staff member has their own account and the smallest role that fits. Give `delivery.override` (closing a driver delivery without the customer's code) only to managers — Admin and Super Admin have it.
- [ ] **Cash on delivery safety** (Settings → Cash on delivery safety): SMS sender approved before go-live (guests prove their mobile by SMS before paying cash — without SMS, guests can only pay by card), largest cash order, open cash orders per customer, refusals before COD is switched off, driver cash limit. Name the cashier(s) (`FINANCE_ADMIN`, or a custom role with `cash.receive`); every driver hands over cash daily on the **Cash on delivery** page and keeps the PDF receipt.
- [ ] The API image ships `assets/fonts` (Noto Sans Arabic, OFL) for PDFs — the Dockerfile copies it; on other hosts deploy the folder next to `dist/`.
- [ ] **Two-step sign-in**: every staff member installs an authenticator app (Google / Microsoft Authenticator, 1Password) and turns it on at first sign-in (**My security** — production requires it); each saves their 10 recovery codes somewhere safe. At least two people hold `admins.manage` so a lost phone can be reset.
- [ ] **Stock control**: mark food, cosmetics and other dated products "Has an expiry date"; enter suppliers; from now on receive deliveries against purchase orders (the person receiving is not the one who ordered); plan a monthly stocktake per area; set `STOCK_WRITE_OFF_LIMIT_MINOR` if QAR 500 does not fit.
- [ ] **Payments**: finance checks **Payments & closing → Needs checking** every morning, prints the daily closing report, and uploads Dibsy's settlement CSV (Dibsy dashboard → reports) when it arrives; WhatsApp template `fastmovex_delivery_failed` approved (above).
- [ ] **Privacy page** (Pages → Privacy) says how customers download their data and delete their account (Account → Your data and privacy) and the 14-day waiting period; a storage lifecycle rule (or job) removes photo files no longer referenced.
- [ ] **Warehouse:** shelf positions (`bin`) filled in for the products so picking lists come out in walking order; staff print the picking list and packing slips each morning (Picking & packing).
- [ ] **Sign in with Google / Apple** (optional): OAuth web client and Apple Services ID made (above), ids in `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`; tried once on staging.
- [ ] **Browser notifications** (optional): VAPID keys generated once and stored in the secrets manager.
- [ ] **Google**: Search Console verified and sitemap submitted, Bing too; Google Business Profile created; Merchant Center feeds added and free listings on; category and brand texts written for the top categories (SEO.md).
- [ ] Commission rules, delivery pricing and categories reviewed by the business team.
- [ ] Demo data **not** loaded (`db:seed:demo` refuses in production).
- [ ] Uptime monitor on `/api/v1/health`; error tracking and log retention configured.
- [ ] **Privacy** and **Terms** pages (admin panel → Pages) reviewed by a lawyer in Qatar — the seeded texts are templates — and company details, return rules and contact details filled in; **About** rewritten in your own words. Leave the Terms/Privacy links in Store & delivery empty to use these pages.
- [ ] Support email, phone/WhatsApp and address set in **Store & delivery** (shown on the Contact page); someone owns the admin **Messages** inbox.
- [ ] API `STOREFRONT_URL=https://fastmovex.qa` so guest confirmation emails carry a tracking link; decide whether guest checkout stays on (Settings → Checkout).
