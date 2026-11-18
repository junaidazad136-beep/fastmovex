CREATE TYPE "WarrantyStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'IN_REPAIR', 'RESOLVED');
CREATE TYPE "WarrantyResolution" AS ENUM ('REPAIRED', 'REPLACED', 'REFUNDED');
CREATE TABLE "WarrantyClaim" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "status" "WarrantyStatus" NOT NULL DEFAULT 'REQUESTED',
    "resolution" "WarrantyResolution",
    "note" TEXT,
    "warrantyEndsOn" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "overdueWarnedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WarrantyClaim_orderItemId_idx" ON "WarrantyClaim"("orderItemId");
CREATE INDEX "WarrantyClaim_userId_idx" ON "WarrantyClaim"("userId");
CREATE INDEX "WarrantyClaim_sellerId_status_idx" ON "WarrantyClaim"("sellerId", "status");
CREATE INDEX "WarrantyClaim_status_dueAt_idx" ON "WarrantyClaim"("status", "dueAt");
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarrantyClaim" ENABLE ROW LEVEL SECURITY;
