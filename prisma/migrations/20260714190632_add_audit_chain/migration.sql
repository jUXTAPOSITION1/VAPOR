-- AlterTable
ALTER TABLE "PaymentRecord" ADD COLUMN "seq" INTEGER;
ALTER TABLE "PaymentRecord" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN "recordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_seq_key" ON "PaymentRecord"("seq");
