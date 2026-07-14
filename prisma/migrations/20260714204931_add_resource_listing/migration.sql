-- CreateTable
CREATE TABLE "ResourceListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resource" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'http',
    "x402Version" INTEGER NOT NULL,
    "payTo" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "accepts" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT,
    "serviceName" TEXT,
    "tags" TEXT,
    "iconUrl" TEXT,
    "extensions" TEXT,
    "discoverable" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE INDEX "ResourceListing_payTo_idx" ON "ResourceListing"("payTo");

-- CreateIndex
CREATE INDEX "ResourceListing_scheme_network_idx" ON "ResourceListing"("scheme", "network");

-- CreateIndex
CREATE INDEX "ResourceListing_discoverable_idx" ON "ResourceListing"("discoverable");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceListing_resource_payTo_key" ON "ResourceListing"("resource", "payTo");
