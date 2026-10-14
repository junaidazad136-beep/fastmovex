# API

REST, JSON, versioned. **380 operations** across 62 groups.

- Base URL: `https://api.fastmovex.qa/api/v1` (local: `http://localhost:4000/api/v1`)
- Interactive docs (non-production): `/api/docs` · machine-readable spec: [`apps/api/openapi.json`](apps/api/openapi.json) (regenerate with `curl localhost:4000/api/docs-json > openapi.json`) — use it to generate typed clients for the web, dashboards and Flutter app.

## Conventions

### Authentication

| Client | Login / register response | Refresh |
|---|---|---|
| **Web** (default) | `{ accessToken, expiresIn }` + `fmx_rt` refresh cookie (httpOnly, Secure in production, SameSite=Strict, path `/api/v1/auth`) | `POST /auth/refresh` with the cookie **and** header `X-Requested-With: fastmovex-web` (CSRF guard) |
| **Mobile** (send `X-Client-Type: mobile`) | `{ accessToken, refreshToken, expiresIn }` — store the refresh token in the Keychain/Keystore | `POST /auth/refresh` with `{ "refreshToken": "…" }` |
| **Admin panel** (send `X-Client-Type: admin`) | Staff and FastMoveX drivers (drivers only get the `/driver` page; every API call still checks permissions) — `403` for customers. `{ accessToken, expiresIn }` + its own `fmx_admin_rt` cookie, so the panel and the shop never replace each other's session | `POST /auth/refresh` with the cookie, `X-Client-Type: admin` and `X-Requested-With: fastmovex-web`; refused once the account has neither a staff permission nor the driver role |

Send the access token as `Authorization: Bearer <token>` (15 minutes). Refresh tokens are single-use and rotate;
reusing an old one revokes that whole login on every device. After `POST /seller/apply`, refresh once so the token
carries the `SELLER` role.

### Money

Amounts are **strings of minor units**: `"26110"` = QAR 261.10. Never send floats. Clients never send prices at
all — carts take `variantId` + `quantity`, and every total is computed by the server.

### Headers

| Header | Used for |
|---|---|
| `X-Country` | Market (`QA` default). Only active countries are accepted. Drives currency, VAT, delivery and catalogue. |
| `X-Cart-Token` | Guest cart. Returned as `cartToken` by the first `POST /cart/items`; after login call `POST /cart/merge`. |
| `X-Buy-Now-Token` | `GET /cart/buy-now`: the one-item cart made by `POST /cart/buy-now { variantId, quantity }` ("Buy Now"). Checkout takes it as `buyNowToken` (signed in) or `X-Cart-Token` (guest); the customer's own cart is untouched. |
| `Idempotency-Key` | `POST /checkout` and `POST /checkout/guest` — retrying with the same key returns the same order (`"reused": true`), never a second one. A key already used by someone else is refused (`409`). |
| `X-Order-Token` | Guest order pages: the `orderAccessToken` from guest checkout or `POST /orders/guest/lookup`. |
| `X-Client-Type: mobile` | Refresh token in the body instead of a cookie. |
| `X-Client-Type: admin` | Admin panel session: staff-only sign-in, separate refresh cookie. |

### Errors

Standard shape; validation lists every problem:

```json
{ "statusCode": 400, "error": "Bad Request", "message": ["identifier must be longer than or equal to 3 characters"] }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input, or a business rule (e.g. "Only 3 can be added", "This code has expired") |
| 401 | Not logged in / token expired → refresh |
| 403 | Logged in but not allowed (role/permission, seller not approved) |
| 404 | Not found **or not yours** (other sellers' / customers' records are reported as not found) |
| 409 | Conflict: out of stock, price changed, concurrent edit, duplicate |
| 429 | Rate limit (`Retry-After`); one-time-code endpoints return `retryAfterSeconds` |

Unknown body fields are rejected (`forbidNonWhitelisted`), so a client can never smuggle in `isAdmin`, `priceMinor`, etc.

### Pagination

- Lists: `?cursor=` → `{ items, nextCursor }` (keyset, stable while new rows arrive). Pass `nextCursor` back until it is `null`.
- Search: `?page=&limit=` (limit ≤ 48, first 1,000 results) → `{ items, total, page, pageCount, facets }`.

### Rate limits

120 requests/min per IP by default. Stricter: login/register 5/min, forgot-password 5/15 min, OTP confirm 10/15 min,
coupon apply 10/min, seller apply 3/min, bank-details change 5/hour, support tickets 5/hour, checkout 10/min,
guest checkout 5/min, guest order lookup 10/15 min, contact form 3/10 min (and at most 5 messages per email per hour).

## Main flows

**Customer purchase**

1. `GET /home`, `GET /search?q=…`, `GET /products/{slug}`
2. `POST /cart/items { variantId, quantity }` (guest or logged in) → cart grouped by seller with server totals
3. `POST /cart/coupon { code }` (login required) · if `canCheckout` is false, read `notices` / item `issues` (`PRICE_CHANGED` → `POST /cart/acknowledge-prices`)
4. `POST /addresses` → `GET /delivery/slots` (when `enabled`, show the days and windows; `required` = the customer must pick one) → `POST /checkout { addressId, paymentMethod, deliverySlot?, whatsappOptIn? }` with `Idempotency-Key`. `deliverySlot` is a window's `start` from the listing. Refusals: `409 SLOT_REQUIRED`, `409 SLOT_FULL` (someone took the last place — reload the listing), `400 SLOT_INVALID` / `SLOT_CLOSED`. `whatsappOptIn: true` records consent to order updates on WhatsApp (the account mobile, or the delivery mobile when the account has none).
5. Response `payment.status`: `CAPTURED` (done), `PENDING` + `redirectUrl` (send the customer there: Dibsy's payment page or 3-D Secure; the webhook confirms), `FAILED` (order cancelled, items put back in the cart). Card payments need `returnUrl`, an address on the FastMoveX website (`STOREFRONT_URL` or a `CORS_ORIGINS` origin); anything else is `400`.
6. Back on the return page, poll `GET /orders/{orderNumber}` (guests: `GET /orders/guest/{orderNumber}`) — reading a pending card order makes the API ask the gateway directly, so it confirms even if the webhook is late.
7. `GET /orders/{orderNumber}`, `GET /orders/{orderNumber}/tracking` (shows the 4-digit delivery code for FastMoveX couriers)

**Guest purchase (no account)** — only when `GET /markets` shows `guestCheckout: true` for the market.

1. `POST /cart/items` as a guest → keep `cartToken`
2. `POST /checkout/guest` with `X-Cart-Token`, `Idempotency-Key` and `{ contact: { fullName, email, phone, marketingOptIn?, locale? }, address: { …same fields as POST /addresses }, paymentMethod, note? }`
3. The response is the normal checkout result plus `orderAccessToken`. Keep it on the device; the confirmation email carries a tracking link with it (when `STOREFRONT_URL` is set).
4. `GET /orders/guest/{orderNumber}` with `X-Order-Token` (same shape as `GET /orders/{orderNumber}` + `guest: true`) · `POST /orders/guest/{orderNumber}/cancel { reason }`
5. Lost the link: `POST /orders/guest/lookup { orderNumber, contact }` (email or phone used for the order) → `{ token }`; a wrong pair is `401` with no hint which part was wrong.

**Cash on delivery as a guest** (market rule `codRules.phoneCheck` = `GUESTS` or `ALL`): first
`POST /checkout/guest/phone-code` with the same `contact` → `{ required: true, sentTo, expiresInSeconds }` (a 6-digit
SMS code; `required: false` when this guest already proved that number), then send `contact.phoneCode` with the order.
Missing or wrong code → `400 COD_PHONE_CODE`; SMS not connected → `503 SMS_OFF` / `403 COD_NEEDS_SMS` (pay by card or
sign in). Codes: 10 minutes, 5 tries, 60 s between sends, 5 per number per hour.

**Cash-on-delivery refusals** (any checkout): `403 COD_BLOCKED` (the account, or anyone using that delivery phone, is
blocked), `400 COD_LIMIT` (order above `maxOrderMinor`; the body has `maxOrderMinor`), `400 COD_OPEN_ORDERS` (too many
undelivered cash orders), `403 COD_PHONE_UNVERIFIED` (`phoneCheck: ALL` and the account's mobile is not verified).
Card payment is never limited.

Refusals: `409 ACCOUNT_EXISTS` (the email belongs to an account — sign in), `403 GUEST_CHECKOUT_OFF`. Registering with an
email or phone a guest used returns `409 GUEST_ACCOUNT`: the person sets a password with forgot-password (the one-time
code proves the address), and the account keeps the guest orders.

**Delivery slots** — `GET /delivery/slots` → `{ enabled, required, timezone, days: [{ date, weekday, slots: [{ start, end, from, to, left, available }] }] }`. Live (not cached): it changes with every order. `from`/`to` are local times; `start`/`end` are ISO instants. The chosen window comes back on the order as `deliverySlotStart` / `deliverySlotEnd`.

**WhatsApp** — `GET /markets` → `whatsapp: { updates, chat }`: `updates` = the store can send order updates (show an unticked "updates on WhatsApp" box at checkout / in the account: `PATCH /me/notification-settings { whatsappOptIn }`, `400 NO_PHONE` without a mobile number); `chat` = the number for a `https://wa.me/<chat>?text=…` link. Guests: `contact.whatsappOptIn` on `POST /checkout/guest`.

