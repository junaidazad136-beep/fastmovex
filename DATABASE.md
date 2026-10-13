# Database

PostgreSQL 16+, managed through Prisma. **82 tables, 35 enums**, eighteen migrations.
Schema: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).

## Hard requirements

| Requirement | Why | Enforced by |
|---|---|---|
| Database encoding **UTF8** (ctype `C.UTF-8` or `en_US.UTF-8`) | Arabic product names, search and trigram matching | The first migration aborts with a clear message otherwise |
| Timestamps in **UTC** | Reports, "today" in Doha, retry timers | The API sets `TimeZone=UTC` on every connection; the migration sets the database default |
| Extension `pg_trgm` | Typo-tolerant search | Created by the migration (available on every managed Postgres) |

## Money rules

- Every amount is a `BIGINT` in **minor units**: `26110` = QAR 261.10. Currencies with 3 decimals (KWD, BHD, OMR) use 1/1000 (`Currency.minorUnits`).
- Rates are **basis points**: `1000` = 10%.
- The API sends money as **strings** (`"26110"`) because JSON numbers cannot hold every 64-bit integer safely.
- All arithmetic is integer: discounts are split with a largest-remainder allocation so per-line amounts always add up to the exact total; percentages round half-up (commission, VAT) or down (discounts).
- No floating point anywhere in the money path.

## Tables by domain

