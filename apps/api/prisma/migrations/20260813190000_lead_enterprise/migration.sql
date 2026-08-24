-- LeadSource: professional multi-channel set (append-only)
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'LINKEDIN';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'COLD_CALL';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'EMAIL_CAMPAIGN';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'EVENT';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PARTNER';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'INBOUND_PHONE';

-- ActivityType: add LINKEDIN
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'LINKEDIN';

-- New enums
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "MeetingType" AS ENUM ('CALL', 'VIDEO_CALL', 'IN_PERSON', 'DEMO');
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- Lead: enterprise fields
ALTER TABLE "Lead"
  ADD COLUMN "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "stageEnteredAt" TIMESTAMP(3),
  ADD COLUMN "firstResponseAt" TIMESTAMP(3),
  ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

-- LeadMeeting table
CREATE TABLE "LeadMeeting" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "MeetingType" NOT NULL DEFAULT 'VIDEO_CALL',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "durationMins" INTEGER NOT NULL DEFAULT 30,
  "meetingLink" TEXT,
  "location" TEXT,
  "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadMeeting_pkey" PRIMARY KEY ("id")
);

-- Client <-> Lead (FK on Lead.convertedClientId)
ALTER TABLE "Client" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Client_leadId_key" UNIQUE ("leadId");

-- Project: source lead + proposal (protocol)
ALTER TABLE "Project"
  ADD COLUMN "sourceLeadId" TEXT,
  ADD COLUMN "sourceProposalId" TEXT,
  ADD CONSTRAINT "Project_sourceLeadId_fkey" FOREIGN KEY ("sourceLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Project_sourceProposalId_fkey" FOREIGN KEY ("sourceProposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Project_sourceProposalId_key" UNIQUE ("sourceProposalId");

-- LeadMeeting constraints
ALTER TABLE "LeadMeeting"
  ADD CONSTRAINT "LeadMeeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LeadMeeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;