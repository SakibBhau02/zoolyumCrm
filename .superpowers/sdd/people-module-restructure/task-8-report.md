# Task 8 Report: Create payroll.service.ts

Status: DONE

## Summary

Created `apps/api/src/people/payroll.service.ts` per the brief — a mechanical extraction of the
4 payroll methods from `apps/api/src/people/people.service.ts` into a new `PayrollService` class.

## What was done

- Created `apps/api/src/people/payroll.service.ts` with the exact skeleton from the brief:
  imports of `Injectable`, `NotFoundException`, `PrismaService`, `CacheService`, `CapitalService`,
  `AttendanceService` (from `./attendance.service`), and the `leaveDays` util (from `./people-utils`).
- Constructor injects `prisma`, `cache`, `capital`, and `attendance` (AttendanceService),
  exactly as specified.
- Moved method bodies verbatim (locate by function name in `people.service.ts`):
  1. `payslip(id)` — unchanged (uses `this.prisma`).
  2. `payroll(period?)` — unchanged (uses `this.prisma`).
  3. `runPayroll(period)` — transformed:
     - `this.attendanceReport(period)` → `this.attendance.attendanceReport(period)`
     - `this.leaveDays(l.startDate, l.endDate)` → `leaveDays(l.startDate, l.endDate)`
     - All other references (`this.prisma`) unchanged.
  4. `updatePayrollStatus(id, status)` — unchanged (uses `this.prisma`, `this.capital`,
     `this.cache`).
- No other files modified. `people.service.ts` left untouched (the old service still contains
  the methods; removal is handled by a later task).

## Verification

- `npm run build` (workdir `apps/api`) — succeeded with no errors or warnings.
  All 8 people files + old service compile together.

## Self-review checklist

- [x] All 4 methods moved (`payslip`, `payroll`, `runPayroll`, `updatePayrollStatus`)
- [x] Transformations applied exactly as specified (2 changes, both in `runPayroll`)
- [x] No other behavior changed — bodies copied verbatim; method names/signatures preserved
- [x] `leaveDays` imported from `./people-utils` (confirmed exported there)
- [x] `attendanceReport` exists on `AttendanceService` (Task 3) with the same signature
- [x] Build passes

## Concerns

None.