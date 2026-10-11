# Security

How the FastMoveX API protects accounts, data and money. Every control below is implemented and covered by tests
unless it is listed under [Not yet implemented](#not-yet-implemented).

## Principles

1. **The server decides.** Prices, discounts, delivery fees, VAT, commission, stock and permissions are never taken from the client. Unknown request fields are rejected outright.
2. **Least privilege.** Every route is authenticated by default; public routes are opted in explicitly. Admin routes check granular permissions, seller routes check ownership.
3. **Money is append-only.** Financial state lives in an immutable, balanced, idempotent ledger enforced by the database itself.
4. **Fail closed, degrade gracefully.** Bad configuration stops the process; a cache or notification outage never breaks a purchase.

## Authentication

| Control | Implementation |
|---|---|
| Password hashing | argon2id (19 MiB memory, 2 iterations — OWASP 2024); hashes upgraded transparently on login |
| Password policy | customers 8+ chars with a letter and a digit; staff 12+ with upper, lower and digit |
| Account enumeration | identical error for unknown user / wrong password, and a dummy hash is computed for unknown users so timing matches; forgot-password always answers the same and returns before sending |
| Access tokens | HS256 JWT, 15 min, issuer-checked, type-checked (`typ=access`) |
| Refresh tokens | random 384-bit, stored as SHA-256 only, single-use with rotation; reuse of a used token revokes the whole login family and is audited. A token rotated less than 15 s ago may come back once while its login is still alive (a response lost when the browser closed, two tabs refreshing together) — after logout, logout-all or a password reset there is no live token, so a replay is still treated as theft |
| Web sessions | refresh token in an httpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/auth`; refresh requires `X-Requested-With: jovia-web` (CSRF) |
| Mobile sessions | refresh token returned in the body for secure device storage |
| Admin panel sessions | `X-Client-Type: admin`: only accounts with a staff permission can sign in (customers and drivers get 403, audited as `auth.admin_login_denied`) and refresh (a staff member whose roles were removed loses the panel at the next refresh, ≤ 15 min). Its refresh token lives in a separate `jovia_admin_rt` cookie, so the panel and the shop never overwrite each other's session |
| Two-step sign-in (staff) | TOTP (RFC 6238: authenticator app, 6 digits, 30 s, ±1 step for clock drift). The secret is stored AES-256-GCM encrypted; turning it on needs the first code, then every other session is signed out. Each code works once (the last used step is stored and updated atomically). 10 one-time recovery codes (`XXXX-XXXX`, stored as peppered SHA-256, removed atomically when used, can be regenerated with a current code). Sign-in with it on: the password step returns only a 5-minute **challenge** (a JWT of type `mfa`, bound to the client), `POST /auth/2fa/login` exchanges it with the code for tokens; the session (access and refresh token) carries `mfa=true`. **Required for every staff account in production** (`STAFF_TWO_FACTOR=required`, the default when `NODE_ENV=production`): a staff session without it can only reach the set-up, sessions, sign-in history, password change and sign-out routes (`403 TWO_FACTOR_SETUP_REQUIRED`) and the admin panel sends them to **My security**. Customers, sellers and drivers are not affected. Staff cannot turn it off where it is required; a lost phone is reset by another admin (`admins.manage`, never your own, a super admin only by a super admin), audited |
| Account lockout | per account, on top of the per-IP rate limit: 5 wrong passwords or codes within 15 minutes pause sign-in for 15 minutes (`429 ACCOUNT_LOCKED` with the minutes left, even with the right password), the user is emailed, audited as `auth.account_locked`; a password reset unlocks |
| Sign-in history and devices | every attempt (success, wrong password, wrong code, locked, not staff) is kept with device ("Chrome on Windows"), IP and client; an email goes out when an account signs in from a device not seen in 180 days; **My security** lists signed-in devices (one per login) and ends any of them; staff with `users.read` see a staff member's history |
| Logout everywhere | `POST /auth/logout-all`; also automatic on password change, password reset, suspension and role demotion |
| One-time codes | 6 digits, HMAC-SHA256 (keyed, bound to user + purpose) stored — never the code; 10-min expiry; 5 wrong tries per code; 60 s resend cooldown; 5 codes per address per hour; single use even under concurrent requests; codes are sent directly and never written to the notifications table |
| Email/phone verification | a code only verifies the exact address it was sent to |
| Guest orders | a guest gets an **order access token**: HMAC-SHA256 of the order id with a key derived from `JWT_ACCESS_SECRET` (nothing stored, compared in constant time, valid for that one order only; rotating the secret revokes every link). The order number alone opens nothing. Lookup needs the order number **and** the email or phone used, is rate-limited (10 / 15 min) and answers `401` without saying which part was wrong. Guest accounts have no password and cannot sign in |
| Guests and real accounts | guest checkout with an email that belongs to an account is refused (`ACCOUNT_EXISTS`: sign in), so nobody can add orders to someone else's account or read them. A guest becomes an account only through forgot-password — the one-time code proves they own the address; registering with a guest's email/phone is refused (`GUEST_ACCOUNT`). A phone number already on another account is not copied to the guest |
| Idempotency keys | a checkout key is bound to the account (or guest) that first used it; another caller reusing it gets `409`, never someone else's order |

## Roles and permissions

Roles: `SUPER_ADMIN`, `ADMIN`, `FINANCE_ADMIN`, `OPERATIONS_ADMIN`, `CATALOG_MANAGER`, `INVENTORY_MANAGER`, `ORDER_MANAGER`,
`SUPPORT_ADMIN`, `SELLER`, `CUSTOMER`, `DELIVERY_AGENT`. Staff get permissions through roles (editable in the admin
panel's **Roles & permissions** or `PUT /admin/roles/{code}/permissions`); there is no hidden "super user" bypass in
code — `SUPER_ADMIN` simply holds every permission and cannot be edited. A route with several permissions needs all
of them.

| Permission group | Permissions | SUPER | ADMIN | FINANCE | OPS | CATALOG | INVENTORY | ORDERS | SUPPORT |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| users | `users.read`, `users.update`, `users.suspend` | ✓ | ✓ | | | | | read | read |
| sellers | `sellers.read`, `sellers.approve`, `sellers.suspend`, `sellers.documents.read` | ✓ | ✓ | read | ✓ | | | | read |
| catalogue | `products.read`, `products.manage`, `products.moderate`, `categories.manage`, `banners.manage` | ✓ | ✓ | | ✓ | ✓ | read | read | |
| inventory | `inventory.manage` (stock changes) | ✓ | ✓ | | ✓ | ✓ | ✓ | | |
| orders | `orders.read`, `orders.update`, `orders.cancel` | ✓ | ✓ | read | ✓ | | | ✓ | read |
| finance | `payments.read`, `refunds.create`, `refunds.approve`, `payouts.read`, `payouts.approve`, `commissions.manage`, `ledger.read` | ✓ | ✓ | ✓ | | | | | |
| finance | `payouts.mark_paid` | ✓ | ✗ | ✓ | | | | | |
| marketing | `coupons.manage`, `campaigns.manage`, `featured.manage` | ✓ | ✓ | | | ✓ | | | |
| support | `tickets.read`, `tickets.reply`, `reviews.moderate`, `returns.manage` | ✓ | ✓ | | returns | | | returns | ✓ |
| delivery | `delivery.read`, `delivery.manage` | ✓ | ✓ | | ✓ | | | ✓ | |
| system | `settings.manage`, `countries.manage`, `analytics.read`, `audit.read` | ✓ | ✓ | analytics, audit | | analytics | | | |
| system | `admins.manage`, `roles.manage` | ✓ | ✗ | | | | | | |
| cash | `cash.read` (who holds COD cash, handovers, receipts), `cash.receive` (cashier) | ✓ | ✓ | ✓ | read | | | read | |
| control | `delivery.override` (close a driver delivery without the customer's code, with a reason) | ✓ | ✓ | | | | | | |
| stock | `inventory.approve` (write-offs above the limit, approve stocktakes, write off expired stock) | ✓ | ✓ | | ✓ | | | | |
| purchasing | `purchasing.manage` (suppliers, purchase orders), `purchasing.receive` (receive goods) | ✓ | ✓ | | ✓ | | receive | | |
| payments | `payments.reconcile` (upload gateway settlement files) | ✓ | ✓ | ✓ | | | | | |
| reports | `reports.margin` (profit & margin: cost prices and profit) | ✓ | ✓ | ✓ | | | | | |
| orders | `orders.create` (phone orders for a customer) | ✓ | ✓ | | ✓ | | | ✓ | ✓ |

Prices and stock are separate rights: changing a price needs `products.manage`, changing stock needs
`inventory.manage` (checked per change, also inside bulk edits).

Guard rails on access management: nobody can change their own roles or status; only a super admin can grant,
remove or suspend a super admin; the last active super admin cannot be demoted or suspended.

**Sellers** are isolated by ownership, not by URL: the seller is always derived from the token, every query is
scoped to that seller, and another seller's record returns **404** (not 403) so IDs cannot be probed. Pending,
rejected or suspended sellers can only reach onboarding routes.
**Customers** only ever see their own orders, addresses, carts, returns, tickets and reviews.
**Couriers** (`DELIVERY_AGENT`) only see jobs assigned to them; the customer's 4-digit code is checked in constant time and 5 wrong codes lock the job.
**The delivery code is the customer's proof of receipt**: only the customer sees it (order page, SMS to the delivery
phone, email, WhatsApp). Staff and seller screens and APIs never contain it; staff closing a driver delivery must type
it (wrong codes count towards the same lock) or, as a manager, write why it is missing — recorded on the delivery and
audited.

## Input, output and injection

| Threat | Control |
|---|---|
| Mass assignment | `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` on every DTO |
| SQL injection | Prisma parameterised queries; raw SQL only through tagged templates (every value bound); sort orders from a fixed whitelist; search words tokenised in the app and quoted; `LIKE` wildcards escaped — tested with injection payloads |
| XSS | JSON-only API with Helmet (CSP, nosniff, frame-ancestors); notification templates are plain text; SVG/HTML uploads rejected; banner links must be site paths or `https://` (no `javascript:`); content pages are stored as plain text in a small markdown subset and rendered by the website as React text nodes — never as HTML — with links limited to site paths, `https:`, `mailto:` and `tel:` |
| Messages customers did not ask for | WhatsApp order updates go only to customers who ticked the (never pre-ticked) box at checkout or in their account; the consent time is stored; switching it off stops them at once. Cart reminders are treated as promotions: only with marketing consent, at most one a day (two per cart), never during quiet hours (default 21:00–09:00 Doha), stopped by any cart change or order. WhatsApp uses Meta-approved templates only |
| Website cache refresh | `POST /api/revalidate` on the website accepts only the shared `INTERNAL_API_KEY` (constant-time check) and an allow-list of cache tags; anything else is `403` / `400` |
| Spam | the contact form has a hidden honeypot field (bots that fill it are answered `202` and dropped), a 3 / 10 min per-IP limit and at most 5 messages per email per hour (extra ones silently accepted and dropped, so the limit is not revealed) |
| Route clashes | content pages cannot use a web address the website already uses (`checkout`, `track`, `account`, …) |
| CSRF | tokens in `Authorization` headers; the only cookie is SameSite=Strict and its endpoint requires a custom header |
| Spreadsheet injection | CSV/Excel exports prefix cells starting with `= + - @` |
| Oversized payloads | 1 MB JSON limit; file size limits per type |
| Brute force / abuse | per-IP rate limits (120/min default; auth 5/min; codes 5/15 min; coupons 10/min; checkout 10/min; support 5/h); coupon guessing needs login |

## Admin panel (apps/admin)

- Staff-only sign-in and a separate session cookie (see Authentication). The access token is kept in memory only.
- FastMoveX drivers (`DELIVERY_AGENT` only) may sign in too, but the panel sends them to `/driver` and every other address
  redirects back there; the API refuses them all staff routes anyway. Only `/driver` may ask for the phone's location
  (`Permissions-Policy: geolocation=(self)` on that page alone), and only after the driver switches sharing on.
- **Driver page without signal:** a small service worker (`/driver-sw.js`, scope `/driver` only, `worker-src 'self'`)
  keeps the page itself and the static files; it never caches API answers. The driver's last run (stops, phones,
  addresses, cash) and steps taken offline are kept in that phone's `localStorage`, per driver, and **wiped on
  sign-out** (the page warns when steps are not sent yet). Opening the page offline needs a driver who signed in on
  that phone before; the session is confirmed with the server as soon as there is signal. Queued steps go through the
  normal API checks when sent: a wrong delivery code is refused then and the job comes back as open (the page tells
  the driver to check the code is right while offline). Photos are not kept offline.
