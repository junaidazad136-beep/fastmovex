-- Phase 17: several warehouses. Stock is counted per warehouse (WarehouseStock); Inventory.onHand stays the
-- total that the shop sells from and is kept equal to the sum by a trigger — it can no longer be changed directly.

ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

CREATE TABLE "Warehouse" (
  "id" UUID NOT NULL,
  "sellerId" UUID NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(80),
  "city" VARCHAR(80),
  "address" VARCHAR(300),
  "zones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id"),
  -- the default warehouse is where stock goes when nobody says otherwise: it must stay open
  CONSTRAINT "Warehouse_default_active_check" CHECK (NOT "isDefault" OR "isActive")
);
CREATE UNIQUE INDEX "Warehouse_sellerId_code_key" ON "Warehouse"("sellerId", "code");
CREATE UNIQUE INDEX "Warehouse_one_default_per_seller" ON "Warehouse"("sellerId") WHERE "isDefault";
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WarehouseStock" (
  "warehouseId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "bin" VARCHAR(40),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("warehouseId", "variantId"),
  CONSTRAINT "WarehouseStock_onHand_check" CHECK ("onHand" >= 0)
);
CREATE INDEX "WarehouseStock_variantId_idx" ON "WarehouseStock"("variantId");
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StockTransfer" (
  "id" UUID NOT NULL,
  "number" VARCHAR(30) NOT NULL,
  "fromWarehouseId" UUID NOT NULL,
  "toWarehouseId" UUID NOT NULL,
  "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
  "note" VARCHAR(300),
  "createdById" UUID NOT NULL,
  "receivedById" UUID,
  "receivedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockTransfer_two_places_check" CHECK ("fromWarehouseId" <> "toWarehouseId")
);
CREATE UNIQUE INDEX "StockTransfer_number_key" ON "StockTransfer"("number");
CREATE INDEX "StockTransfer_status_createdAt_idx" ON "StockTransfer"("status", "createdAt");
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StockTransferItem" (
  "transferId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("transferId", "variantId"),
  CONSTRAINT "StockTransferItem_quantity_check" CHECK ("quantity" > 0)
);
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerOrder" ADD COLUMN "warehouseId" UUID;
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SellerOrder_warehouseId_status_idx" ON "SellerOrder"("warehouseId", "status");
ALTER TABLE "InventoryMovement" ADD COLUMN "warehouseId" UUID;

-- Existing data: every seller gets a main warehouse holding all of its current stock, and its shipments ship from there.
INSERT INTO "Warehouse" ("id", "sellerId", "code", "name", "nameAr", "city", "isDefault", "updatedAt")
  SELECT gen_random_uuid(), s."id", 'MAIN', 'Main warehouse', 'المستودع الرئيسي', 'Doha', true, now() FROM "Seller" s;
INSERT INTO "WarehouseStock" ("warehouseId", "variantId", "onHand")
  SELECT w."id", i."variantId", i."onHand"
  FROM "Inventory" i
  JOIN "ProductVariant" v ON v."id" = i."variantId"
  JOIN "Product" p ON p."id" = v."productId"
  JOIN "Store" st ON st."id" = p."storeId"
  JOIN "Warehouse" w ON w."sellerId" = st."sellerId" AND w."isDefault"
  WHERE i."onHand" > 0;
UPDATE "SellerOrder" so SET "warehouseId" = w."id" FROM "Warehouse" w WHERE w."sellerId" = so."sellerId" AND w."isDefault";

-- From here on the warehouse rows are the truth and the total follows them.
CREATE OR REPLACE FUNCTION warehouse_stock_sync() RETURNS trigger AS $$
DECLARE
  d integer;
  v uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN d := NEW."onHand"; v := NEW."variantId";
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."variantId" <> OLD."variantId" OR NEW."warehouseId" <> OLD."warehouseId" THEN
      RAISE EXCEPTION 'A warehouse stock row cannot move to another product or warehouse';
    END IF;
    d := NEW."onHand" - OLD."onHand"; v := NEW."variantId";
  ELSE d := -OLD."onHand"; v := OLD."variantId";
  END IF;
  IF d <> 0 THEN
    PERFORM set_config('jovia.stock_sync', 'on', true);
    UPDATE "Inventory" SET "onHand" = "onHand" + d, "version" = "version" + 1, "updatedAt" = now() WHERE "variantId" = v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No inventory row for variant %', v;
    END IF;
    PERFORM set_config('jovia.stock_sync', 'off', true);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER warehouse_stock_sync AFTER INSERT OR UPDATE OR DELETE ON "WarehouseStock"
  FOR EACH ROW EXECUTE FUNCTION warehouse_stock_sync();

-- Nobody changes the total by hand any more (a forgotten code path fails loudly instead of drifting).
CREATE OR REPLACE FUNCTION inventory_onhand_guard() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('jovia.stock_sync', true), 'off') <> 'on' AND
     ((TG_OP = 'INSERT' AND NEW."onHand" <> 0) OR (TG_OP = 'UPDATE' AND NEW."onHand" IS DISTINCT FROM OLD."onHand")) THEN
    RAISE EXCEPTION 'Inventory.onHand is the sum of the warehouses: change WarehouseStock instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_onhand_guard BEFORE INSERT OR UPDATE ON "Inventory"
  FOR EACH ROW EXECUTE FUNCTION inventory_onhand_guard();
