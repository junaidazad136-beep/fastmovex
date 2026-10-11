-- Phase 19: staff two-step sign-in and sign-in history, proof of failed deliveries, stock control (write-off reasons,
-- stocktakes, dated lots / expiry, suppliers and purchase orders) and payment settlement matching.

-- ---------------------------------------------------------------- sign-in security
ALTER TABLE "User"
  ADD COLUMN "twoFactorSecret" TEXT,
  ADD COLUMN "twoFactorPendingSecret" TEXT,
  ADD COLUMN "twoFactorEnabledAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorRecovery" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "twoFactorLastStep" INTEGER,
  ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedLoginAt" TIMESTAMP(3),
  ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "mfa" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LoginEvent" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "success" BOOLEAN NOT NULL,
  "reason" VARCHAR(40) NOT NULL,
  "method" VARCHAR(20) NOT NULL,
  "client" VARCHAR(10) NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "device" VARCHAR(80),
  "deviceHash" VARCHAR(64),
  "newDevice" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt" DESC);
CREATE INDEX "LoginEvent_userId_deviceHash_idx" ON "LoginEvent"("userId", "deviceHash");
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- failed delivery proof
ALTER TABLE "DeliveryOrder"
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "failureLat" DOUBLE PRECISION,
  ADD COLUMN "failureLng" DOUBLE PRECISION,
  ADD COLUMN "failureDistanceM" INTEGER,
  ADD COLUMN "failurePhotoKey" TEXT,
  ADD COLUMN "customerRequest" TEXT,
  ADD COLUMN "customerRequestAt" TIMESTAMP(3);

-- ---------------------------------------------------------------- stock control
ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'LOST';
ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'FOUND';
ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'COUNT';
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

ALTER TABLE "Product" ADD COLUMN "tracksExpiry" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "StockLot" (
  "id" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "lotCode" VARCHAR(40) NOT NULL DEFAULT '',
  "expiresOn" DATE NOT NULL,
  "quantity" INTEGER NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockLot_quantity_check" CHECK ("quantity" >= 0)
);
CREATE UNIQUE INDEX "StockLot_warehouseId_variantId_lotCode_expiresOn_key" ON "StockLot"("warehouseId", "variantId", "lotCode", "expiresOn");
CREATE INDEX "StockLot_variantId_expiresOn_idx" ON "StockLot"("variantId", "expiresOn");
CREATE INDEX "StockLot_expiresOn_idx" ON "StockLot"("expiresOn");
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dated stock can never be more than what is on the shelf
CREATE OR REPLACE FUNCTION jovia_lots_within_shelf() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dated INTEGER; shelf INTEGER;
BEGIN
  SELECT coalesce(sum("quantity"), 0) INTO dated FROM "StockLot" WHERE "warehouseId" = NEW."warehouseId" AND "variantId" = NEW."variantId";
  SELECT coalesce(max("onHand"), 0) INTO shelf FROM "WarehouseStock" WHERE "warehouseId" = NEW."warehouseId" AND "variantId" = NEW."variantId";
  IF dated > shelf THEN RAISE EXCEPTION 'Dated stock (%) is more than the shelf (%)', dated, shelf; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "StockLot_within_shelf" AFTER INSERT OR UPDATE ON "StockLot" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jovia_lots_within_shelf();

