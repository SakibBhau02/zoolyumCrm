# Task 3 Report: Create attendance.service.ts

## Status: DONE

## What was created

`apps/api/src/people/attendance.service.ts` — new `@Injectable()` `AttendanceService` class with
constructor injecting `PrismaService` and `CacheService`, per the class skeleton in the brief.
`apps/api/src/people/people.service.ts` was NOT modified (read-only source).

## Methods moved (22 of 22 from the brief, all present)

Private helpers (kept private in the new class):
- `offDaysFor` (line 15)
- `computeDayStatus` (line 20)
- `syncDay` (line 51)
- `recomputeDay` (line 83)

Public methods:
- `attendancePolicy` (35), `updateAttendancePolicy` (43), `importPunches` (103),
  `iclockGetRequest` (146), `iclockPushData` (150), `punches` (174), `mapPunch` (189),
  `kioskPunch` (200), `recomputeMonth` (218), `correctAttendance` (262),
  `attendanceReport` (287), `lateList` (345), `recordAttendance` (372),
  `attendanceMonth` (398), `attendanceSummary` (409), `holidays` (425),
  `createHoliday` (429), `deleteHoliday` (441)

No other methods were copied (no overview/employees/leave/payroll/OKR/training/candidate
methods present). Verified by grepping all method definitions in the new file.

## Transformations applied

1. **Five private date helpers NOT copied** (`dateStr`, `monthRange`, `minutesOf`, `toHHmm`,
   `weekdayName` are not defined in the new class). All call sites rewritten from
   `this.<name>(...)` to `<name>(...)` using imports from `./people-utils`. Grep confirms
   zero occurrences of `this.dateStr|this.monthRange|this.minutesOf|this.toHHmm|this.weekdayName`
   in `attendance.service.ts`.
2. **`this.invalidatePeople()` → `await invalidatePeopleCache(this.cache)`** in exactly the 6
   listed methods: `importPunches` (142), `mapPunch` (196), `kioskPunch` (214),
   `recomputeMonth` (258), `correctAttendance` (283), `recordAttendance` (394).
3. **`this.attendancePolicy()` internal calls preserved** (method of this class) in
   `recomputeDay` (85), `recomputeMonth` (220), `attendanceReport` (289), `lateList` (355).
4. **`this.importPunches(...)` preserved** in `iclockPushData` (169).
5. **Private call chains preserved** as `this.` calls: `offDaysFor`, `computeDayStatus`,
   `syncDay`, `recomputeDay` cross-references.
6. Imports limited to what the moved bodies use: `BadRequestException`, `Injectable`,
   `NotFoundException` (from `@nestjs/common`), `AttendanceStatus` (from `@prisma/client`),
   `PrismaService`, `CacheService`, and `dateStr, invalidatePeopleCache, minutesOf, monthRange,
   toHHmm, weekdayName` from `./people-utils`. `ForbiddenException`/`CapitalService`/`leaveDays`
   are not needed by any moved body and were omitted. All imports are used (no unused).

## Verification

- Command: `npm run build` (workdir `apps/api`) → `nest build` exited 0, no errors or warnings.
- This confirms `people.service.ts`, `directory.service.ts` (Task 2), and
  `attendance.service.ts` all compile under TypeScript strict.
- Timezone convention untouched: day-level math (UTC getters) and punch time-of-day (local
  getters) preserved verbatim — the util functions are identical implementations, so no
  behavior change.

## Self-review notes

- All 22 listed methods moved, verbatim bodies, only the mechanical `this.` → import
  substitutions described above; nothing else changed (confirmed by inspection of each body
  against the source).
- Old `people.service.ts` untouched — its copies of these methods still exist (deletion is a
  later task); controller wiring is unchanged and still compiles.
- No git repo in this workspace — no commit performed.
