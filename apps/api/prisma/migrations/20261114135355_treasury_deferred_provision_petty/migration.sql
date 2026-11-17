-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "deferPeriods" INTEGER,
ADD COLUMN     "deferRevenue" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "realizedFx" DECIMAL(14,2) DEFAULT 0,
ADD COLUMN     "settlementRate" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "DeferredRevenue" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "recognizedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "periods" INTEGER NOT NULL,
    "monthlyAmount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeferredRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeferredRevenueRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeferredRevenueRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvisionRun" (
    "id" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'AGING',
    "rate" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "journalId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvisionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashEntry" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category" TEXT,
    "receiptUrl" TEXT,
    "journalId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeferredRevenue_invoiceId_key" ON "DeferredRevenue"("invoiceId");

-- CreateIndex
CREATE INDEX "DeferredRevenue_status_idx" ON "DeferredRevenue"("status");

-- CreateIndex
CREATE INDEX "DeferredRevenueRun_period_idx" ON "DeferredRevenueRun"("period");

-- CreateIndex
CREATE UNIQUE INDEX "DeferredRevenueRun_scheduleId_period_key" ON "DeferredRevenueRun"("scheduleId", "period");

-- CreateIndex
CREATE INDEX "ProvisionRun_asOfDate_idx" ON "ProvisionRun"("asOfDate");

-- CreateIndex
CREATE INDEX "PettyCashEntry_date_idx" ON "PettyCashEntry"("date");

-- AddForeignKey
ALTER TABLE "DeferredRevenueRun" ADD CONSTRAINT "DeferredRevenueRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DeferredRevenue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
