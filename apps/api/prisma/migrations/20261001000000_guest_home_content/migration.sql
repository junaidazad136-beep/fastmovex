-- Guest checkout, admin-editable home page, content pages and the contact form.

CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'HANDLED', 'SPAM');

ALTER TABLE "User" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Country" ADD COLUMN "guestCheckout" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "HomeSection" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "title" VARCHAR(80),
    "titleAr" VARCHAR(80),
    "config" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Page" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "titleAr" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "showInFooter" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactMessage" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "subject" VARCHAR(150),
    "message" TEXT NOT NULL,
    "orderNumber" VARCHAR(40),
    "userId" UUID,
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "handledById" UUID,
    "handledAt" TIMESTAMP(3),
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeSection_countryCode_sortOrder_idx" ON "HomeSection"("countryCode", "sortOrder");
-- A built-in section appears at most once per market; custom collections can repeat.
CREATE UNIQUE INDEX "HomeSection_builtin_once" ON "HomeSection"("countryCode", "key") WHERE "key" <> 'collection';
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");
-- Guest accounts are looked up by email at checkout.
CREATE INDEX "User_guest_email_idx" ON "User"("email") WHERE "isGuest";
