-- Department → allowed task types. Empty array means "no restriction".
ALTER TABLE "Settings" ADD COLUMN "departmentTaskTypes" JSONB NOT NULL DEFAULT '[]';
