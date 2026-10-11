-- Delivery time slots: per-market configuration, the window chosen on each order, and capacity per window.

ALTER TABLE "Country" ADD COLUMN "deliverySlots" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Order" ADD COLUMN "deliverySlotStart" TIMESTAMP(3),
                    ADD COLUMN "deliverySlotEnd" TIMESTAMP(3);
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliverySlot_check"
  CHECK (("deliverySlotStart" IS NULL AND "deliverySlotEnd" IS NULL) OR ("deliverySlotEnd" > "deliverySlotStart"));
CREATE INDEX "Order_countryCode_deliverySlotStart_idx" ON "Order"("countryCode", "deliverySlotStart");

CREATE TABLE "DeliverySlotUsage" (
    "countryCode" CHAR(2) NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliverySlotUsage_pkey" PRIMARY KEY ("countryCode", "slotStart"),
    CONSTRAINT "DeliverySlotUsage_booked_check" CHECK ("booked" >= 0)
);

-- A cancelled order gives its window back, whichever code path cancels it (customer, staff, unpaid expiry, failed payment).
CREATE OR REPLACE FUNCTION release_delivery_slot() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' AND OLD."status" <> 'CANCELLED' AND OLD."deliverySlotStart" IS NOT NULL THEN
    UPDATE "DeliverySlotUsage"
       SET "booked" = GREATEST("booked" - 1, 0), "updatedAt" = now()
     WHERE "countryCode" = OLD."countryCode" AND "slotStart" = OLD."deliverySlotStart";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_release_delivery_slot"
  AFTER UPDATE OF "status" ON "Order"
  FOR EACH ROW EXECUTE FUNCTION release_delivery_slot();
