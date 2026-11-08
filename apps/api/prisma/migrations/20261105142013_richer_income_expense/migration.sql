-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "department" TEXT,
ADD COLUMN     "markupPct" DECIMAL(5,2) DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "vendorBillDate" DATE,
ADD COLUMN     "vendorBillNumber" TEXT;

-- AlterTable
ALTER TABLE "ManualIncome" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "referenceId" TEXT,
ADD COLUMN     "taxWithheld" DECIMAL(14,2) DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "taxWithheld" DECIMAL(14,2) DEFAULT 0;

-- CreateIndex
CREATE INDEX "ManualIncome_clientId_idx" ON "ManualIncome"("clientId");

-- CreateIndex
CREATE INDEX "ManualIncome_projectId_idx" ON "ManualIncome"("projectId");

-- AddForeignKey
ALTER TABLE "ManualIncome" ADD CONSTRAINT "ManualIncome_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncome" ADD CONSTRAINT "ManualIncome_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
