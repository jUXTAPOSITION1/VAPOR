-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "url" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "nextAttemptAt" DATETIME NOT NULL,
    "lastError" TEXT,
    "deliveredAt" DATETIME
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
