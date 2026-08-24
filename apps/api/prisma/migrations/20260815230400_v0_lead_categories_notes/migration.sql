-- v0-crm lead module parity: custom categories (LeadCategory table), note history (LeadNote)

ALTER TYPE "LeadCategory" RENAME TO "LeadCategoryOld";

CREATE TABLE "LeadCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadCategory_name_key" ON "LeadCategory"("name");

INSERT INTO "LeadCategory" ("id", "name", "color") VALUES
  ('lc_digital_marketing', 'Digital Marketing', '#a78bfa'),
  ('lc_seo', 'SEO', '#34d399'),
  ('lc_social_media', 'Social Media', '#f472b6'),
  ('lc_content', 'Content', '#fbbf24'),
  ('lc_branding', 'Branding', '#38bdf8'),
  ('lc_web_development', 'Web Development', '#2dd4bf'),
  ('lc_ppc', 'PPC', '#fb923c'),
  ('lc_other', 'Other', NULL);

ALTER TABLE "Lead" ADD COLUMN "leadCategoryId" TEXT;

UPDATE "Lead" SET "leadCategoryId" = CASE "category"
  WHEN 'DIGITAL_MARKETING' THEN 'lc_digital_marketing'
  WHEN 'SEO' THEN 'lc_seo'
  WHEN 'SOCIAL_MEDIA' THEN 'lc_social_media'
  WHEN 'CONTENT' THEN 'lc_content'
  WHEN 'BRANDING' THEN 'lc_branding'
  WHEN 'WEB_DEVELOPMENT' THEN 'lc_web_development'
  WHEN 'PPC' THEN 'lc_ppc'
  ELSE 'lc_other'
END;

ALTER TABLE "Lead" DROP COLUMN "category";
DROP TYPE "LeadCategoryOld";

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_leadCategoryId_fkey" FOREIGN KEY ("leadCategoryId") REFERENCES "LeadCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Lead_leadCategoryId_idx" ON "Lead"("leadCategoryId");

CREATE TABLE "LeadNote" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadNote_leadId_idx" ON "LeadNote"("leadId");

ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;