-- Admin catalogue: richer product data, cost price, barcodes, the platform's own ("house") store.

ALTER TABLE "Seller" ADD COLUMN "isHouse" BOOLEAN NOT NULL DEFAULT false;
-- Only one house store.
CREATE UNIQUE INDEX "Seller_one_house_store" ON "Seller" ("isHouse") WHERE "isHouse";

ALTER TABLE "Product"
  ADD COLUMN "shortDescription" TEXT,
  ADD COLUMN "shortDescriptionAr" TEXT,
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "seoTitle" TEXT,
  ADD COLUMN "seoDescription" TEXT;
CREATE INDEX "Product_tags_gin" ON "Product" USING GIN ("tags");

ALTER TABLE "ProductVariant"
  ADD COLUMN "barcode" TEXT,
  ADD COLUMN "costPriceMinor" BIGINT,
  ADD COLUMN "lengthMm" INTEGER,
  ADD COLUMN "widthMm" INTEGER,
  ADD COLUMN "heightMm" INTEGER;
CREATE INDEX "ProductVariant_barcode_idx" ON "ProductVariant" ("barcode");
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_cost_nonneg" CHECK ("costPriceMinor" IS NULL OR "costPriceMinor" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_dims_pos" CHECK (
  ("lengthMm" IS NULL OR "lengthMm" > 0) AND ("widthMm" IS NULL OR "widthMm" > 0) AND ("heightMm" IS NULL OR "heightMm" > 0)
);
