-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payer" TEXT,
    "isValid" BOOLEAN NOT NULL,
    "invalidReason" TEXT,
    "riskScore" INTEGER,
    "riskBand" TEXT,
    "riskReasons" TEXT,
    "settled" BOOLEAN,
    "transactionHash" TEXT,
    "errorReason" TEXT
);

-- CreateIndex
CREATE INDEX "PaymentRecord_payTo_createdAt_idx" ON "PaymentRecord"("payTo", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecord_payer_idx" ON "PaymentRecord"("payer");

-- CreateIndex
CREATE INDEX "PaymentRecord_transactionHash_idx" ON "PaymentRecord"("transactionHash");
