-- Phase 17: customer questions about a product, answered by the store (shown once answered).

CREATE TYPE "QuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'REJECTED');

CREATE TABLE "ProductQuestion" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "locale" VARCHAR(5) NOT NULL DEFAULT 'en',
  "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING',
  "answer" VARCHAR(2000),
  "answeredById" UUID,
  "answeredAt" TIMESTAMP(3),
  "rejectReason" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductQuestion_pkey" PRIMARY KEY ("id"),
  -- an answered question always has its answer
  CONSTRAINT "ProductQuestion_answered_check" CHECK ("status" <> 'ANSWERED' OR ("answer" IS NOT NULL AND "answeredAt" IS NOT NULL))
);

CREATE INDEX "ProductQuestion_productId_status_answeredAt_idx" ON "ProductQuestion"("productId", "status", "answeredAt" DESC);
CREATE INDEX "ProductQuestion_status_createdAt_idx" ON "ProductQuestion"("status", "createdAt");
CREATE INDEX "ProductQuestion_userId_createdAt_idx" ON "ProductQuestion"("userId", "createdAt");

ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
