-- v0-crm task dependency type (blocked-by / blocks / related)
ALTER TABLE "TaskDependency" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'blocked-by';