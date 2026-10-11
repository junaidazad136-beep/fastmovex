-- Storefront look (FastMoveX home): banners can carry their own text, drawn by the website over a purple background
-- (badge, two-line headline with *accent* words, one line under it, button label), in English and Arabic.
ALTER TABLE "Banner"
  ADD COLUMN "kicker" VARCHAR(30),
  ADD COLUMN "kickerAr" VARCHAR(30),
  ADD COLUMN "headline" VARCHAR(80),
  ADD COLUMN "headlineAr" VARCHAR(80),
  ADD COLUMN "subline" VARCHAR(120),
  ADD COLUMN "sublineAr" VARCHAR(120),
  ADD COLUMN "ctaLabel" VARCHAR(24),
  ADD COLUMN "ctaLabelAr" VARCHAR(24);
