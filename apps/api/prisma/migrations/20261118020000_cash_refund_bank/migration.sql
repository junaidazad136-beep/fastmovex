-- Bank account for cash-on-delivery refunds (paid by transfer)
ALTER TABLE "Refund" ADD COLUMN "bankIbanEncrypted" TEXT;
ALTER TABLE "Refund" ADD COLUMN "bankIbanLast4" TEXT;
ALTER TABLE "Refund" ADD COLUMN "bankAccountHolder" TEXT;
ALTER TABLE "Refund" ADD COLUMN "bankDetailsAt" TIMESTAMP(3);