- The menu is built from the token's permissions for convenience; **every** call is authorised again by the API.
- Strict per-request CSP (scripts only with the response's nonce, network only to the API), `X-Frame-Options: DENY`,
  `noindex`, `Cache-Control: no-store`, no third-party scripts, fonts or analytics.
- Every change goes through the API and lands in the audit log with the staff member's name (Audit log screen).
- Content pages and the home layout need `settings.manage` / `banners.manage`; contact messages need `tickets.read` (reply/mark: `tickets.reply`).
- Recommended in production: its own hostname (`admin.…`) and an extra network restriction (VPN or IP allow-list).

## Website (apps/web)

| Control | Implementation |
|---|---|
| Content Security Policy | per-request nonce: scripts only with that nonce (`strict-dynamic`), no inline event handlers, network calls only to the API origin, images only from the site and the media CDN, `frame-ancestors 'none'`. For sign in with Google / Apple only their sign-in origins are added (Google's button frame and stylesheet `accounts.google.com/gsi/`, Apple's script and window); `SOCIAL_SIGN_IN=off` removes them |
| Sign in with Google / Apple | the ID token is checked by the API (signature against the provider's keys, issuer, our client ids, expiry, a fresh random **nonce** per attempt kept in the tab); customers only; an email links to an existing account only when the provider says it is confirmed; an account cannot lose its only way in |
| Browser notifications | asked only when the customer switches them on (Notifications page); the push service gets an encrypted message for that browser only (VAPID); a tap opens only a page of the site; signing out removes that browser's subscription |
| Headers | `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, `Permissions-Policy` (website: camera and microphone for this site only — barcode scan and voice search, both started by the shopper; nothing is recorded or uploaded: the picture is read in the browser and only the number is searched; voice uses the browser's own speech recognition), HSTS in production, no `X-Powered-By` |
| Tokens in the browser | access token in memory only; refresh token only in the httpOnly SameSite=Strict cookie; refresh serialized across tabs (Web Locks) and shared over a BroadcastChannel |
| No secrets in the browser | the only server secret (`INTERNAL_API_KEY`) is read on the server; browser config contains public URLs only |
| Redirects | the post-sign-in destination must be a same-site path (no open redirect); admin-entered banner links must be site paths or `https://` |
| Guest tracking links | `/track?order=…&t=…` is `noindex` with `Referrer-Policy: no-referrer`, so the token does not leak to other sites; the device remembers its own recent guest orders in `localStorage` (order number + token only) |
| Personal pages | account, cart and checkout are rendered in the browser with the shopper's own token, never cached by the server or the service worker, and marked `noindex` |
| Search-engine settings | verification codes are reduced to their code (no markup can reach the page); social links only to the networks' own https addresses; category/brand texts are plain text (paragraphs, no HTML); all JSON-LD is serialized with `<` escaped |
| Image proxy | the optimiser only fetches from the configured media host; private IPs are refused unless explicitly enabled for local development |
| Structured data | JSON-LD is serialized with `<` escaped |

## Files

- Type detected from the file's **bytes** (magic numbers), never from the name or `Content-Type`. Allowed: JPEG, PNG, WebP (images), PDF (documents), MP4 (video).
- Size limits: images 5 MB, documents 10 MB, video 30 MB; max 10 images per product, 5 per review, 20 seller documents.
- Customer photos (reviews) are decoded and **re-encoded** on the server (sharp: upright, ≤ 1600 px, WebP), which drops
  every bit of metadata — above all the GPS position phones store in photos. Images over 40 megapixels are refused
  (decompression bombs). The browser also shrinks them before upload.
- Random object keys; public and private buckets are separate. Seller documents and proof-of-delivery photos live in the private bucket and are served only through **5-minute signed URLs**; every view is audited.

## Sensitive data

- Seller IBANs: validated (ISO 13616 mod-97) and encrypted with **AES-256-GCM** (random IV, authentication tag); only the last 4 characters are stored in clear. Bank-detail changes are audited (without the IBAN).
- No card data ever reaches FastMoveX: payment providers return references only.
- Customers never see commission, seller earnings or internal keys; sellers see only the delivery details of their own shipments; reviews show "First L." names only.
- Promotional notifications require explicit opt-in (`marketingOptIn`).
- **Search log**: counts per day and search text only. Searches that look like an email, a phone or card number or a
  link are never stored; the visitor's IP and browser are hashed in memory to count distinct visitors and never saved.
  A search becomes a public "popular search" only after 3 different visitors and while it still finds products; staff
  can hide any.
- **Visit analytics**: first-party and anonymous — a random id per browser tab session (sessionStorage, no cookie), no
  IP, no user id, coarse device type only; bots and headless browsers are not counted; landing pages are cut to their
  section so order numbers or tokens never land in the data; sessions are deleted after 13 months. The `text/plain`
  body parser that beacons need is mounted on that one route only, so no other endpoint accepts a cross-site "simple" body.
- Product questions are shown only after the store answers them, with "First L." names.

## Financial integrity

| Risk | Control |
|---|---|
| Client-side price tampering | cart and checkout recompute everything from the database with one pure pricing function |
| Price changed after adding to cart | checkout blocked until the customer acknowledges the new price |
| Overbooked delivery window | a place is taken with a conditional update (`booked < capacity`) inside the order transaction, so the last place goes to exactly one customer; cancelled orders give it back via a database trigger |
| Double order from a double tap | `Idempotency-Key` on checkout (unique in the database) |
| Forged payment confirmation | Dibsy webhooks are only a hint: the API fetches the payment from Dibsy with its secret key and confirms only if Dibsy says it is paid **and** the order id (metadata), amount and currency match the order; a mismatch is refused and audited (`payment.mismatch`). Webhook payment ids are format-checked before any request. The test gateway's HMAC-signed webhooks exist only outside production |
| Lost webhook | the API asks the gateway when the customer opens a pending order (at most every 5 s) and before the unpaid-order expiry, so a paid order is never cancelled; money arriving after cancellation becomes a refund |
| Redirect abuse | the payment return address must be on the FastMoveX website (`STOREFRONT_URL` / `CORS_ORIGINS`, https in production); the checkout page address from the gateway must be https |
| Card data | never touches FastMoveX: customers type cards on Dibsy's hosted page (lowest PCI scope, SAQ-A); FastMoveX stores only Dibsy's payment id and what the customer paid with (e.g. `applepay`) |
| Overselling | conditional stock reservation (`onHand − reserved ≥ qty`) in the order transaction; DB CHECK keeps stock ≥ 0 and reserved ≤ on hand |
| Coupon over-use | usage limit enforced atomically in the order transaction; per-user and first-order checks; uses returned when a payment fails |
| Deal quota over-use | atomic counter with `stockLimit`, returned on failed/abandoned payments |
| Duplicate webhook / capture | unique `(provider, eventId)`; ledger idempotency keys; payment signature verified over the raw body in constant time |
| Late payment for a cancelled order | never resurrects the order; recorded in the ledger (`REFUND_PAYABLE`) and refunded |
| Double refund | atomic `PENDING → PROCESSING` claim; refunded total can never exceed the payment (DB CHECK + conditional update) |
| Double payout | per-seller advisory lock; request ≤ available − already requested; balance re-checked when paid |
| Insider payout fraud | four-eyes rule: the approver cannot mark the payout paid; `ADMIN` has no `payouts.mark_paid` |
| Insider refund fraud | four-eyes rule: whoever created a refund cannot approve it or mark it paid (`403 FOUR_EYES`; super admin excepted); approver recorded (`approvedById`) |
| "Delivered" without the customer | FastMoveX-driver deliveries close only with the customer's code; a manager override needs a written reason, is stored on the delivery and audited (`delivery.override`); sellers cannot close them |
| Cash on delivery kept by a driver | every delivered COD shipment is recorded on the name of whoever holds the cash; a cashier counts it in (expected vs counted, shortage needs a note, audited as `cash.handover_short`); nobody receives their own cash (DB CHECK); collections and handovers are write-once (DB triggers); drivers at the market's cash limit cannot pick up more; cash held over a day shows on the dashboard |
| Fake cash-on-delivery orders | guests prove their mobile with an SMS code; max cash order; max open cash orders per account/phone; customers (and their phone) can be blocked; refusals at the door counted, COD switched off automatically at the limit — card payment always stays available |
| Return fraud (wrong or used item sent back) | staff inspect on arrival: only *sellable* items go back to stock; *damaged* is refunded but kept off stock; *not accepted* gets no refund — all with a note, audited |
| Missed-delivery excuses | a failed attempt stores the driver's phone location, the distance from the customer's map pin and an optional door photo (private, opened with a 5-minute link, audited); attempts over 500 m from the pin are flagged red for operations. The customer is told at once (SMS / email / WhatsApp) and can pick a new time or leave a note — or tell operations it was not true |
| Stock quietly written off | every stock change needs a reason (damaged, expired, lost, found, correction) that matches its direction; removing more than `STOCK_WRITE_OFF_LIMIT_MINOR` (QAR 500) at cost needs `inventory.approve`; stocktakes are blind for counters and approved by a different person (DB CHECK), never below units promised to orders; the Losses report shows what left without being sold |
| Expired goods sold | products marked "has an expiry date" need the date when stock arrives; orders take the earliest good date first (FEFO), expired units are never shipped and are written off every night |
| Fake supplier deliveries | goods are received against a purchase order by someone other than the person who raised it (`403 FOUR_EYES`, super admin excepted), never more than ordered (DB CHECK, conditional update), and goods receipts can never be changed or deleted (DB triggers) |
| Payments that do not add up | daily checks: cancelled but still charged, delivered but not paid, amount ≠ order, card payments stuck over an hour, cash orders without a collection, cash with a driver over a day; the gateway's settlement file is matched row by row (differences, missing, duplicates, payments missing from the file); a daily closing report (PDF) for finance |
| Ledger tampering | DB triggers block UPDATE/DELETE; deferred trigger rejects unbalanced transactions |
| Silent config mistakes | production refuses log drivers, placeholder secrets, localhost CORS and the test payment gateway |

## Staff notes, tags and alerts

- Customer tags and notes (and order staff notes) are **staff-only**: no customer-facing endpoint selects them and an
  integration test checks the customer's profile and order responses never contain them. Reading needs `users.read`
  (order notes: `orders.read`); tagging, pinning and deleting others' notes need `users.update`. Every change is
  audited. They are personal data: deleted with the account and never put in the customer's data export.
- Staff alerts go to people by permission at the moment of the alert (a role change applies at once), never to the
  person who caused them, never by SMS/WhatsApp; email only for those who chose it. Alert texts carry order numbers,
  names and amounts — no addresses, phone numbers or delivery codes. Links are relative admin paths.
- Margin data (cost prices, profit) needs `reports.margin`: operations and support roles do not see it.
- The live map shows driver positions only to `delivery.read`; positions are sent by the driver's phone only while a
  job is picked up or out for delivery, and kept as the last point per job (no location history). Map tiles are
  images from the configured tile server (`MAP_TILE_URL`, allowed in the panel's CSP `img-src`); no map scripts are
  loaded from third parties (Leaflet is bundled).

## Order changes, phone orders and refunds

- Orders change only through the change endpoints, each in one transaction with a row lock on the order; every change
  is an `OrderChange` record the database refuses to edit, plus the audit log. Items can be **added** only to a
  cash-on-delivery order before dispatch (stock reserved in the same transaction, the cash to collect goes up, the
  customer is told); nothing can be added to a paid order without a new payment. Money never moves silently: cash to collect is reduced, card payments get a
  refund that goes through the usual four-eyes approval.
- Customers change only their own orders (others' → 404), at most 3 times, only before packing, and only to their own
  saved addresses (guests: with the private order link). A cash order cannot be moved to a phone number blocked for
  cash on delivery.
- Phone orders: `orders.create`; never for a staff account; priced by the server like any order; the staff member who
  took it is recorded (`placedById`) and audited. The "verified mobile" rule for cash is waived only here (staff spoke
  to the customer); the other cash-on-delivery rules (blocked customer/phone, maximum amount, open orders) still apply.
  A promo code on a phone order is judged for that customer by the same rules as on the website (per-person limit,
  first order, new customers) and redeemed in the order's transaction.
- Refused at the door: only the assigned driver, only while out for delivery, only part of the shipment; the units are
  not back on sale until someone books them in (and damaged ones need a written note).
- Refund approval limits per staff member (`User.refundLimitMinor`), set only by `admins.manage` and never for
  yourself; enforced by the API on approve and mark-paid, on top of the four-eyes rule.
- Customer order responses never include cost prices, commission or who placed the order (stripped server-side).

## Personal data (Qatar PDPPL)

- **Access:** customers download everything held about them (`/me/data-export`, JSON; internal staff notes, passwords
  and card data are never included); support can produce the same file for a request received another way
  (`users.read`, audited as `privacy.data_exported` with who did it).
- **Deletion:** the customer asks with their password; nothing open may be pending (orders, returns, refunds). The
  account is signed out everywhere and deleted after 14 days unless they sign in and keep it. Deletion removes
  identifying data and keeps what the law requires for accounting (orders, payments, refunds, invoices, credit notes)
  without the person: name "Deleted customer", no email/phone/password, order addresses reduced to city and zone.
  Review and return photos, the customer's support message texts, staff notes and tags about them are removed. Audited (`privacy.deletion_requested`,
  `privacy.deletion_cancelled`, `privacy.account_deleted`). Staff and seller accounts are closed by an admin / support.
- **Documents:** invoices, credit notes and return receipts are served only to the order's customer (or with the
  guest order token) and to staff by permission; credit-note numbers are issued and frozen by the database.
- Uploaded photo files of deleted accounts are unlinked from the records; removing the objects from storage is a
  separate clean-up (bucket lifecycle rule or a periodic job).

## Audit log

`AuditLog` records actor, action, entity, before/after and IP/user-agent for: auth events (password change/reset,
logout-all, token reuse), seller applications, approvals, suspensions, bank changes and document views, product
moderation and price changes, category/brand/coupon/campaign/banner changes, order status changes, refunds, returns,
payouts, commission rules, market settings (including guest checkout on/off and cash-on-delivery rules), guest checkouts, content pages, home layout changes, staff/role/permission changes, user suspension, delivery overrides, cash handovers (shortages separately), COD blocks/unblocks (manual and automatic), two-step sign-in on / off / reset / recovery codes, account lockouts, ended sessions, failed-delivery photo views, stocktakes (create, submit, approve, cancel), nightly expiry write-offs, suppliers and purchase orders (create, change, send, receive, cancel), settlement uploads, packing slip prints, data exports, account deletion requests / cancellations / deletions and every analytics export.
Since Phase 23 also: product images (add / remove / order), variant creation and changes, every stock adjustment
(also alert levels), store logo / banner, failed delivery attempts and wrong delivery codes, finance release runs started
by hand, support replies, stocktake counts, staff alert settings, items added to orders, Google / Apple sign-ups and
links. Driver location pings are the only staff/driver write that is deliberately not audited (too frequent; the
last position is on the delivery).
Viewable at `GET /admin/audit-logs` (`audit.read`).

## Secrets

- `JWT_ACCESS_SECRET` and `FIELD_ENCRYPTION_KEY` come from the platform's secret manager, never from the repository (`.env` is git-ignored).
- `VAPID_PRIVATE_KEY` (browser notifications) is a secret too; the public key is meant to be public. Google / Apple
  client ids are public; the API refuses to start in production with changed Google / Apple key URLs.
- The encryption key must be backed up offline; rotating it requires a re-encryption job (not included).
- The production image runs as a non-root user and contains no source code or dev dependencies.

## Not yet implemented

These are recommended before or soon after launch:

- **Malware scanning of uploads** (e.g. S3/R2 event → ClamAV) — types and sizes are validated, content is not scanned.
- **Breached-password check** (Have I Been Pwned k-anonymity API) at registration.
- **WAF / bot protection** — configure at Cloudflare in front of the API and the website.
- **Encryption-key rotation** tooling.

## Reporting a vulnerability

Email security@fastmovex.qa (set this up before launch). Do not open public issues for security problems.
