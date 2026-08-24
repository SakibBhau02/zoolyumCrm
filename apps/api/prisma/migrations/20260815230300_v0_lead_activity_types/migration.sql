-- v0-crm lead module parity: activity history system types (created / updated / stage_changed)
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'STAGE_CHANGED';