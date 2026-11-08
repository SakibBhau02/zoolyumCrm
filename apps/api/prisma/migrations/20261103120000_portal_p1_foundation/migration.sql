-- Portal P1 foundation: per-contact access, threaded messages, client notifications.
-- CreateEnum
CREATE TYPE "PortalScope" AS ENUM ('ALL', 'CUSTOM');

-- AlterTable
ALTER TABLE "ClientComment" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "threadKey" TEXT NOT NULL DEFAULT 'general',
ALTER COLUMN "projectId" DROP NOT NULL;

-- Backfill: existing comments all belong to their project thread.
UPDATE "ClientComment" SET "threadKey" = "projectId" WHERE "projectId" IS NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "portalUserId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PortalUser" ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramLinkCode" TEXT,
ADD COLUMN     "telegramLinkedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PortalContactAccess" (
    "id" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "scope" "PortalScope" NOT NULL DEFAULT 'ALL',
    "projectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modules" TEXT[] DEFAULT ARRAY['WORK', 'PERFORMANCE', 'MESSAGES', 'FILES', 'BILLING']::TEXT[],
    "canSeeAdSpend" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalContactAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalThreadRead" (
    "id" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalThreadRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalContactAccess_portalUserId_key" ON "PortalContactAccess"("portalUserId");

-- CreateIndex
CREATE INDEX "PortalThreadRead_threadKey_idx" ON "PortalThreadRead"("threadKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortalThreadRead_portalUserId_threadKey_key" ON "PortalThreadRead"("portalUserId", "threadKey");

-- CreateIndex
CREATE INDEX "ClientComment_threadKey_createdAt_idx" ON "ClientComment"("threadKey", "createdAt");

-- CreateIndex
CREATE INDEX "ClientComment_parentId_idx" ON "ClientComment"("parentId");

-- CreateIndex
CREATE INDEX "Notification_portalUserId_isRead_idx" ON "Notification"("portalUserId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_portalUserId_createdAt_idx" ON "Notification"("portalUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_telegramChatId_key" ON "PortalUser"("telegramChatId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalContactAccess" ADD CONSTRAINT "PortalContactAccess_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalThreadRead" ADD CONSTRAINT "PortalThreadRead_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientComment" ADD CONSTRAINT "ClientComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ClientComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
