-- Phase 23: Google / Apple sign-in, web push, items added to an order

CREATE TABLE "SocialAccount" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" VARCHAR(10) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialAccount_provider_check" CHECK ("provider" IN ('GOOGLE', 'APPLE'))
);
CREATE UNIQUE INDEX "SocialAccount_provider_subject_key" ON "SocialAccount"("provider", "subject");
CREATE INDEX "SocialAccount_userId_idx" ON "SocialAccount"("userId");
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebPushSubscription" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" VARCHAR(200) NOT NULL,
  "auth" VARCHAR(100) NOT NULL,
  "userAgent" VARCHAR(300),
  "failures" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebPushSubscription_endpoint_check" CHECK ("endpoint" LIKE 'https://%')
);
CREATE UNIQUE INDEX "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");
CREATE INDEX "WebPushSubscription_userId_idx" ON "WebPushSubscription"("userId");
ALTER TABLE "WebPushSubscription" ADD CONSTRAINT "WebPushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- staff can now also add items to an order before dispatch
ALTER TABLE "OrderChange" DROP CONSTRAINT "OrderChange_kind_check";
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_kind_check" CHECK ("kind" IN ('ITEMS', 'ADDED', 'ADDRESS', 'SLOT', 'DOOR_REFUSAL'));
