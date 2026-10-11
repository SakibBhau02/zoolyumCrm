-- AlterTable
ALTER TABLE "BrandingConfig" ADD COLUMN     "address" TEXT,
ADD COLUMN     "authorizedSignerName" TEXT,
ADD COLUMN     "authorizedSignerTitle" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "defaultCurrency" TEXT DEFAULT 'BDT',
ADD COLUMN     "defaultNotes" TEXT,
ADD COLUMN     "defaultPaymentDetails" JSONB,
ADD COLUMN     "defaultTerms" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "signatureImageUrl" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "autoGenerateInvoice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "billingDayOfMonth" INTEGER,
ADD COLUMN     "lastAutoInvoiceCycle" TEXT,
ADD COLUMN     "monthlyAmount" DECIMAL(14,2),
ADD COLUMN     "monthlyServiceDescription" TEXT,
ADD COLUMN     "paymentDueDays" INTEGER DEFAULT 15;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountAmount" DECIMAL(14,2) DEFAULT 0,
ADD COLUMN     "discountRate" DECIMAL(5,2),
ADD COLUMN     "paymentDetails" JSONB,
ADD COLUMN     "shippingFee" DECIMAL(14,2) DEFAULT 0,
ADD COLUMN     "templateStyle" TEXT DEFAULT 'modern-orange',
ADD COLUMN     "terms" TEXT;

-- CreateTable
CREATE TABLE "InvoiceReminder" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'system',
    "recipientEmail" TEXT,
    "recipientName" TEXT,
    "subject" TEXT,
    "notes" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceReminder_invoiceId_idx" ON "InvoiceReminder"("invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceReminder" ADD CONSTRAINT "InvoiceReminder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
