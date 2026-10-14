# Environment variables

The API validates its environment at startup (`src/config/env.ts`). A missing or invalid variable stops the
process with a list of every problem, so a misconfigured deploy never half-starts.

Legend — **Req**: required · *opt*: optional.

## Runtime

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `NODE_ENV` | *opt* | `development` | `development`, `test` or `production`. Production hides Swagger, refuses the test payment gateway and enables the guard rails below. | `production` |
| `TZ` | — | ignored | The API always runs in UTC (set in code); a host `TZ` such as Asia/Qatar has no effect. | |
| `PORT` | *opt* | `4000` | HTTP port. | Set by the platform (Railway/Render inject `PORT`). |

## Database

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `DATABASE_URL` | **Req** | — | PostgreSQL connection string. The database must be **UTF8**. | Managed Postgres URL with `?sslmode=require` |
| `DATABASE_POOL_MAX` | *opt* | `10` | Connections per API instance. Keep `instances × pool` below your plan's connection limit. | e.g. `10` for 2 instances on a 25-connection plan |
| `DATABASE_CA_CERT` | *opt* | — | The database provider's CA certificate (PEM text; `\n` escapes allowed). The API then connects **encrypted and verified** against it, whatever `sslmode` the URL carries (the URL's ssl options still apply to the Prisma CLI). | Hosted Postgres with its own CA (Supabase: Database settings → SSL → Download certificate) |

The API pins every connection to `TimeZone=UTC`; the migrations also set the database default to UTC.

## Authentication

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | **Req** | — | HMAC secret for access tokens and webhook signatures of the test gateway. ≥ 32 chars. Also peppers one-time-code hashes and signs guest order links. | 48 random bytes, from a secrets manager. Rotating it logs everyone out and invalidates guest tracking links (guests can still look orders up with order number + email). |
| `JWT_ACCESS_TTL_SECONDS` | *opt* | `900` | Access-token lifetime (60–3600). Role changes apply at the next refresh. | `900` |
| `REFRESH_TTL_DAYS` | *opt* | `30` | Refresh-token lifetime (1–90). Tokens rotate on every refresh. | `30` |
| `CORS_ORIGINS` | *opt* | `http://localhost:3000` | Comma-separated browser origins allowed to call the API with credentials. | `https://fastmovex.qa,https://seller.fastmovex.qa,https://admin.fastmovex.qa` |
| `COOKIE_DOMAIN` | *opt* | — | Domain of the refresh-token cookies (`fmx_rt` for the shop, `fmx_admin_rt` for the admin panel). | `.fastmovex.qa` |
| `STAFF_TWO_FACTOR` | *opt* | `required` in production, `optional` elsewhere | `required`: every staff account must use two-step sign-in (authenticator app) before using staff tools; `optional`: staff may turn it on. Customers, sellers and drivers are never asked. | leave unset (= `required`) |
| `DEFAULT_COUNTRY` | *opt* | `QA` | Market used when a request has no `X-Country` header. Must be an active country. | `QA` |

## Encryption

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `FIELD_ENCRYPTION_KEY` | **Req** | — | 32 bytes, base64. AES-256-GCM key for seller IBANs. | Generate once, store in a secrets manager, back it up offline. **Never change it after go-live** — encrypted IBANs would become unreadable. |

## File storage (S3-compatible)

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `S3_ENDPOINT` | *opt* | — | Custom endpoint. Empty = AWS S3. | R2: `https://<account>.r2.cloudflarestorage.com` |
| `S3_REGION` | *opt* | `auto` | Region. | AWS: e.g. `me-central-1`; R2: `auto` |
| `S3_ACCESS_KEY_ID` | **Req** | — | Access key. | Key scoped to the two buckets only |
| `S3_SECRET_ACCESS_KEY` | **Req** | — | Secret key. | |
| `S3_FORCE_PATH_STYLE` | *opt* | `false` | `true` for MinIO. | `false` |
| `S3_BUCKET_PUBLIC` | **Req** | — | Product images, logos, banners, review photos. Public read (behind a CDN). | `fastmovex-public` |
| `S3_BUCKET_PRIVATE` | **Req** | — | Seller documents, proof-of-delivery photos. **No public access**; served through 5-minute signed URLs. | `fastmovex-private` |
| `PUBLIC_MEDIA_BASE_URL` | **Req** | — | Base URL used to build public image links. | `https://media.fastmovex.qa` (CDN in front of the public bucket) |

## Cache

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `REDIS_URL` | *opt* | — | Redis for caches (home feed, search, categories, commission rules, alert throttling). Empty = in-process memory cache. Redis errors degrade to cache misses, never to errors. | **Set it** as soon as you run 2+ instances |

## Finance

