-- Phase 18: cash on delivery is counted and handed over, staff cannot skip the delivery code without a recorded reason,
-- refunds need a second person, fake COD orders are held back, and returns are inspected before going back on the shelf.

-- Returns: what staff found when the item came back
CREATE TYPE "ReturnCondition" AS ENUM ('SELLABLE', 'DAMAGED', 'NOT_ACCEPTED');
ALTER TABLE "ReturnRequest" ADD COLUMN "condition" "ReturnCondition",
  ADD COLUMN "inspectionNote" TEXT,
  ADD COLUMN "receivedById" UUID;

-- Customers: cash-on-delivery block and refusals at the door
ALTER TABLE "User" ADD COLUMN "codBlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "codBlockedReason" TEXT,
  ADD COLUMN "codRefusals" INTEGER NOT NULL DEFAULT 0;

-- Market rules for cash on delivery (see src/cash/cod-rules.ts)
ALTER TABLE "Country" ADD COLUMN "codRules" JSONB NOT NULL DEFAULT '{}';

-- Refunds: who approved (never the person who created it, except a super admin)
ALTER TABLE "Refund" ADD COLUMN "approvedById" UUID;

-- Deliveries: staff override of the customer's code is recorded
ALTER TABLE "DeliveryOrder" ADD COLUMN "overrideById" UUID,
  ADD COLUMN "overrideReason" TEXT;

-- Cash taken at the door, per shipment, and who holds it
CREATE TABLE "CodCollection" (
  "id" UUID NOT NULL,
  "sellerOrderId" UUID NOT NULL,
  "holderUserId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "handoverId" UUID,
  CONSTRAINT "CodCollection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CodCollection_amount_check" CHECK ("amountMinor" >= 0)
);
CREATE UNIQUE INDEX "CodCollection_sellerOrderId_key" ON "CodCollection"("sellerOrderId");
CREATE INDEX "CodCollection_holderUserId_handoverId_idx" ON "CodCollection"("holderUserId", "handoverId");
CREATE INDEX "CodCollection_collectedAt_idx" ON "CodCollection"("collectedAt");

-- A handover: counted cash vs expected
CREATE TABLE "CashHandover" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "holderUserId" UUID NOT NULL,
  "receivedById" UUID NOT NULL,
  "expectedMinor" BIGINT NOT NULL,
  "receivedMinor" BIGINT NOT NULL,
  "varianceMinor" BIGINT NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashHandover_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashHandover_amounts_check" CHECK ("expectedMinor" >= 0 AND "receivedMinor" >= 0 AND "varianceMinor" = "receivedMinor" - "expectedMinor"),
  -- nobody receives their own cash
  CONSTRAINT "CashHandover_two_people_check" CHECK ("holderUserId" <> "receivedById")
);
CREATE UNIQUE INDEX "CashHandover_number_key" ON "CashHandover"("number");
CREATE INDEX "CashHandover_holderUserId_createdAt_idx" ON "CashHandover"("holderUserId", "createdAt" DESC);
CREATE INDEX "CashHandover_createdAt_idx" ON "CashHandover"("createdAt");

ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "CashHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money records are written once: a collection keeps its amount and holder, and once handed over it stays with that
-- handover; a handover is never edited or deleted (mistakes are corrected by a new handover, visible in the history).
CREATE OR REPLACE FUNCTION jovia_cod_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cash collections cannot be deleted'; END IF;
  IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."holderUserId" <> OLD."holderUserId" OR NEW."sellerOrderId" <> OLD."sellerOrderId" THEN
    RAISE EXCEPTION 'A cash collection cannot be changed';
  END IF;
  IF OLD."handoverId" IS NOT NULL AND NEW."handoverId" IS DISTINCT FROM OLD."handoverId" THEN
    RAISE EXCEPTION 'This cash was already handed over';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CodCollection_guard" BEFORE UPDATE OR DELETE ON "CodCollection" FOR EACH ROW EXECUTE FUNCTION jovia_cod_collection_guard();

CREATE OR REPLACE FUNCTION jovia_cash_handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cash handovers cannot be changed or deleted';
END $$;
CREATE TRIGGER "CashHandover_guard" BEFORE UPDATE OR DELETE ON "CashHandover" FOR EACH ROW EXECUTE FUNCTION jovia_cash_handover_guard();

-- New permissions (the seed keeps them in sync too)
INSERT INTO "Permission" ("id", "code", "group") VALUES
  (gen_random_uuid(), 'cash.read', 'cash'),
  (gen_random_uuid(), 'cash.receive', 'cash'),
  (gen_random_uuid(), 'delivery.override', 'control')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r JOIN "Permission" p ON
  (r."code" IN ('SUPER_ADMIN', 'ADMIN') AND p."code" IN ('cash.read', 'cash.receive', 'delivery.override'))
  OR (r."code" = 'FINANCE_ADMIN' AND p."code" IN ('cash.read', 'cash.receive'))
  OR (r."code" IN ('OPERATIONS_ADMIN', 'ORDER_MANAGER') AND p."code" = 'cash.read')
ON CONFLICT DO NOTHING;
