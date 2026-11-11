-- Portal hardening: revocable sessions, expiring Telegram links, deny-by-default access,
-- one approval row per file/contact, and richer activity actions.

-- AlterTable
ALTER TABLE "PortalUser" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "telegramLinkCreatedAt" TIMESTAMP(3);

-- Deny by default: an explicit access row with no modules grants nothing.
ALTER TABLE "PortalContactAccess" ALTER COLUMN "modules" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "canSeeAdSpend" SET DEFAULT false;

-- One decision row per deliverable per contact (history stays in PortalActivityLog).
DELETE FROM "DeliverableApproval" a
USING "DeliverableApproval" b
WHERE a."projectFileId" = b."projectFileId"
  AND a."portalUserId" = b."portalUserId"
  AND (a."decidedAt" < b."decidedAt" OR (a."decidedAt" = b."decidedAt" AND a."id" < b."id"));

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableApproval_projectFileId_portalUserId_key" ON "DeliverableApproval"("projectFileId", "portalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_email_key" ON "ClientContact"("email");

-- AlterEnum
ALTER TYPE "PortalAction" ADD VALUE IF NOT EXISTS 'FILE_DOWNLOADED';
ALTER TYPE "PortalAction" ADD VALUE IF NOT EXISTS 'VIEWED_REPORT';
