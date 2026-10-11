-- Phase 17: better search. Arabic-aware matching, spelling suggestions, a search log (what customers look for and
-- do not find), popular searches and staff-managed synonyms.

-- 1) Arabic text normalised the same way on both sides: alef forms → ا, ta marbuta → ه, alef maqsura → ي,
--    harakat and tatweel removed, and the article "ال" dropped from the front of words ("القهوة" → "قهوه").
--    "أحذية" and "الاحذيه" now find each other. The API applies the same rules to queries (search-text.ts).
CREATE OR REPLACE FUNCTION jovia_search_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT regexp_replace(
    translate(regexp_replace(lower(t), '[\u064B-\u065F\u0670\u0640]', '', 'g'), 'أإآٱةى', 'ااااهي'),
    '(^|[^\u0621-\u064Aa-z0-9])ال(?=[\u0621-\u064A]{2})', '\1', 'g') $$;

DROP INDEX IF EXISTS product_search_gin;
ALTER TABLE "Product" DROP COLUMN IF EXISTS "searchVector";
ALTER TABLE "Product" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', jovia_search_norm(coalesce("title", ''))), 'A') ||
    setweight(to_tsvector('simple', jovia_search_norm(coalesce("titleAr", ''))), 'A') ||
    setweight(to_tsvector('simple', jovia_search_norm(coalesce("description", ''))), 'C')
  ) STORED;
CREATE INDEX product_search_gin ON "Product" USING GIN ("searchVector");
DROP INDEX IF EXISTS product_title_ar_trgm;
CREATE INDEX product_title_ar_trgm ON "Product" USING GIN (jovia_search_norm("titleAr") gin_trgm_ops);

-- 2) Search log: one row per market, day and search (counts only — never who searched).
CREATE TABLE "SearchLog" (
  "countryCode" VARCHAR(2) NOT NULL,
  "day" DATE NOT NULL,
  "query" VARCHAR(100) NOT NULL,
  "searches" INTEGER NOT NULL DEFAULT 0,
  "visitors" INTEGER NOT NULL DEFAULT 0,
  "zeroResults" INTEGER NOT NULL DEFAULT 0,
  "corrected" INTEGER NOT NULL DEFAULT 0,
  "lastTotal" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("countryCode", "day", "query")
);
CREATE INDEX "SearchLog_countryCode_day_idx" ON "SearchLog" ("countryCode", "day");

-- 3) Per-market search settings: pinned popular searches, hidden searches, synonyms.
ALTER TABLE "Country" ADD COLUMN "searchSettings" JSONB NOT NULL DEFAULT '{}';
