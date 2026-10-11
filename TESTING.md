# Testing

Three apps, each tested on its own and against the real API in CI on every push.

| Layer | Where / command | What it runs against | Count |
|---|---|---|---:|
| API unit + API | `apps/api` · `npm test` | services with mocked persistence, pure engines, and the **real Nest application** (guards, pipes, routing) over HTTP with a mocked database | 492 |
| API integration | `apps/api` · `npm run test:int` | the **real application, real PostgreSQL, real S3-compatible storage** — nothing mocked except the outgoing email/SMS call (Dibsy and the WhatsApp Cloud API are replaced by local stand-in servers; Google's sign-in keys are served by the test itself) | 164 |
| Website unit | `apps/web` · `npm test` | money formatting, translations (both languages complete, plural rules), URL safety, CSP, SEO helpers, variant picker, safe rendering of content pages, two-step code input, missed-delivery wording, browser-notification key, arrival texts, Google Shopping feed, image sitemap, the cards' delivery day | 53 |
| Website browser | `apps/web` · `npm run test:e2e` | a **real browser** on the production build of the website, calling the real API and database | 77 (2 need the API connected to the Dibsy stand-in; `phase23` needs the API started with the e2e Google client — see below) |
| Admin unit | `apps/admin` · `npm test` | money typed by staff, Qatar-time dates, options → variants builder and its checks, token reading, two-step code input, the driver page's offline outbox, the CSP for the driver's offline helper | 16 |
| Admin browser | `apps/admin` · `npm run test:e2e` | a **real browser** on the production build of the admin panel, calling the real API and database | 57 |

Plus type-checking (`npm run typecheck`) and the production build (`npm run build`) of all three apps.

## Running the tests

```bash
cd apps/api

# Unit + API tests: no database needed
npm test
npm run test:cov              # with coverage

# Integration tests: needs the local stack, migrations and both seeds
docker compose up -d
npx prisma migrate deploy
npm run db:seed && npm run db:seed:demo
npm run test:int
```

The integration suite creates fresh customers and a fresh seller on every run (random suffixes) and restores the
demo prices it changes, so it can be repeated on the same database. It refuses to run if `DATABASE_URL` looks like
production. It uses the demo accounts, so it needs `npm run db:seed:demo`.

## What the integration suite proves

`test/integration/flow.int-spec.ts` — one complete marketplace lifecycle, in order:

1. Register → verify email with a one-time code → forgot password → reset (code single-use, old sessions revoked)
2. Forgot-password for an unknown account gives the same answer and sends nothing
3. Seller applies → token refresh adds the SELLER role → invalid IBAN and SVG-as-PDF rejected → documents + bank → submit → admin approves the document, then the seller → ledger accounts opened
4. Seller creates a product with two variants → cannot submit without an image → uploads → admin approves → visible and searchable
5. Cart with **two sellers**: client prices rejected, stock limit enforced, flash-deal price applied, per-seller delivery, `WELCOME10` split to the dirham (total QAR 261.10)
6. Checkout: address format enforced, **idempotent** (same key = same order), stock reserved, order split per seller, customer view hides commission, ledger balanced, seller pending balance exactly QAR 180.00
7. Seller-delivered shipment through every status; no going back; stock committed
8. Seller A cannot read or update seller B's shipment; customer cannot use admin routes or another customer's order
9. FastMoveX fleet: ready for pickup → delivery job created → ops assigns courier → pickup → out for delivery → wrong code rejected → right code + photo → order delivered
10. Return → wrong seller cannot decide it → seller approves and receives → finance refunds exactly the paid line amount (QAR 71.10) → no double refund → ledger still balanced
11. Return window passes → earnings released → payout validation → approve → **four-eyes** (same finance admin and plain admin refused) → second finance admin pays → balances exact
12. Ledger rows cannot be updated or deleted; analytics and CSV export include the order; admin payments list; customer received notifications
13. Reviews only after delivery, once per item; rating recomputed

`test/integration/edge.int-spec.ts`:

- out-of-stock variant cannot be added
- **price changed after adding to cart** → checkout blocked (409) until acknowledged
- **failed card payment** → order cancelled, stock, coupon use and deal quota returned, items and coupon back in the cart, no ledger entry
- pending 3-D Secure payment → forged webhook rejected → signed webhook confirms → **replayed webhook ignored** → exactly one capture
- abandoned payment expires after 30 min → stock released → money arriving later does not resurrect the order → recorded as `REFUND_PAYABLE` → refunded → ledger balanced
- **cash on delivery with one seller cancelling** → only the delivered part is collected (QAR 59.00) → no refund needed → ledger balanced
- **coupon abuse**: first-order coupon after an order, unknown code, guest
- customer cancels before shipping (reservation released) but not after delivery
- home sections, category + price + stock filters and sorting, suggestions, time series (7 daily buckets in Doha time), top categories, Excel export, seller analytics, role checks on analytics and finance
- admin moves a category with its children (paths re-rooted), delete protection
- admin changes the market delivery fee → carts use it immediately; support admin refused

`test/integration/admin.int-spec.ts` — running FastMoveX's own store from the admin panel:

- the house store exists (created by the base seed) and its owner account cannot sign in
- staff create a product in it; it cannot go live without a photo; published products are public while cost price and staff-only fields never are
- a customer buys it; it appears under "to ship"; staff move the shipment step by step (no skipping); stock is committed when it ships; support staff cannot move orders
- stock cannot go below what open orders reserved; every change is in the history; changing only the low-stock alert level moves no stock
- admin panel sessions: customers refused (no cookie set), staff get the separate `jovia_admin_rt` cookie, the shop's refresh ignores it
- the audit log names who made each change; support staff cannot read it
- CSV: export → edit → dry run changes nothing → import updates in place; bad rows reported by line
- dashboard counters show only what the caller may act on

`test/integration/slots.int-spec.ts` — delivery time slots:

- impossible settings refused, support staff refused; the listing shows open days and windows with places left
- a required time: no order without one; a made-up time refused; nothing created
- **two customers race for the last place: exactly one wins** (`SLOT_FULL` for the other); the winner cancels → the place is free again → the next customer gets it
- an unpaid card order that expires gives its place back (trigger); guests choose a time; the staff day view and the orders filter show the bookings
- switched off: no picker, and a stale choice from an open tab is ignored

`test/integration/whatsapp-reminders.int-spec.ts` — WhatsApp and cart reminders, against a local stand-in for the WhatsApp Cloud API:

- `/markets` shows WhatsApp updates and the chat number; Settings shows the connected services
- a guest who ticks WhatsApp gets `fastmovex_order_placed` in Arabic with first name, order number, total and delivery; without the tick, nothing
- an account without a mobile is refused in settings (`NO_PHONE`) but can opt in at checkout (the delivery mobile is used); switching off works
- reminders: settings validated; a forgotten cart gets one reminder (in-app, email, WhatsApp with the cart link) only with marketing consent; no repeat the same day; a second one a day later; never a third
- changing the cart restarts the clock (trigger); the order after a reminder is credited to it and appears in the stats
- quiet hours and the off switch stop reminders
- saved-product alerts: back in stock and a price drop reach WhatsApp (`fastmovex_back_in_stock`, `fastmovex_price_drop`) in the customer's language with the product link; without WhatsApp consent only in-app and email; more stock while available, a price rise, or the same drop again say nothing

`test/integration/dibsy.int-spec.ts` — card payments through Dibsy, against a local stand-in for the Dibsy API:

- `/markets` offers one card option served by Dibsy (not the sandbox)
- checkout creates a Dibsy payment (amount `129.50` QAR, our order id in metadata, API version header) and returns Dibsy's page; the order waits
- a forged "succeeded" webhook changes nothing while Dibsy still says open; junk and unknown ids are refused
- the real payment confirms the order, posts the ledger once (balanced) and records the method (Apple Pay); a replay is ignored
- webhook lost: opening the order asks Dibsy and confirms it; the expiry job asks Dibsy first and keeps a paid order, cancels an unpaid one
- Dibsy's answer with a different amount is refused and audited; a failed payment cancels the order, returns stock and refills the cart
- the return address must be on the FastMoveX website (no order is created otherwise)
- finance refunds through Dibsy with the exact amount; the ledger stays balanced

`test/integration/guest.int-spec.ts` — guest checkout, content and home page (Phase 14):

- a guest orders with only name, email and phone; gets a 43-character order token; the same idempotency key replays the same order; the cart is emptied; the confirmation email mentions tracking
- only the token opens the order (no token / a changed token / an account holder's order → 401)
- lookup with order number + email (any case) or phone returns the token; wrong contact or unknown order → 401
- an email that belongs to an account → `409 ACCOUNT_EXISTS`; no cart → 400; guest checkout switched off for the market → `403 GUEST_CHECKOUT_OFF` and `/markets` shows it
- the guest cancels before shipping and the stock comes back
- registering with the guest's email → `409 GUEST_ACCOUNT`; forgot-password + reset turns the guest into an account that sees its order; guest checkout with that email then needs sign-in
- pages: seeded About/Privacy/Terms are public; drafts hidden until published; reserved and duplicate addresses refused; support staff cannot edit; deleted pages disappear
- contact form: message stored, honeypot messages dropped, invalid input 400; support sees it and marks it handled with a note
- home layout: preview a collection; save a layout with a tag collection, a retitled section and a hidden section → `/home` follows it; duplicate built-ins, invalid collections and unknown keys refused; support staff refused; reset brings the standard page back
- offers: a discounted product appears in the sale list

`test/integration/search.int-spec.ts` — search (Phase 17):

- a product is found by its words in English and Arabic, with or without the article, a shadda, or ى for ي
- a typo with no matches shows results for the correction (`spelling.auto`); `spell=false` turns it into "Did you mean"
- staff synonyms (English and Arabic) make other words find the product; every other word still has to match; bad settings `400`
- the search log counts searches and distinct visitors; an email is never stored; a search needs 3 visitors to become popular; pinned searches come first; type-ahead offers popular searches; staff can hide one
- nothing found → popular searches and best sellers; the staff report has totals, top searches and found-nothing searches; customers get `403`

`test/integration/reviews-questions.int-spec.ts` — review photos and product questions (Phase 17):

- a sideways 2400×1200 phone photo with GPS is stored upright, 800×1600, WebP, with no metadata; it waits for moderation
- not-a-photo refused, at most 5; the customer and staff remove single photos, someone else cannot
- once published: "Customer photos" on the first page, filter "with photos"
- questions: sign-in needed, too short refused, private until answered, at most 3 waiting per product (`429 TOO_MANY_OPEN`); staff answer → public, the customer is told once (an edit does not message again); staff reject; customers cannot use the queue

`test/integration/traffic.int-spec.ts` — visit analytics (Phase 17):

- events validated (UUID, known types, 1–50); JSON and text/plain beacons accepted, unknown fields refused; bots ignored; one row per visit with source, device, landing section (no order number) and funnel flags; later batches add up, the source never changes
- guest checkout with `traffic` stores the order's source and marks the visit as ordered; without it (an app) no source
- the staff report: funnel, sales by source (visits, carts, orders, revenue, conversion), devices, daily; customers `403`

`test/integration/warehouses.int-spec.ts` — warehouses (Phase 17):

- every store has a main warehouse with its stock; new stock lands there; changing `Inventory.onHand` directly is refused by the database
- staff add a warehouse with zones; stock in and out per warehouse (never below zero)
- checkout picks the warehouse that has everything nearest to the customer, or the one that has everything when the near one is short
- the order screen shows what is short and where; changing the warehouse; shipping from a short warehouse → `409 WAREHOUSE_SHORT`
- transfers: too many / same warehouse refused; units move only when received, once; cancelled ones cannot be received; the total never changes
- shipping takes units off that shelf and the total always equals the sum; a warehouse with stock or open shipments cannot be closed, nor the default

`test/integration/driver.int-spec.ts` — the driver page (Phase 17):

- drivers may sign in to the panel app but every staff route answers `403`
- staff assign two jobs; the run lists them by delivery window then zone, with name, phone, Google Maps link, cash to collect and the pickup warehouse
- pick up → on the way → failed attempt (moved after open jobs) → try again
- wrong code refused; right code + doorstep photo → delivered, cash on delivery captured, cash collected in the summary; the photo through a signed URL
- someone who is not a driver cannot see or touch the jobs

`test/integration/cash-fraud.int-spec.ts` — cash and fraud controls (Phase 18):

- the customer sees the 4-digit delivery code on their order and gets it by SMS; staff order screens and the deliveries list never contain it
- operations staff without `delivery.override` cannot close a driver delivery without the code; a wrong code counts towards the lock; a manager must write a reason (stored and audited); the cash lands on the right person (driver, or the staff member)
- cash handover: nobody receives their own cash; operations can look but not receive; a shortage needs a note; the same cash cannot be counted twice (`409`); the database refuses to edit or delete collections and handovers; receipts are PDFs, drivers open only their own
- a driver holding the cash limit cannot pick up until the cash is handed over; run sheets print for the driver and for staff (not for non-drivers)
- refunds: the creator cannot approve (`FOUR_EYES`), a second person can; the list shows who asked and who approved
- fake COD: order size limit, open cash orders limit, blocking a customer (reason required, `users.update` only) also blocks their phone on another account; two refusals at the door switch COD off automatically (the same delivery refused twice counts once)
- returns inspected: condition required; damaged → refund but no restock; sellable → restock; not accepted → rejected, no refund

`test/integration/phase19.int-spec.ts` — security, delivery proof, stock control, payments (Phase 19):

- two-step sign-in: set up (secret stored encrypted, pending until the first code), other sessions end, 10 recovery codes; password alone gives a challenge, a wrong code is refused, a code works once (replay refused), a forged challenge fails; a recovery code works once; sign-in history; sessions listed and ended; only `admins.manage` resets (never yourself); 5 wrong passwords pause the account (`429`) even with the right password
- failed delivery: location + door photo kept, distance from the pin measured, photo opens through a short link; the customer sees the attempt and leaves a note (someone else's order: `404`); a refusal cannot be rescheduled
- stock: reason directions, write-off over QAR 500 needs a manager; dated product needs the expiry date; expired lots are listed and written off by the nightly run; blind stocktake (counters do not see expected numbers, one open count per warehouse, all lines counted before submit, a second person approves, the submitter cannot); the Losses report
- purchasing: duplicate supplier refused; draft editable, sent order fixed; receiver ≠ creator, never more than ordered, expiry required for dated products; partial then full receipt; weighted average cost exact; lot created; goods receipts and over-receiving refused by the database; PDF; warehouse staff can receive but not order
- payments: a cancelled-but-charged card order is listed; the settlement file matches by reference (match, duplicate, not in FastMoveX, unreadable row, wrong amount); only `payments.reconcile` uploads; daily closing adds up, PDF, finance only; new dashboard counters

`test/integration/phase20.int-spec.ts` — documents and privacy (Phase 20):

- invoice: own order (Arabic too), another customer and a wrong guest link get `404`, guests download with their link, staff by permission; the order lists its documents
- credit note: no number while the refund is pending; the database numbers it when paid and refuses to change it; customer, finance and admin downloads; another customer `404`; operations (no `payments.read`) `403`
- return receipt: only after the item is back and checked; listed on the order; customer and staff downloads
- picking list: the same product in two orders added up with its shelf; by ids and by warehouse; packing slips (batch and single); a cancelled shipment refused; customers `403`
- my data: the file has the account, addresses and orders, no password, audited; staff can produce it; deletion: blocked by an open order, wrong password, staff refused; scheduled → signed out → sign in shows the date → kept; asked again → the nightly run waits 14 days, then removes the personal details, keeps the order with the address reduced, sign-in no longer works, the invoice still prints

`test/integration/phase21.int-spec.ts` — insights, notes and alerts (Phase 21):

- cost frozen on the sale by the database: margin by product (sales, cost, profit, 55.55 %); a later cost change does not move it; a refunded unit leaves sales and cost; the next sale uses the new cost
- a product sold without a cost: left out of the margin, counted as "without cost", listed; by day; CSV with a Total row; operations `403`; bad range `400`
- live map: the driver's position after sharing it and the customer's pin on the job; drivers `403`; a "not delivered" 3 km from the pin adds a failure and a "far" to performance, and alerts operations — not the driver, not finance
- tags normalised (`big spender` → `BIG_SPENDER`), bad tag `400`, operations `403`; the list filters by tag; one pinned note at a time; order notes with the customer's tags and pinned note; none of it in the customer's own profile or order; audited
- alerts: per-person choice (off / bell / bell + email; unknown values ignored); a VIP's new order reaches operations by bell and email, not the admin who switched it off, not finance; it is in the inbox with its link; finance only sees the alerts their permissions allow
- low stock: announced once, not again on the next scan; after a restock above the level and a new drop, announced again; only to inventory staff

`test/integration/phase22.int-spec.ts` — order changes and return logistics (Phase 22):

- staff reduce one line and remove another: only reductions (`400`), never everything (`400`), a reason needed, finance `403`; totals, cash to collect, reserved stock back, the record (which the database refuses to edit), the customer's view (no cost, no names) and message; the removed line stays out when the shipment ships; after shipping `409`
- a card order changed: a refund for the difference, pending approval
- refund limit: set by a super admin only; finance above their limit `403 REFUND_LIMIT`; another approver pays it
- the customer moves the window (old place given back) and the address (own saved ones only; others' `404`); three changes then `403`; staff still can; guests with their link (`401` without); after packing `409`
- phone order: price check creates nothing; a new caller becomes a guest profile; same key → same order; placed by recorded; found again by phone; staff accounts refused; product search
- door: refusing all or more than ordered `400`, staff `403`; cash to collect drops to 65.00; delivered; payment and cash collection 65.00; the unit not on the shelf until booked in (damaged needs a note; twice `409`)
- pickup: only for an approved return, drivers only, no past days, one at a time; the customer sees it; failed → arranged again → collected; the admin list shows it; then checked as usual

`test/integration/phase23.int-spec.ts` — sign-in, notifications, buy again, add items, phone promo codes, ETA, audit (Phase 23):

- Google: the test runs its own key server (`GOOGLE_JWKS_URL`) and signs ID tokens; a new account (no password, email confirmed, Arabic), the same account again, the only sign-in cannot be removed, a replayed token with another nonce `401`, an existing password account with that confirmed email gets linked (and can unlink), an unconfirmed email `400 SOCIAL_NO_EMAIL`, a staff email `403 STAFF_ACCOUNT`, the admin panel `403`, Apple not set up `400`; audited
- browser notifications: VAPID keys made for the run; `http://` endpoints refused; subscribed → an order update goes out on `PUSH` to the browser; removed
- buy again: a product no longer sold is listed as skipped, the other comes back at today's price; another customer's order `404`
- add an item: finance `403`, short reason `400`, the product search offers the order's sellers; reserved stock, shipment and order totals, cash to collect, the `ADDED` record, audit, the customer's message and order view; a card order `409 ADD_NEEDS_COD`; more than the stock `409` (nothing reserved); after the driver has it `409`
- phone order promo code: a first-order code for a new caller applies (10 %), is redeemed on the new profile; the same caller again is refused; an unknown code `400`
- arrival estimate: none before the driver sets off; once on the way with a position ~3 km away: ≥ 11 minutes, in the future, no internal ids; a failed attempt is audited
- audit: image added and removed, a variant changed, stock adjusted — all recorded

`test/integration/phase24.int-spec.ts` — search engines and search (Phase 24):

- category texts and questions in both languages: too-long title `400`, a question without Arabic `400`, finance `403`; public on the category; audited with the fields; cleared with an empty value (the other language untouched)
- brand page: Arabic name, text, product count 0 → 1 once a product has the brand; unknown or malformed `404`; in the brand sitemap only with products; staff brand list; update clears and sets texts
- Google & social: a wrong social address `400`; a pasted meta tag keeps the code; public on `/markets`; a later save keeps the rest
- feed: a live deal is the sale price with dates; a real barcode is sent, a made-up one not; out of stock; switched off → nothing
- search: suggestions with price, photo, stock and category; in-stock products before a sold-out best seller; "popular" sort still puts the best seller first

## Admin panel browser tests (`apps/admin/e2e`)

```bash
# API running with RATE_LIMIT_DISABLED=true, CORS_ORIGINS including http://localhost:3001, base + demo seed
cd apps/admin
npm run build && cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static
PORT=3001 node .next/standalone/server.js &
SUPER_ADMIN_EMAIL=owner@jovia.test SUPER_ADMIN_PASSWORD=… npm run test:e2e
```

| Spec | Proves |
|---|---|
| `auth` | customers refused; wrong password message; deep link → sign in → back to the page; httpOnly `jovia_admin_rt` cookie and no shop cookie; session survives reload; sign out; dashboard sections |
| `rbac` | a new *Inventory* staff member sees only Products/Inventory, cannot edit prices but can edit stock, and gets "No access" on other addresses |
| `catalog` | product with two colour variants and a photo → published → on the public API without cost price → edit survives reload; inventory table edit → history shows who and why; CSV checked then imported |
| `content` | new page written in English + Arabic with live preview → published → public via the API; reserved address refused; deleted. Home page editor: add a tag collection, move it up, hide "New arrivals", save → the home feed follows; back to the standard layout. Contact message opened, noted and marked handled. Guest checkout switched off and on in Settings |
| `slots` | Settings → Delivery times: switch on, required, lead time, close Friday, edit and remove windows → the shop's listing follows; an impossible window is refused; Orders → delivery date shows each window's bookings |
| `reminders` | connected services listed; cart reminders switched on with timing, saved exactly |
| `search` | a found-nothing search → Synonym dialog → the shop finds dates for that word; hide from popular searches |
| `questions` | a customer's Arabic question and a spam one → answered in Arabic (published, leaves the queue) and the other not published (the customer sees "rejected") |
| `traffic` | a WhatsApp visit that reached the cart shows in the funnel and the sources |
| `warehouses` | add a warehouse with zones → move 3 units there (transfer → received) → inventory shows them per warehouse and in the warehouse view |
| `driver` | staff assign a job on Deliveries → the driver signs in on a phone and lands on the driver page → cash and map link shown → picked up → on the way → wrong code refused → right code (read from the customer's own order, as staff cannot see it) → delivered → "Cash with me" and the run-sheet button; staff screens redirect back to the driver page |
| `cash` | operations staff must type the customer's code to mark a driver delivery delivered (wrong code refused, no manager option); a manager closes one without the code with a reason shown on the order; the cashier receives cash short by QAR 5 (note required) → receipt opens → listed as short; operations see the Cash page but cannot receive; a refund created by the admin shows "Needs another approver", finance approves it; a returned item marked damaged with a note; COD blocked and allowed again on the customer page; COD rules saved in Settings (bad amount refused) |
| `phase19` | a staff member turns on two-step sign-in (QR / key, wrong code refused, 10 recovery codes downloaded) → the next sign-in asks for the code (wrong one refused, recorded) → a super admin sees "On", opens their sign-ins and resets it; a driver's failed attempt from 2 km away with GPS and a door photo is flagged "2.0 km from address — check" with the customer's note on Deliveries; supplier → purchase order (total checked, PDF) → sent → the creator cannot receive → operations receive 5 then the rest with batch and expiry → on the Expiry page; a blind stocktake by an inventory clerk (scan a SKU, one missing) approved by operations → in Losses; a damaged write-off with its reason; finance sees payment problems, the closing report and PDF, uploads a settlement CSV |
| `phase20` | Picking & packing lists the new order with what to pick, one ticked → packing slips and picking list print, packing slip and invoice from the order page; a paid goodwill refund shows its credit note number on the order and in Refunds; a returned item checked → receipt prints; support downloads a customer's data file |
| `phase21` | Live map shows the driver ("Live") and a pin, the driver's jobs open on click, the Drivers tab lists them; Profit & margin totals, by category, CSV download, hidden from operations; a customer tagged VIP + a custom tag and a pinned note → both on their order, an order note added, the list filtered by tag; a new order rings the bell, the alert opens the order, and the alert is switched to bell + email |
| `phase22` | Phone order for a new caller (find product, quantity, address, check price, place → "Phone order · Demo Admin" on the order); change items, address and window from the order page with the change history; the driver records part of a delivery refused (cash drops) and the warehouse books it back in; a refund limit set and cleared on the Staff page |
| `phase23` | Add item on a cash order (find the product, quantity 2, reason) → "Items added · total +QAR 30.00" in the history; a phone order with a promo code shows "Promo …" and the discount in the price check; the driver page with the network cut: the run stays on screen ("No connection"), "Picked up" waits on the phone ("1 step waiting"), and is sent when the network is back (the API shows the job picked up) |
| `seo` | Categories → Google (SEO) tab: title with live Google preview, text, a question in both languages → saved and public; a new brand with Arabic name and text → "Written" in the list; Settings → Google & social: pasted meta tag kept as its code, a wrong TikTok address refused, feed and sitemap addresses listed |
| `orders` | order from the shop → "To ship" → prepare → ship → deliver from the order page; invoice PDF; cancelling an unshipped order returns the stock |
| `mobile` | menu drawer on a phone, no horizontal scrolling |
| `a11y` | axe-core WCAG 2.1 AA on the sign-in page and 12 main screens: no serious or critical violations |

## Website browser tests (`apps/web/e2e`)

Playwright, desktop Chrome (1366 px) and a phone (Pixel 7), against the **production build**:

```bash
# API running with RATE_LIMIT_DISABLED=true and the demo seed; website built and started
cd apps/web
E2E_API_LOG=/path/to/api.log npm run test:e2e     # the log lets the sign-up test read the one-time code
```

| Spec | Proves |
|---|---|
| `storefront` | home sections and live countdown, no CSP violations; Arabic is RTL, fully translated and remembered; search with type-ahead, typo tolerance, brand filter, sorting; category breadcrumbs + canonical; product deal price, stock and Product JSON-LD; store page; help, policies, localized 404; robots, sitemaps, manifest, service worker; security headers |
| `purchase` | guest cart with **two stores** → exact totals from the server (QAR 233.00) → sign in from the cart → guest cart merged → invalid and valid promo code (QAR 210.70) → cash on delivery → order page with two shipments → customer cancels; sandbox card payment captured and shown as paid |
| `guest` | guest checkout: empty form explains what is missing → cash on delivery asks for the texted code (wrong code refused) → order with name, email, phone and a Qatar address → tracking page with the order and cash on delivery; lookup with a wrong email refused, right email (any case) finds it → cancel; tampered link shows nothing; signing up with that email points to forgot-password. Contact form sent; About / Privacy (Arabic, RTL) / Terms linked from the footer; unknown page → 404; offers page lists products; offers and pages in the sitemap; tracking page `noindex` |
| `account` | sign-up with password rules → email verification with the real one-time code (wrong code rejected) → verified badge; wrong password message; Qatar address form validation (zone/street/building, local mobile numbers normalised); wishlist → move to cart; support ticket; sign out; forgot password → reset with the code → sign in |
| `mobile` | bottom tab bar, category page in Arabic, filter sheet, add to cart, **no horizontal scrolling** — also on the account pages in both languages |
| `slots` | turns slots on for the test: a required time must be picked before the order goes through, the order page shows it; optional mode offers "As soon as possible" and guests can pick a window |
| `whatsapp` | with a store WhatsApp number the chat button and "ask about this product" open wa.me with a prefilled message; checkout offers WhatsApp updates unticked |
| `dibsy` | (runs when the API uses the Dibsy stand-in) signed-in customer pays with Apple Pay on the Dibsy page and returns to a paid order; a guest whose card is declined sees a clear message and keeps the items in the cart |
| `alerts` | a sold-out product offers "Tell me when it is back": guests sign in first, one tap saves the alert; restocking puts it in the customer's inbox |
| `search` | typo → "Showing results for" + "Search instead for"; Arabic letter forms and the article; nothing found → popular searches and best sellers; the empty search box offers popular and recent searches (and clears them) |
| `reviews-qa` | photos picked, one removed, sent (stored as WebP) → published → "Customer photos" opens full size, "With photos" filter; a question (too short refused) stays private until answered, then shows on the product and as "Answered" in the account |
| `cod` | the customer's order shows the delivery code with what to do with it, then "Khalid is on the way" with a map link once the driver shares the location; the code disappears after delivery; Arabic page; with a QAR 50 cash limit, cash on delivery is greyed out with the reason and card is chosen |
| `two-step` | staff/customer with two-step sign-in: code step after the password, wrong code message, recovery code works once, Arabic RTL, lockout message with the minutes left |
| `missed-delivery` | a missed delivery shows "We missed you" with the reason; the customer picks a new time and a note; from the guest link (Arabic) a note; a refused order says it goes back, nothing to rearrange |
| `documents-privacy` | order page: invoice download, and after a paid refund the credit note (number shown, file named after it); download my data; delete my account (wrong password refused) → signed out → signing in shows the date → "Keep my account"; Arabic: an open order blocks deletion with the reason |
| `phase23` | "Continue with Google" (Google's script stood in for, tokens signed by the test against a key server it runs on port 47824 — start the API with `GOOGLE_CLIENT_IDS=e2e-web.apps.googleusercontent.com GOOGLE_JWKS_URL=http://127.0.0.1:47824/certs`, otherwise the test is skipped) creates the account; the account page lists Google and asks to set a password; signing in again in Arabic; Buy again → "2 items added to your cart"; while the driver is on the way the order shows "Arriving around …" (EN + AR); Notifications on this browser switched on and off (the browser's push subscription stood in for; needs VAPID keys on the API) |
| `seo` | category page: its own title (EN + AR), the intro text and a question that opens, FAQ and ItemList data; brand page reached from a product and from a search for the brand; the search box shows photo and price and "See all results"; Google feed, image sitemap, brand sitemap and the Search Console code in the page |
| `analytics` | a visit from a tagged Instagram link → cart → guest order: one visit, cart, purchase and order under that source in the staff report |
| `a11y` | axe-core WCAG 2.1 AA on 15 pages (both languages, including guest checkout, tracking, contact, offers and a content page): no serious or critical violations |

The suite creates a fresh customer per run, so it can be repeated on the same database.

## Required edge cases → where they are tested

| Edge case | Integration | Unit |
|---|---|---|
| Two sellers in one cart | flow 5–6, 9 | `phase6-pricing`, `phase7-checkout` |
| Seller cancellation | edge (COD partial) | `phase7-orders` (status machine, derived status) |
| Partial refund | flow 10 | `phase8-finance` (refund maths, unit-by-unit returns) |
| Full refund | edge (late payment) | `phase8-finance` (full refund incl. FastMoveX-funded promo claw-back) |
| Failed payment | edge, dibsy | `phase7-checkout` |
| Duplicate payment request | flow 6 (idempotency key), edge (webhook replay) | `phase7-orders` (ledger idempotency) |
| Out-of-stock product | edge, flow 5 | `phase6-cart`, `phase7-checkout` (sold out during checkout rolls back) |
| Price changed after cart creation | edge | `phase6-cart` |
| Coupon abuse | edge, flow 5 | `phase6-pricing` (limits, first order, new customer, per user, expiry) |
| Forged / lost payment webhook | dibsy (forged, replay, lost, mismatch) | `phase15-dibsy` (lookup instead of trust, id checks, amounts) |
| Guest access to orders | guest (token, lookup, account claim) | `phase14` (token forgery, secret rotation) |
| Unauthorized admin access | flow 8, 11–12, edge, guest | `guards.spec`, `app.e2e.spec`, `phase10` (role guard rails) |
| Seller accessing another seller's data | flow 8, 10 | `phase4-services`, `phase7-checkout`, `phase8-finance` |

Other notable unit coverage: token rotation and reuse detection, argon2 and timing-safe login, OTP limits,
production-config guard, file-type sniffing, IBAN validation and encryption, category tree rules, search SQL
builder (injection safety, index-friendly modes, fallback decision), commission rule precedence, money allocation,
VAT inclusive/exclusive, ledger balancing, release windows, payout four-eyes, delivery code checks, market time
zones, export formula-injection guard, notification channel selection and retry/backoff. Phase 17: Arabic
normalisation, synonym tsquery building (injection-safe), search settings, log privacy filter, spelling (edit distance,
vocabulary, decision when to correct), traffic source classification, device and landing-page rules, session batching,
warehouse choice, driver run order and map links, WhatsApp alert templates.

## CI

`.github/workflows/api.yml`:

1. `npm ci`, `prisma generate`, type-check
2. unit + API tests
3. production build
4. PostgreSQL 16 (UTF8) + MinIO service containers → `prisma migrate deploy` → base + demo seed → integration tests
5. Docker image build

`.github/workflows/web.yml` (website) and `.github/workflows/admin.yml` (admin panel): each starts the API on a real
Postgres + MinIO with the base and demo seed, then type-check, unit tests, production build, Playwright browser tests
(report uploaded on failure), and the Docker image.

A pull request cannot be merged green if migrations fail on a real database or any money flow breaks.

## Writing new tests

- Pure logic (pricing, commission, ledger entries, status machines) → a unit test next to the existing ones; no mocks needed.
- Anything that touches SQL written by hand (search, analytics, locks, raw updates) → **also** add an integration assertion. Mocked tests cannot catch SQL errors; the integration suite found nine such bugs before release.
- Money assertions use exact minor-unit values and finish with "ledger total is zero".
