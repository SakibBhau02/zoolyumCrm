-- ── Branding singleton ────────────────────────────────────────────────
-- Every branding save used `findFirst()` with no ORDER BY, so repeated saves
-- left duplicates behind and a later read could pick any of them. The UI then
-- showed "the bank details never save" (they were written to another row).
--
-- 1. Merge every duplicate into the newest row, newest non-null value wins.
-- 2. Delete the duplicates.
-- 3. Pin the survivor to the fixed id `default`, like `Settings`, so the app
--    can never create a second one again.

DO $$
DECLARE
  keep_id text;
BEGIN
  IF (SELECT count(*) FROM "BrandingConfig") > 1 THEN
    SELECT id INTO keep_id FROM "BrandingConfig" ORDER BY "updatedAt" DESC LIMIT 1;

    WITH merged AS (
      SELECT
        (array_agg("logoUrl"                ORDER BY "updatedAt" DESC) FILTER (WHERE "logoUrl" IS NOT NULL))[1]                AS "logoUrl",
        (array_agg("logoDarkUrl"            ORDER BY "updatedAt" DESC) FILTER (WHERE "logoDarkUrl" IS NOT NULL))[1]            AS "logoDarkUrl",
        (array_agg("logoLightUrl"           ORDER BY "updatedAt" DESC) FILTER (WHERE "logoLightUrl" IS NOT NULL))[1]           AS "logoLightUrl",
        (array_agg("logoJxlUrl"             ORDER BY "updatedAt" DESC) FILTER (WHERE "logoJxlUrl" IS NOT NULL))[1]             AS "logoJxlUrl",
        (array_agg("logoDarkJxlUrl"         ORDER BY "updatedAt" DESC) FILTER (WHERE "logoDarkJxlUrl" IS NOT NULL))[1]         AS "logoDarkJxlUrl",
        (array_agg("logoLightJxlUrl"        ORDER BY "updatedAt" DESC) FILTER (WHERE "logoLightJxlUrl" IS NOT NULL))[1]        AS "logoLightJxlUrl",
        (array_agg("appName"                ORDER BY "updatedAt" DESC) FILTER (WHERE "appName" IS NOT NULL))[1]                AS "appName",
        (array_agg("primaryColor"           ORDER BY "updatedAt" DESC) FILTER (WHERE "primaryColor" IS NOT NULL))[1]           AS "primaryColor",
        (array_agg("secondaryColor"         ORDER BY "updatedAt" DESC) FILTER (WHERE "secondaryColor" IS NOT NULL))[1]         AS "secondaryColor",
        (array_agg("invoiceNumberingFormat" ORDER BY "updatedAt" DESC) FILTER (WHERE "invoiceNumberingFormat" IS NOT NULL))[1] AS "invoiceNumberingFormat",
        (array_agg("tagline"                ORDER BY "updatedAt" DESC) FILTER (WHERE "tagline" IS NOT NULL))[1]                AS "tagline",
        (array_agg("email"                  ORDER BY "updatedAt" DESC) FILTER (WHERE "email" IS NOT NULL))[1]                  AS "email",
        (array_agg("phone"                  ORDER BY "updatedAt" DESC) FILTER (WHERE "phone" IS NOT NULL))[1]                  AS "phone",
        (array_agg("address"                ORDER BY "updatedAt" DESC) FILTER (WHERE "address" IS NOT NULL))[1]                AS "address",
        (array_agg("city"                   ORDER BY "updatedAt" DESC) FILTER (WHERE "city" IS NOT NULL))[1]                   AS "city",
        (array_agg("country"                ORDER BY "updatedAt" DESC) FILTER (WHERE "country" IS NOT NULL))[1]                AS "country",
        (array_agg("taxId"                  ORDER BY "updatedAt" DESC) FILTER (WHERE "taxId" IS NOT NULL))[1]                  AS "taxId",
        (array_agg("website"                ORDER BY "updatedAt" DESC) FILTER (WHERE "website" IS NOT NULL))[1]                AS "website",
        (array_agg("authorizedSignerName"   ORDER BY "updatedAt" DESC) FILTER (WHERE "authorizedSignerName" IS NOT NULL))[1]   AS "authorizedSignerName",
        (array_agg("authorizedSignerTitle"  ORDER BY "updatedAt" DESC) FILTER (WHERE "authorizedSignerTitle" IS NOT NULL))[1]  AS "authorizedSignerTitle",
        (array_agg("signatureImageUrl"      ORDER BY "updatedAt" DESC) FILTER (WHERE "signatureImageUrl" IS NOT NULL))[1]      AS "signatureImageUrl",
        (array_agg("defaultPaymentDetails"  ORDER BY "updatedAt" DESC) FILTER (WHERE "defaultPaymentDetails" IS NOT NULL))[1]  AS "defaultPaymentDetails",
        (array_agg("defaultCurrency"        ORDER BY "updatedAt" DESC) FILTER (WHERE "defaultCurrency" IS NOT NULL))[1]        AS "defaultCurrency",
        (array_agg("defaultNotes"           ORDER BY "updatedAt" DESC) FILTER (WHERE "defaultNotes" IS NOT NULL))[1]           AS "defaultNotes",
        (array_agg("defaultTerms"           ORDER BY "updatedAt" DESC) FILTER (WHERE "defaultTerms" IS NOT NULL))[1]           AS "defaultTerms"
      FROM "BrandingConfig"
    )
    UPDATE "BrandingConfig" b SET
      "logoUrl" = COALESCE(m."logoUrl", b."logoUrl"),
      "logoDarkUrl" = COALESCE(m."logoDarkUrl", b."logoDarkUrl"),
      "logoLightUrl" = COALESCE(m."logoLightUrl", b."logoLightUrl"),
      "logoJxlUrl" = COALESCE(m."logoJxlUrl", b."logoJxlUrl"),
      "logoDarkJxlUrl" = COALESCE(m."logoDarkJxlUrl", b."logoDarkJxlUrl"),
      "logoLightJxlUrl" = COALESCE(m."logoLightJxlUrl", b."logoLightJxlUrl"),
      "appName" = COALESCE(m."appName", b."appName"),
      "primaryColor" = COALESCE(m."primaryColor", b."primaryColor"),
      "secondaryColor" = COALESCE(m."secondaryColor", b."secondaryColor"),
      "invoiceNumberingFormat" = COALESCE(m."invoiceNumberingFormat", b."invoiceNumberingFormat"),
      "tagline" = COALESCE(m."tagline", b."tagline"),
      "email" = COALESCE(m."email", b."email"),
      "phone" = COALESCE(m."phone", b."phone"),
      "address" = COALESCE(m."address", b."address"),
      "city" = COALESCE(m."city", b."city"),
      "country" = COALESCE(m."country", b."country"),
      "taxId" = COALESCE(m."taxId", b."taxId"),
      "website" = COALESCE(m."website", b."website"),
      "authorizedSignerName" = COALESCE(m."authorizedSignerName", b."authorizedSignerName"),
      "authorizedSignerTitle" = COALESCE(m."authorizedSignerTitle", b."authorizedSignerTitle"),
      "signatureImageUrl" = COALESCE(m."signatureImageUrl", b."signatureImageUrl"),
      "defaultPaymentDetails" = COALESCE(m."defaultPaymentDetails", b."defaultPaymentDetails"),
      "defaultCurrency" = COALESCE(m."defaultCurrency", b."defaultCurrency"),
      "defaultNotes" = COALESCE(m."defaultNotes", b."defaultNotes"),
      "defaultTerms" = COALESCE(m."defaultTerms", b."defaultTerms")
    FROM merged m
    WHERE b.id = keep_id;

    DELETE FROM "BrandingConfig" WHERE id <> keep_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "BrandingConfig" WHERE id = 'default') THEN
    UPDATE "BrandingConfig" SET id = 'default' WHERE id = (SELECT id FROM "BrandingConfig" ORDER BY "updatedAt" DESC LIMIT 1);
  END IF;
END $$;

-- ── Bank & mobile-financial-services accounts ─────────────────────────
-- `BankAccount` only stored a display name, so an invoice could not print the
-- bank name / account number / branch, and Rocket and Upay had no type at all.
ALTER TYPE "BankAccountType" ADD VALUE IF NOT EXISTS 'ROCKET';
ALTER TYPE "BankAccountType" ADD VALUE IF NOT EXISTS 'UPAY';

ALTER TABLE "BankAccount"
  ADD COLUMN IF NOT EXISTS "accountHolder" TEXT,
  ADD COLUMN IF NOT EXISTS "bankName" TEXT,
  ADD COLUMN IF NOT EXISTS "accountNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "branch" TEXT,
  ADD COLUMN IF NOT EXISTS "routingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "showOnInvoice" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
