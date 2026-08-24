/*
  Warnings:

  - The `category` column on the `Expense` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('IN', 'REFUND');

-- CreateEnum
CREATE TYPE "CreditNoteType" AS ENUM ('CREDIT_NOTE', 'REFUND', 'WRITE_OFF');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "isPayable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paidAmount" DECIMAL(14,2) DEFAULT 0,
ADD COLUMN     "subcategory" TEXT,
DROP COLUMN "category",
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'MISC';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "exchangeRate" DECIMAL(10,4) DEFAULT 1,
ADD COLUMN     "expenseId" TEXT,
ADD COLUMN     "installmentId" TEXT,
ADD COLUMN     "type" "PaymentType" NOT NULL DEFAULT 'IN',
ALTER COLUMN "invoiceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bankDetails" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "phone" TEXT;

-- DropEnum
DROP TYPE "ExpenseCategory";

-- CreateTable
CREATE TABLE "ExpenseCategoryDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subcategories" JSONB NOT NULL DEFAULT '[]',
    "accountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategoryDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualIncome" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "exchangeRate" DECIMAL(10,4) DEFAULT 1,
    "category" TEXT NOT NULL DEFAULT 'OTHER_INCOME',
    "date" DATE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "bankAccountId" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "type" "CreditNoteType" NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "exchangeRate" DECIMAL(10,4) DEFAULT 1,
    "reason" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "createdById" TEXT,
    "refundPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "sourceId" TEXT,
    "notes" TEXT,
    "reversedEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategoryDef_key_key" ON "ExpenseCategoryDef"("key");

-- CreateIndex
CREATE INDEX "Installment_invoiceId_idx" ON "Installment"("invoiceId");

-- CreateIndex
CREATE INDEX "ManualIncome_date_idx" ON "ManualIncome"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_referenceNumber_key" ON "CreditNote"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_refundPaymentId_key" ON "CreditNote"("refundPaymentId");

-- CreateIndex
CREATE INDEX "CreditNote_clientId_idx" ON "CreditNote"("clientId");

-- CreateIndex
CREATE INDEX "CreditNote_date_idx" ON "CreditNote"("date");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversedEntryId_key" ON "JournalEntry"("reversedEntryId");

-- CreateIndex
CREATE INDEX "JournalEntry_entryType_idx" ON "JournalEntry"("entryType");

-- CreateIndex
CREATE INDEX "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceId_idx" ON "JournalEntry"("sourceId");

-- CreateIndex
CREATE INDEX "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "Payment_expenseId_idx" ON "Payment"("expenseId");

-- AddForeignKey
ALTER TABLE "ExpenseCategoryDef" ADD CONSTRAINT "ExpenseCategoryDef_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncome" ADD CONSTRAINT "ManualIncome_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncome" ADD CONSTRAINT "ManualIncome_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_refundPaymentId_fkey" FOREIGN KEY ("refundPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
