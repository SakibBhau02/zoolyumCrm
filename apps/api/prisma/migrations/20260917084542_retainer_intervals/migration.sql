-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "nextRetainerDate" DATE,
ADD COLUMN     "retainerInterval" TEXT DEFAULT 'MONTHLY';