**Content and home page** — `GET /pages` (footer links) and `GET /pages/{slug}` (text in a small markdown subset: `## ` / `### ` headings, `- ` lists, `**bold**`, `[text](/path|https://…|mailto:|tel:)`; render it as text, never as HTML) · `POST /contact { name, email, phone?, subject?, message, orderNumber? }` → `202` (leave the hidden `website` field empty) · `GET /offers` (running campaigns and products on sale). The home feed follows the order staff set in the admin panel; each section may carry `title` / `titleAr` (use them over your default title) and `viewAll` (`{ category, sort }`, `{ q, sort }` or `{ offers: true }`). Sections with `key: "collection"` are product rows staff made; `value_props` has no items (show the store's promises).

**Seller onboarding** — `POST /seller/apply` → refresh token → `PATCH /seller/me`, `PUT /seller/me/bank`, `POST /seller/me/documents` (multipart `file` + `type`) → `POST /seller/me/submit` → admin approves.

**Selling** — `POST /seller/products` (draft with variants) → `POST /seller/products/{id}/images` → `PATCH /seller/products/{id} { submitForReview: true }` → admin approves → orders arrive at `GET /seller/orders` → `POST /seller/orders/{id}/status` (`PREPARING` → `SHIPPED` → `OUT_FOR_DELIVERY` → `DELIVERED`, or `READY_FOR_PICKUP` for a FastMoveX courier).

**FastMoveX's own store (admin panel)** — `POST /admin/products` (defaults to the FastMoveX store, `status: DRAFT`) → `POST /admin/products/{id}/images` → `POST /admin/products/{id}/status { status: "ACTIVE" }` (needs a photo and an active variant) · stock: `POST /admin/variants/{id}/stock { delta, reason }` (or `delta: 0` with `lowStockThreshold` to change only the alert level) · spreadsheet: `GET /admin/products/export.csv` → edit → `POST /admin/products/import?dryRun=true` (multipart `file`, reports per line) → same without `dryRun` · orders: `GET /admin/orders?view=to_fulfil` → `POST /admin/orders/shipments/{id}/status` step by step · counters for the menu: `GET /admin/dashboard/summary` (only what the caller may act on).

**Money out** — `GET /seller/finance/balance` (pending / available / requestable / paid) → `POST /seller/payouts` → finance approves → a *different* finance admin marks it paid.

## Payment webhooks

`POST /api/v1/payments/webhook/{provider}` — public, not in Swagger. Each provider turns the call into trusted data or
refuses it (`400`/`403`):

- **Dibsy** (`/payments/webhook/dibsy`, set automatically as `webhookUrl` from `API_PUBLIC_URL`): the body only names a
  payment id (`{ "id": "…" }` or `id=…`). The API never trusts it — it fetches that payment from Dibsy with the secret
  key and uses Dibsy's answer, which must match the order (our order id in `metadata`, amount and currency) before
  anything is confirmed. A forged call can at most make the API look a payment up.
- **PayLater** (`/payments/webhook/paylater`, give this address to PayLater): JSON with `merchantId`, `orderId` (our
  order number), `status`, `timestamp`, `comments`, `txHash`, `signature`. `txHash` must be MD5 of the upper-cased
  concatenation and `signature` HMAC-SHA256 of `txHash` with `PAYLATER_WEBHOOK_SECRET`; anything else is refused. The
  customer's return page also asks PayLater's status endpoint, so a lost webhook never leaves a paid order unpaid.
- **Test gateway** (development only): `X-Test-Signature` = HMAC-SHA256 of the raw body with `JWT_ACCESS_SECRET`.

Replayed events return `{ "duplicate": true }`. If a webhook never arrives, the API asks the gateway when the customer
opens the order and once more before an unpaid order expires (30 min), so a paid order is never cancelled.

## What the apps can rely on (no business rules in the frontend)

The website (and later the Flutter app) never re-implements a rule; the API tells it what is allowed:

| Need | Where it comes from |
|---|---|
| Currency, VAT display, payment methods that really work, delivery pricing, address fields per market | `GET /markets` (payment methods without a configured provider are left out; `cardProvider`: `"dibsy"` = one card option whose page also offers Apple Pay, Google Pay and Himyan, `"test"` = sandbox, `testPayments: true` only then) |
| The price to show | product cards and product variants carry `dealPriceMinor` / `dealEndsAt` for a running campaign — the same rule the cart charges |
| Return window on the product page | `returnWindowDays` on `GET /products/{slug}` (0 = not returnable) |
| Whether to show "Cancel order" | `canCancel` on `GET /orders/{orderNumber}` (and the guest route) |
| Whether to offer guest checkout | `guestCheckout` on `GET /markets` |
| Whether to show "Return" on an item | `returnableQty` and `returnDeadline` on each order item |
| Why a promo code did not apply | `coupon.reason` in the cart (`NOT_FOUND`, `EXPIRED`, `MIN_ORDER` + `shortByMinor`, …) — stable codes to translate |
| Sitemap | `GET /sitemap` (summary) and `GET /sitemap?kind=products|categories|stores&page=N` |

**Server-side rendering.** The website's server sends `X-Internal-Key: <INTERNAL_API_KEY>` on its public `GET` requests. Those
requests skip per-IP rate limits (every visitor's page render comes from the same server IP) and are not counted as product
views — the shopper's browser reports the real view. The key is compared in constant time and never accepted for writes.

## Endpoints

🔒 = `Authorization: Bearer` required (role/permission checks apply on top). Admin routes need the permission listed in
[SECURITY.md](SECURITY.md#roles-and-permissions); seller routes need an **approved** seller (onboarding routes excepted).


### Health

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | public |

### Catalogue

| Method | Path | Auth |
|---|---|---|
| GET | `/sitemap` | public |

### Auth

| Method | Path | Auth |
|---|---|---|
| POST | `/auth/register` | public |
| POST | `/auth/password/forgot` | public |
| POST | `/auth/password/reset` | public |
| POST | `/auth/verify/request` | 🔒 |
| POST | `/auth/verify/confirm` | 🔒 |
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/logout` | public |
| POST | `/auth/logout-all` | 🔒 |
| POST | `/auth/change-password` | 🔒 |
| GET | `/auth/me` | 🔒 |
| GET / POST | `/auth/social/providers` · `/auth/social` (see **Sign in with Google / Apple**) | public |
| POST | `/auth/2fa/login` | public |
| GET | `/auth/2fa` | 🔒 |
| POST | `/auth/2fa/setup` | 🔒 |
| POST | `/auth/2fa/enable` | 🔒 |
| POST | `/auth/2fa/recovery-codes` | 🔒 |
| POST | `/auth/2fa/disable` | 🔒 |
| GET | `/auth/sessions` | 🔒 |
| DELETE | `/auth/sessions/{id}` | 🔒 |
| GET | `/auth/login-history` | 🔒 |
| POST | `/admin/staff/{id}/2fa/reset` | 🔒 `admins.manage` |
| GET | `/admin/users/{id}/login-history` | 🔒 `users.read` |

**Two-step sign-in.** With it on, `POST /auth/login` answers `200 { twoFactorRequired: true, challenge, expiresIn: 300 }`
and no tokens; finish with `POST /auth/2fa/login { challenge, code }` (6-digit app code or a recovery code `XXXX-XXXX`),
which answers exactly like a normal login. Wrong code → `401 BAD_CODE`; old challenge → `401 CHALLENGE_EXPIRED`.
To turn it on: `POST /auth/2fa/setup` → `{ secret, otpauthUrl }` (show the URL as a QR code), then
`POST /auth/2fa/enable { code }` → `{ recoveryCodes: [10], accessToken, expiresIn }` (shown once; every other session is
signed out; this device gets a new session). `GET /auth/2fa` → `{ enabled, enabledAt, recoveryCodesLeft, required,
thisSession }` (also inside `GET /auth/me` as `twoFactor`). When staff must use it (`STAFF_TWO_FACTOR=required`, the
production default) a staff session without it gets `403 TWO_FACTOR_SETUP_REQUIRED` on everything except
`/auth/me`, `/auth/2fa*`, `/auth/sessions*`, `/auth/login-history`, `/auth/change-password` and `/auth/logout-all`.
**Lockout:** 5 wrong passwords or codes in 15 minutes → `429 { reason: 'ACCOUNT_LOCKED', retryAfterSeconds }` for 15
minutes (a password reset unlocks). `GET /auth/sessions` → signed-in devices `{ id, device, ip, signedInAt,
lastActiveAt, twoStep, current }`; `DELETE` ends one. `GET /auth/login-history` → the last 30 attempts.

### Categories

| Method | Path | Auth |
|---|---|---|
| GET | `/categories` | public |
| GET | `/categories/{slug}` | public |

### Admin / Categories

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/categories` | 🔒 |
| POST | `/admin/categories` | 🔒 |
| PUT | `/admin/categories/reorder` | 🔒 |
| PATCH | `/admin/categories/{id}` | 🔒 |
| DELETE | `/admin/categories/{id}` | 🔒 |

### Seller / Onboarding

| Method | Path | Auth |
|---|---|---|
| POST | `/seller/apply` | 🔒 |

### Seller / Account

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/me` | 🔒 |
| PATCH | `/seller/me` | 🔒 |
| PUT | `/seller/me/bank` | 🔒 |
| POST | `/seller/me/documents` | 🔒 |
| POST | `/seller/me/logo` | 🔒 |
| POST | `/seller/me/banner` | 🔒 |
| POST | `/seller/me/submit` | 🔒 |

### Admin / Sellers

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/sellers` | 🔒 |
| GET | `/admin/sellers/{id}` | 🔒 |
| GET | `/admin/sellers/documents/{docId}/url` | 🔒 |
| PATCH | `/admin/sellers/documents/{docId}` | 🔒 |
| POST | `/admin/sellers/{id}/approve` | 🔒 |
| POST | `/admin/sellers/{id}/reject` | 🔒 |
| POST | `/admin/sellers/{id}/suspend` | 🔒 |
| POST | `/admin/sellers/{id}/reinstate` | 🔒 |

### Products

| Method | Path | Auth |
|---|---|---|
| GET | `/products/{slug}` | public |
| GET | `/products/{slug}/related` | public — `{ boughtTogether (≤2), alsoViewed (≤12) }`, from real orders and views, cached 30 min |

### Seller / Products

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/products` | 🔒 |
| POST | `/seller/products` | 🔒 |
| GET | `/seller/products/{id}` | 🔒 |
| PATCH | `/seller/products/{id}` | 🔒 |
| DELETE | `/seller/products/{id}` | 🔒 |
| POST | `/seller/products/{id}/variants` | 🔒 |
| PATCH | `/seller/variants/{variantId}` | 🔒 |
| POST | `/seller/variants/{variantId}/stock` | 🔒 |
| GET | `/seller/variants/{variantId}/stock` | 🔒 |
| POST | `/seller/products/{id}/images` | 🔒 |
| PUT | `/seller/products/{id}/images/order` | 🔒 |
| DELETE | `/seller/images/{imageId}` | 🔒 |

### Admin / Products

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/products` | 🔒 |
| POST | `/admin/products` | 🔒 |
| GET | `/admin/products/export.csv` | 🔒 |
| GET | `/admin/products/import-template.csv` | 🔒 |
| POST | `/admin/products/import` | 🔒 |
| POST | `/admin/products/bulk` | 🔒 |
| GET | `/admin/products/{id}` | 🔒 |
| PATCH | `/admin/products/{id}` | 🔒 |
| POST | `/admin/products/{id}/status` | 🔒 |
| POST | `/admin/products/{id}/duplicate` | 🔒 |
| POST | `/admin/products/{id}/variants` | 🔒 |
| POST | `/admin/products/{id}/images` | 🔒 |
| PUT | `/admin/products/{id}/images/order` | 🔒 |
| DELETE | `/admin/images/{imageId}` | 🔒 |
| POST | `/admin/products/{id}/approve` | 🔒 |
| POST | `/admin/products/{id}/reject` | 🔒 |
| POST | `/admin/products/{id}/feature` | 🔒 |
| POST | `/admin/products/{id}/unfeature` | 🔒 |
| PATCH | `/admin/variants/{variantId}` | 🔒 |
| POST | `/admin/variants/{variantId}/stock` | 🔒 |
| GET | `/admin/variants/{variantId}/stock` | 🔒 |
| GET | `/admin/inventory` | 🔒 |
| POST | `/admin/inventory/bulk` | 🔒 |

### Brands

| Method | Path | Auth |
|---|---|---|
| GET | `/brands` | public |
| POST | `/admin/brands` | 🔒 |
| PATCH | `/admin/brands/{id}` | 🔒 |

### Size guides

`GET /products/{slug}` returns `sizeChart` (or `null`): the product's own guide, otherwise the nearest category's default
when the product has a size option ("Size", "Shoe size", "المقاس"…). A guide is `{ id, name, nameAr, kind, columns:
[{ label, labelAr, unit: "cm" | "in" | null }], rows: string[][], note, noteAr }`; `kind` (CLOTHING, LENGTH, SHOES, KIDS,
GENERAL) picks the "how to measure" tips. Products and categories take `sizeChartId` (null = none / category default).
FastMoveX's guides (no store) can be category defaults; a store's own guides only its own products.

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/size-charts` | 🔒 products.read |
| GET | `/admin/size-charts/{id}` | 🔒 products.read |
| POST | `/admin/size-charts` | 🔒 products.manage |
| PATCH | `/admin/size-charts/{id}` | 🔒 products.manage |
| DELETE | `/admin/size-charts/{id}` | 🔒 products.manage |
| GET | `/seller/size-charts` | 🔒 seller — FastMoveX's (`own: false`) and the store's own |
| POST | `/seller/size-charts` | 🔒 seller |
| PATCH | `/seller/size-charts/{id}` | 🔒 seller (own guides only) |
| DELETE | `/seller/size-charts/{id}` | 🔒 seller (own guides only) |

### Seller bulk upload

The staff spreadsheet (`/admin/products/import`), limited to the seller's own store. Products are matched by `handle` or by
a SKU inside that store; sellers cannot add brands (an unknown brand is a line error) and cannot publish directly:
`status=active` sends a product that has photos for review, `archived` archives it. New products are drafts.

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/products/import-template.csv` | 🔒 seller |
| GET | `/seller/products/export.csv` | 🔒 seller — the store's products |
| POST | `/seller/products/import?dryRun=true` | 🔒 seller — multipart `file`; 30 an hour; returns `{ products, variants, stockChanges, errors[{ line, sku, message }], warnings }` |

### Account Health and holiday mode

`GET /seller/health` (and staff: `GET /admin/sellers/{id}/health`, sellers.read) returns `{ status: good | risk | poor,
metrics: [{ key, value, count, of, target, limit, days, state: good | warn | bad | none }] }` for: `cancellations` (orders
the store cancelled, 30 days, target < 2.5%, limit 5%), `lateDispatch` (ready for pickup more than 24 h after the order,
30 days, < 4% / 10%), `returns` (items returned of items delivered, 30 days, < 8% / 15%), `rating` (published reviews,
90 days, ≥ 4.0 / 3.5) and `questions` (answered within 48 h, ≥ 90% / 70%). A measure needs enough cases before it is judged.

`PUT /seller/away { until: ISO date | null, message? }` closes the store until a date (max 90 days): its products leave
search, categories and home rails, cannot be added to a cart (400, `reason: STORE_AWAY`), cart lines get the blocking
issue `STORE_AWAY`, and product / store pages carry `store.awayUntil` and `awayMessage`. It reopens by itself.
`GET /seller/away` returns the current state.

### Automatic Arabic

Sellers and staff may write product text in English or Arabic; the API writes the other language (DeepL, when
`DEEPL_API_KEY` is set) for `title`, `shortDescription`, `description` and the store's `description`, right after a
product is saved and otherwise within a minute. Brand names, model numbers, units and short ALL-CAPS codes are kept.
`autoText` on a product (seller and admin views) lists the fields the machine wrote; text changed by hand drops out of
it and is never overwritten. `optionsAr` (`GET /products/{slug}`) maps option words to Arabic (`{"Colour": "اللون",
"Black": "أسود"}`); cart lines carry `optionsAr` (the line's options in Arabic) next to `options`.

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/translation` | 🔒 products.read — provider, state, month's usage, products waiting |
| POST | `/admin/translation/run` | 🔒 products.manage — work through the waiting list now |

### Search

| Method | Path | Auth |
|---|---|---|
| GET | `/search` | public |
| GET | `/search/suggest` | public |
| GET | `/search/popular` | public |
| POST | `/search/log` | public |

`GET /search` also returns `spelling { original, corrected, auto }` — `auto: true` means nothing matched what was typed, so these are the results for `corrected` ("Showing results for …"); otherwise it is a "Did you mean …?" suggestion. `spell=false` searches exactly what was typed. When nothing is found, `noResults { popular[], products[] }` (popular searches and best sellers). Arabic letter forms (أ/إ/ا, ة/ه, ى/ي), harakat and the article "ال" are ignored on both sides. Staff synonyms widen a word. `GET /search/suggest` adds `queries[]` (popular searches starting like the text). `GET /search/popular` → `{ queries }` (pinned and most-searched; a shop without search history gets its best-selling brands). A query that looks like a **barcode or SKU** (one word of letters, digits, dashes with a digit in it) also matches variants by exact `barcode` / `sku` and ranks them first — the website's camera barcode search uses this. `POST /search/log { q, total, corrected? }` (204, 60/min) is sent by the browser once per search: counts only, never who searched; anything that looks like an email, phone or card number or a link is not stored.

### Home

| Method | Path | Auth |
|---|---|---|
| GET | `/home` | public |
| GET | `/me/recently-viewed` | 🔒 |
| GET | `/offers` | public |

`GET /home` (phase 25, the app-style home): hero banners carry their text — `kicker`, `headline` (≤2 lines; words between `*stars*` are coloured), `subline`, `ctaLabel`, each with an `…Ar` version, all nullable (no headline = the picture alone); category tiles carry `imageUrl` (the picture of the category's best-selling product). Every product card carries `quickAddVariantId`: the variant the card's **Add** button puts in the cart (only for a one-option product in stock; otherwise `null` and the button opens the product). `POST/PATCH /admin/banners` accept the same text fields (empty string clears; a third headline line is refused).

### Content

| Method | Path | Auth |
|---|---|---|
| GET | `/pages` | public |
| GET | `/pages/{slug}` | public |
| POST | `/contact` | public |

### Stores

| Method | Path | Auth |
|---|---|---|
| GET | `/stores/{slug}` | public |

### Cart

| Method | Path | Auth |
|---|---|---|
| GET | `/cart` | public |
| DELETE | `/cart` | public |
| POST | `/cart/items` | public |
| PATCH | `/cart/items/{itemId}` | public |
| DELETE | `/cart/items/{itemId}` | public |
| POST | `/cart/acknowledge-prices` | public |
| POST | `/cart/coupon` | 🔒 |
| DELETE | `/cart/coupon` | 🔒 |
| POST | `/cart/merge` | 🔒 |

### Admin / Coupons

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/coupons` | 🔒 |
| POST | `/admin/coupons` | 🔒 |
| PATCH | `/admin/coupons/{id}` | 🔒 |

### Seller / Coupons

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/coupons` | 🔒 |
| POST | `/seller/coupons` | 🔒 |
| PATCH | `/seller/coupons/{id}` | 🔒 |

### Account / Addresses

| Method | Path | Auth |
|---|---|---|
| GET | `/addresses` | 🔒 |
| POST | `/addresses` | 🔒 |
| PATCH | `/addresses/{id}` | 🔒 |
| DELETE | `/addresses/{id}` | 🔒 |
| POST | `/addresses/{id}/default` | 🔒 |

### Admin / Commissions

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/commissions` | 🔒 |
| POST | `/admin/commissions` | 🔒 |
| PATCH | `/admin/commissions/{id}` | 🔒 |
| POST | `/admin/commissions/simulate` | 🔒 |

### Checkout

| Method | Path | Auth |
|---|---|---|
| POST | `/checkout/guest` | public |
| POST | `/checkout/guest/phone-code` | public |
| POST | `/checkout` | 🔒 |
| GET | `/delivery/slots` | public |

### Orders

| Method | Path | Auth |
|---|---|---|
| POST | `/orders/guest/lookup` | public |
| GET | `/orders/guest/{orderNumber}` | public |
| POST | `/orders/guest/{orderNumber}/cancel` | public |
| GET | `/orders` | 🔒 |
| GET | `/orders/{orderNumber}` | 🔒 |
| POST | `/orders/{orderNumber}/cancel` | 🔒 |
| POST | `/orders/{orderNumber}/buy-again` | 🔒 |
| GET | `/orders/{orderNumber}/tracking` | 🔒 |
| POST | `/orders/{orderNumber}/reschedule` | 🔒 |
| POST | `/orders/guest/{orderNumber}/reschedule` | public + `X-Order-Token` |

**Missed delivery:** when a FastMoveX driver could not deliver, the shipment's `delivery` has `attempt: { failedAt, kind:
NO_ANSWER | NOT_HOME | ADDRESS | ANOTHER_DAY | REFUSED | OTHER, canReschedule }` and `request: { text, at } | null`.
The customer answers with `reschedule { deliverySlot?: <window start from GET /delivery/slots>, note?: ≤ 300 chars }`
(at least one) → `{ ok, request }`; the new window is booked like at checkout (`409` when full). Not possible after a
refusal at the door.

### Seller / Orders

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/orders` | 🔒 |
| GET | `/seller/orders/{id}` | 🔒 |
| POST | `/seller/orders/{id}/status` | 🔒 |
| POST | `/seller/orders/{id}/cancel` | 🔒 |

### Admin / Orders

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/orders` | 🔒 |
| GET | `/admin/orders/{orderNumber}` | 🔒 |
| POST | `/admin/orders/{orderNumber}/cancel` | 🔒 |
| POST | `/admin/orders/shipments/{id}/status` | 🔒 |
| GET | `/admin/delivery-slots` | 🔒 |

`GET /admin/orders?slotDate=YYYY-MM-DD` lists the orders delivered in a window on that day.

**Closing a FastMoveX-driver delivery** (`status: DELIVERED` on a shipment whose delivery `method` is `FASTMOVEX`) needs the
customer's 4-digit code: `{ "status": "DELIVERED", "code": "4821" }` (wrong codes count towards the same 5-try lock as
the driver's). Without the code, only staff with `delivery.override` may close it, with
`{ "status": "DELIVERED", "overrideReason": "…at least 10 characters" }` — stored on the delivery (`overrideById`,
`overrideReason`) and audited as `delivery.override`. Otherwise `403 DELIVERY_CODE_REQUIRED` /
`400 OVERRIDE_REASON_REQUIRED`. Sellers can never mark a FastMoveX-driver delivery delivered. Staff and seller views never
contain `deliveryCode` (only `hasCode`); the customer's own order (`GET /orders/{n}`, guest view) has
`delivery.deliveryCode` until delivered, the driver's first name, and `delivery.location` (`lat`, `lng`, `mapUrl`)
while on the way.

### Returns

| Method | Path | Auth |
|---|---|---|
| POST | `/orders/{orderNumber}/returns` | 🔒 |
| GET | `/me/returns` | 🔒 |

### Seller / Finance

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/finance/balance` | 🔒 |
| GET | `/seller/finance/statement` | 🔒 |
| GET | `/seller/payouts` | 🔒 |
| POST | `/seller/payouts` | 🔒 |
| GET | `/seller/returns` | 🔒 |
| POST | `/seller/returns/{id}/decision` | 🔒 |
| POST | `/seller/returns/{id}/received` | 🔒 |

### Admin / Finance

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/finance/summary` | 🔒 |
| POST | `/admin/finance/release-due` | 🔒 |
| GET | `/admin/payments` | 🔒 |
| GET | `/admin/refunds` | 🔒 |
| POST | `/admin/refunds` | 🔒 |
| POST | `/admin/refunds/{id}/approve` | 🔒 |
| POST | `/admin/refunds/{id}/reject` | 🔒 |
| POST | `/admin/refunds/{id}/mark-paid` | 🔒 |
| GET | `/admin/payouts` | 🔒 |
| POST | `/admin/payouts/{id}/approve` | 🔒 |
| POST | `/admin/payouts/{id}/reject` | 🔒 |
| POST | `/admin/payouts/{id}/mark-paid` | 🔒 |
| GET | `/admin/returns` | 🔒 |
| POST | `/admin/returns/{id}/decision` | 🔒 |
| POST | `/admin/returns/{id}/received` | 🔒 |

**Four-eyes on refunds:** the person who created a refund (`createdById`) cannot approve it or mark it paid —
`403 FOUR_EYES` (a `SUPER_ADMIN` may). `GET /admin/refunds` items carry `createdBy` and `approvedBy` (`{ id, fullName }`).

**Receiving a return** needs an inspection: `{ "condition": "SELLABLE" | "DAMAGED" | "NOT_ACCEPTED", "note"?: "…" }`
(note required unless sellable). `SELLABLE` restocks and queues the refund; `DAMAGED` queues the refund but keeps the
item off sellable stock (a zero-quantity stock movement records it); `NOT_ACCEPTED` rejects the return — no refund, no
restock, the customer is told. Stored on the return as `condition`, `inspectionNote`, `receivedById`.

### Account / Notifications

| Method | Path | Auth |
|---|---|---|
| GET | `/me/notifications` | 🔒 |
| GET | `/me/notifications/unread-count` | 🔒 |
| POST | `/me/notifications/read-all` | 🔒 |
| POST | `/me/notifications/{id}/read` | 🔒 |
| POST | `/me/devices` | 🔒 |
| DELETE | `/me/devices/{token}` | 🔒 |
| GET / POST | `/me/push` · `/me/push/subscriptions` · `/me/push/subscriptions/remove` (browser notifications) | 🔒 |
| PATCH | `/me/notification-settings` | 🔒 |

### Reviews

| Method | Path | Auth |
|---|---|---|
| GET | `/products/{slug}/reviews` | public |
| GET | `/stores/{slug}/reviews` | public |
| POST | `/reviews` | 🔒 |
| POST | `/reviews/{id}/images` | 🔒 |
| DELETE | `/reviews/{id}/images/{index}` | 🔒 |
| GET | `/me/reviews` | 🔒 |
| GET | `/me/reviewable` | 🔒 |

Review photos (`POST /reviews/{id}/images`, max 5) are re-encoded on the server: turned upright, at most 1600 px, WebP, **all metadata (GPS) removed**. `DELETE /reviews/{id}/images/{index}` removes one; staff use `POST /admin/reviews/{id}/images/{index}/remove`. `GET /products/{slug}/reviews?withPhotos=1` filters; the first page adds `summary.photoReviews` and `photos[]` (12 latest, for "Customer photos").

### Seller / Reviews

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/reviews` | 🔒 |

### Admin / Reviews

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/reviews` | 🔒 |
| POST | `/admin/reviews/{id}/moderate` | 🔒 |
| POST | `/admin/reviews/{id}/images/{index}/remove` | 🔒 |

### Wishlist

| Method | Path | Auth |
|---|---|---|
| GET | `/wishlists` | 🔒 |
| POST | `/wishlists` | 🔒 |
| GET | `/wishlists/contains` | 🔒 |
| POST | `/wishlists/items` | 🔒 |
| DELETE | `/wishlists/items/{productId}` | 🔒 |
| PATCH | `/wishlists/items/{productId}/alerts` | 🔒 |
| POST | `/wishlists/items/{productId}/move-to-cart` | 🔒 |
| GET | `/wishlists/{id}` | 🔒 |
| PATCH | `/wishlists/{id}` | 🔒 |
| DELETE | `/wishlists/{id}` | 🔒 |

### Support

| Method | Path | Auth |
|---|---|---|
| GET | `/faq` | public |
| POST | `/support/tickets` | 🔒 |
| GET | `/support/tickets` | 🔒 |
| GET | `/support/tickets/{number}` | 🔒 |
| POST | `/support/tickets/{number}/messages` | 🔒 |
| POST | `/support/tickets/{number}/close` | 🔒 |

### Admin / Support

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/tickets` | 🔒 |
| GET | `/admin/tickets/{id}` | 🔒 |
| PATCH | `/admin/tickets/{id}` | 🔒 |
| POST | `/admin/tickets/{id}/messages` | 🔒 |
| POST | `/admin/faq` | 🔒 |
| PATCH | `/admin/faq/{id}` | 🔒 |
| DELETE | `/admin/faq/{id}` | 🔒 |

### Courier

| Method | Path | Auth |
|---|---|---|
| GET | `/courier/jobs` | 🔒 |
| GET | `/courier/jobs/run` | 🔒 |
| POST | `/courier/jobs/{id}/pickup` | 🔒 |
| POST | `/courier/jobs/{id}/out-for-delivery` | 🔒 |
| POST | `/courier/jobs/{id}/location` | 🔒 |
| POST | `/courier/jobs/{id}/deliver` | 🔒 |
| POST | `/courier/jobs/{id}/fail` | 🔒 |
| GET | `/courier/jobs/run.pdf` | 🔒 |
| GET | `/courier/cash` | 🔒 |
| GET | `/courier/cash/handovers/{id}/receipt` | 🔒 |

`fail` accepts JSON or multipart: `reason`, `refused?`, `lat?`, `lng?` (the phone's position) and `photo?` (door photo,
private). The distance from the customer's map pin is stored; the customer is told at once (SMS / email / WhatsApp
`fastmovex_delivery_failed`) with a link to choose a new time.

`GET /courier/jobs/run` is the driver page: open jobs in driving order (delivery window, then zone, then when assigned), followed by today's finished ones, each with customer name and phone, address with a Google Maps link, items, pickup warehouse and the cash to collect (`cash.amountMinor`, cash-on-delivery only), plus a summary (to do, delivered, failed, cash to collect / collected). A failed attempt can go back to `out-for-delivery` (customer called back). `deliver` needs the customer's 4-digit code (5 wrong codes lock the job); the doorstep photo is private (staff see it through a 5-minute signed URL).
`fail` takes `refused: true` when the customer turned the order down at the door (counts towards switching cash on
delivery off for them). `pickup` answers `403 CASH_LIMIT` while the driver holds the market's driver cash limit.
`run.pdf` is the printable run sheet; `GET /courier/cash` is the driver's cash in hand (by order), the limit and the
last handovers, whose receipts (PDF) they can open.

### Admin / Delivery

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/deliveries` | 🔒 |
| GET | `/admin/deliveries/couriers` | 🔒 |
| POST | `/admin/deliveries/{id}/assign` | 🔒 |
| GET | `/admin/deliveries/{id}/proof` | 🔒 |
| GET | `/admin/deliveries/run-sheet.pdf?courierUserId=` | 🔒 |
| GET | `/admin/deliveries/{id}/failure-photo` | 🔒 `delivery.read` |

Deliveries include `failedAt`, `failureDistanceM` (metres from the address pin; over 500 is flagged), `failurePhotoKey`
(open with `failure-photo` → 5-minute URL, audited) and `customerRequest` / `customerRequestAt`.

### Admin / Cash

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/cash/holders` | 🔒 `cash.read` |
| GET | `/admin/cash/holders/{userId}` | 🔒 `cash.read` |
| POST | `/admin/cash/holders/{userId}/handover` | 🔒 `cash.receive` |
| GET | `/admin/cash/handovers?holderUserId=&from=&to=&shortOnly=` | 🔒 `cash.read` |
| GET | `/admin/cash/handovers/{id}/receipt` | 🔒 `cash.read` |
| POST | `/admin/users/{id}/cod` | 🔒 `users.update` |

Every delivered cash-on-delivery shipment leaves a **cash collection** on the name of whoever holds the money: the
FastMoveX driver who delivered it, otherwise the staff member who marked it delivered. `holders` lists who holds cash now
plus today's totals (collected, handed over, short, still with people). A cashier records a **handover**:
`{ "collectionIds": [...], "receivedMinor": "45000", "note"?: "…" }` — the ids are what the cashier is counting (from
`holders/{userId}`); if any was handed over meanwhile → `409`. `expected` is the sum, `variance = received − expected`;
a difference needs a note (`400 NOTE_REQUIRED`); nobody receives their own cash (`403`, also a database check).
Collections and handovers cannot be edited or deleted (database triggers). Receipts are PDFs (Arabic names print
correctly). `POST /admin/users/{id}/cod` `{ blocked, reason }` switches cash on delivery off/on for a customer (a reason
is required to block; unblocking resets the refusal count).
### Admin / Analytics

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/analytics/traffic` | 🔒 |
| GET | `/admin/analytics/overview` | 🔒 |
| GET | `/admin/analytics/timeseries` | 🔒 |
| GET | `/admin/analytics/top` | 🔒 |
| GET | `/admin/analytics/export` | 🔒 |

`GET /admin/analytics/traffic?range=7d` (`analytics.read`): visits, the funnel (visit → product → cart → checkout → order, with drop-off), sales by source/medium (orders from the app or before tracking show as `unknown`), devices, landing pages and daily visits/orders.

### Seller / Analytics

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/analytics/overview` | 🔒 |
| GET | `/seller/analytics/timeseries` | 🔒 |
| GET | `/seller/analytics/top-products` | 🔒 |

### Admin / Marketing

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/cart-reminders/stats` | 🔒 |
| GET | `/admin/campaigns` | 🔒 |
| POST | `/admin/campaigns` | 🔒 |
| PATCH | `/admin/campaigns/{id}` | 🔒 |
| GET | `/admin/campaigns/{id}/products` | 🔒 |
| POST | `/admin/campaigns/{id}/products` | 🔒 |
| DELETE | `/admin/campaigns/{id}/products/{variantId}` | 🔒 |
| GET | `/admin/banners` | 🔒 |
| POST | `/admin/banners` | 🔒 |
| PATCH | `/admin/banners/{id}` | 🔒 |
| DELETE | `/admin/banners/{id}` | 🔒 |
| POST | `/admin/products/{id}/sponsor` | 🔒 |
| POST | `/admin/stores/{id}/feature` | 🔒 |

### Admin / Users & Access

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/users` | 🔒 |
| GET | `/admin/users/{id}` | 🔒 |
| POST | `/admin/users/{id}/status` | 🔒 |
| GET | `/admin/staff` | 🔒 |
| POST | `/admin/staff` | 🔒 |
| PUT | `/admin/staff/{id}/roles` | 🔒 |
| GET | `/admin/roles` | 🔒 |
| GET | `/admin/permissions` | 🔒 |
| PUT | `/admin/roles/{code}/permissions` | 🔒 |
| GET | `/admin/audit-logs` | 🔒 |

### Admin / Dashboard

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/dashboard/summary` | 🔒 |

### Admin / Settings

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/countries` | 🔒 |
| GET | `/admin/countries/integrations` | 🔒 |
| PATCH | `/admin/countries/{code}` | 🔒 |

`PATCH /admin/countries/{code}` also takes `deliverySlots { enabled, required, daysAhead, leadMinutes, closedWeekdays, closedDates, windows: [{ start, end, capacity }] }` and `cartReminders { enabled, firstAfterMinutes, secondAfterHours | null, quietFrom, quietTo }`; impossible settings are refused with a readable `400`.

### Markets

`GET /markets` items include `cod: { maxOrderMinor, guestPhoneCheck, accountPhoneCheck, guestAvailable }` so checkout
can hide cash on delivery before the shopper tries.

| Method | Path | Auth |
|---|---|---|
| GET | `/markets` | public |

### Admin / Search

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/search/report` | 🔒 |

`GET /admin/search/report?days=30` (`analytics.read`): totals, daily, top searches, searches that found nothing, and the current settings. Settings are saved with `PATCH /admin/countries/{code}` `{ searchSettings: { pinned: string[≤10], hidden: string[], synonyms: string[][] } }`.

### Admin / Home page

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/home-sections` | 🔒 |
| PUT | `/admin/home-sections` | 🔒 |
| POST | `/admin/home-sections/reset` | 🔒 |
| POST | `/admin/home-sections/preview` | 🔒 |

### Admin / Content

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/pages` | 🔒 |
| POST | `/admin/pages` | 🔒 |
| GET | `/admin/pages/{id}` | 🔒 |
| PATCH | `/admin/pages/{id}` | 🔒 |
| DELETE | `/admin/pages/{id}` | 🔒 |
| GET | `/admin/contact-messages` | 🔒 |
| PATCH | `/admin/contact-messages/{id}` | 🔒 |

### Analytics

| Method | Path | Auth |
|---|---|---|
| POST | `/analytics/events` | public |

`POST /analytics/events` — public, 120/min, JSON **or** `text/plain` (navigator.sendBeacon; market in `?country=`). Body `{ sessionId (UUID v4 made by the browser, per tab session), locale?, touch? { utmSource, utmMedium, utmCampaign, referrerHost, click: gclid|fbclid|ttclid|msclkid }, events: [{ type: page_view|product_view|add_to_cart|checkout_start, path? }] (1–50) }` → 204. No cookie, no IP, no user id; bot and headless browsers are ignored; landing pages are cut to their section (account, checkout, track, login, cart). Checkout and guest checkout accept the same `traffic { sessionId, …touch }` so the order records its `trafficSource / Medium / Campaign`.

### Questions

| Method | Path | Auth |
|---|---|---|
| GET | `/products/{slug}/questions` | public |
| POST | `/products/{slug}/questions` | 🔒 |
| GET | `/me/questions` | 🔒 |

Questions are private until the store answers. `POST /products/{slug}/questions { body (10–500) }` needs a signed-in customer; at most 3 waiting per product and 10 in total (`429`, reason `TOO_MANY_OPEN`). `GET /products/{slug}/questions` lists answered ones (`total` on the first page). The customer is told when it is answered (in-app, email, WhatsApp template `fastmovex_question_answered` if they opted in).

### Admin / Questions

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/questions` | 🔒 |
| POST | `/admin/questions/{id}/answer` | 🔒 |
| PATCH | `/admin/questions/{id}/answer` | 🔒 |
| POST | `/admin/questions/{id}/reject` | 🔒 |

Permission `reviews.moderate`. `POST …/answer` publishes (once — two staff answering at the same moment cannot both message the customer); `PATCH …/answer` edits without a new message; `POST …/reject` hides it (also a published one). Sellers have the same for their own products under `/seller/questions`.

### Seller / Questions

| Method | Path | Auth |
|---|---|---|
| GET | `/seller/questions` | 🔒 |
| POST | `/seller/questions/{id}/answer` | 🔒 |
| POST | `/seller/questions/{id}/reject` | 🔒 |

### Admin / Warehouses

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/warehouses` | 🔒 |
| POST | `/admin/warehouses` | 🔒 |
| PATCH | `/admin/warehouses/{id}` | 🔒 |
| GET | `/admin/warehouses/{id}/stock` | 🔒 |
| GET | `/admin/variants/{variantId}/warehouses` | 🔒 |
| GET | `/admin/stock-transfers` | 🔒 |
| POST | `/admin/stock-transfers` | 🔒 |
| POST | `/admin/stock-transfers/{id}/receive` | 🔒 |
| POST | `/admin/stock-transfers/{id}/cancel` | 🔒 |
| GET | `/admin/orders/shipments/{id}/warehouse` | 🔒 |
| POST | `/admin/orders/shipments/{id}/warehouse` | 🔒 |

`Inventory.onHand` is the sum of the warehouses (database trigger; direct changes are refused). Checkout picks the warehouse that has everything, nearest to the delivery zone (`zones`), then `priority`; `GET/POST /admin/orders/shipments/{id}/warehouse` shows whether it has everything and changes it until the shipment leaves. Shipping takes the units off that shelf (`409 WAREHOUSE_SHORT` instead of going below zero). `POST /admin/variants/{id}/stock` and `POST /admin/inventory/bulk` take an optional `warehouseId` (default warehouse otherwise); `GET /admin/inventory?warehouseId=` adds `warehouseOnHand`, every row has `byWarehouse`. Transfers move units when received (destination first, the total never changes); only waiting transfers can be cancelled. A warehouse with stock or open shipments cannot be closed; the default one never.

### Admin / Stock control

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/inventory/expiry?days=30` | 🔒 `products.read` |
| POST | `/admin/inventory/expiry/write-off` | 🔒 `inventory.approve` |
| GET | `/admin/inventory/shrinkage?from=&to=` | 🔒 `products.read` |
| GET | `/admin/stock-counts?status=` | 🔒 `products.read` |
| POST | `/admin/stock-counts` | 🔒 `inventory.manage` |
| GET | `/admin/stock-counts/{id}` | 🔒 `products.read` |
| PATCH | `/admin/stock-counts/{id}/lines` | 🔒 `inventory.manage` |
| POST | `/admin/stock-counts/{id}/submit` | 🔒 `inventory.manage` |
| POST | `/admin/stock-counts/{id}/approve` | 🔒 `inventory.approve` |
| POST | `/admin/stock-counts/{id}/cancel` | 🔒 `inventory.manage` |

**Stock changes** (`POST /admin/variants/{id}/stock`) take a `reason`: `RESTOCK` and `FOUND` only add, `DAMAGED`,
`EXPIRED` and `LOST` only remove, `ADJUSTMENT` either way (`400` otherwise). Removing more than
`STOCK_WRITE_OFF_LIMIT_MINOR` at cost needs `inventory.approve` (`403 WRITE_OFF_APPROVAL`). For products with
`tracksExpiry: true` a `RESTOCK` needs `expiresOn: "YYYY-MM-DD"` (`400 EXPIRY_REQUIRED`) and may carry `lotCode`;
removals may name a `lotId`. Orders take the earliest good date first and never an expired one; every night at 00:10
(Qatar) expired lots are written off as `EXPIRED` (units promised to orders are left and listed).
**Stocktake:** `POST { warehouseId, variantIds? | categoryId?, blind = true, note? }` (one open count per warehouse,
`409`); counters send `PATCH { lines: [{ variantId, countedQty }] }` in batches (unknown products join the count); on a
blind count, people without `inventory.approve` see no expected numbers until it is submitted. `submit` needs every
line counted (`400 NOT_COUNTED`); `approve` by a different person (`403 FOUR_EYES`) posts each difference as a `COUNT`
movement (`409 RESERVED` if it would go below units promised to orders). `shrinkage` totals what left other than by
selling, by reason and product, at cost.

### Admin / Purchasing

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/suppliers?q=&all=` | 🔒 `products.read` |
| POST | `/admin/suppliers` | 🔒 `purchasing.manage` |
| PATCH | `/admin/suppliers/{id}` | 🔒 `purchasing.manage` |
| GET | `/admin/purchase-orders?status=&supplierId=` | 🔒 `products.read` |
| POST | `/admin/purchase-orders` | 🔒 `purchasing.manage` |
| GET | `/admin/purchase-orders/{id}` | 🔒 `products.read` |
| PATCH | `/admin/purchase-orders/{id}` | 🔒 `purchasing.manage` (draft only) |
| POST | `/admin/purchase-orders/{id}/order` | 🔒 `purchasing.manage` |
| POST | `/admin/purchase-orders/{id}/cancel` | 🔒 `purchasing.manage` |
| POST | `/admin/purchase-orders/{id}/receive` | 🔒 `purchasing.receive` |
| GET | `/admin/purchase-orders/{id}/pdf` | 🔒 `products.read` |

A purchase order is `DRAFT → ORDERED → PARTIAL → RECEIVED` (or `CANCELLED`; goods already received stay).
`POST { supplierId, warehouseId, expectedOn?, note?, lines: [{ variantId, quantity, unitCostMinor }] }`.
`receive { supplierRef?, note?, lines: [{ lineId, quantity, lotCode?, expiresOn? }] }` → `{ receipt: { number:
"GRN-QA-…", units, status }, order }`: someone other than the person who raised the order (`403 FOUR_EYES`, super admin
excepted), never more than still expected (`400 OVER_RECEIVED`), expiry required for dated products
(`400 EXPIRY_REQUIRED`). Each line adds a `RESTOCK` movement (ref `purchase_order`) and updates the variant's cost to
the weighted average. Goods receipts cannot be changed or deleted.

### Admin / Payments

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/payments?status=&method=&cursor=` | 🔒 `payments.read` |
| GET | `/admin/payments/exceptions?kind=` | 🔒 `payments.read` |
| GET | `/admin/payments/settlements` | 🔒 `payments.read` |
| GET | `/admin/payments/settlements/{id}` | 🔒 `payments.read` |
| POST | `/admin/payments/settlements` | 🔒 `payments.reconcile` |
| GET | `/admin/payments/closing?date=YYYY-MM-DD` | 🔒 `payments.read` |
| GET | `/admin/payments/closing/pdf?date=` | 🔒 `payments.read` |

`exceptions` → `{ counts, items }` for `CANCELLED_NOT_REFUNDED`, `DELIVERED_NOT_PAID`, `AMOUNT_MISMATCH` (card: order
total; cash: the shipments not cancelled), `CARD_PENDING` (over an hour), `COD_NO_COLLECTION`, `CASH_NOT_HANDED_OVER`
(over a day). `POST settlements` is multipart: `file` (CSV, ≤ 5 MB, columns found by name — `reference` / `payment
id` / `id`, `amount`, optional `date` — or the first two columns), `provider` (default `dibsy`). Each row is matched by
the gateway reference (refunds as negative amounts): matched, differs (amount or FastMoveX status), not in FastMoveX,
duplicate; plus captured card payments in the file's period that the file does not have. `closing` → one Qatar day:
sales by payment method, card money captured, refunds sent, cash collected / handed in / short / still with drivers,
net money in; `closing/pdf` is the printable report.

### Documents (PDF)

| Method | Path | Auth |
|---|---|---|
| GET | `/orders/{orderNumber}/invoice.pdf?lang=en\|ar` | 🔒 own order |
| GET | `/orders/{orderNumber}/credit-notes/{refundId}.pdf` | 🔒 own order |
| GET | `/orders/{orderNumber}/return-receipts/{returnId}.pdf` | 🔒 own order |
| GET | `/orders/guest/{orderNumber}/invoice.pdf` (also `credit-notes/…`, `return-receipts/…`) | public + `X-Order-Token` |
| GET | `/admin/orders/{orderNumber}/invoice.pdf` | 🔒 `orders.read` |
| GET | `/admin/orders/shipments/{id}/packing-slip.pdf` | 🔒 `orders.read` |
| GET | `/admin/fulfilment/packing-slips.pdf?ids=\|warehouseId=&date=&slotStart=` | 🔒 `orders.read` |
| GET | `/admin/fulfilment/pick-list?…` (JSON) · `/admin/fulfilment/pick-list.pdf?…` | 🔒 `orders.read` |
| GET | `/admin/refunds/{id}/credit-note.pdf` | 🔒 `payments.read` |
| GET | `/admin/returns/{id}/receipt.pdf` | 🔒 `returns.manage` |

**Invoice:** one page per seller (each seller sells to the customer; FastMoveX's own store uses the company details from
Settings), labels in English and Arabic, item names in `lang`; numbered with the order number (`-1`, `-2` when several
sellers); a cancelled order prints "CANCELLED"; credit notes issued are listed. Not before the order is confirmed
(`409 NOT_CONFIRMED`). Another customer's order and a wrong guest token are `404`.
**Credit note:** exists once a refund has succeeded — the database gives it a number `CN-QA-YYMMDD-NNNNNN` at that
moment (whichever path paid it) and refuses to change it (`409 NOT_REFUNDED` before). **Return receipt:** once the
item is back and checked (`409 NOT_RECEIVED` before) — item, condition, note, refund status, number `RR-…`.
`GET /orders/{orderNumber}` (and the guest route) carries `documents: { invoice, creditNotes[], returnReceipts[] }`.
**Packing slips / picking list** (FastMoveX's own warehouses; sellers pack their own): shipments waiting to be packed
(confirmed / preparing / ready), by warehouse (default: the default warehouse), delivery date (Qatar) or one window,
or explicit `ids` (a cancelled one → `409 CANCELLED`). The picking list totals each product with its shelf (`bin`), in
walking order, and which orders it is for; slips have no prices, list barcodes and the cash to collect.
`Content-Disposition` is exposed to browsers (CORS) so downloads keep their names.

### Account / Privacy (Qatar PDPPL)

| Method | Path | Auth |
|---|---|---|
| GET | `/me/data-export` | 🔒 (3 per hour) |
| GET | `/me/deletion` | 🔒 |
| POST | `/me/deletion` | 🔒 |
| DELETE | `/me/deletion` | 🔒 |
| GET | `/admin/users/{id}/data-export` | 🔒 `users.read` |
| GET | `/admin/users/{id}/deletion` | 🔒 `users.read` |

`data-export` is a JSON file (attachment) with the account, addresses, orders (items, payments, refunds), returns,
reviews, questions, wishlists, support messages (internal notes left out), notifications, sign-ins, carts and recently
viewed — never the password or card data. `POST /me/deletion { password, reason? }` → `{ deleteOn }` (14 days):
staff and seller accounts are refused (`403`), a wrong password is `401 BAD_PASSWORD`, open orders / returns / refunds
are `409 OPEN_ACTIVITY` with `blockers`. The account is signed out everywhere; signing in again works and
`GET /auth/me` has `deletion: { deleteOn }`; `DELETE /me/deletion` keeps the account. After the date the nightly job
removes the name, email, phone, password, addresses, carts, wishlists, notifications, devices, sign-in history,
review and return photos, the customer's support message texts and contact-form messages; orders, payments, refunds
and invoices stay with the address reduced to city/zone and "Deleted customer" as the name. The account can no
longer sign in.

### Admin / Insights (drivers, profit & margin)

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/deliveries/live` | 🔒 `delivery.read` |
| GET | `/admin/deliveries/performance?range=today\|yesterday\|7d\|30d\|3m\|6m\|12m\|custom&from=&to=` | 🔒 `delivery.read` |
| GET | `/admin/reports/margin?range=…&group=day\|product\|category` | 🔒 `reports.margin` |
| GET | `/admin/reports/margin.csv?range=…&group=…` | 🔒 `reports.margin` |

**Live:** every active driver with their last position (`location: { lat, lng, at, stale }` — `stale` after 10 minutes
without a new point; the phone sends one while a job is picked up / out for delivery), open jobs in window order with
the customer's map pin (`pin` is `null` when the address has none), `late` when the window has passed, cash in hand;
plus `waitingForDriver`. The admin "Live map" tab polls it every 30 s.
**Performance** (per driver, in the period): assigned, delivered, not delivered (and how many were refusals),
success %, on-time % (delivered before the end of the promised window, over deliveries that had one), average minutes
from "out for delivery" to delivered, "not delivered" marked more than 500 m from the pin, wrong codes typed, cash
collected and the shortfall at handover.
**Margin** (FastMoveX's own store only): sales without VAT of the units kept (refunded units taken out and shown as
`refundedMinor`), cost at the `unitCostMinor` **frozen on each order line at the sale** (a database trigger copies the
variant's cost price; later cost changes never move past margins), profit, margin %. Lines sold without a cost are
left out of cost **and** margin (`uncostedUnits`, `uncostedRevenueMinor`, and `missingCost`: the 20 biggest such
products). Totals also show delivery fees charged and marketplace commission earned. CSV: one row per group plus a
Total row (UTF-8 with BOM, opens in Excel).

### Admin / Customer notes & tags

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/customer-tags` | 🔒 `users.read` |
| PUT | `/admin/users/{id}/tags` `{ tags: [] }` | 🔒 `users.update` |
| GET / POST | `/admin/users/{id}/notes` `{ body, pinned? }` | 🔒 `users.read` |
| PATCH | `/admin/users/{id}/notes/{noteId}` `{ pinned }` | 🔒 `users.update` |
| DELETE | `/admin/users/{id}/notes/{noteId}` | 🔒 author, or `users.update` |
| GET / POST | `/admin/orders/{orderNumber}/notes` `{ body }` | 🔒 `orders.read` |

Tags are stored upper-case (`big spender` → `BIG_SPENDER`), 2–20 letters/numbers, at most 10; suggested: VIP, RISKY,
WHOLESALE, CORPORATE, INFLUENCER. `GET /admin/users?tag=VIP` filters the customer list; the list, the customer page,
the order list and the order page carry `tags`. One note per customer can be pinned; `GET /admin/orders/{n}/notes`
returns the order's staff notes plus `customer: { tags, pinnedNote }`. All changes are audited. **None of this is in
any customer-facing response**; tags and notes are erased with the account (PDPPL deletion).

### Staff alerts

| Method | Path | Auth |
|---|---|---|
| GET | `/me/alert-prefs` | 🔒 staff |
| PATCH | `/me/alert-prefs` `{ prefs: { STAFF_NEW_ORDER: "off"\|"app"\|"email", … } }` | 🔒 staff |

Alerts arrive in the normal inbox (`/me/notifications`, `/me/notifications/unread-count`) with `data.link` = the admin
page to open. Who gets what — everyone whose roles carry the permission, except the person who caused it:

| Alert | When | Permission |
|---|---|---|
| `STAFF_NEW_ORDER` | a paid / cash order for FastMoveX's own store is confirmed (customer tags shown) | `orders.update` |
| `STAFF_DELIVERY_FAILED` | a driver marks "not delivered" or a refusal (and if it was far from the pin) | `delivery.manage` |
| `STAFF_REFUND_PENDING` | a refund waits for approval (manual, return received, paid shipment cancelled) | `refunds.approve` |
| `STAFF_LOW_STOCK` | every 15 min: own-store products at or below their alert level — once, again only after a restock | `inventory.manage` |
| `STAFF_STOCKTAKE_SUBMITTED` | a counted stocktake is submitted | `inventory.approve` |
| `STAFF_CASH_SHORT` | a driver hands over less cash than collected | `cash.receive` |

Each person chooses per alert: `off`, `app` (bell, the default) or `email` (bell + email, with a link when `ADMIN_URL`
is set). Alerts never go by SMS or WhatsApp. `GET /me/alert-prefs` lists only the alerts the person's permissions allow.

### Changing an order after checkout

| Method | Path | Auth |
|---|---|---|
| PATCH | `/admin/orders/{orderNumber}/items` `{ changes: [{ itemId, quantity }], reason }` | 🔒 `orders.update` |
| PUT | `/admin/orders/{orderNumber}/address` `{ addressId? \| address?, reason? }` | 🔒 `orders.update` |
| PUT | `/admin/orders/{orderNumber}/slot` `{ deliverySlot: iso \| null, reason? }` | 🔒 `orders.update` |
| PUT | `/orders/{orderNumber}/address` `{ addressId }` | 🔒 own order |
| PUT | `/orders/{orderNumber}/slot` `{ deliverySlot }` | 🔒 own order |
| PUT | `/orders/guest/{orderNumber}/address` `{ address }` · `/orders/guest/{orderNumber}/slot` | public + `X-Order-Token` |

**Items** (staff, until the driver picks the shipment up — confirmed / preparing / ready): `quantity` is how many to
keep; only reductions (`400 ONLY_REDUCE` — to add, see **Adding an item** below), never every item of a shipment
(`400 ALL_REMOVED` — cancel it instead), after dispatch `409 NOT_EDITABLE`. Discount, VAT and commission shrink in
proportion; a removed line stays on record as `CANCELLED` (off the invoice, the packing slip and the driver's list).
Reserved stock and deal quotas are given back; shipment and order totals follow; cash on delivery: the amount to
collect goes down; a card payment gets a **refund** for the difference (`PENDING`, normal four-eyes approval and the
approver's limit). **Address / window**: staff until dispatch; the customer while every shipment is confirmed or
preparing, at most **3 changes per order** (`403 CHANGE_LIMIT`), signed in = one of their saved addresses, guests = a
full address. Another window takes a place there and gives the old one back. A cash order cannot move to a phone
number blocked for cash on delivery (`403 COD_BLOCKED`). Every change is an `OrderChange` (kind `ITEMS` / `ADDED` /
`ADDRESS` / `SLOT` / `DOOR_REFUSAL`, who, reason, before/after, amount) that can never be edited; the admin order has `changes`
(with names), `editable` and `placedBy`; the customer's order has `changes` (no names, no reasons) and
`changeOptions: { canChange, changesLeft }`. The customer is told (`ORDER_CHANGED`, email + in-app) about staff
and door changes.

### Phone orders

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/phone-orders/customers?q=` | 🔒 `orders.create` |
| GET | `/admin/phone-orders/products?q=` | 🔒 `orders.create` |
| POST | `/admin/phone-orders/quote` | 🔒 `orders.create` |
| POST | `/admin/phone-orders` (`Idempotency-Key`) | 🔒 `orders.create` |

Body: `customer: { userId } | { fullName, phone, email? }`, `items: [{ variantId, quantity }]`, `addressId` (the
customer's saved one) or `address`, `saveAddress?`, `deliverySlot?`, `note?`. Priced by the same cart engine as the
website (deals, stock, delivery fee, cash-on-delivery limits and blocks), **cash on delivery**. `couponCode?` — a
promo code the caller gives, judged for that customer exactly like on the website (their own limits, first order, new
customers; a caller who gets a new profile counts as new); a code that cannot be used → `400` with its `reason`, the
quote's `cart.coupon` shows it applied or why not. An
existing customer is found by id, phone or email; otherwise a guest profile is created with the phone. Staff accounts
can never be the customer (`403`). The quote creates nothing. The order records `placedById`; the same key returns the
same order.

### Driver: refused at the door, return pickups

| Method | Path | Auth |
|---|---|---|
| POST | `/courier/jobs/{id}/refuse-items` `{ items: [{ itemId, quantity }], reason }` | 🔒 driver, own job, out for delivery |
| GET | `/courier/pickups` | 🔒 driver |
| POST | `/courier/pickups/{id}/collected` `{ lat?, lng? }` · `/courier/pickups/{id}/failed` `{ reason }` | 🔒 driver, own pickup |
| POST / DELETE | `/admin/returns/{id}/pickup` `{ courierUserId, date, note? }` | 🔒 `returns.manage` |
| GET | `/admin/door-returns?open=true\|false` | 🔒 `returns.manage` |
| POST | `/admin/door-returns/{id}/receive` `{ condition: SELLABLE \| DAMAGED, note? }` | 🔒 `returns.manage` |

**Refused at the door:** the customer keeps the rest; `quantity` = units refused (everything refused → use
`fail` with `refused`). The order change follows the same rules as staff item changes (cash to collect goes down at
once, card → refund); the units become a `DoorReturn` "with the driver" and are not on the shelf until the warehouse
books them in (sellable → back where they left from; damaged → kept off stock, note required). **Pickups:** only for
an approved return; one active pickup per return (a failed or cancelled one can be arranged again); the customer is
told (`RETURN_PICKUP_SCHEDULED`, email + SMS) and sees it on their returns (`pickup: { status, date }`); the admin
returns list shows the driver and status. After "collected" the item is checked on the Returns page as before.

### Refund approval limits

| Method | Path | Auth |
|---|---|---|
| PUT | `/admin/staff/{id}/refund-limit` `{ limitMinor: "50000" \| null }` | 🔒 `admins.manage` (not yourself) |

`POST /admin/refunds/{id}/approve` and `/mark-paid` are refused above the approver's limit (`403 REFUND_LIMIT`,
`limitMinor`); `null` = no limit of their own. `GET /auth/me` (staff) has `refundLimitMinor`; the staff list shows it.

### Adding an item to an order (staff)

| Method | Path | Auth |
|---|---|---|
| GET | `/admin/orders/{orderNumber}/addable-products?q=` | 🔒 `orders.update` |
| POST | `/admin/orders/{orderNumber}/items` `{ variantId, quantity: 1–99, reason: 5–300 chars }` | 🔒 `orders.update` |

Cash-on-delivery orders only (a paid card order cannot be charged again here: `409 ADD_NEEDS_COD` — place a new
order), before the shipment leaves (`409 NOT_EDITABLE`), a product of a seller that has an open shipment on the order
(`400 OTHER_SELLER`; the search only offers those). Today's price (a live deal counts while its quota lasts), stock
reserved at once (`409 OUT_OF_STOCK`), VAT and commission worked out like at checkout; the shipment and order totals
and the **cash to collect** go up. Recorded as `OrderChange` kind `ADDED` (`amountMinor` = how much more), audited
(`order.items_added`), the customer is told (`ORDER_CHANGED`: "You pay … more on delivery"). → `{ orderNumber, itemId,
amountMinor }`.

### Buy again

| Method | Path | Auth |
|---|---|---|
| POST | `/orders/{orderNumber}/buy-again` (`X-Country`) | 🔒 own order |

Puts every product of the order back in the customer's cart — at today's price, at most what is in stock now and the
per-line limit (same product on several lines = one line). Never fails for the whole request: → `{ cart, added:
[{ variantId, title, quantity }], skipped: [{ variantId, title, reason: UNAVAILABLE | OUT_OF_STOCK | CART_FULL }] }`.
A product already in the cart up to the stock is neither added nor skipped.

### Arrival estimate (customer)

While a FastMoveX-driver shipment is **out for delivery**, `GET /orders/{n}` (and the guest view) has
`delivery.eta: { at, minutes, stopsBefore } | null`: straight-line distance from the driver's last position (less than
20 minutes old) to the address pin × 1.4 for roads, at 25 km/h, plus 8 minutes for each of the driver's stops before
this one (in the order of the driver's run), at least 5 minutes, `at` rounded up to 5 minutes. `null` without a
recent position or a pin — show the delivery window then.

### Sign in with Google / Apple

| Method | Path | Auth |
|---|---|---|
| GET | `/auth/social/providers` | public → `{ google: <web client id> \| null, apple: <services id> \| null }` |
| POST | `/auth/social` `{ provider: GOOGLE \| APPLE, idToken, nonce?, fullName?, locale? }` | public (10/min) |
| GET | `/auth/social` | 🔒 → `[{ provider, email, createdAt, lastUsedAt }]` |
| DELETE | `/auth/social/{google\|apple}` | 🔒 |

The app or website gets an **ID token** from Google / Apple and sends it here. The API checks the signature against
the provider's published keys, the issuer, the audience (one of `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`), the expiry,
and the **nonce**: pass the random value your page gave the provider (it must come back inside the token; a token with
a nonce is refused without it). Then: an identity already linked → that account; otherwise a **confirmed** email that
matches an account → Google / Apple is linked to it (a guest profile becomes a full account); otherwise a new customer
(email confirmed, no password; Apple sends the name only once — pass it as `fullName`). Answers like `/auth/login`
(tokens + refresh cookie, `created: true` for a new account, or the two-step challenge). Customers only: staff
accounts → `403 STAFF_ACCOUNT`, the admin panel never accepts it. Errors: `400 SOCIAL_OFF` (provider not set up),
`401 SOCIAL_TOKEN` / `SOCIAL_NONCE`, `400 SOCIAL_NO_EMAIL`. Removing the only way in (no password) → `400
LAST_SIGN_IN`. `GET /auth/me` has `hasPassword` and `signIns: ['GOOGLE', …]`. Audited: `auth.social_signup`,
`auth.social_linked`.

### Browser notifications (Web Push)

| Method | Path | Auth |
|---|---|---|
| GET | `/me/push` | 🔒 → `{ enabled, publicKey, browsers }` |
| POST | `/me/push/subscriptions` `{ endpoint: https://…, keys: { p256dh, auth } }` | 🔒 |
| POST | `/me/push/subscriptions/remove` `{ endpoint }` | 🔒 |

With VAPID keys set, everything that goes out as a phone push also goes to the customer's browsers (the `PUSH`
channel succeeds when at least one device or browser takes it). Pass `publicKey` to `PushManager.subscribe` and send
`subscription.toJSON()` here. Payload `{ title, body, url, tag }`: `url` is a page of the website (the order, or the
notifications inbox). Up to 10 browsers per person; an endpoint the push service reports gone (404/410) or that failed 5
times is removed. Signing out on the website removes that browser.

### Audit coverage (Phase 23)

Every staff, seller and driver change now leaves an audit entry. Added: `variant.create`, `variant.update` (fields),
`inventory.adjust` (also alert level only), `product.image_add` / `image_remove` / `images_reorder`,
`store.logo_update` / `banner_update`, `delivery.failed`, `delivery.code_failed`, `finance.release_run` (run by hand),
`ticket.reply`, `stocktake.count`, `staff.alert_prefs`; user suspend / activate now records the previous status with the reason. Driver location pings are deliberately not audited.

### Search engines & Google Shopping (Phase 24)

| Method | Path | Auth |
|---|---|---|
| GET | `/brands/{slug}` | public → `{ slug, name, nameAr, logoUrl, description, descriptionAr, seoTitle, seoTitleAr, seoDescription, seoDescriptionAr, productCount }` (`404` unknown) |
| GET | `/sitemap/brands` | public → brands with something on sale |
| GET | `/feeds/products?page=` | public → Google Merchant data (one row per variant), `{ enabled: false, items: [] }` when switched off |
| GET | `/admin/brands?q=` | 🔒 `products.read` → up to 500 brands with all texts and `_count.products` |
| POST / PATCH | `/admin/brands` · `/admin/brands/{id}` `{ name, nameAr?, slug?, description?, descriptionAr?, seoTitle?, seoTitleAr?, seoDescription?, seoDescriptionAr? }` | 🔒 `products.moderate` |
| POST / PATCH | `/admin/categories` · `/admin/categories/{id}` + the same texts + `faq: [{ q, qAr, a, aAr }]` (≤ 20) | 🔒 `categories.manage` |
| PATCH | `/admin/countries/{code}` `{ seoSettings: { googleVerification?, bingVerification?, social?: { instagram, facebook, tiktok, x, youtube, snapchat, linkedin }, merchantFeed? } }` | 🔒 `countries.manage` |

Texts: an empty string clears one; only the fields sent change; Google title ≤ 70, description ≤ 170, intro ≤ 5000.
Questions without both languages and an answer are dropped. `GET /categories/{slug}` returns the texts and `faq`.
Verification: a pasted `<meta … content="…">` keeps only the code (letters, digits, `-`, `_`); social links must be
the network's own `https://` address (else `400`). `GET /markets` → `seo: { googleVerification, bingVerification,
social }`. Feed rows: `id` (SKU), `itemGroupId` (product, when it has variants), titles / descriptions EN + AR, photos
(variant's own first), `priceMinor`, `salePriceMinor` + `saleStartsAt` / `saleEndsAt` (a live deal while its quota
lasts), `availability`, `brand` (else the store), `gtin` (only a barcode with a valid check digit), `mpn`, colour /
size from the options, `productType` (category path EN / AR), `returnDays`; plus the market's currency, delivery fee
and free-delivery threshold. Product detail variants carry `gtin` the same way.

**Search changes:** relevance and the default order put products in stock first, then text match, sales and rating
(average × number of reviews); an explicit sort (price, newest, popular, rating) is obeyed as chosen.
`GET /search/suggest` products now carry `priceMinor`, `imageUrl`, `inStock`, `category` / `categoryAr` (6 at most);
brands carry `nameAr`.