CREATE TABLE "StockCount" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "warehouseId" UUID NOT NULL,
  "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
  "blind" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "createdById" UUID NOT NULL,
  "submittedById" UUID,
  "approvedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id"),
  -- the person who counted never approves their own count
  CONSTRAINT "StockCount_two_people_check" CHECK ("approvedById" IS NULL OR "approvedById" <> "submittedById")
);
CREATE UNIQUE INDEX "StockCount_number_key" ON "StockCount"("number");
CREATE INDEX "StockCount_status_createdAt_idx" ON "StockCount"("status", "createdAt");
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StockCountLine" (
  "id" UUID NOT NULL,
  "countId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "expectedQty" INTEGER NOT NULL,
  "countedQty" INTEGER,
  "countedAt" TIMESTAMP(3),
  "countedById" UUID,
  CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockCountLine_counted_check" CHECK ("countedQty" IS NULL OR "countedQty" >= 0)
);
CREATE UNIQUE INDEX "StockCountLine_countId_variantId_key" ON "StockCountLine"("countId", "variantId");
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- purchasing
CREATE TABLE "Supplier" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "contactName" VARCHAR(120),
  "phone" VARCHAR(30),
  "email" VARCHAR(200),
  "crNumber" VARCHAR(40),
  "address" VARCHAR(300),
  "paymentTerms" VARCHAR(120),
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrder" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "supplierId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "currencyCode" CHAR(3) NOT NULL,
  "totalMinor" BIGINT NOT NULL DEFAULT 0,
  "expectedOn" DATE,
  "note" TEXT,
  "createdById" UUID NOT NULL,
  "orderedById" UUID,
  "orderedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrder_total_check" CHECK ("totalMinor" >= 0)
);
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");
CREATE INDEX "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");
CREATE INDEX "PurchaseOrder_supplierId_createdAt_idx" ON "PurchaseOrder"("supplierId", "createdAt");
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PurchaseOrderLine" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "receivedQty" INTEGER NOT NULL DEFAULT 0,
  "unitCostMinor" BIGINT NOT NULL,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id"),
  -- never receive more than was ordered
  CONSTRAINT "PurchaseOrderLine_qty_check" CHECK ("quantity" > 0 AND "receivedQty" >= 0 AND "receivedQty" <= "quantity" AND "unitCostMinor" >= 0)
);
CREATE UNIQUE INDEX "PurchaseOrderLine_orderId_variantId_key" ON "PurchaseOrderLine"("orderId", "variantId");
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GoodsReceipt" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "orderId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "receivedById" UUID NOT NULL,
  "supplierRef" VARCHAR(60),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoodsReceipt_number_key" ON "GoodsReceipt"("number");
CREATE INDEX "GoodsReceipt_orderId_idx" ON "GoodsReceipt"("orderId");
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GoodsReceiptLine" (
  "id" UUID NOT NULL,
  "receiptId" UUID NOT NULL,
  "poLineId" UUID NOT NULL,
  "variantId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lotCode" VARCHAR(40),
  "expiresOn" DATE,
  CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoodsReceiptLine_qty_check" CHECK ("quantity" > 0)
);
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Goods receipts are the record of what physically arrived: never edited or deleted
CREATE OR REPLACE FUNCTION jovia_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Goods receipts cannot be changed or deleted'; END $$;
CREATE TRIGGER "GoodsReceipt_guard" BEFORE UPDATE OR DELETE ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION jovia_receipt_guard();
CREATE TRIGGER "GoodsReceiptLine_guard" BEFORE UPDATE OR DELETE ON "GoodsReceiptLine" FOR EACH ROW EXECUTE FUNCTION jovia_receipt_guard();

-- ---------------------------------------------------------------- payment settlements
CREATE TABLE "PaymentSettlement" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "fileName" VARCHAR(200) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "rows" INTEGER NOT NULL,
  "matched" INTEGER NOT NULL,
  "mismatched" INTEGER NOT NULL,
  "missing" INTEGER NOT NULL,
  "extra" INTEGER NOT NULL,
  "fileTotalMinor" BIGINT NOT NULL,
  "result" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentSettlement_createdAt_idx" ON "PaymentSettlement"("createdAt");

-- ---------------------------------------------------------------- permissions
INSERT INTO "Permission" ("id", "code", "group") VALUES
  (gen_random_uuid(), 'inventory.approve', 'inventory'),
  (gen_random_uuid(), 'purchasing.manage', 'purchasing'),
  (gen_random_uuid(), 'purchasing.receive', 'purchasing'),
  (gen_random_uuid(), 'payments.reconcile', 'finance')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r JOIN "Permission" p ON
  (r."code" IN ('SUPER_ADMIN', 'ADMIN') AND p."code" IN ('inventory.approve', 'purchasing.manage', 'purchasing.receive', 'payments.reconcile'))
  OR (r."code" = 'FINANCE_ADMIN' AND p."code" = 'payments.reconcile')
  OR (r."code" = 'OPERATIONS_ADMIN' AND p."code" IN ('inventory.approve', 'purchasing.manage', 'purchasing.receive'))
  OR (r."code" = 'INVENTORY_MANAGER' AND p."code" = 'purchasing.receive')
ON CONFLICT DO NOTHING;
