-- JOVIA: database rules Prisma cannot express (ledger immutability, balance check, search, integrity guards).


-- 1) Typo-tolerant + full-text product search (Postgres now, Typesense later)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Typo tolerance: "erbuds" must still find "Earbuds". The pg_trgm default (0.6) is too strict for short queries.
-- Applied as a database default so every pooled connection gets it (needs the database owner, which the app user normally is).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.45', current_database());
  -- all timestamps are UTC (the API also pins this per connection)
  EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set database defaults (not the database owner). Search typo tolerance is stricter; the API still forces UTC per connection.';
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("titleAr", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS product_search_gin ON "Product" USING GIN ("searchVector");
CREATE INDEX IF NOT EXISTS product_title_trgm ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_title_ar_trgm ON "Product" USING GIN ("titleAr" gin_trgm_ops);

-- 2) Ledger is append-only: no UPDATE / DELETE ever
CREATE OR REPLACE FUNCTION jovia_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger rows are immutable (table %)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entry_immutable ON "LedgerEntry";
CREATE TRIGGER ledger_entry_immutable BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION jovia_block_mutation();

DROP TRIGGER IF EXISTS ledger_tx_immutable ON "LedgerTransaction";
CREATE TRIGGER ledger_tx_immutable BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION jovia_block_mutation();

-- 3) Every ledger transaction must balance to zero (checked at COMMIT)
CREATE OR REPLACE FUNCTION jovia_check_balanced() RETURNS trigger AS $$
DECLARE s BIGINT;
BEGIN
  SELECT COALESCE(SUM("amountMinor"), 0) INTO s
  FROM "LedgerEntry" WHERE "transactionId" = NEW."transactionId";
  IF s <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % unbalanced: %', NEW."transactionId", s;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_balanced ON "LedgerEntry";
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jovia_check_balanced();

-- 4) Hard guards so bad data can never be written
ALTER TABLE "Inventory"      ADD CONSTRAINT inv_non_negative CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");
ALTER TABLE "CartItem"       ADD CONSTRAINT cart_qty_positive CHECK ("quantity" > 0);
ALTER TABLE "OrderItem"      ADD CONSTRAINT item_qty_positive CHECK ("quantity" > 0 AND "refundedQty" <= "quantity");
ALTER TABLE "ProductVariant" ADD CONSTRAINT price_non_negative CHECK ("priceMinor" >= 0);
ALTER TABLE "Review"         ADD CONSTRAINT rating_range CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "Payment"        ADD CONSTRAINT refund_le_amount CHECK ("refundedMinor" <= "amountMinor");
ALTER TABLE "SellerPayout"   ADD CONSTRAINT payout_positive CHECK ("amountMinor" > 0);
ALTER TABLE "CommissionRule" ADD CONSTRAINT commission_value CHECK (
  ("type" = 'PERCENTAGE' AND "rateBps" BETWEEN 0 AND 10000) OR
  ("type" = 'FIXED' AND "fixedMinor" >= 0)
);

-- 5) Only one default address / wishlist per user
CREATE UNIQUE INDEX IF NOT EXISTS one_default_address ON "Address"("userId") WHERE "isDefault";
CREATE UNIQUE INDEX IF NOT EXISTS one_default_wishlist ON "Wishlist"("userId") WHERE "isDefault";

-- 6) Platform ledger accounts (sellerId NULL) must be unique per type+currency
CREATE UNIQUE INDEX IF NOT EXISTS platform_account_unique
  ON "LedgerAccount"("type", "currencyCode") WHERE "sellerId" IS NULL;

CREATE INDEX IF NOT EXISTS product_country_status_created ON "Product"("countryCode", "status", "createdAt" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS product_country_status_rating ON "Product"("countryCode", "status", "ratingAvg" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS product_featured ON "Product"("countryCode") WHERE "isFeatured" AND "status" = 'ACTIVE' AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS product_sponsored ON "Product"("countryCode", "sponsoredUntil") WHERE "sponsoredUntil" IS NOT NULL;
CREATE INDEX IF NOT EXISTS category_name_trgm ON "Category" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS brand_name_trgm ON "Brand" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS store_geo ON "Store"("lat", "lng") WHERE "lat" IS NOT NULL AND "isActive";
