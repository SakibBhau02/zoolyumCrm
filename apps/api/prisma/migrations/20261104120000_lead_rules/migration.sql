-- Lead intake rules: configurable validation / duplicate / routing / scoring / SLA.
-- The rules themselves live in "Settings"."leadRules" so they can be toggled from Control.

ALTER TABLE "Settings" ADD COLUMN "leadRules" JSONB NOT NULL DEFAULT '{}';

-- Normalised phone (E.164-ish) so duplicate matching does not depend on how the
-- rep typed the number. Backfilled by `npm run backfill:lead-phones` / the rules engine.
ALTER TABLE "Lead" ADD COLUMN "phoneNormalized" TEXT;

-- Rule-engine output shown on the lead list: NO_PHONE, NO_COMPANY, DUPLICATE,
-- STALE, SLA_BREACH, UNASSIGNED.
ALTER TABLE "Lead" ADD COLUMN "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Lead_phoneNormalized_idx" ON "Lead"("phoneNormalized");
