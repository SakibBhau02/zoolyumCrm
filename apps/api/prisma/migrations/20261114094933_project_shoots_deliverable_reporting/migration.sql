-- CreateEnum
CREATE TYPE "DeliverableKind" AS ENUM ('GRAPHIC', 'VIDEO', 'PHOTO', 'COPY', 'OTHER');

-- CreateEnum
CREATE TYPE "ShootDuration" AS ENUM ('HALF_DAY', 'FULL_DAY');

-- CreateEnum
CREATE TYPE "ShootStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'WRAPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShootCrewRole" AS ENUM ('DOP', 'CAMERAMAN', 'ASSISTANT_CAMERA', 'GAFFER', 'GRIP', 'SOUND', 'ART_DIRECTOR', 'STYLIST', 'MAKEUP', 'PRODUCER', 'LINE_PRODUCER', 'PHOTOGRAPHER', 'DRONE_OPERATOR', 'DRIVER', 'TALENT', 'TEAM_MEMBER', 'OTHER');

-- CreateEnum
CREATE TYPE "ShootCrewSource" AS ENUM ('EMPLOYEE', 'VENDOR', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ReportGrouping" AS ENUM ('CAMPAIGN', 'KIND', 'OWNER', 'NONE');

-- AlterTable
ALTER TABLE "ProjectDeliverable" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "kind" "DeliverableKind",
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "topic" TEXT;

-- AlterTable
ALTER TABLE "ProjectReport" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "campaignLabel" TEXT,
ADD COLUMN     "groupBy" "ReportGrouping" NOT NULL DEFAULT 'CAMPAIGN',
ADD COLUMN     "shoots" JSONB,
ADD COLUMN     "summary" JSONB;

-- CreateTable
CREATE TABLE "Shoot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "shootDate" DATE NOT NULL,
    "endDate" DATE,
    "durationType" "ShootDuration" NOT NULL DEFAULT 'FULL_DAY',
    "callTime" TEXT,
    "wrapTime" TEXT,
    "isDateLocked" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "locationUrl" TEXT,
    "locationNote" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ShootStatus" NOT NULL DEFAULT 'PLANNED',
    "calendarEventId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootCrew" (
    "id" TEXT NOT NULL,
    "shootId" TEXT NOT NULL,
    "role" "ShootCrewRole" NOT NULL,
    "source" "ShootCrewSource" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeId" TEXT,
    "vendorId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "callTime" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "fee" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShootCrew_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shoot_calendarEventId_key" ON "Shoot"("calendarEventId");

-- CreateIndex
CREATE INDEX "Shoot_projectId_shootDate_idx" ON "Shoot"("projectId", "shootDate");

-- CreateIndex
CREATE INDEX "Shoot_campaignId_idx" ON "Shoot"("campaignId");

-- CreateIndex
CREATE INDEX "Shoot_shootDate_idx" ON "Shoot"("shootDate");

-- CreateIndex
CREATE INDEX "Shoot_status_idx" ON "Shoot"("status");

-- CreateIndex
CREATE INDEX "ShootCrew_shootId_idx" ON "ShootCrew"("shootId");

-- CreateIndex
CREATE INDEX "ShootCrew_employeeId_idx" ON "ShootCrew"("employeeId");

-- CreateIndex
CREATE INDEX "ShootCrew_vendorId_idx" ON "ShootCrew"("vendorId");

-- CreateIndex
CREATE INDEX "ProjectDeliverable_campaignId_idx" ON "ProjectDeliverable"("campaignId");

-- CreateIndex
CREATE INDEX "ProjectDeliverable_kind_idx" ON "ProjectDeliverable"("kind");

-- AddForeignKey
ALTER TABLE "ProjectDeliverable" ADD CONSTRAINT "ProjectDeliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shoot" ADD CONSTRAINT "Shoot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shoot" ADD CONSTRAINT "Shoot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shoot" ADD CONSTRAINT "Shoot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootCrew" ADD CONSTRAINT "ShootCrew_shootId_fkey" FOREIGN KEY ("shootId") REFERENCES "Shoot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootCrew" ADD CONSTRAINT "ShootCrew_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootCrew" ADD CONSTRAINT "ShootCrew_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
