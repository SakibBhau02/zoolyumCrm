-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "balanceAfter" DECIMAL(5,1),
ADD COLUMN     "balanceBefore" DECIMAL(5,1),
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "deductedDays" DECIMAL(5,1),
ADD COLUMN     "workingDays" INTEGER;

-- CreateTable
CREATE TABLE "WorkdayOverride" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkdayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "annualDays" DECIMAL(5,1),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkdayOverride_date_key" ON "WorkdayOverride"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_leaveType_key" ON "LeavePolicy"("leaveType");

-- AddForeignKey
ALTER TABLE "WorkdayOverride" ADD CONSTRAINT "WorkdayOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
