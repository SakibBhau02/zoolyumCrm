-- People module integrity fixes (QA audit 2026-11-10)

-- 1. Employee shift is now an explicit override; NULL means "follow AttendancePolicy".
--    The previous @default("10:00"/"18:00") made every row non-null, so editing the
--    company policy had no effect on anyone. Rows that still hold the factory default
--    are reset to NULL (identical to the current policy, so behaviour is unchanged).
ALTER TABLE "Employee" ALTER COLUMN "shiftStart" DROP DEFAULT,
                       ALTER COLUMN "shiftEnd" DROP DEFAULT;

UPDATE "Employee" SET "shiftStart" = NULL WHERE "shiftStart" = '10:00';
UPDATE "Employee" SET "shiftEnd" = NULL WHERE "shiftEnd" = '18:00';

-- 2. One payroll record per employee per period (stops double salary runs).
CREATE UNIQUE INDEX "PayrollRecord_employeeId_period_key" ON "PayrollRecord"("employeeId", "period");

-- 3. A fingerprint device retrying an ATTLOG batch must not duplicate punches.
CREATE UNIQUE INDEX "PunchLog_deviceId_punchTime_key" ON "PunchLog"("deviceId", "punchTime");
