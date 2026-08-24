-- v0-crm tasks module parity: type, dates, assignees, reporter, attachments, time, comments, templates
ALTER TABLE "Task" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN "startDate" TIMESTAMP(3),
ADD COLUMN "actualHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "assignees" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "reporterId" TEXT;

ALTER TABLE "Task" ADD CONSTRAINT "Task_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeLog" ADD COLUMN "isBillable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TaskComment" ADD COLUMN "parentId" TEXT,
ADD COLUMN "reactions" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskTemplate" ADD COLUMN "category" TEXT,
ADD COLUMN "benchmarkDurationDays" INTEGER,
ADD COLUMN "benchmarkHours" DECIMAL(8,2);