# Task 8 Brief: Create payroll.service.ts

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 8)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/api/src/people/payroll.service.ts`
- Read-only source: `apps/api/src/people/people.service.ts`
- Read-only: `apps/api/src/people/attendance.service.ts` (Task 3 — exists, exports `AttendanceService`)

## Global constraints

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- Method names/signatures preserved verbatim — do not rename. No route changes.
- No git repo — do not commit. Verify by running the build.
- Do NOT dispatch subagents.

## What to produce

Create `apps/api/src/people/payroll.service.ts`.

### Methods to move (locate by FUNCTION NAME in `people.service.ts`)

- `payslip`
- `payroll`
- `runPayroll`
- `updatePayrollStatus`

### Class skeleton

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { CapitalService } from "../capital/capital.service";
import { AttendanceService } from "./attendance.service";
import { leaveDays } from "./people-utils";

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly capital: CapitalService,
    private readonly attendance: AttendanceService
  ) {}

  // moved method bodies go here
}
```

### Transformations inside the moved bodies

- `runPayroll` calls `this.attendanceReport(period)` in the old class. Change it to
  `this.attendance.attendanceReport(period)` (AttendanceService is injected as `attendance`).
- `runPayroll` calls `this.leaveDays(...)` in the old class. Change it to `leaveDays(...)`
  (the util import).
- All other `this.` references (`this.prisma`, `this.cache`, `this.capital`) stay as-is.

## Verify

Run `npm run build` (workdir `apps/api`). Expected: succeeds — all 8 people files + old
service compile together.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-8-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path