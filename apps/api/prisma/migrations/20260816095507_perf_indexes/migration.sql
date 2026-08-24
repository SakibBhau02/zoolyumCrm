/*
  Warnings:

  - Made the column `progress` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `billingType` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `paymentStatus` on table `Project` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "LeadFollowUp_date_idx";

-- DropIndex
DROP INDEX "LeadFollowUp_leadId_idx";

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "documents" DROP NOT NULL,
ALTER COLUMN "careerHistory" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "stageEnteredAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "progress" SET NOT NULL,
ALTER COLUMN "billingType" SET NOT NULL,
ALTER COLUMN "paymentStatus" SET NOT NULL;

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "referenceLinks" DROP NOT NULL,
ALTER COLUMN "activityLog" DROP NOT NULL,
ALTER COLUMN "attachments" DROP NOT NULL,
ALTER COLUMN "assignees" DROP NOT NULL,
ALTER COLUMN "customFields" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TaskComment" ALTER COLUMN "reactions" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Client_accountOwnerId_idx" ON "Client"("accountOwnerId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "Lead_stage_idx" ON "Lead"("stage");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_idx" ON "Lead"("assignedToId");

-- CreateIndex
CREATE INDEX "Lead_leadScore_idx" ON "Lead"("leadScore");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Lead_temperature_idx" ON "Lead"("temperature");

-- CreateIndex
CREATE INDEX "Lead_priority_idx" ON "Lead"("priority");

-- CreateIndex
CREATE INDEX "Lead_stage_createdAt_idx" ON "Lead"("stage", "createdAt");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_idx" ON "LeadActivity"("leadId");

-- CreateIndex
CREATE INDEX "LeadActivity_loggedAt_idx" ON "LeadActivity"("loggedAt");

-- CreateIndex
CREATE INDEX "LeadFollowUp_leadId_status_date_idx" ON "LeadFollowUp"("leadId", "status", "date");

-- CreateIndex
CREATE INDEX "LeadNote_createdById_idx" ON "LeadNote"("createdById");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "Project_assignedPmId_idx" ON "Project"("assignedPmId");

-- CreateIndex
CREATE INDEX "Proposal_leadId_idx" ON "Proposal"("leadId");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
