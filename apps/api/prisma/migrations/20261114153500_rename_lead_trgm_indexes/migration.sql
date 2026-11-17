-- Prisma names an index <Table>_<Column>_idx; the trigram migration used a
-- hand-written *_trgm_idx name, so the schema and the database disagreed.
ALTER INDEX "Lead_name_trgm_idx" RENAME TO "Lead_name_idx";
ALTER INDEX "Lead_company_trgm_idx" RENAME TO "Lead_company_idx";
ALTER INDEX "Lead_contactEmail_trgm_idx" RENAME TO "Lead_contactEmail_idx";
ALTER INDEX "Lead_contactPhone_trgm_idx" RENAME TO "Lead_contactPhone_idx";
ALTER INDEX "Lead_uid_trgm_idx" RENAME TO "Lead_uid_idx";