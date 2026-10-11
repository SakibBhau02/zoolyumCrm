-- AlterEnum
ALTER TYPE "IntegrationType" ADD VALUE 'MESSAGING';

-- AlterTable
ALTER TABLE "ClientContact" ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "shareEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shareToken" TEXT;

-- CreateTable
CREATE TABLE "WhatsappMessageLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "templateName" TEXT,
    "language" TEXT DEFAULT 'en',
    "messageType" TEXT NOT NULL DEFAULT 'template',
    "params" JSONB,
    "relatedInvoiceId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "wamid" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "description" TEXT,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bodyPreview" TEXT,
    "buttons" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metaStatus" TEXT,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessageLog_wamid_key" ON "WhatsappMessageLog"("wamid");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_relatedInvoiceId_idx" ON "WhatsappMessageLog"("relatedInvoiceId");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_status_idx" ON "WhatsappMessageLog"("status");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_createdAt_idx" ON "WhatsappMessageLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_name_language_key" ON "WhatsappTemplate"("name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shareToken_key" ON "Invoice"("shareToken");
