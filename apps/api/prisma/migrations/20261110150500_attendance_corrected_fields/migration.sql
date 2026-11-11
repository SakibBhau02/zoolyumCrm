-- Track which attendance fields HR corrected by hand, so the nightly
-- recompute can refresh the rest instead of overwriting the whole row.
ALTER TABLE "Attendance" ADD COLUMN "correctedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Existing corrected rows: we cannot know which field was edited, so protect
-- status only (the most common correction) and keep times refreshable.
UPDATE "Attendance" SET "correctedFields" = ARRAY['status'] WHERE "isManuallyCorrected" = true;
