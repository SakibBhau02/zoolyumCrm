-- CreateEnum
CREATE TYPE "VendorEngagementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VendorPaymentType" AS ENUM ('ADVANCE', 'PARTIAL', 'FINAL', 'REFUND');

-- CreateEnum
CREATE TYPE "VendorEngagementCategory" AS ENUM ('CREW', 'EQUIPMENT', 'STUDIO', 'LOCATION', 'POST_PRODUCTION', 'TALENT', 'TRANSPORT', 'CATERING', 'FREELANCE', 'OTHER');

-- CreateTable
CREATE TABLE "VendorEngagement" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "category" "VendorEngagementCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" "VendorEngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE,
    "dueDate" DATE,
    "deliveredAt" DATE,
    "billNumber" TEXT,
    "billReceivedAt" DATE,
    "retentionPct" DECIMAL(5,2) DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "type" "VendorPaymentType" NOT NULL DEFAULT 'PARTIAL',
    "paymentDate" DATE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "referenceId" TEXT,
    "bankAccountId" TEXT,
    "taxWithheld" DECIMAL(14,2) DEFAULT 0,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorEngagement_reference_key" ON "VendorEngagement"("reference");

-- CreateIndex
CREATE INDEX "VendorEngagement_vendorId_idx" ON "VendorEngagement"("vendorId");

-- CreateIndex
CREATE INDEX "VendorEngagement_projectId_idx" ON "VendorEngagement"("projectId");

-- CreateIndex
CREATE INDEX "VendorEngagement_status_idx" ON "VendorEngagement"("status");

-- CreateIndex
CREATE INDEX "VendorEngagement_dueDate_idx" ON "VendorEngagement"("dueDate");

-- CreateIndex
CREATE INDEX "VendorPayment_engagementId_idx" ON "VendorPayment"("engagementId");

-- CreateIndex
CREATE INDEX "VendorPayment_paymentDate_idx" ON "VendorPayment"("paymentDate");

-- AddForeignKey
ALTER TABLE "VendorEngagement" ADD CONSTRAINT "VendorEngagement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEngagement" ADD CONSTRAINT "VendorEngagement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEngagement" ADD CONSTRAINT "VendorEngagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VendorEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
