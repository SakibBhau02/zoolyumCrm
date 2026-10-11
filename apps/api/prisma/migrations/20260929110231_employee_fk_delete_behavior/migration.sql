-- DropForeignKey
ALTER TABLE "AttendanceCorrection" DROP CONSTRAINT "AttendanceCorrection_employeeId_fkey";

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
