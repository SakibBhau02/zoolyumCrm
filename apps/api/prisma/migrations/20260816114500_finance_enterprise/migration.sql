-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "balanceDeducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "payrollRecordId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "balanceCredited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_payrollRecordId_key" ON "Expense"("payrollRecordId");

-- CreateIndex
CREATE INDEX "Payment_bankAccountId_idx" ON "Payment"("bankAccountId");

-- CreateIndex
CREATE INDEX "PayrollRecord_period_idx" ON "PayrollRecord"("period");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "PayrollRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;