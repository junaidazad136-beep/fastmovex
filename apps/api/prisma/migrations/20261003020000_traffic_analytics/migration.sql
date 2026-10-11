-- Phase 17: first-party, anonymous traffic analytics. One row per browsing session (random id made in the browser,
-- no cookie, no user id, no IP): where it came from and how far it got (product → cart → checkout → order).

CREATE TABLE "AnalyticsSession" (
  "id" UUID NOT NULL,
  "countryCode" VARCHAR(2) NOT NULL,
  "day" DATE NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "source" VARCHAR(60) NOT NULL DEFAULT 'direct',
  "medium" VARCHAR(30) NOT NULL DEFAULT 'none',
  "campaign" VARCHAR(100),
  "landingPath" VARCHAR(200),
  "device" VARCHAR(10) NOT NULL DEFAULT 'desktop',
  "locale" VARCHAR(5),
  "pageViews" INTEGER NOT NULL DEFAULT 0,
  "productViews" INTEGER NOT NULL DEFAULT 0,
  "addedToCart" BOOLEAN NOT NULL DEFAULT false,
  "startedCheckout" BOOLEAN NOT NULL DEFAULT false,
  "purchased" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsSession_countryCode_day_idx" ON "AnalyticsSession"("countryCode", "day");

-- Where each order came from (same rules as the session), for sales by source.
ALTER TABLE "Order" ADD COLUMN "trafficSource" VARCHAR(60),
                    ADD COLUMN "trafficMedium" VARCHAR(30),
                    ADD COLUMN "trafficCampaign" VARCHAR(100);
