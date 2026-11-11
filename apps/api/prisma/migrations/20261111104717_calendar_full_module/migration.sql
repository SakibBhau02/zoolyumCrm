/*
  Warnings:

  - Added the required column `updatedAt` to the `CalendarEvent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TIKTOK', 'X', 'YOUTUBE', 'GOOGLE_BUSINESS', 'PINTEREST', 'THREADS');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('STATIC', 'CAROUSEL', 'REEL', 'STORY', 'VIDEO', 'TEXT', 'ARTICLE');

-- CreateEnum
CREATE TYPE "ContentApprovalStatus" AS ENUM ('NONE', 'INTERNAL_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'MISSED');

-- CreateEnum
CREATE TYPE "EventOutcome" AS ENUM ('PENDING', 'DONE', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "PlanScope" AS ENUM ('WEEK', 'MONTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'LOCKED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdFlightStatus" AS ENUM ('PLANNED', 'LIVE', 'PAUSED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PLAN', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CalendarEventType" ADD VALUE 'SHOOT';
ALTER TYPE "CalendarEventType" ADD VALUE 'REPORT';

-- AlterEnum
ALTER TYPE "Module" ADD VALUE 'CALENDAR';

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "allDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attendeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "clientContactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "endDate" TEXT,
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "meetingUrl" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "outcome" "EventOutcome" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reminderMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[],
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "taskId" TEXT,
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "visibility" "EventVisibility" NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "calendarColor" TEXT,
ADD COLUMN     "postingTargets" JSONB;

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "altText" TEXT,
ADD COLUMN     "approvalStatus" "ContentApprovalStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "assetUrls" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "externalPostId" TEXT,
ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "firstComment" TEXT,
ADD COLUMN     "format" "ContentFormat" NOT NULL DEFAULT 'STATIC',
ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkUrl" TEXT,
ADD COLUMN     "notesInternal" TEXT,
ADD COLUMN     "pillarId" TEXT,
ADD COLUMN     "publishStatus" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "recurrenceRule" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
ALTER COLUMN "scheduledDate" SET DEFAULT '';

-- AlterTable
ALTER TABLE "DailyTarget" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "periodType" TEXT NOT NULL DEFAULT 'MONTH';

-- AlterTable
ALTER TABLE "ProjectDeliverable" ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "startDate" DATE;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PLAN',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "totalBudget" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "briefLink" TEXT,
    "ownerId" TEXT,
    "color" TEXT,
    "platforms" "Platform"[] DEFAULT ARRAY[]::"Platform"[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdFlight" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "objective" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "dailyBudget" DECIMAL(12,2),
    "totalBudget" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" "AdFlightStatus" NOT NULL DEFAULT 'PLANNED',
    "creativeNote" TEXT,
    "adAccountId" TEXT,
    "externalCampaignId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdFlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPlatformAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "profileUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "followers" INTEGER,
    "followersAt" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPillar" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7C3AED',
    "targetPct" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPillar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMetric" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "scope" "PlanScope" NOT NULL DEFAULT 'MONTH',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "createdById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarComment" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarAuditLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clientId" TEXT,
    "authorId" TEXT,
    "summary" TEXT NOT NULL,
    "misses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedCalendarView" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "view" TEXT NOT NULL DEFAULT 'month',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedCalendarView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarShareLink" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "planId" TEXT,
    "token" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PLAN',
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_clientId_startDate_idx" ON "Campaign"("clientId", "startDate");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "AdFlight_clientId_startDate_idx" ON "AdFlight"("clientId", "startDate");

-- CreateIndex
CREATE INDEX "AdFlight_campaignId_idx" ON "AdFlight"("campaignId");

-- CreateIndex
CREATE INDEX "AdFlight_status_idx" ON "AdFlight"("status");

-- CreateIndex
CREATE INDEX "ClientPlatformAccount_clientId_idx" ON "ClientPlatformAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPlatformAccount_clientId_platform_handle_key" ON "ClientPlatformAccount"("clientId", "platform", "handle");

-- CreateIndex
CREATE INDEX "ContentPillar_clientId_idx" ON "ContentPillar"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPillar_clientId_name_key" ON "ContentPillar"("clientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ContentMetric_postId_key" ON "ContentMetric"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarPlan_shareToken_key" ON "CalendarPlan"("shareToken");

-- CreateIndex
CREATE INDEX "CalendarPlan_clientId_periodStart_idx" ON "CalendarPlan"("clientId", "periodStart");

-- CreateIndex
CREATE INDEX "CalendarPlan_status_idx" ON "CalendarPlan"("status");

-- CreateIndex
CREATE INDEX "CalendarComment_source_sourceId_idx" ON "CalendarComment"("source", "sourceId");

-- CreateIndex
CREATE INDEX "CalendarAuditLog_sourceId_idx" ON "CalendarAuditLog"("sourceId");

-- CreateIndex
CREATE INDEX "CalendarAuditLog_createdAt_idx" ON "CalendarAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "DailyLog_date_idx" ON "DailyLog"("date");

-- CreateIndex
CREATE INDEX "DailyLog_clientId_date_idx" ON "DailyLog"("clientId", "date");

-- CreateIndex
CREATE INDEX "SavedCalendarView_ownerId_idx" ON "SavedCalendarView"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarShareLink_token_key" ON "CalendarShareLink"("token");

-- CreateIndex
CREATE INDEX "CalendarShareLink_clientId_idx" ON "CalendarShareLink"("clientId");

-- CreateIndex
CREATE INDEX "CalendarEvent_clientId_date_idx" ON "CalendarEvent"("clientId", "date");

-- CreateIndex
CREATE INDEX "ContentPost_scheduledAt_idx" ON "ContentPost"("scheduledAt");

-- CreateIndex
CREATE INDEX "ContentPost_clientId_scheduledAt_idx" ON "ContentPost"("clientId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ContentPost_projectId_scheduledAt_idx" ON "ContentPost"("projectId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ContentPost_campaignId_idx" ON "ContentPost"("campaignId");

-- CreateIndex
CREATE INDEX "ContentPost_approvalStatus_idx" ON "ContentPost"("approvalStatus");

-- CreateIndex
CREATE INDEX "DailyTarget_clientId_idx" ON "DailyTarget"("clientId");

-- CreateIndex
CREATE INDEX "ProjectDeliverable_dueDate_idx" ON "ProjectDeliverable"("dueDate");

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "ContentPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTarget" ADD CONSTRAINT "DailyTarget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdFlight" ADD CONSTRAINT "AdFlight_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdFlight" ADD CONSTRAINT "AdFlight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdFlight" ADD CONSTRAINT "AdFlight_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPlatformAccount" ADD CONSTRAINT "ClientPlatformAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPillar" ADD CONSTRAINT "ContentPillar_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMetric" ADD CONSTRAINT "ContentMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarPlan" ADD CONSTRAINT "CalendarPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarPlan" ADD CONSTRAINT "CalendarPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarComment" ADD CONSTRAINT "CalendarComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCalendarView" ADD CONSTRAINT "SavedCalendarView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarShareLink" ADD CONSTRAINT "CalendarShareLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Data backfill (safe to re-run; only touches rows that still need it)
-- ─────────────────────────────────────────────────────────────────────────────

-- Legacy string scheduling → queryable timestamp (Asia/Dhaka, no DST).
UPDATE "ContentPost"
SET "scheduledAt" = (
  COALESCE(NULLIF("scheduledDate", ''), to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD'))
  || ' ' || COALESCE(NULLIF("scheduledTime", ''), '10:00') || ':00+06'
)::timestamptz
WHERE "scheduledAt" IS NULL;

-- Publish/approval state from the single legacy status column.
UPDATE "ContentPost"
SET "publishStatus" = CASE "status"::text
    WHEN 'SCHEDULED' THEN 'SCHEDULED'::"PublishStatus"
    WHEN 'PUBLISHED' THEN 'PUBLISHED'::"PublishStatus"
    WHEN 'FAILED' THEN 'FAILED'::"PublishStatus"
    ELSE 'DRAFT'::"PublishStatus"
  END
WHERE "publishStatus" = 'DRAFT' AND "status"::text <> 'DRAFT';

UPDATE "ContentPost"
SET "approvalStatus" = 'APPROVED'::"ContentApprovalStatus"
WHERE "status"::text = 'PUBLISHED' AND "approvalStatus" = 'NONE';

-- A post always belongs to the client of its project when it has one.
UPDATE "ContentPost" p
SET "clientId" = pr."clientId"
FROM "Project" pr
WHERE p."projectId" = pr."id" AND p."clientId" IS NULL;

-- Give every client a stable calendar colour so chips stay recognisable.
UPDATE "Client" c
SET "calendarColor" = palette.color
FROM (
  SELECT "id",
         (ARRAY['#7C3AED','#0EA5E9','#10B981','#F59E0B','#EF4444','#14B8A6','#8B5CF6','#F97316'])[
           1 + (abs(hashtext("id")) % 8)
         ] AS color
  FROM "Client"
) palette
WHERE c."id" = palette."id" AND c."calendarColor" IS NULL;

-- Roles that could open the old calendar (FLOW) keep access under the new module.
UPDATE "Role"
SET "modulePermissions" = jsonb_set(
  "modulePermissions"::jsonb,
  '{CALENDAR}',
  COALESCE("modulePermissions"::jsonb -> 'FLOW', '{"view":true,"edit":false,"approve":false}'::jsonb),
  true
)::json
WHERE "modulePermissions"::jsonb -> 'CALENDAR' IS NULL;

