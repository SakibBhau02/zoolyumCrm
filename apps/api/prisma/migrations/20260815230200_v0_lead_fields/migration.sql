-- v0-crm lead module parity: temperature, category, probability, starred, tags, website/pageLink, uid, follow-ups, activity diffs, meeting attendees, QUALIFIED stage

ALTER TYPE "LeadStage" ADD VALUE IF NOT EXISTS 'QUALIFIED';

CREATE TYPE "LeadTemperature" AS ENUM ('HOT', 'WARM', 'COLD');
CREATE TYPE "LeadCategory" AS ENUM ('DIGITAL_MARKETING', 'SEO', 'SOCIAL_MEDIA', 'CONTENT', 'BRANDING', 'WEB_DEVELOPMENT', 'PPC', 'OTHER');
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'MISSED');

ALTER TABLE "Lead"
  ADD COLUMN "temperature" "LeadTemperature" NOT NULL DEFAULT 'WARM',
  ADD COLUMN "category" "LeadCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "probability" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "website" TEXT,
  ADD COLUMN "pageLink" TEXT,
  ADD COLUMN "uid" TEXT;

UPDATE "Lead" SET "uid" = sub.uid
FROM (
  SELECT id, 'LD-' || LPAD((row_number() OVER (ORDER BY "createdAt", "id"))::text, 4, '0') AS uid
  FROM "Lead"
) sub
WHERE "Lead"."id" = sub.id AND "Lead"."uid" IS NULL;

CREATE UNIQUE INDEX "Lead_uid_key" ON "Lead"("uid");

CREATE TABLE "LeadFollowUp" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadFollowUp_leadId_idx" ON "LeadFollowUp"("leadId");
CREATE INDEX "LeadFollowUp_date_idx" ON "LeadFollowUp"("date");

ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadActivity" ADD COLUMN "changes" JSONB;

ALTER TABLE "LeadMeeting" ADD COLUMN "attendees" JSONB;

UPDATE "PipelineStage" SET "order" = "order" + 100 WHERE "order" >= 2;
UPDATE "PipelineStage" SET "order" = "order" - 99 WHERE "order" >= 102;
INSERT INTO "PipelineStage" ("id", "name", "order", "slaDays")
VALUES ('ps_qualified', 'Qualified', 2, 4)
ON CONFLICT ("name") DO NOTHING;