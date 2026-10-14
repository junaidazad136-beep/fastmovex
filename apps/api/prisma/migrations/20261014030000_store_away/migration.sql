-- Vacation mode: the store is closed until this moment (products hidden from lists, cannot be bought), with a note.
ALTER TABLE "Store" ADD COLUMN "awayUntil" TIMESTAMP(3), ADD COLUMN "awayMessage" TEXT;
