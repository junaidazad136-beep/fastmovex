-- Phase 22: order changes after checkout, phone orders, items refused at the door, return pickups, refund limits

ALTER TABLE "Order" ADD COLUMN "placedById" UUID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "refundLimitMinor" BIGINT;
ALTER TABLE "User" ADD CONSTRAINT "User_refundLimitMinor_check" CHECK ("refundLimitMinor" IS NULL OR "refundLimitMinor" >= 0);

CREATE TABLE "OrderChange" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "sellerOrderId" UUID,
  "kind" VARCHAR(20) NOT NULL,
  "byRole" VARCHAR(10) NOT NULL,
  "actorId" UUID,
  "reason" VARCHAR(500),
  "summary" VARCHAR(1000) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "amountMinor" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderChange_kind_check" CHECK ("kind" IN ('ITEMS', 'ADDRESS', 'SLOT', 'DOOR_REFUSAL')),
  CONSTRAINT "OrderChange_byRole_check" CHECK ("byRole" IN ('STAFF', 'CUSTOMER', 'DRIVER')),
  CONSTRAINT "OrderChange_amount_check" CHECK ("amountMinor" >= 0)
);
CREATE INDEX "OrderChange_orderId_createdAt_idx" ON "OrderChange"("orderId", "createdAt");
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the change history is a record: never edited afterwards
CREATE OR REPLACE FUNCTION jovia_order_change_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Order changes are a permanent record and cannot be edited';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER jovia_order_change_immutable BEFORE UPDATE ON "OrderChange" FOR EACH ROW EXECUTE FUNCTION jovia_order_change_immutable();

CREATE TABLE "DoorReturn" (
  "id" UUID NOT NULL,
  "deliveryOrderId" UUID NOT NULL,
  "orderItemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "courierUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedAt" TIMESTAMP(3),
  "receivedById" UUID,
  "condition" "ReturnCondition",
  "note" VARCHAR(300),
  CONSTRAINT "DoorReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoorReturn_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "DoorReturn_received_check" CHECK (("receivedAt" IS NULL) = ("receivedById" IS NULL) AND ("receivedAt" IS NULL) = ("condition" IS NULL))
);
CREATE INDEX "DoorReturn_receivedAt_createdAt_idx" ON "DoorReturn"("receivedAt", "createdAt");
CREATE INDEX "DoorReturn_orderItemId_idx" ON "DoorReturn"("orderItemId");
ALTER TABLE "DoorReturn" ADD CONSTRAINT "DoorReturn_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoorReturn" ADD CONSTRAINT "DoorReturn_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "PickupStatus" AS ENUM ('ASSIGNED', 'COLLECTED', 'FAILED', 'CANCELLED');

CREATE TABLE "ReturnPickup" (
  "id" UUID NOT NULL,
  "returnRequestId" UUID NOT NULL,
  "status" "PickupStatus" NOT NULL DEFAULT 'ASSIGNED',
  "courierUserId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "address" JSONB NOT NULL,
  "note" VARCHAR(300),
  "createdById" UUID NOT NULL,
  "collectedAt" TIMESTAMP(3),
  "collectedLat" DOUBLE PRECISION,
  "collectedLng" DOUBLE PRECISION,
  "failedAt" TIMESTAMP(3),
  "failureReason" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnPickup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnPickup_collected_check" CHECK (("status" = 'COLLECTED') = ("collectedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ReturnPickup_returnRequestId_key" ON "ReturnPickup"("returnRequestId");
CREATE INDEX "ReturnPickup_courierUserId_status_idx" ON "ReturnPickup"("courierUserId", "status");
CREATE INDEX "ReturnPickup_status_date_idx" ON "ReturnPickup"("status", "date");
ALTER TABLE "ReturnPickup" ADD CONSTRAINT "ReturnPickup_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnPickup" ADD CONSTRAINT "ReturnPickup_courierUserId_fkey" FOREIGN KEY ("courierUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phone orders: staff place an order for a customer (orders group; support takes calls too)
INSERT INTO "Permission" ("id", "code", "group") VALUES (gen_random_uuid(), 'orders.create', 'orders') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r JOIN "Permission" p ON p."code" = 'orders.create'
 AND r."code" IN ('SUPER_ADMIN', 'ADMIN', 'OPERATIONS_ADMIN', 'ORDER_MANAGER', 'SUPPORT_ADMIN')
ON CONFLICT DO NOTHING;
