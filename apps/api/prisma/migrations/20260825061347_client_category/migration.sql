-- CreateEnum
CREATE TYPE "ClientCategory" AS ENUM ('ACTIVE', 'ON_HOLD', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "category" "ClientCategory" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Client_category_idx" ON "Client"("category");
