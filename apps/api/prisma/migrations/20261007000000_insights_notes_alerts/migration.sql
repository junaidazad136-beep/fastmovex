-- Phase 21: driver live map + performance, margin report, customer notes & tags, staff alerts

-- Cost of each unit sold, frozen at the sale (copied from the variant by the database on every insert path)
ALTER TABLE "OrderItem" ADD COLUMN "unitCostMinor" BIGINT;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitCostMinor_check" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0);
-- past sales: the best we know is today's cost
UPDATE "OrderItem" oi SET "unitCostMinor" = v."costPriceMinor" FROM "ProductVariant" v WHERE v.id = oi."variantId" AND oi."unitCostMinor" IS NULL;
CREATE OR REPLACE FUNCTION jovia_item_cost() RETURNS trigger AS $$
BEGIN
  IF NEW."unitCostMinor" IS NULL THEN
    SELECT "costPriceMinor" INTO NEW."unitCostMinor" FROM "ProductVariant" WHERE id = NEW."variantId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER jovia_item_cost BEFORE INSERT ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION jovia_item_cost();

-- When the driver's phone last sent its position
ALTER TABLE "DeliveryOrder" ADD COLUMN "lastLocationAt" TIMESTAMP(3);
CREATE INDEX "DeliveryOrder_courier_location_idx" ON "DeliveryOrder"("courierUserId", "lastLocationAt");

-- Low-stock alert sent (cleared when stock is back above the level)
ALTER TABLE "Inventory" ADD COLUMN "lowStockAlertedAt" TIMESTAMP(3);

-- Customer tags + staff alert preferences
ALTER TABLE "User" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "alertPrefs" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "User_tags_idx" ON "User" USING GIN ("tags");

CREATE TABLE "CustomerNote" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "authorId" UUID NOT NULL, "body" VARCHAR(2000) NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerNote_body_check" CHECK (length(trim("body")) > 0)
);
CREATE INDEX "CustomerNote_userId_pinned_createdAt_idx" ON "CustomerNote"("userId", "pinned", "createdAt" DESC);
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderNote" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "authorId" UUID NOT NULL, "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderNote_body_check" CHECK (length(trim("body")) > 0)
);
CREATE INDEX "OrderNote_orderId_createdAt_idx" ON "OrderNote"("orderId", "createdAt");
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reports permission (margin is sensitive: cost prices)
INSERT INTO "Permission" ("id", "code", "group") VALUES (gen_random_uuid(), 'reports.margin', 'finance') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r JOIN "Permission" p ON p."code" = 'reports.margin' AND r."code" IN ('SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN')
ON CONFLICT DO NOTHING;