| Variable | Req | Default | Description |
|---|---|---|---|
| `PAYOUT_MIN_MINOR` | *opt* | `5000` | Smallest payout a seller can request, in minor units (QAR 50.00). |
| `STOCK_WRITE_OFF_LIMIT_MINOR` | *opt* | `50000` | Value (at cost, minor units — QAR 500.00) of stock one person may write off at a time without `inventory.approve`. |

## Notifications

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `NOTIFY_EMAIL_DRIVER` | *opt* | `none` | `none`, `log` (print to console) or `resend`. | `resend` |
| `RESEND_API_KEY` | when `resend` | — | Resend API key. | |
| `EMAIL_FROM` | *opt* | `FastMoveX <no-reply@fastmovex.qa>` | Sender. The domain must be verified in Resend (SPF/DKIM). | |
| `NOTIFY_SMS_DRIVER` | *opt* | `none` | `none`, `log` or `twilio`. | `twilio` (or `none` until contracted) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | when `twilio` | — | Twilio credentials and sender (number or alphanumeric ID registered for Qatar). | |
| `NOTIFY_PUSH_DRIVER` | *opt* | `none` | `none` or `log`. The FCM driver is added with the mobile app. | `none` |
| `STOREFRONT_URL` | *opt* | — | Public address of the website: private **tracking links** in guest order emails, the cart link in **cart reminders**, and where the API sends "refresh your cache" right after staff change something (so changes show at once). Empty = links fall back to text and the website shows changes after its cache time (1–5 min). | `https://fastmovex.qa` |
| `ADMIN_URL` | *opt* | — | Public address of the admin panel. Staff alert emails end with a link to the page (the order, the refunds list…). Empty = the email has no link. | `https://admin.fastmovex.qa` |
| `STOREFRONT_INTERNAL_URL` | *opt* | `STOREFRONT_URL` | Only if the API reaches the website server on an internal address (e.g. `http://web:3000` in Docker). | |
| `WHATSAPP_DRIVER` | *opt* | `none` | `none`, `log` (print to the console) or `cloud` (Meta WhatsApp Cloud API). | `cloud` once the templates are approved |
| `WHATSAPP_TOKEN` | with `cloud` | — | Permanent system-user access token (Meta Business settings → System users) with `whatsapp_business_messaging`. | from the secrets manager |
| `WHATSAPP_PHONE_NUMBER_ID` | with `cloud` | — | Numeric id of the sending number (WhatsApp Manager → API setup) — not the phone number itself. | |
| `WHATSAPP_API_URL` | *opt* | `https://graph.facebook.com/v22.0` | Graph API base and version. Raise the version when Meta retires it. | |

| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *opt* | — | **Browser notifications** (Web Push) for the website. Generate once: `npx web-push generate-vapid-keys`. Both or neither; empty = off (the Notifications page shows no switch). Never change them casually: every browser would have to switch notifications on again. | private key from the secrets manager |
| `VAPID_SUBJECT` | *opt* | `mailto:support@fastmovex.qa` | Contact the push services (Google, Mozilla, Apple) may use. `mailto:` or `https:`. | `mailto:tech@fastmovex.qa` |

When a channel is `none` it is simply skipped: nothing is reported as "sent" that was not. In-app notifications always work.

