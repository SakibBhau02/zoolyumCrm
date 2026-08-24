-- CalendarEvent: missing projectId column
ALTER TABLE "CalendarEvent" ADD COLUMN "projectId" TEXT;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;