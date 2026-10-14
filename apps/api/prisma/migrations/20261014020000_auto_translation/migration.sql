-- Automatic English ⇄ Arabic (DeepL): what the machine wrote per field, Arabic option words, last translation pass.
ALTER TABLE "Product" ADD COLUMN "autoText" JSONB NOT NULL DEFAULT '{}',
                      ADD COLUMN "optionsAr" JSONB,
                      ADD COLUMN "translatedAt" TIMESTAMP(3);
ALTER TABLE "Store" ADD COLUMN "autoText" JSONB NOT NULL DEFAULT '{}',
                    ADD COLUMN "translatedAt" TIMESTAMP(3);
