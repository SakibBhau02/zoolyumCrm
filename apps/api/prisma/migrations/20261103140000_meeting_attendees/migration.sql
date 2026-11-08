-- CreateTable
CREATE TABLE "LeadMeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "markedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadMeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadMeetingAttendee_employeeId_idx" ON "LeadMeetingAttendee"("employeeId");

-- CreateIndex
CREATE INDEX "LeadMeetingAttendee_meetingId_idx" ON "LeadMeetingAttendee"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadMeetingAttendee_meetingId_employeeId_key" ON "LeadMeetingAttendee"("meetingId", "employeeId");

-- AddForeignKey
ALTER TABLE "LeadMeetingAttendee" ADD CONSTRAINT "LeadMeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "LeadMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMeetingAttendee" ADD CONSTRAINT "LeadMeetingAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the legacy JSON blob.
-- LeadMeeting.attendees is an array of { id, name } where `id` is a User id, so
-- the only link back to an employee is User.employeeId. Meetings whose attendees
-- were free-text names (no matching User) cannot be recovered — they stay empty.
INSERT INTO "LeadMeetingAttendee" ("id", "meetingId", "employeeId", "status", "createdAt")
SELECT gen_random_uuid()::text, m."id", u."employeeId", 'INVITED', CURRENT_TIMESTAMP
FROM "LeadMeeting" m
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN m."attendees" IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(m."attendees") = 'array' THEN m."attendees"
      ELSE '[]'::jsonb
    END
) AS elem
JOIN "User" u ON u."id" = elem->>'id'
WHERE u."employeeId" IS NOT NULL
ON CONFLICT ("meetingId", "employeeId") DO NOTHING;