## Sign in with Google / Apple (customers)

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `GOOGLE_CLIENT_IDS` | *opt* | — | Comma-separated OAuth client ids whose ID tokens are accepted: the **web** client first (the website's button uses it), then the iOS / Android app clients. Empty = no Google button. | `123-abc.apps.googleusercontent.com,…` |
| `APPLE_CLIENT_IDS` | *opt* | — | Apple **Services ID** for the website first (e.g. `qa.fastmovex.web`), then the app's bundle id (`qa.fastmovex.app`). Empty = no Apple button. | |
| `GOOGLE_JWKS_URL` / `APPLE_JWKS_URL` | *opt* | Google's / Apple's published keys | For local tests only (a key server the tests run). The API refuses to start in production when they are changed. | leave unset |

Client ids are public (they are in the website's page); there is no client secret: the API only checks ID tokens.

## Card payments (Dibsy)

| Variable | Req | Default | Description | Production |
|---|---|---|---|---|
| `DIBSY_SECRET_KEY` | *opt* | — | Dibsy secret API key (dashboard → Developers). Set = card payments go through Dibsy (the customer chooses card, Himyan, Apple Pay or Google Pay on Dibsy's page); the test sandbox is then switched off. Empty = no gateway: cash on delivery only in production, the test sandbox in development. | Live secret key from the secrets manager. Use the **test** key on staging. |
| `DIBSY_API_URL` | *opt* | `https://api.dibsy.one/v2` | Dibsy API base. Only change it to use the local stand-in (`http://localhost:4010/v2`, see SETUP.md). | leave the default (must be https) |
| `PAYLATER_CLIENT_ID` | *opt* | — | PayLater (Qatar "pay in 4") merchant client id, from PayLater's merchant portal. With the secret and outlet id set, the **PAYLATER** payment method becomes available; switch it on per market in Admin → Settings → Payment methods. Orders from QAR 300 to QAR 25,000 only. | From PayLater (live) — UAT credentials on staging. |
| `PAYLATER_CLIENT_SECRET` | *opt* | — | PayLater client secret (OAuth2 client credentials). | Secrets manager. |
| `PAYLATER_OUTLET_ID` | *opt* | — | PayLater outlet id (digits). | From PayLater. |
| `PAYLATER_WEBHOOK_SECRET` | prod, if PayLater is on | — | Signs PayLater's payment notifications. Give PayLater the webhook address `{API_PUBLIC_URL}/api/v1/payments/webhook/paylater`. | Secrets manager. |
| `PAYLATER_API_URL` | *opt* | `https://connect.paylaterapp.com` | PayLater API base. Use `https://connect.uat.paylaterapp.com` with UAT credentials on staging. | leave the default (must be https) |
| `DEEPL_API_KEY` | *opt* | — | Automatic Arabic ⇄ English for product names, short lines, descriptions, option words and store pages. Free key: deepl.com → API Free plan → Account → API keys (ends in `:fx`, 500,000 characters a month). Without it nothing is translated and the shop works as before. Status: Admin → Catalogue → Arabic translation. | Secrets manager. Never in chat or git. |
| `TRANSLATE_PROVIDER` | *opt* | `deepl` | `deepl` (uses the key above), `off`. `fake` is for tests only and refused in production. | leave the default |
| `TRANSLATE_SWEEP` | *opt* | `on` | The once-a-minute pass over older products, CSV imports and store pages. | leave the default |
| `API_PUBLIC_URL` | with Dibsy | — | Public address of this API; Dibsy calls `<API_PUBLIC_URL>/api/v1/payments/webhook/dibsy` when a payment changes. | `https://api.fastmovex.qa` (required with Dibsy) |

The return address after paying is the website's own `/{locale}/checkout/return`; the API only accepts return addresses on
`STOREFRONT_URL` or a `CORS_ORIGINS` origin, so keep the website's origin in one of them.

## Website server key

| Variable | Used by | Description |
|---|---|---|
| `INTERNAL_API_KEY` | API **and** website | 32+ random characters, same value on both. The website's server sends it on public `GET` requests so page renders are not rate-limited per IP and not counted as product views. Never exposed to browsers. The API also uses it to call the website's `POST /api/revalidate` (instant refresh after staff changes). Optional; without it the website still works but shares one rate-limit bucket and shows staff changes after its cache time. |

## Website (apps/web)

Read at **runtime** (one image for every environment):

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_API_URL` | `http://localhost:4000/api/v1` | API URL used by browsers. Its origin is also the CSP `connect-src`. |
| `API_INTERNAL_URL` | = `PUBLIC_API_URL` | API URL used by the website's server (private network in production). |
| `SITE_URL` | `http://localhost:3000` | Public website address: canonical URLs, sitemap, Open Graph. `robots.txt` blocks everything unless this is a real (non-localhost, non-staging) address in production. |
| `DEFAULT_COUNTRY` | `QA` | Market shown to visitors. |
| `INTERNAL_API_KEY` | — | See above. |
| `MEDIA_URL` | = `NEXT_PUBLIC_MEDIA_URL` | Media origin allowed by the CSP `img-src`. |
| `SITE_URL` also decides the addresses in the Google product feeds (`/feeds/google-en.xml`, `/feeds/google-ar.xml`) | | |
| `SEARCH_ENGINES` | on | `off` makes `robots.txt` block everything. Addresses on `*.vercel.app`, `*.onrender.com`, `*.netlify.app`, `*.pages.dev`, localhost and anything with `staging` are blocked anyway. |
| `SOCIAL_SIGN_IN` | on | `off` removes Google's and Apple's sign-in origins from the CSP (use it if neither is set up on the API). The buttons themselves appear only for providers the API has client ids for. |

Read at **build time** (Docker build args):

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_MEDIA_URL` | Public base URL of product images (the API's `PUBLIC_MEDIA_BASE_URL`). Only this host is allowed through the image optimiser (AVIF/WebP, responsive sizes). Without it images are served unoptimised. |
| `IMAGE_OPTIMIZATION` | `false` serves images as-is (use when a CDN image service resizes them). |
| `IMAGE_ALLOW_LOCAL_IP` | `true` only for a local MinIO on 127.0.0.1. **Never in a real deployment** (lets the optimiser fetch private IPs). |
| `API_PROXY_TARGET` | Only when the API is on **another site** (free test hosting: website on `vercel.app`, API on `onrender.com`), where browsers never send the SameSite=Strict sign-in cookie. E.g. `https://fastmovex-api.onrender.com`: the website then serves the API at its own `/api/v1`, and `PUBLIC_API_URL` must be `https://<this site>/api/v1`. Not needed with `api.fastmovex.qa` next to `fastmovex.qa`. |

## Admin panel (apps/admin)

All read at **runtime**; the panel has no secrets (staff sign in with their own accounts).

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_API_URL` | `http://localhost:4000/api/v1` | API URL used by the browser. Its origin is the CSP `connect-src`. Add the panel's origin to the API's `CORS_ORIGINS`. |
| `STOREFRONT_URL` | `http://localhost:3000` | The customer website, for "View in store" links. |
| `MEDIA_URL` | — | Media origin (product photos, banners) allowed by the CSP `img-src`, e.g. `https://media.fastmovex.qa`. |
| `DEFAULT_COUNTRY` | `QA` | Market the panel works in. |
| `MAP_TILE_URL` | OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) | Background tiles of the drivers' **live map** (`{z}/{x}/{y}`, optional `{s}`). Its origin is added to the CSP `img-src` automatically. OpenStreetMap's own servers are fine for a few staff screens; for more, use a provider's URL with its key (MapTiler, Stadia, Mapbox…). `none` = pins only. |
| `MAP_ATTRIBUTION` | `© OpenStreetMap contributors` | Credit shown on the map; set the provider's required text with `MAP_TILE_URL`. |
| `API_PROXY_TARGET` (build time) | — | Same as for the website: the API on another site (free test hosting). Then `PUBLIC_API_URL` = `https://<panel>/api/v1`. |

## Development / test only

| Variable | Used by | Description |
|---|---|---|
| `RATE_LIMIT_DISABLED` | API | `true` turns rate limiting off. **Ignored when `NODE_ENV=production`.** Used by the integration and browser tests (they sign in and request codes many times a minute). |
| `E2E_API_LOG`, `WEB_URL`, `API_URL`, `PW_CHROMIUM_PATH` | website browser tests | API log file (to read one-time codes printed by the `log` driver), website and API addresses, an already-installed Chromium. |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | `npm run db:seed` | Creates (or keeps) the first SUPER_ADMIN. Use a 12+ character password and change it after the first login. |
| `HOUSE_STORE_NAME`, `HOUSE_STORE_NAME_AR`, `HOUSE_STORE_SLUG`, `HOUSE_STORE_EMAIL`, `HOUSE_STORE_PHONE` | `npm run db:seed` | FastMoveX's own store, where staff-created products go (0% commission). Defaults: `FastMoveX`, `فاست موف إكس`, `fastmovex`. Created once; later runs keep it. |
| `DEMO_PASSWORD` | `npm run db:seed:demo`, integration tests | Password of the demo accounts (default `Demo-Pass-2026`). |
| `DEMO_SEED_ALLOW` | `npm run db:seed:demo` | `yes` lets the demo shop load with `NODE_ENV=production` — **only for a private test server** ([FREE-TEST.md](FREE-TEST.md)), and only with your own `DEMO_PASSWORD` of 12+ characters. Never on the real shop. |
| `SEED_ONLY_IF_EMPTY` | `npm run db:seed` | `yes` skips the seed when the database is already set up (automatic deploys, so admin changes are never reset). |

## Production guard rails

With `NODE_ENV=production` the API **refuses to start** if:

- `NOTIFY_EMAIL_DRIVER`, `NOTIFY_SMS_DRIVER`, `NOTIFY_PUSH_DRIVER` or `WHATSAPP_DRIVER` is `log` (one-time codes and personal data would end up in logs), or `WHATSAPP_DRIVER=cloud` lacks its token or number id,
- `JWT_ACCESS_SECRET` looks like a placeholder (`change-me`, `example`, `test-secret`),
- `CORS_ORIGINS` contains `localhost`,
- `DIBSY_SECRET_KEY` is set without `API_PUBLIC_URL`, or `DIBSY_API_URL` is not https,
- `GOOGLE_JWKS_URL` / `APPLE_JWKS_URL` are changed, or only one of the two VAPID keys is set.

It also removes the test payment gateway (card methods are hidden from `GET /markets` unless `DIBSY_SECRET_KEY` is set), refuses non-https payment return addresses and checkout pages, hides Swagger, and ignores `RATE_LIMIT_DISABLED`.
The demo seed refuses to run.

## Generating secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # FIELD_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # INTERNAL_API_KEY
```
