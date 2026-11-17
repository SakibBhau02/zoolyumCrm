-- Trigram indexes for the Pulse lead search.
--
-- `contains` + `mode: insensitive` compiles to ILIKE '%q%', which no B-tree
-- index can serve: every keystroke scanned the whole Lead table (audit PERF-05).
-- pg_trgm GIN indexes make leading-wildcard matches indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Lead_name_trgm_idx" ON "Lead" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_company_trgm_idx" ON "Lead" USING GIN ("company" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_contactEmail_trgm_idx" ON "Lead" USING GIN ("contactEmail" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_contactPhone_trgm_idx" ON "Lead" USING GIN ("contactPhone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_uid_trgm_idx" ON "Lead" USING GIN ("uid" gin_trgm_ops);
