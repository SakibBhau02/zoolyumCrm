-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "healthBreakdown" JSONB,
ADD COLUMN     "healthComputedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ClientHealthLog" ADD COLUMN     "breakdown" JSONB,
ADD COLUMN     "level" "HealthLevel";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "confidenceScore" INTEGER,
ADD COLUMN     "healthBreakdown" JSONB,
ADD COLUMN     "healthComputedAt" TIMESTAMP(3),
ADD COLUMN     "healthOverrideReason" TEXT,
ADD COLUMN     "healthStatusOverride" "HealthStatus";

-- AlterTable
ALTER TABLE "ProjectRiskLog" ADD COLUMN     "breakdown" JSONB;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "scoringConfig" JSONB NOT NULL DEFAULT '{}';
