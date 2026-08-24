-- v0-crm project module parity: uid, category, priority, progress, billing, team, links
ALTER TABLE "Project" ADD COLUMN "uid" TEXT,
ADD COLUMN "category" TEXT DEFAULT '',
ADD COLUMN "priority" TEXT DEFAULT 'MEDIUM',
ADD COLUMN "progress" INTEGER DEFAULT 0,
ADD COLUMN "spentAmount" DECIMAL(14,2),
ADD COLUMN "team" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "billingType" TEXT DEFAULT 'ONE_TIME',
ADD COLUMN "recurringInterval" TEXT,
ADD COLUMN "nextBillingDate" TIMESTAMP(3),
ADD COLUMN "monthlyRate" DECIMAL(14,2),
ADD COLUMN "totalBilled" DECIMAL(14,2),
ADD COLUMN "paymentStatus" TEXT DEFAULT 'PENDING',
ADD COLUMN "briefLink" TEXT,
ADD COLUMN "driveLink" TEXT,
ADD COLUMN "researchLink" TEXT;

CREATE UNIQUE INDEX "Project_uid_key" ON "Project"("uid");