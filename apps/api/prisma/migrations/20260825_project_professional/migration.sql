-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "ReferenceType" AS ENUM ('DRIVE', 'NOTION', 'FIGMA', 'OTHER');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "description" TEXT,
ADD COLUMN     "amount" DECIMAL(14,2),
ADD COLUMN     "projectLink" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "socialLinks" JSONB;

-- AlterEnum for billingType: String -> BillingCycle with USING
ALTER TABLE "Project" ALTER COLUMN "billingType" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "billingType" TYPE "BillingCycle" USING ("billingType"::text::"BillingCycle");
ALTER TABLE "Project" ALTER COLUMN "billingType" SET DEFAULT 'ONE_TIME';

-- Data migration: copy budgetAmount to amount where amount is null
UPDATE "Project" SET "amount" = "budgetAmount" WHERE "amount" IS NULL AND "budgetAmount" IS NOT NULL;

-- CreateTable
CREATE TABLE "ProjectReference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "type" "ReferenceType" NOT NULL DEFAULT 'OTHER',
    "fileUrl" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectReference_projectId_idx" ON "ProjectReference"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectReference" ADD CONSTRAINT "ProjectReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReference" ADD CONSTRAINT "ProjectReference_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
