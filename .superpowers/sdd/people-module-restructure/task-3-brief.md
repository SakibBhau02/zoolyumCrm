# Task 3 Brief: Create attendance.service.ts

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 3)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/api/src/people/attendance.service.ts`
- Read-only source: `apps/api/src/people/people.service.ts` (still contains the methods to move)

## Global constraints that bind this task

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- API routes must NOT change. Method names and signatures preserved verbatim — do not rename.
- Day-level date math keeps the UTC-getter convention (dateStr, monthRange, weekdayName); punch
  time-of-day keeps local getters (toHHmm, minutesOf). Do not change timezone logic.
- No git repo in this workspace — do not commit. Verify by running the build.
- Do NOT dispatch subagents.

## What to produce

Create `apps/api/src/people/attendance.service.ts`. This is the biggest service — it owns the
attendance policy, punch engine (device/kiosk/import/mapping), attendance CRUD/reports, and
holidays.

### Methods to move (locate by FUNCTION NAME in `people.service.ts`; copy bodies verbatim)

Move these methods out of `apps/api/src/people/people.service.ts` into the new file:

Private helpers:
- `offDaysFor` (private)
- `computeDayStatus` (private)
- `syncDay` (private)
- `recomputeDay` (private)

Public methods:
- `attendancePolicy`
- `updateAttendancePolicy`
- `importPunches`
- `iclockGetRequest`
- `iclockPushData`
- `punches`
- `mapPunch`
- `kioskPunch`
- `recomputeMonth`
- `correctAttendance`
- `attendanceReport`
- `lateList`
- `recordAttendance`
- `attendanceMonth`
- `attendanceSummary`
- `holidays`
- `createHoliday`
- `deleteHoliday`

DO NOT move anything else. The old file keeps its remaining methods for now.

### Class skeleton

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AttendanceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { dateStr, invalidatePeopleCache, minutesOf, monthRange, toHHmm, weekdayName } from "./people-utils";

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // moved method bodies go here
}
```

### Required transformations inside the moved bodies

- The old class defined private helpers `dateStr`, `monthRange`, `minutesOf`, `toHHmm`,
  `weekdayName` as arrow-function properties. Do NOT copy those four into the new class.
  Instead, everywhere a body calls `this.dateStr(...)`, `this.monthRange(...)`,
  `this.minutesOf(...)`, `this.toHHmm(...)`, `this.weekdayName(...)`, call the imported
  function directly: `dateStr(...)`, `monthRange(...)`, `minutesOf(...)`, `toHHmm(...)`,
  `weekdayName(...)`. The imported names are identical to the old property names, so this is
  a mechanical `this.` → `` change on those five identifiers.
- `attendancePolicy` is called internally as `this.attendancePolicy()` in `recomputeDay`,
  `recomputeMonth`, `attendanceReport`, `lateList` — keep those calls as `this.attendancePolicy()`
  (it is a method of this class).
- Replace `await this.invalidatePeople();` with `await invalidatePeopleCache(this.cache);`
  in: `importPunches`, `mapPunch`, `kioskPunch`, `recomputeMonth`, `correctAttendance`,
  `recordAttendance`.
- `iclockPushData` calls `this.importPunches(...)` — keep it (same class).
- `offDaysFor`, `computeDayStatus`, `syncDay`, `recomputeDay` stay private methods of this class.
- Keep imports limited to what the moved methods use. `AttendanceStatus` is used in
  `computeDayStatus`'s return type annotation and in `recordAttendance`'s body — keep it.
  If a moved method uses an identifier you did not import, add the import (only if it is a
  real dependency).

## Verify

Run `npm run build` (workdir `apps/api`). Expected: succeeds. A successful build now means
`people.service.ts`, `directory.service.ts` (Task 2), and `attendance.service.ts` all compile.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-3-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path