| Domain | Tables |
|---|---|
| Markets | `Currency`, `Country` (currency, VAT rate, prices-include-VAT, payment methods, delivery providers, delivery pricing, address format, legal settings, guest checkout on/off, active flag) |
| Identity & access | `User` (`isGuest`: a shopper who ordered without an account — no password, cannot sign in), `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshToken` (hashed, rotating families; `mfa` = signed in with the second step), `LoginEvent` (every sign-in attempt: result, method, device, IP, new device), `VerificationCode` (HMAC of one-time codes), `AuditLog` |
| Sellers | `Seller` (status, CR number, encrypted IBAN), `SellerDocument` (private files), `Store` (public storefront, location, rating) |
| Catalogue | `Category` (tree via materialized `path`), `Brand`, `Product` (generated `searchVector`), `ProductVariant`, `ProductImage`, `Inventory` (the shop's total: on hand = sum of the warehouses, reserved, version), `InventoryMovement` (with warehouse), `RecentlyViewed` |
| Warehouses | `Warehouse` (per seller, zones it is nearest to, priority, default), `WarehouseStock` (units per warehouse), `StockTransfer`, `StockTransferItem`, `StockLot` (dated part of a shelf: batch, expiry date, units) |
| Stock control | `StockCount` + `StockCountLine` (stocktake: expected vs counted, submitter ≠ approver), `Supplier`, `PurchaseOrder` + `PurchaseOrderLine` (ordered, received, unit cost), `GoodsReceipt` + `GoodsReceiptLine` (what arrived, batch, expiry — write-once) |
| Shopping | `Cart` (one per user per market, or guest token; reminder clock and count), `CartItem` (price snapshot for change detection), `Address` |
| Orders | `Order` (what the customer sees), `SellerOrder` (one shipment per seller), `OrderItem` (price, discount, VAT, commission + rule snapshot), `OrderStatusHistory` |
| Payments | `Payment` (provider reference only — never card data), `WebhookEvent` (replay protection), `Refund` (`creditNoteNo` / `creditNoteAt` set by the database when paid), `ReturnRequest` (`receivedAt` for the return receipt), `PaymentSettlement` (each gateway settlement file matched: rows, matched, differ, missing, extra) |
| Commission & money | `CommissionRule`, `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`, `SellerPayout` |
| Marketing | `Coupon`, `CouponRedemption`, `Campaign`, `CampaignProduct` (deal price + quota), `Banner` |
| Engagement | `Review` (photos as WebP keys), `ProductQuestion`, `Wishlist`, `WishlistItem`, `Notification` (outbox + in-app inbox), `DeviceToken`, `SupportTicket`, `TicketMessage`, `FaqEntry` |
| Insights | `SearchLog` (counts per day and search text), `AnalyticsSession` (anonymous visits and how far they got) |
| Content | `Page` (About / Privacy / Terms and others, EN + AR text, published, footer order), `ContactMessage` (Contact form inbox: status NEW / HANDLED / SPAM, staff note), `HomeSection` (the home page order per market; no rows = the standard page) |
| Delivery | `DeliverySlotUsage` (places taken per delivery window), `DeliveryOrder` (method, provider, courier, ETA, location, code, proof, staff override + reason), `DeliveryEvent` |
| Staff notes | `CustomerNote` (staff-only note about a customer; one pinned per customer, shown on their orders), `OrderNote` (staff note on an order); `User.tags` (VIP, RISKY… — GIN index), `User.alertPrefs` (staff alert choices) |
| Order changes & returns logistics | `OrderChange` (every change after checkout: items, address, window, refused at the door — who, why, before/after, amount; a trigger refuses any update), `DoorReturn` (units refused at the door: with the driver until booked back in), `ReturnPickup` (a driver collects an approved return; enum `PickupStatus`); `Order.placedById` (phone orders), `User.refundLimitMinor` |
| Search engines | `Category` / `Brand` intro text, Google title & description (EN + AR), category questions (`faq`); `Country.seoSettings` (verification codes, social links, product feed on/off) |
| Sign-in & browser push | `SocialAccount` (a Google or Apple identity linked to a customer: provider + the provider's user id, unique together; email; last used), `WebPushSubscription` (one per browser that agreed to notifications: https endpoint (unique), its encryption keys, failure count) |
| Cash on delivery | `CodCollection` (cash taken for one shipment and who holds it), `CashHandover` (cashier counts it: expected, received, variance, note); `User.codBlocked / codBlockedReason / codRefusals`, `Country.codRules` |

### Order model

```
Order (customer's single order, one payment)
 ├── SellerOrder  (Doha Gadgets Hub)  status, delivery fee, commission, seller net
 │     ├── OrderItem  ×n              unit price, qty, discount share, VAT, commission snapshot
 │     └── DeliveryOrder              seller delivery / FastMoveX fleet / 3PL
 └── SellerOrder  (Pearl Home Living)
       └── ...
```

The customer-facing order status is derived from its shipments (the least advanced live shipment; `CANCELLED`
only when every shipment is cancelled).

## The ledger

Balances are **never stored**. Each is `SUM(LedgerEntry.amountMinor)` for an account.

- **Accounts** (`LedgerAccountType`): `CUSTOMER_CLEARING` (cash in/out), `SELLER_PENDING` (earned, inside the return window), `SELLER_AVAILABLE` (withdrawable), `SELLER_PAID`, `PLATFORM_REVENUE` (FastMoveX commission), `PLATFORM_DISCOUNT` (FastMoveX-funded promotions), `DELIVERY_REVENUE`, `TAX_PAYABLE`, `REFUND_PAYABLE` (money for an order that no longer exists).
- **Sign**: `+` = credited to (owed to / earned by) the account, `−` = debit.
- **Immutable**: database triggers reject any `UPDATE`/`DELETE` on `LedgerEntry` and `LedgerTransaction`.
- **Balanced**: a deferred constraint trigger rejects any transaction whose entries do not sum to zero.
- **Idempotent**: each transaction has a unique `idempotencyKey` (`order_captured_<id>`, `release_<sellerOrderId>`, `refund_<id>`, `payout_<id>`, `late_payment_<paymentId>`), so a webhook retry or a re-run job never posts twice.

### Transaction types

| Type | When | Entries |
|---|---|---|
| `ORDER_CAPTURED` | card captured, or cash on delivery collected | clearing −total; each seller pending +(net + FastMoveX promo reimbursement); revenue +commission; tax payable +VAT added on top; promo expense −FastMoveX-funded discount |
| `SELLER_RELEASE` | hourly job, after the return window (longest of seller default and product policy), no open return | seller pending −X, seller available +X |
| `REFUND` | refund succeeded | reverses the capture proportionally: clearing +R; seller (pending or available) −share; revenue −commission share; tax −VAT share; promo +reimbursement share |
| `PAYOUT` | finance marks a bank transfer as paid | seller available −X, seller paid +X |
| `LATE_PAYMENT` | gateway confirms money for an order that had already expired | clearing −X, refund payable +X (a refund is created automatically; paying it reverses this) |

### Worked example (from the integration test)

A customer buys 2 mugs at QAR 100 from a new seller and a power bank at a QAR 79 flash-deal price from
Doha Gadgets Hub (QAR 10 delivery), with the FastMoveX-funded `WELCOME10` coupon (10%, split 20.00 / 7.90).
Commission: 10% Qatar default. The customer pays **QAR 261.10**.

| Account | Amount | Why |
|---|---:|---|
| Customer clearing | −261.10 | money received |
| Mug seller — pending | +180.00 | 200.00 − 20.00 commission (the 20.00 coupon share is reimbursed by FastMoveX) |
| Doha Gadgets Hub — pending | +81.10 | 79.00 + 10.00 delivery − 7.90 commission |
| FastMoveX revenue | +27.90 | commission |
| FastMoveX promotions | −27.90 | cost of the coupon |
| **Total** | **0.00** | |

Commission base: a **FastMoveX-funded** discount does not reduce it (FastMoveX pays the discount and the seller receives
price minus commission as if there were no coupon); a **seller-funded** discount does (the seller chose to give it).

## Migrations

```
prisma/migrations/
├── 20260928000000_init/                    generated by Prisma from schema.prisma (+ UTF8 check)
├── 20260928000100_ledger_search_guards/    rules Prisma cannot express (below)
├── 20260930000000_admin_catalog/           FastMoveX's own store + product fields for the admin panel (below)
├── 20261001000000_guest_home_content/      guest checkout, content pages, contact inbox, home layout (below)
├── 20261002000000_delivery_slots/          delivery time windows and their capacity (below)
├── 20261002010000_whatsapp_cart_reminders/ WhatsApp consent and channel, abandoned-cart reminders (below)
├── 20261003000000_search_insights/         Arabic-aware search, search log, search settings (below)
├── 20261003010000_product_questions/       product questions and answers (below)
├── 20261003020000_traffic_analytics/       anonymous visit sessions, order source (below)
├── 20261003030000_warehouses/              warehouses, per-warehouse stock, transfers (below)
├── 20261004000000_cash_fraud_controls/     COD cash handover, delivery override, refund approver, return inspection (below)
├── 20261005000000_security_delivery_stock_payments/  staff 2FA + sign-in history, failed-delivery proof, lots, stocktake, purchasing, settlements (below)
├── 20261006000000_documents_privacy/       credit-note numbers, return received time, account deletion (below)
├── 20261007000000_insights_notes_alerts/   cost on order lines, live map, customer/order notes, staff alerts (below)
├── 20261008000000_order_changes_pickups/   order change history, items refused at the door, return pickups (below)
├── 20261009000000_social_push/             Google / Apple sign-in links, browser notification subscriptions (below)
├── 20261010000000_seo_content/             category & brand text for search engines, market SEO settings (below)
├── 20261011000000_storefront_look/        banner text drawn by the website (badge, headline, line, button; EN + AR)
└── migration_lock.toml
```

The second migration adds:

- `pg_trgm`, the generated `Product.searchVector` column (title EN + AR weighted A, description C) and GIN indexes (full-text + trigram on titles, category and brand names);
- search tuning (`pg_trgm.word_similarity_threshold = 0.45`) and UTC as database defaults;
- ledger immutability triggers and the balanced-transaction constraint trigger;
- CHECK constraints: stock never negative and reserved ≤ on hand, quantities > 0, refunded ≤ bought, prices ≥ 0, rating 1–5, refunds ≤ payment, payout > 0, commission rate 0–100%;
- partial unique indexes: one default address and one default wishlist per user, one platform ledger account per type and currency;
- sort/filter indexes for search, home rails and nearby stores.

The third migration (admin panel, single-merchant launch) adds:

- `Seller.isHouse` with a partial unique index (exactly one "house" seller: FastMoveX's own store);
- product fields `shortDescription(Ar)`, `tags` (lowercase keywords, GIN index), `seoTitle`, `seoDescription`;
- variant fields `barcode` (indexed), `costPriceMinor` (private, CHECK ≥ 0), `lengthMm` / `widthMm` / `heightMm` (CHECK > 0).

The fourth migration (guest checkout and content) adds:

- `User.isGuest` (with an index on guest emails for order lookup) and `Country.guestCheckout` (default on);
- tables `Page` (unique `slug`), `ContactMessage` (+ enum `ContactStatus`), `HomeSection` with a partial unique index
  so each standard section appears at most once per market (collections may repeat).

The fifth migration (delivery slots) adds `Country.deliverySlots` (JSON settings), `Order.deliverySlotStart/End`
(+ index, CHECK end > start) and the `DeliverySlotUsage` table (places taken per market and window start, CHECK
`booked >= 0`). Checkout takes a place with `UPDATE … SET booked = booked + 1 WHERE booked < capacity` inside the order
transaction; a trigger on `Order.status` gives the place back when an order becomes `CANCELLED`, whichever code path
cancels it.

The sixth migration adds the `WHATSAPP` notification channel, `User.whatsappOptIn` (+ when), `Country.cartReminders`,
`Cart.itemsChangedAt` / `remindersSent` / `lastReminderAt` (a trigger on `CartItem` insert / quantity change restarts the
reminder clock) and `Order.cartReminderAt` (set when the customer had been reminded within 7 days — the order is credited
to the reminder).

The seventh migration (search) adds the immutable SQL function `fastmovex_search_norm()` (Arabic alef forms → ا, ة → ه,
ى → ي, harakat and tatweel removed, the article "ال" dropped from the front of words), regenerates
`Product.searchVector` with it and indexes `fastmovex_search_norm("titleAr")` for typo matching; the API applies the same
rules to what is typed (`search-text.ts`, unit-tested against the SQL). It also adds `SearchLog` (one row per market,
day and search text: searches, distinct visitors, found-nothing count, spelling corrections — no user ids) and
`Country.searchSettings` (pinned / hidden popular searches, synonym groups).

The eighth adds `ProductQuestion` (+ enum `QuestionStatus`): shown only once answered (CHECK: an answered question has
its answer and time), cascades with the product.

The ninth adds `AnalyticsSession` — one row per anonymous browsing session (random id made in the browser; no cookie,
user id or IP): source / medium / campaign, landing section, device type, page and product views, and whether it
reached the cart, checkout and an order — kept 13 months — and `Order.trafficSource / trafficMedium / trafficCampaign`.

The tenth (warehouses) adds `Warehouse` (per seller; code unique per seller; one default per seller via a partial
unique index; the default must stay open), `WarehouseStock` (CHECK `onHand >= 0`), `StockTransfer` + items (CHECK two
different warehouses, quantity > 0), `SellerOrder.warehouseId`, `InventoryMovement.warehouseId` and the movement
reasons `TRANSFER_OUT` / `TRANSFER_IN`. Existing stock was moved into a "Main warehouse" per seller. Two triggers keep
the books straight: changes to `WarehouseStock` add the same difference to `Inventory.onHand`, and any other change of
`Inventory.onHand` (or an insert with stock) is refused — so the shop's total is always the sum of the shelves.

The eleventh (cash and fraud controls) adds `CodCollection` (one per shipment, CHECK amount ≥ 0) and `CashHandover`
(CHECK `variance = received − expected`, CHECK holder ≠ receiver — nobody receives their own cash). Triggers make the
money records write-once: a collection's amount, holder and shipment never change, once handed over it stays with that
handover, and neither can be deleted; a handover can never be changed or deleted. It also adds `User.codBlocked`,
`codBlockedReason`, `codRefusals`, `Country.codRules` (JSON), `Refund.approvedById`, `DeliveryOrder.overrideById` /
`overrideReason`, the enum `ReturnCondition` with `ReturnRequest.condition / inspectionNote / receivedById`, and the
permissions `cash.read`, `cash.receive`, `delivery.override` (granted to Super Admin and Admin; finance gets cash,
operations and order managers may look at cash).

The twelfth (security, delivery proof, stock control, payments) adds:

- staff security: `User.twoFactorSecret` / `twoFactorPendingSecret` (AES-256-GCM encrypted), `twoFactorEnabledAt`,
  `twoFactorRecovery` (hashes of the one-time recovery codes), `twoFactorLastStep` (a code is never accepted twice),
  `failedLogins` / `failedLoginAt` / `lockedUntil`, `RefreshToken.mfa`, and the `LoginEvent` table;
- failed-delivery proof on `DeliveryOrder`: `failedAt`, `failureLat` / `failureLng`, `failureDistanceM` (from the
  address pin), `failurePhotoKey` (private file), `customerRequest` / `customerRequestAt` (new time or note);
- stock: movement reasons `DAMAGED`, `EXPIRED`, `LOST`, `FOUND`, `COUNT`; `Product.tracksExpiry`; `StockLot` with a
  deferred constraint trigger — the dated units of a shelf can never add up to more than the shelf; `StockCount` /
  `StockCountLine` (enum `StockCountStatus`, CHECK approver ≠ submitter); `Supplier`, `PurchaseOrder` (enum
  `PurchaseOrderStatus`), `PurchaseOrderLine` (CHECK `receivedQty ≤ quantity`), `GoodsReceipt` / `GoodsReceiptLine`
  (triggers: never updated or deleted);
- `PaymentSettlement`;
- permissions `inventory.approve`, `purchasing.manage`, `purchasing.receive`, `payments.reconcile` (Super Admin and
  Admin: all four; Finance: reconcile; Operations: approve stock and purchasing; Inventory manager: receive goods).

The thirteenth (documents and privacy) adds `Refund.creditNoteNo` (unique) and `creditNoteAt` with the sequence
`fastmovex_credit_note_seq` and a trigger: the moment a refund becomes `SUCCEEDED` it gets `CN-<country>-<YYMMDD Qatar>-<6
digits>`; the number and date can never change, and only a successful refund can have one (existing paid refunds were
numbered in payment order). It adds `ReturnRequest.receivedAt`, `User.deletionRequestedAt` / `deletionScheduledFor`
(CHECK: both or neither, indexed) / `deletionReason`, and an index on `WarehouseStock(warehouseId, bin)` for picking.

The fourteenth (insights, notes and alerts) adds `OrderItem.unitCostMinor` (CHECK ≥ 0) with a `BEFORE INSERT`
trigger `fastmovex_item_cost` that copies the variant's cost price onto every new order line — whichever checkout path
created it — so the margin report always uses the cost at the moment of the sale (existing lines were backfilled from
today's cost); `DeliveryOrder.lastLocationAt` (+ index on courier, time) for the live map; `Inventory.lowStockAlertedAt`
(low-stock alert sent; cleared when restocked above the level); `User.tags` (text array, GIN index) and
`User.alertPrefs` (JSON); the `CustomerNote` and `OrderNote` tables (CHECK: body not blank; notes about a person are
deleted with the account); and the permission `reports.margin` (Super Admin, Admin, Finance).

The fifteenth (order changes and return logistics) adds `OrderChange` (CHECKs on kind, role and a non-negative amount;
`BEFORE UPDATE` trigger `fastmovex_order_change_immutable`: the history can never be edited), `DoorReturn` (CHECK quantity
> 0; received time, person and condition are all set together or not at all), `ReturnPickup` (one per return, enum
`PickupStatus`; CHECK: collected ⇔ `collectedAt`), `Order.placedById` (FK, phone orders), `User.refundLimitMinor`
(CHECK ≥ 0) and the permission `orders.create` (Super Admin, Admin, Operations, Order manager, Support). Removed order
lines are kept with status `CANCELLED` (quantity unchanged, CHECK `quantity > 0` still holds).

The sixteenth (sign-in and browser notifications) adds `SocialAccount` (CHECK provider is `GOOGLE` or `APPLE`; unique
provider + subject; deleted with the user) and `WebPushSubscription` (CHECK endpoint starts with `https://`; unique
endpoint — a browser belongs to whoever is signed in there now; deleted with the user), and lets `OrderChange.kind` be
`ADDED` (staff added an item before dispatch; `amountMinor` is then how much the total went up). Account deletion
removes both new kinds of rows. `User.passwordHash` was already optional: an account made with Google / Apple has none
until the customer sets one with "Forgot password".

The seventeenth (search-engine content) adds to `Category` an intro text, own Google title and description in both
languages and `faq` (JSON array of `{ q, qAr, a, aAr }`, CHECK: an array of at most 20; length CHECKs on the texts:
title ≤ 70, description ≤ 170, intro ≤ 5000); to `Brand` `nameAr` and the same texts (no FAQ); and to `Country`
`seoSettings` (JSON object: Search Console / Bing codes, social profile links, product feed on/off).

### Workflow

| Situation | Command |
|---|---|
| Changed `schema.prisma` locally | `npx prisma migrate dev --name <change>` — creates a new folder; commit it |
| Deploy (CI / release step) | `npx prisma migrate deploy` — applies pending migrations only, never resets |
| Check what is applied | `npx prisma migrate status` |

Never edit a migration that has been applied in production; add a new one. Raw SQL (triggers, partial indexes)
goes in a migration created with `npx prisma migrate dev --create-only` and edited before applying.

## Seeding

| Command | What | Where |
|---|---|---|
| `npm run db:seed` | Currencies (QAR, AED, SAR, KWD, BHD, OMR, PKR, USD, EUR), countries (QA active; AE, SA, PK prepared but inactive), 11 roles, 40 permissions, FastMoveX's own store (0% commission, owner account that cannot sign in), 23 bilingual categories, Qatar 10% default commission, Qatar delivery pricing (QAR 10, free from QAR 100), platform ledger accounts, first super admin from env, starting **About / Privacy / Terms** pages in English and Arabic (created once, never overwritten — edit them in the admin panel; the legal texts are templates to be reviewed by a lawyer in Qatar) | every environment, including production (idempotent) |
| `npm run db:seed:demo` | demo staff, customer, courier, 3 approved sellers with stores, 24 products / 34 variants with images, flash-deal campaign, 3 coupons, banners, FAQ | development and staging only (refuses in production) |

All seed values (commission, delivery fee, VAT) are starting points that admins change from the admin panel.

## Indexes & performance

- Search uses the GIN indexes in two modes: *all words* (full-text only — the fast common path) and, when that finds fewer than 10 products, *any word + trigram* (typos, partial words). Measured on 50,000 products: most queries 10–100 ms, rare fuzzy queries ≈ 200 ms, category/price filters ≈ 30 ms.
- Listing endpoints use keyset (cursor) pagination on `(createdAt, id)`; search uses page numbers capped at 1,000 results.
- Product cards for any list are loaded in one query (no N+1).
- Beyond ~500k products, switch the `SearchEngine` provider to Typesense/Meilisearch (one class; see `src/search/search.types.ts`).

## Backups

Use your provider's point-in-time recovery (7+ days). Before every release that includes a migration, take a
manual snapshot. Back up `FIELD_ENCRYPTION_KEY` separately from the database — a database backup without that key
cannot restore seller bank details.
