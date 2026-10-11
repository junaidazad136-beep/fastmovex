-- Phase 24: content for search engines — category and brand pages, market SEO settings, product GTIN check

ALTER TABLE "Category"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "descriptionAr" TEXT,
  ADD COLUMN "seoTitle" TEXT,
  ADD COLUMN "seoTitleAr" TEXT,
  ADD COLUMN "seoDescription" TEXT,
  ADD COLUMN "seoDescriptionAr" TEXT,
  ADD COLUMN "faq" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Category" ADD CONSTRAINT "Category_faq_array_check" CHECK (jsonb_typeof("faq") = 'array' AND jsonb_array_length("faq") <= 20);
ALTER TABLE "Category" ADD CONSTRAINT "Category_seo_length_check" CHECK (
  coalesce(length("description"), 0) <= 5000 AND coalesce(length("descriptionAr"), 0) <= 5000
  AND coalesce(length("seoTitle"), 0) <= 70 AND coalesce(length("seoTitleAr"), 0) <= 70
  AND coalesce(length("seoDescription"), 0) <= 170 AND coalesce(length("seoDescriptionAr"), 0) <= 170);

ALTER TABLE "Brand"
  ADD COLUMN "nameAr" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "descriptionAr" TEXT,
  ADD COLUMN "seoTitle" TEXT,
  ADD COLUMN "seoTitleAr" TEXT,
  ADD COLUMN "seoDescription" TEXT,
  ADD COLUMN "seoDescriptionAr" TEXT;
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_seo_length_check" CHECK (
  coalesce(length("description"), 0) <= 5000 AND coalesce(length("descriptionAr"), 0) <= 5000
  AND coalesce(length("seoTitle"), 0) <= 70 AND coalesce(length("seoTitleAr"), 0) <= 70
  AND coalesce(length("seoDescription"), 0) <= 170 AND coalesce(length("seoDescriptionAr"), 0) <= 170);

ALTER TABLE "Country" ADD COLUMN "seoSettings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Country" ADD CONSTRAINT "Country_seoSettings_object_check" CHECK (jsonb_typeof("seoSettings") = 'object');
