-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "deviceId" TEXT,
ADD COLUMN "weeklyOffDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "shiftStart" TEXT DEFAULT '10:00',
ADD COLUMN "shiftEnd" TEXT DEFAULT '18:00',
ADD COLUMN "graceMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN "tentative" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isGovernment" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN "lateDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "halfDayDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "absentDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "breakdown" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE "AttendancePolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "weeklyOffDays" TEXT[] NOT NULL DEFAULT ARRAY['FRIDAY','SATURDAY']::TEXT[],
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "shiftStart" TEXT NOT NULL DEFAULT '10:00',
    "shiftEnd" TEXT NOT NULL DEFAULT '18:00',
    "halfDayCutoff" TEXT NOT NULL DEFAULT '12:00',
    "lateLadder" JSONB NOT NULL DEFAULT '[{"lates":3,"days":1},{"lates":6,"days":2},{"lates":9,"days":3}]',
    "dailyRateDivisor" INTEGER NOT NULL DEFAULT 26,
    "proRataEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT,
    "punchTime" TIMESTAMP(3) NOT NULL,
    "verifyMethod" TEXT,
    "workCode" TEXT,
    "deviceSn" TEXT,
    "source" TEXT NOT NULL DEFAULT 'DEVICE',
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "unmatched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "correctedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_deviceId_key" ON "Employee"("deviceId");

-- CreateIndex
CREATE INDEX "PunchLog_employeeId_punchTime_idx" ON "PunchLog"("employeeId", "punchTime");

-- CreateIndex
CREATE INDEX "PunchLog_punchTime_idx" ON "PunchLog"("punchTime");

-- CreateIndex
CREATE INDEX "PunchLog_unmatched_idx" ON "PunchLog"("unmatched");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_attendanceId_idx" ON "AttendanceCorrection"("attendanceId");

-- AddForeignKey
ALTER TABLE "PunchLog" ADD CONSTRAINT "PunchLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the default attendance policy row
INSERT INTO "AttendancePolicy" ("id", "weeklyOffDays", "graceMinutes", "shiftStart", "shiftEnd", "halfDayCutoff", "lateLadder", "dailyRateDivisor", "proRataEnabled", "updatedAt")
VALUES ('default', ARRAY['FRIDAY','SATURDAY']::TEXT[], 15, '10:00', '18:00', '12:00', '[{"lates":3,"days":1},{"lates":6,"days":2},{"lates":9,"days":3}]', 26, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;