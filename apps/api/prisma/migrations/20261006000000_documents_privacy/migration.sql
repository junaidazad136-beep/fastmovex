-- Phase 20: credit notes, return receipts, account deletion (PDPPL)

-- Refund → credit note number, given by the database the moment a refund succeeds (whichever code path does it)
ALTER TABLE "Refund" ADD COLUMN "creditNoteNo" TEXT, ADD COLUMN "creditNoteAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Refund_creditNoteNo_key" ON "Refund"("creditNoteNo");
CREATE SEQUENCE "jovia_credit_note_seq";

-- existing successful refunds get numbers in the order they were paid
WITH done AS (
  SELECT r.id, o."countryCode" AS cc, coalesce(r."completedAt", r."createdAt") AS at,
         row_number() OVER (ORDER BY coalesce(r."completedAt", r."createdAt"), r.id) AS n
  FROM "Refund" r JOIN "Order" o ON o.id = r."orderId" WHERE r.status = 'SUCCEEDED'
)
UPDATE "Refund" r SET "creditNoteNo" = 'CN-' || done.cc || '-' || to_char(done.at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Qatar', 'YYMMDD') || '-' || lpad(done.n::text, 6, '0'),
                      "creditNoteAt" = done.at
FROM done WHERE done.id = r.id;
SELECT setval('"jovia_credit_note_seq"', greatest((SELECT count(*) FROM "Refund" WHERE "creditNoteNo" IS NOT NULL), 1), (SELECT count(*) > 0 FROM "Refund" WHERE "creditNoteNo" IS NOT NULL));

CREATE OR REPLACE FUNCTION jovia_credit_note() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."creditNoteNo" IS NOT NULL THEN
    IF NEW."creditNoteNo" IS DISTINCT FROM OLD."creditNoteNo" OR NEW."creditNoteAt" IS DISTINCT FROM OLD."creditNoteAt" THEN
      RAISE EXCEPTION 'A credit note number never changes' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'SUCCEEDED' AND NEW."creditNoteNo" IS NULL THEN
    NEW."creditNoteNo" := 'CN-' || (SELECT "countryCode" FROM "Order" WHERE id = NEW."orderId") || '-'
      || to_char(now() AT TIME ZONE 'Asia/Qatar', 'YYMMDD') || '-' || lpad(nextval('"jovia_credit_note_seq"')::text, 6, '0');
    NEW."creditNoteAt" := now();
  ELSIF NEW.status <> 'SUCCEEDED' AND NEW."creditNoteNo" IS NOT NULL THEN
    RAISE EXCEPTION 'Only a successful refund has a credit note' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER jovia_credit_note BEFORE INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION jovia_credit_note();

-- Return received: when (for the return receipt)
ALTER TABLE "ReturnRequest" ADD COLUMN "receivedAt" TIMESTAMP(3);
UPDATE "ReturnRequest" SET "receivedAt" = "updatedAt" WHERE status IN ('RECEIVED', 'REFUNDED') AND "receivedById" IS NOT NULL;

-- Account deletion (Qatar PDPPL): requested → carried out after the waiting period by the daily job
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3), ADD COLUMN "deletionScheduledFor" TIMESTAMP(3), ADD COLUMN "deletionReason" VARCHAR(300);
CREATE INDEX "User_deletionScheduledFor_idx" ON "User"("deletionScheduledFor");
ALTER TABLE "User" ADD CONSTRAINT "User_deletion_pair_check" CHECK (("deletionRequestedAt" IS NULL) = ("deletionScheduledFor" IS NULL));

-- Picking: find a shelf position fast
CREATE INDEX IF NOT EXISTS "WarehouseStock_warehouseId_bin_idx" ON "WarehouseStock"("warehouseId", "bin");
