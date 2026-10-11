-- WhatsApp order updates (opt-in) and abandoned-cart reminders.

ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP';

ALTER TABLE "User" ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
                   ADD COLUMN "whatsappOptInAt" TIMESTAMP(3);

ALTER TABLE "Country" ADD COLUMN "cartReminders" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Cart" ADD COLUMN "itemsChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0,
                   ADD COLUMN "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_remindersSent_check" CHECK ("remindersSent" >= 0);
CREATE INDEX "Cart_itemsChangedAt_idx" ON "Cart"("itemsChangedAt");

ALTER TABLE "Order" ADD COLUMN "cartReminderAt" TIMESTAMP(3);

-- Adding or changing an item is new shopping activity: the reminder clock starts again.
CREATE OR REPLACE FUNCTION cart_items_changed() RETURNS trigger AS $$
BEGIN
  UPDATE "Cart" SET "itemsChangedAt" = now(), "remindersSent" = 0 WHERE "id" = NEW."cartId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CartItem_changed"
  AFTER INSERT OR UPDATE OF "quantity" ON "CartItem"
  FOR EACH ROW EXECUTE FUNCTION cart_items_changed();
