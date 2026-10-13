-- The working name JOVIA becomes FastMoveX everywhere it was still used inside the database.
-- Renames keep every object's identity, so triggers, indexes and the search column keep working unchanged.

-- 1) Codes stored with orders, deliveries and campaigns
ALTER TYPE "DeliveryMethod" RENAME VALUE 'JOVIA' TO 'FASTMOVEX';
ALTER TYPE "CampaignType" RENAME VALUE 'JOVIA_EXCLUSIVE' TO 'FASTMOVEX_EXCLUSIVE';
UPDATE "DeliveryOrder" SET "providerCode" = 'fastmovex_fleet' WHERE "providerCode" = 'jovia_fleet';
UPDATE "Country" SET "deliveryProviders" = array_replace("deliveryProviders", 'jovia_fleet', 'fastmovex_fleet') WHERE 'jovia_fleet' = ANY("deliveryProviders");
UPDATE "HomeSection" SET "key" = 'fastmovex_exclusive' WHERE "key" = 'jovia_exclusive';

-- 2) Demo and system accounts (the demo shop of a test server, and the house store's system user)
UPDATE "User" SET "email" = replace("email", '@demo.jovia.test', '@demo.fastmovex.test') WHERE "email" LIKE '%@demo.jovia.test';
UPDATE "User" SET "email" = replace("email", '@system.jovia.invalid', '@system.fastmovex.invalid') WHERE "email" LIKE '%@system.jovia.invalid';
UPDATE "User" SET "email" = replace("email", '@jovia.test', '@fastmovex.test') WHERE "email" LIKE '%@jovia.test';
UPDATE "Seller" SET "contactEmail" = replace("contactEmail", '@demo.jovia.test', '@demo.fastmovex.test') WHERE "contactEmail" LIKE '%@demo.jovia.test';
UPDATE "Supplier" SET "email" = replace("email", '@demo.jovia.test', '@demo.fastmovex.test') WHERE "email" LIKE '%@demo.jovia.test';

-- 3) Database functions, their bodies, triggers and the credit-note number sequence
ALTER SEQUENCE IF EXISTS "jovia_credit_note_seq" RENAME TO "fastmovex_credit_note_seq";
DO $$
DECLARE r record;
BEGIN
  -- functions named jovia_… (triggers and indexes point at them by identity, so nothing else changes)
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname LIKE 'jovia\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %I(%s) RENAME TO %I', r.proname, r.args, 'fastmovex_' || substr(r.proname, 7));
  END LOOP;
  -- bodies that still say jovia (the sequence, the stock-sync flag): rewritten in place (same function, same triggers)
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.prosrc LIKE '%jovia%'
  LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), 'jovia', 'fastmovex');
  END LOOP;
  -- triggers named jovia_…
  FOR r IN
    SELECT t.tgname, t.tgrelid::regclass AS tbl
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND NOT t.tgisinternal AND t.tgname LIKE 'jovia\_%'
  LOOP
    EXECUTE format('ALTER TRIGGER %I ON %s RENAME TO %I', r.tgname, r.tbl, 'fastmovex_' || substr(r.tgname, 7));
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND (p.proname LIKE 'jovia%' OR p.prosrc LIKE '%jovia%')) THEN
    RAISE EXCEPTION 'Some database functions still use the old name';
  END IF;
END $$;
