-- Client-scoped comment threads: the general thread has no project, so the
-- client must be stored on the comment itself.
ALTER TABLE "ClientComment" ADD COLUMN "clientId" TEXT;

-- Backfill from the project so existing project threads stay attached.
UPDATE "ClientComment" cc
SET "clientId" = p."clientId"
FROM "Project" p
WHERE cc."projectId" = p."id";

CREATE INDEX "ClientComment_clientId_threadKey_createdAt_idx"
  ON "ClientComment"("clientId", "threadKey", "createdAt");

ALTER TABLE "ClientComment"
  ADD CONSTRAINT "ClientComment_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
