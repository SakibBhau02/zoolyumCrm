# People Module Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the People module — split the API into 7 domain services and convert the single 1647-line frontend page into nested-route tab pages with a shared layout, plus a centered employee profile modal.

**Architecture:** API: one `PeopleModule` with 7 injectable services sharing a small pure-utils file; `PeopleController` becomes a thin router. Frontend: `people/` becomes a route folder with a client `layout.tsx` (PageHeader + Link-based tab bar using `usePathname`), one page file per tab, and a `_components/` folder for shared constants, hooks, and modals. The employee profile right-Drawer becomes a centered `Modal` (size `xl`).

**Tech Stack:** NestJS, Prisma 6.19.3, Next.js 16 (params is a `Promise`; client components use `useParams`/`usePathname`/`next/link`), React 19, TypeScript strict, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-08-20-people-module-restructure-design.md`

## Global Constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`). API build: `npm run build` (workdir `apps/api`).
- API routes must NOT change — every route path, method, query/body shape stays identical so the e2e suite and the running device integration keep working.
- No git repo in this workspace — omit commit steps; replace them with a Verify step (run the task's build/test command).
- Day-level date math in the API must keep the UTC-getter convention (`dateStr`, `monthRange`); punch time-of-day keeps local getters. Do not change timezone logic during this refactor.
- Encoding: never paste the mojibake sequence into edited files — it double-encodes. Type the real em-dash (U+2014) and arrow (U+2192) directly.
- Frontend routes use kebab-case paths; tab labels keep current display text (e.g. label "Org Chart" -> path `/people/org-chart`).
- The shared `Segmented`/`Drawer` components in `apps/web/src/components/ui.tsx` are NOT modified (used elsewhere); the people tab bar is a new local `TabNav`.
- e2e runs: `npx playwright test e2e/ --reporter=line --workers=1` (workdir `apps/web`). Login helper: `getByPlaceholder("you@zoolyum.com")`, `input[type="password"]`, button "Sign in".
- Source of truth for all moved code: `apps/api/src/people/people.service.ts` (1059 lines) and `apps/web/src/app/(app)/people/page.tsx` (1647 lines). Executors cut exact ranges from these files — do not rewrite method bodies from memory.

---

## File Structure

**API:**
- Create: `apps/api/src/people/people-utils.ts` — pure date/leave helpers + cache invalidator
- Create: `apps/api/src/people/directory.service.ts`
- Create: `apps/api/src/people/attendance.service.ts`
- Create: `apps/api/src/people/leave.service.ts`
- Create: `apps/api/src/people/performance.service.ts`
- Create: `apps/api/src/people/training.service.ts`
- Create: `apps/api/src/people/recruitment.service.ts`
- Create: `apps/api/src/people/payroll.service.ts`
- Modify: `apps/api/src/people/people.module.ts` (providers: 7 services)
- Modify: `apps/api/src/people/people.controller.ts` (thin router over 7 services)
- Modify: `apps/api/src/people/iclock.controller.ts` (inject `AttendanceService`)
- Delete: `apps/api/src/people/people.service.ts` (only after every method has moved)

**Web:**
- Create: `apps/web/src/app/(app)/people/_components/constants.ts`
- Create: `apps/web/src/app/(app)/people/_components/hooks.ts`
- Create: `apps/web/src/app/(app)/people/_components/tab-nav.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/employee-form.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/employee-profile.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/attendance-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/leave-modal.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/holiday-modal.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/performance-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/training-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/candidate-modal.tsx`
- Create: `apps/web/src/app/(app)/people/layout.tsx` (client: PageHeader + TabNav)
- Rewrite: `apps/web/src/app/(app)/people/page.tsx` -> becomes the Overview page
- Create: `apps/web/src/app/(app)/people/directory/page.tsx`
- Create: `apps/web/src/app/(app)/people/attendance/page.tsx`
- Create: `apps/web/src/app/(app)/people/leave/page.tsx`
- Create: `apps/web/src/app/(app)/people/payroll/page.tsx`
- Create: `apps/web/src/app/(app)/people/settings/page.tsx`
- Create: `apps/web/src/app/(app)/people/performance/page.tsx`
- Create: `apps/web/src/app/(app)/people/okrs/page.tsx`
- Create: `apps/web/src/app/(app)/people/training/page.tsx`
- Create: `apps/web/src/app/(app)/people/candidates/page.tsx`
- Create: `apps/web/src/app/(app)/people/holidays/page.tsx`
- Create: `apps/web/src/app/(app)/people/org-chart/page.tsx`
- Create: `apps/web/src/app/(app)/people/skills/page.tsx`
- Move: `apps/web/src/app/(app)/people/payslip/[id]/page.tsx` -> `apps/web/src/app/(app)/people/payroll/payslip/[id]/page.tsx`; old path becomes a redirect
- Modify: `apps/web/e2e/people-payroll-pro.spec.ts` (button -> link selectors)

---

## Phase A — API split

### Task 1: Create shared people-utils.ts

**Files:**
- Create: `apps/api/src/people/people-utils.ts`

**Interfaces:**
- Produces: `dateStr(d: Date): string`, `monthRange(period: string): { start: Date; end: Date }`, `minutesOf(hhmm: string): number`, `toHHmm(d: Date): string`, `weekdayName(d: Date): string`, `leaveDays(start: Date, end: Date): number`, `invalidatePeopleCache(cache: CacheService): Promise<void>`
- Consumes: `CacheService` type from `../cache/cache.service`

- [ ] **Step 1: Create the file**

```ts
import type { CacheService } from "../cache/cache.service";

// Day keys follow the app convention: DATE columns round-trip as UTC
// midnight, so all day-level math uses UTC getters; punch time-of-day
// (late detection) uses local getters (device wall time).
export const dateStr = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export const monthRange = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const toHHmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const weekdayName = (d: Date) => ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][d.getUTCDay()];

export const leaveDays = (start: Date, end: Date): number => {
  const ms = new Date(end.getTime()).setHours(0, 0, 0, 0) - new Date(start.getTime()).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
};

export const invalidatePeopleCache = async (cache: CacheService) => {
  await cache.del("people:overview");
  await cache.del("people:employees");
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 2: Create directory.service.ts

**Files:**
- Create: `apps/api/src/people/directory.service.ts`

**Interfaces:**
- Produces: `DirectoryService` with `overview()`, `employees()`, `employeeDetail(id)`, `createEmployee(body, user)`, `updateEmployee(id, body, user)`, `deleteEmployee(id)`, `orgChart()`, `skillsMatrix()`, `utilizationTrend()`
- Consumes: `PrismaService`, `CacheService`, `invalidatePeopleCache` from `./people-utils`

- [ ] **Step 1: Cut these exact ranges from `apps/api/src/people/people.service.ts`**
- lines 15-47 (`overview`)
- lines 49-78 (`employees`)
- lines 80-97 (`employeeDetail`)
- lines 492-550 (`createEmployee`, `updateEmployee`, `deleteEmployee`)
- lines 990-1004 (`orgChart`)
- lines 1007-1029 (`skillsMatrix`)
- lines 1031-1058 (`utilizationTrend` + `utilizationTrendCompute`)

- [ ] **Step 2: Assemble the new file**

```ts
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { invalidatePeopleCache } from "./people-utils";

@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  // overview, employees, employeeDetail, createEmployee, updateEmployee,
  // deleteEmployee, orgChart, skillsMatrix, utilizationTrend,
  // utilizationTrendCompute — bodies verbatim from the cut ranges.
  // In createEmployee/updateEmployee/deleteEmployee replace
  //   await this.invalidatePeople();
  // with
  //   await invalidatePeopleCache(this.cache);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds (old `people.service.ts` still present, so no missing-provider errors yet).

### Task 3: Create attendance.service.ts

**Files:**
- Create: `apps/api/src/people/attendance.service.ts`

**Interfaces:**
- Produces: `AttendanceService` with `attendancePolicy()`, `updateAttendancePolicy(body)`, `importPunches(rows)`, `iclockGetRequest(sn?)`, `iclockPushData(sn, table, raw)`, `punches(month?, unmatchedOnly?)`, `mapPunch(id, employeeId)`, `kioskPunch(user, action)`, `recomputeMonth(month)`, `correctAttendance(id, body, user)`, `attendanceReport(month)`, `lateList(month)`, `recordAttendance(body)`, `attendanceMonth(month)`, `attendanceSummary(month)`, `holidays()`, `createHoliday(body)`, `deleteHoliday(id)`; private helpers `computeDayStatus`, `offDaysFor`, `syncDay`, `recomputeDay`
- Consumes: `PrismaService`, `CacheService`, `invalidatePeopleCache`, `dateStr`, `monthRange`, `minutesOf`, `toHHmm`, `weekdayName` from `./people-utils`

- [ ] **Step 1: Cut these exact ranges from `apps/api/src/people/people.service.ts`**
- lines 109-144 (private `dateStr`, `monthRange`, `minutesOf`, `toHHmm`, `weekdayName`, `offDaysFor`, `computeDayStatus` — keep only `offDaysFor` + `computeDayStatus`; the rest come from utils)
- lines 146-212 (`attendancePolicy`, `updateAttendancePolicy`, `syncDay`, `recomputeDay`)
- lines 214-371 (`importPunches`, `iclockGetRequest`, `iclockPushData`, `punches`, `mapPunch`, `kioskPunch`, `recomputeMonth`)
- lines 373-480 (`correctAttendance`, `attendanceReport`, `lateList`)
- lines 553-603 (`recordAttendance`, `attendanceMonth`, `attendanceSummary`)
- lines 966-987 (`holidays`, `createHoliday`, `deleteHoliday`)

- [ ] **Step 2: Assemble the new file**

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

  // offDaysFor, computeDayStatus (private)
  // attendancePolicy, updateAttendancePolicy, syncDay (private), recomputeDay (private)
  // importPunches, iclockGetRequest, iclockPushData, punches, mapPunch,
  // kioskPunch, recomputeMonth, correctAttendance, attendanceReport, lateList,
  // recordAttendance, attendanceMonth, attendanceSummary,
  // holidays, createHoliday, deleteHoliday — bodies verbatim.
  // Replace this.dateStr/this.monthRange/this.minutesOf/this.toHHmm/this.weekdayName
  // with the imported util names. Replace this.invalidatePeople() with
  // await invalidatePeopleCache(this.cache) in importPunches, mapPunch,
  // kioskPunch, recomputeMonth, correctAttendance, recordAttendance.
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 4: Create leave.service.ts

**Files:**
- Create: `apps/api/src/people/leave.service.ts`

**Interfaces:**
- Produces: `LeaveService` with `leaveRequests()`, `applyLeave(body)`, `approveLeave(id, approved, approvedById?)`, `leaveBalances(employeeId?)`
- Consumes: `PrismaService`, `leaveDays` from `./people-utils`

- [ ] **Step 1: Cut lines 605-665** from `people.service.ts` (`leaveDays` private helper, `leaveRequests`, `applyLeave`, `approveLeave`, `leaveBalances`). Do not copy the private `leaveDays` — use the imported util instead.

- [ ] **Step 2: Assemble the new file**

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { leaveDays } from "./people-utils";

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  // leaveRequests, applyLeave, approveLeave, leaveBalances — bodies verbatim,
  // replacing this.leaveDays(...) with leaveDays(...).
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 5: Create performance.service.ts

**Files:**
- Create: `apps/api/src/people/performance.service.ts`

**Interfaces:**
- Produces: `PerformanceService` with `reviews()`, `createReview(body)`, `updateReview(id, body)`, `okrs(employeeId?)`, `createOkr(body)`, `updateOkr(id, body)`, `deleteOkr(id)`; private `recomputeOkr`
- Consumes: `PrismaService`

- [ ] **Step 1: Cut lines 772-856** from `people.service.ts` (`reviews` through `recomputeOkr`).

- [ ] **Step 2: Assemble the new file**

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  // reviews, createReview, updateReview, okrs, createOkr, updateOkr,
  // deleteOkr, recomputeOkr (private) — bodies verbatim.
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 6: Create training.service.ts

**Files:**
- Create: `apps/api/src/people/training.service.ts`

**Interfaces:**
- Produces: `TrainingService` with `courses()`, `createCourse(body)`, `deleteCourse(id)`, `enrollments()`, `createEnrollment(body)`, `updateEnrollment(id, body)`
- Consumes: `PrismaService`

- [ ] **Step 1: Cut lines 858-919** from `people.service.ts` (`courses` through `updateEnrollment`).

- [ ] **Step 2: Assemble the new file**

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  // courses, createCourse, deleteCourse, enrollments, createEnrollment,
  // updateEnrollment — bodies verbatim.
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 7: Create recruitment.service.ts

**Files:**
- Create: `apps/api/src/people/recruitment.service.ts`

**Interfaces:**
- Produces: `RecruitmentService` with `candidates()`, `createCandidate(body)`, `updateCandidate(id, body)`, `deleteCandidate(id)`
- Consumes: `PrismaService`

- [ ] **Step 1: Cut lines 921-963** from `people.service.ts` (`candidates` through `deleteCandidate`).

- [ ] **Step 2: Assemble the new file**

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  // candidates, createCandidate, updateCandidate, deleteCandidate — bodies verbatim.
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 8: Create payroll.service.ts

**Files:**
- Create: `apps/api/src/people/payroll.service.ts`

**Interfaces:**
- Produces: `PayrollService` with `payroll(period?)`, `runPayroll(period)`, `updatePayrollStatus(id, status)`, `payslip(id)`
- Consumes: `PrismaService`, `CacheService`, `CapitalService` (from `../capital/capital.service`), `AttendanceService` (injected; only `attendanceReport` used), `leaveDays` from `./people-utils`

- [ ] **Step 1: Cut lines 482-491 (`payslip`) and lines 667-770 (`payroll`, `runPayroll`, `updatePayrollStatus`)** from `people.service.ts`.

- [ ] **Step 2: Assemble the new file**

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

  // payslip, payroll, runPayroll, updatePayrollStatus — bodies verbatim with:
  //   - runPayroll: this.attendanceReport(period) -> this.attendance.attendanceReport(period)
  //   - runPayroll: this.leaveDays(...) -> leaveDays(...)
  // this.capital and this.cache usages stay identical.
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds.

### Task 9: Rewire module, controller, iclock controller; delete old service

**Files:**
- Modify: `apps/api/src/people/people.module.ts`
- Modify: `apps/api/src/people/people.controller.ts`
- Modify: `apps/api/src/people/iclock.controller.ts`
- Delete: `apps/api/src/people/people.service.ts`

**Interfaces:**
- Consumes: all 7 services from Tasks 2-8

- [ ] **Step 1: Rewrite `people.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { DirectoryService } from "./directory.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { PayrollService } from "./payroll.service";
import { PerformanceService } from "./performance.service";
import { TrainingService } from "./training.service";
import { RecruitmentService } from "./recruitment.service";
import { PeopleController } from "./people.controller";
import { IclockController } from "./iclock.controller";
import { CapitalModule } from "../capital/capital.module";

@Module({
  imports: [CapitalModule],
  controllers: [PeopleController, IclockController],
  providers: [DirectoryService, AttendanceService, LeaveService, PayrollService, PerformanceService, TrainingService, RecruitmentService],
})
export class PeopleModule {}
```

- [ ] **Step 2: Rewrite `people.controller.ts`** — keep every route decorator and guard exactly as today (lines 1-265 of the current file), but inject all seven services and delegate each handler to the service that owns it. Map:

| Route handler (method) | Service |
|---|---|
| overview, employees, employeeDetail, createEmployee, updateEmployee, deleteEmployee, orgChart, skillsMatrix | `directory` |
| utilizationTrend | `directory` |
| attendanceMonth, attendanceSummary, recordAttendance, kioskPunch, recomputeAttendance, correctAttendance, attendanceReport, lateList | `attendance` |
| attendancePolicy, updateAttendancePolicy | `attendance` |
| punches, importPunches, mapPunch | `attendance` |
| leaveRequests, applyLeave, approveLeave, leaveBalances | `leave` |
| payroll, runPayroll, updatePayrollStatus, payslip | `payroll` |
| reviews, createReview, updateReview | `performance` |
| okrs, createOkr, updateOkr, deleteOkr | `performance` |
| courses, createCourse, deleteCourse | `training` |
| enrollments, createEnrollment, updateEnrollment | `training` |
| candidates, createCandidate, updateCandidate, deleteCandidate | `recruitment` |
| holidays, createHoliday, deleteHoliday | `attendance` |

Constructor:

```ts
constructor(
  private readonly directory: DirectoryService,
  private readonly attendance: AttendanceService,
  private readonly leave: LeaveService,
  private readonly payroll: PayrollService,
  private readonly performance: PerformanceService,
  private readonly training: TrainingService,
  private readonly recruitment: RecruitmentService
) {}
```

- [ ] **Step 3: Rewrite `iclock.controller.ts`**

```ts
import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { Public } from "../common/decorators/public.decorator";

// ZKTeco Push SDK protocol endpoints — the fingerprint device polls
// GET /api/iclock/getrequest?SN=xxx and POSTs punch logs to
// /api/iclock/cdata?SN=xxx&table=ATTLOG as tab-separated rows:
//   <PIN>\t<YYYY-MM-DD HH:MM:SS>\t<verify>\t<workcode>
// The device has no JWT, so these routes are @Public.
@Controller("iclock")
export class IclockController {
  constructor(private readonly attendance: AttendanceService) {}

  @Public()
  @Get("getrequest")
  getRequest(@Query("SN") sn: string) {
    return this.attendance.iclockGetRequest(sn);
  }

  @Public()
  @Get("devicecmd")
  deviceCmd(@Query("SN") sn: string) {
    return "OK";
  }

  @Public()
  @Post("cdata")
  async cdata(@Query("SN") sn: string, @Query("table") table: string, @Body() body: any) {
    let raw = typeof body === "string" ? body : "";
    if (!raw && body && typeof body === "object") {
      raw = Object.keys(body)
        .filter((k) => k.includes("\t") || k.includes("-"))
        .join("\n");
    }
    const reply = await this.attendance.iclockPushData(sn, table, raw);
    return reply;
  }
}
```

- [ ] **Step 4: Delete `apps/api/src/people/people.service.ts`.**

- [ ] **Step 5: Verify API**

Run: `npm run build` (workdir `apps/api`)
Expected: build succeeds with no errors.

- [ ] **Step 6: Restart the API and smoke-test the critical endpoints**

Restart: stop the running API process and start it again from the repo root (`npm run dev` — log to `%TEMP%\dev-api.log`), or `npm run start:dev` in `apps/api` if a watch process is not running.
Then verify (authenticated as `sakib@zoolyum.com`; token via login POST `http://localhost:4000/api/auth/login` with `{email,password}`):
- `GET /api/people/employees` returns the 10 employees (200)
- `GET /api/people/attendance-policy` (Bearer token) returns the policy
- `POST /api/people/attendance/recompute` body `{month:"2026-08"}` returns `{processed: number}` without error
- `GET /api/people/payroll?period=2026-08` returns records
- `GET /api/iclock/getrequest?SN=x` returns OK (no auth)

---

## Phase B — Frontend restructure

### Task 10: Create `_components/constants.ts`

**Files:**
- Create: `apps/web/src/app/(app)/people/_components/constants.ts`

**Interfaces:**
- Produces: `TABS` (array of `{ value, href }`), `DAYS`, `dayShort`, `LEAVE_TYPES`, `ATT_STATUSES`, `EMPLOYMENT_TYPES`, `EMPLOYMENT_STATUSES`, `COURSE_TYPES`, `CANDIDATE_STAGES`, `label`, `okrTone`, `levelTone`, `monthNow`, `todayLocal`, `fmtTime`, `skillsOf`, `utilBarCls`, `downloadCsv`
- Consumes: nothing external (pure functions/constants)

- [ ] **Step 1: Create the file** with content copied verbatim from `apps/web/src/app/(app)/people/page.tsx` lines 14-41 (`TABS`..`utilBarCls`), `line 457-470` (`downloadCsv`), plus the new tab list with hrefs:

```ts
export const TABS = [
  { value: "Overview", href: "/people" },
  { value: "Directory", href: "/people/directory" },
  { value: "Attendance", href: "/people/attendance" },
  { value: "Leave", href: "/people/leave" },
  { value: "Payroll", href: "/people/payroll" },
  { value: "Settings", href: "/people/settings" },
  { value: "Performance", href: "/people/performance" },
  { value: "OKRs", href: "/people/okrs" },
  { value: "Training", href: "/people/training" },
  { value: "Candidates", href: "/people/candidates" },
  { value: "Holidays", href: "/people/holidays" },
  { value: "Org Chart", href: "/people/org-chart" },
  { value: "Skills", href: "/people/skills" },
] as const;
```

`downloadCsv` is:

```ts
export function downloadCsv(filename: string, cols: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

Note: read the actual `downloadCsv` body from the source (page.tsx lines 457-470) and copy it verbatim — the block above is the shape; trust the source.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors introduced (file not yet imported anywhere, so it must still compile standalone).

### Task 11: Create `_components/hooks.ts`

**Files:**
- Create: `apps/web/src/app/(app)/people/_components/hooks.ts`

**Interfaces:**
- Produces: `useList<T>(path, refresh?)`, `useToast()`, `Toast`, `LoadOrError`, `DataTable`
- Consumes: React, `SkeletonBlock` from `@/components/shared`

- [ ] **Step 1: Cut lines 43-97** from `apps/web/src/app/(app)/people/page.tsx` (`useList`, `useToast`, `Toast`, `LoadOrError`, `DataTable`) into the new file verbatim. Add the imports they need: `useCallback`, `useEffect`, `useState` from `react`, `apiFetch` from `@/lib/api`, `SkeletonBlock` from `@/components/shared`. Re-export all five as named exports.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 12: Create `_components/tab-nav.tsx`

**Files:**
- Create: `apps/web/src/app/(app)/people/_components/tab-nav.tsx`

**Interfaces:**
- Produces: `TabNav` (default export) — renders the tab bar as links with active state from the current pathname
- Consumes: `TABS` from `./constants`, `cn` from `@/components/shared`, `usePathname` from `next/navigation`, `Link` from `next/link`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/shared";
import { TABS } from "./constants";

export default function TabNav() {
  const pathname = usePathname();
  const active = TABS.reduce((best, t) => {
    const match = pathname === t.href || pathname.startsWith(t.href + "/");
    if (match && t.href.length > (best?.href.length ?? 0)) return t;
    return best;
  }, undefined as (typeof TABS)[number] | undefined);
  return (
    <div className="inline-flex overflow-x-auto rounded-xl border border-border bg-card p-1">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all",
            active?.value === t.value
              ? "bg-brand-gradient text-white shadow-md shadow-violet-500/25"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.value}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 13: Create the people layout

**Files:**
- Create: `apps/web/src/app/(app)/people/layout.tsx`

**Interfaces:**
- Produces: `PeopleLayout` — renders `PageHeader` + `TabNav` + children
- Consumes: `PageHeader` from `@/components/shared`, `TabNav` from `./_components/tab-nav`

- [ ] **Step 1: Create the file**

```tsx
import { PageHeader } from "@/components/shared";
import TabNav from "./_components/tab-nav";

export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="People — HRM"
        subtitle="Attendance through payroll, with utilization intelligence."
        actions={<span className="rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">Payroll: July finalized</span>}
      />
      <div className="overflow-x-auto pb-1">
        <TabNav />
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
```

Note: the header text uses the em-dash between "People" and "HRM" (same as the current page). Type the real em-dash character, not the mojibake sequence.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 14: Extract modal components into `_components/modals/`

**Files:**
- Create: `apps/web/src/app/(app)/people/_components/modals/employee-form.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/attendance-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/leave-modal.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/holiday-modal.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/performance-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/training-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/candidate-modal.tsx`

**Interfaces:**
- Produces (named exports):
  - `employee-form.tsx`: `EmployeeModal`
  - `attendance-modals.tsx`: `AttendanceModal`, `ImportPunchModal`
  - `leave-modal.tsx`: `LeaveModal`
  - `holiday-modal.tsx`: `HolidayModal`
  - `performance-modals.tsx`: `ReviewModal`, `OkrModal`
  - `training-modals.tsx`: `CourseModal`, `EnrollModal`
  - `candidate-modal.tsx`: `CandidateModal`
- Consumes: `constants.ts` (`label`, `todayLocal`, `monthNow`, `DAYS`, `dayShort`, `LEAVE_TYPES`, `ATT_STATUSES`, `EMPLOYMENT_TYPES`, `EMPLOYMENT_STATUSES`, `COURSE_TYPES`, `CANDIDATE_STAGES`), `hooks.ts` (`useToast`, `Toast`), plus the shared components each modal already imports.

- [ ] **Step 1: Move each modal component verbatim** from `apps/web/src/app/(app)/people/page.tsx` into its file (the `function Foo()` blocks below; bodies unchanged). Use the modal's existing imports. Where a modal referenced a constant that now lives in `_components/constants.ts`, import it from `../constants`; where it used `useToast`/`Toast`, import from `../hooks`.

Exact source ranges:
- `EmployeeModal` — lines 188-222 -> `employee-form.tsx`
- `AttendanceModal` — lines 472-515, `ImportPunchModal` — lines 516-548 -> `attendance-modals.tsx`
- `LeaveModal` — lines 687-723 -> `leave-modal.tsx`
- `HolidayModal` — lines 1336-1367 -> `holiday-modal.tsx`
- `ReviewModal` — lines 872-905, `OkrModal` — lines 956-1004 -> `performance-modals.tsx`
- `CourseModal` — lines 1078-1112, `EnrollModal` — lines 1113-1145 -> `training-modals.tsx`
- `CandidateModal` — lines 1237-1268 -> `candidate-modal.tsx`

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors (old `page.tsx` still contains the originals, so no missing imports there yet).

### Task 15: Create `_components/modals/employee-profile.tsx` (centered modal)

**Files:**
- Create: `apps/web/src/app/(app)/people/_components/modals/employee-profile.tsx`

**Interfaces:**
- Produces: `EmployeeProfileModal` (default export)
- Consumes: `Modal` from `@/components/ui`, the detail/edit UI from `DirectoryTab` (page.tsx lines 315-452), `useToast` from `../hooks`, constants, `apiFetch`, shared components, lucide icons.

- [ ] **Step 1: Convert the Drawer into a centered Modal**

Replace the `<Drawer open={!!detailId} ... footer={...}>...</Drawer>` block (page.tsx lines 315-452) with a `Modal`-based component:

```tsx
"use client";

import { useState } from "react";
import {
  Building2, CalendarClock, CalendarDays, GraduationCap, Pencil, Target, Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate, formatDay } from "@/lib/format";
import { Avatar, SkeletonBlock, StatusBadge } from "@/components/shared";
import { Field, Input, Modal, Select } from "@/components/ui";
import { DAYS, dayShort, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, label, skillsOf, fmtTime } from "../constants";
import { Toast, useToast } from "../hooks";

export default function EmployeeProfileModal({
  open, onClose, employeeId, detail, loading,
  onSave, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string | null;
  detail: any;
  loading: boolean;
  onSave: (payload: any) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editF, setEditF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const { flash, notify } = useToast();

  // Copy the edit form state initializer from openEdit (page.tsx lines 249-253),
  // the save handler from saveEdit (lines 254-263), the view grid (lines 378-450)
  // and the edit form grids (lines 339-376) verbatim, replacing:
  //   - Drawer title -> Modal title (same header content)
  //   - Drawer footer buttons -> a bottom action row inside the modal:
  //       view mode:  <Btn variant="outline" onClick={openEdit}><Pencil /> Edit profile</Btn>
  //       edit mode:  Cancel + <Btn variant="primary" onClick={saveEdit}>Save changes</Btn> + Delete
  //   - onSave/onDelete props drive the PATCH/DELETE calls (moved out of the modal).
  // The Modal size is "xl". Close via onClose.
  return (
    <Modal open={open} onClose={onClose} title={...} size="xl">
      {loading ? <skeleton rows /> : !detail ? null : editing && editF ? <edit form /> : <view detail />}
      {detail && !loading && (
        <div className="mt-5 flex justify-end gap-2 border-t border-border/60 pt-4">
          {editing ? (Cancel / Save changes / Delete) : (Edit profile)}
        </div>
      )}
    </Modal>
  );
}
```

The `title` prop should render the same header content the Drawer used (lines 318-324): Avatar, name, roleTitle, `StatusBadge`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors (component not yet imported anywhere).

### Task 16: Rewrite `page.tsx` as the Overview page

**Files:**
- Rewrite: `apps/web/src/app/(app)/people/page.tsx`

**Interfaces:**
- Produces: default export `PeoplePage` -> renders only `OverviewTab` (no tab state, no Segmented, no PageHeader)
- Consumes: `OverviewTab` from the current page (lines 99-187, moved in), `FadeIn` from `@/components/shared`

- [ ] **Step 1: Reduce `page.tsx`** to only what Overview needs: keep `OverviewTab` (lines 99-187) as the default export. Remove all other tab components, modals, `TABS`, constants, `useList`, `DataTable`, `downloadCsv`, `Segmented`, `PageHeader`, `useState<Tab>` etc. The file becomes:

```tsx
"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Gauge, Users, XCircle } from "lucide-react"; // adjust to whatever OverviewTab uses
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, PageHeader, SectionTitle, SkeletonBlock, StatCard } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { DataTable, LoadOrError, useList, useToast, Toast } from "./_components/hooks";
import { monthNow, todayLocal, fmtTime, utilBarCls } from "./_components/constants";

// OverviewTab body verbatim from lines 99-187, renamed to default export PeoplePage.
export default function OverviewTab() {
  // ...verbatim body...
}
```

Note: OverviewTab's actual imports and helpers must be derived from its body (lines 99-187) — cut it carefully and import only what it references. If it references any constant from lines 14-41, import it from `./_components/constants`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 17: Create `directory/page.tsx`

**Files:**
- Create: `apps/web/src/app/(app)/people/directory/page.tsx`

**Interfaces:**
- Produces: default export `DirectoryPage`
- Consumes: `DirectoryTab` logic (page.tsx lines 223-455, minus the Drawer), `EmployeeModal` from `../_components/modals/employee-form`, `EmployeeProfileModal` from `../_components/modals/employee-profile`, constants, hooks

- [ ] **Step 1: Create the page** from the `DirectoryTab` body (lines 223-455), with these changes:
- Remove the `<Drawer ...>` block (lines 315-452) and replace it with `<EmployeeProfileModal open={!!detailId} onClose={() => setDetailId(null)} employeeId={detailId} detail={detail} loading={detailLoading} onSave={...PATCH /people/employees/:id...} onDelete={...DELETE /people/employees/:id...} />`.
- Move the `saveEdit`/`openEdit`/edit-form state handling into the modal (per Task 15), so the page keeps: `refresh`, `employees`, `q`, `dept`, `addOpen`, `detailId`, `detail`, `detailLoading`, and the table render (lines 264-313).
- `EmployeeModal` stays as-is for Add.
- Import `EmployeeModal` and `EmployeeProfileModal`, constants, hooks from the `_components` folder.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 18: Create the remaining tab pages

**Files:**
- Create: `apps/web/src/app/(app)/people/attendance/page.tsx`
- Create: `apps/web/src/app/(app)/people/leave/page.tsx`
- Create: `apps/web/src/app/(app)/people/payroll/page.tsx`
- Create: `apps/web/src/app/(app)/people/settings/page.tsx`
- Create: `apps/web/src/app/(app)/people/performance/page.tsx`
- Create: `apps/web/src/app/(app)/people/okrs/page.tsx`
- Create: `apps/web/src/app/(app)/people/training/page.tsx`
- Create: `apps/web/src/app/(app)/people/candidates/page.tsx`
- Create: `apps/web/src/app/(app)/people/holidays/page.tsx`
- Create: `apps/web/src/app/(app)/people/org-chart/page.tsx`
- Create: `apps/web/src/app/(app)/people/skills/page.tsx`

**Interfaces:**
- Each produces a default-export page component.
- Consumes: the matching tab body from the old `page.tsx` (list below), constants/hooks from `_components`, and their modals from `_components/modals`.

- [ ] **Step 1: Move each tab body** into its page file as the default export, keeping its internal state/data-fetching identical, but importing shared bits from `_components`:

| Page file | Tab body source lines (old page.tsx) | Modals it imports |
|---|---|---|
| `attendance/page.tsx` | 549-686 (`AttendanceTab`) | `AttendanceModal`, `ImportPunchModal` |
| `leave/page.tsx` | 724-799 (`LeaveTab`) | `LeaveModal` |
| `payroll/page.tsx` | 800-871 (`PayrollTab`) | (run-modal is inline) |
| `settings/page.tsx` | 1503-1614 (`SettingsTab`) | none |
| `performance/page.tsx` | 906-955 (`PerformanceTab`) | `ReviewModal` |
| `okrs/page.tsx` | 1005-1077 (`OkrsTab`) | `OkrModal` |
| `training/page.tsx` | 1146-1236 (`TrainingTab`) | `CourseModal`, `EnrollModal` |
| `candidates/page.tsx` | 1269-1335 (`CandidatesTab`) | `CandidateModal` |
| `holidays/page.tsx` | 1368-1428 (`HolidaysTab`) | `HolidayModal` |
| `org-chart/page.tsx` | 1429-1467 (`OrgNode` + `OrgChartTab`) | none |
| `skills/page.tsx` | 1468-1502 (`SkillsTab`) | none |

- [ ] **Step 2: Payroll page payslip link update** — in `payroll/page.tsx`, change the payslip Link href from `/people/payslip/${r.id}` to `/people/payroll/payslip/${r.id}`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 19: Move payslip page and add redirect

**Files:**
- Create: `apps/web/src/app/(app)/people/payroll/payslip/[id]/page.tsx` (move the file from `people/payslip/[id]/page.tsx`, content unchanged)
- Rewrite: `apps/web/src/app/(app)/people/payslip/[id]/page.tsx` -> redirect

**Interfaces:**
- Consumes: nothing new (payslip page already works)

- [ ] **Step 1: Move** `apps/web/src/app/(app)/people/payslip/[id]/page.tsx` to `apps/web/src/app/(app)/people/payroll/payslip/[id]/page.tsx` with no content change.

- [ ] **Step 2: Replace the old page** with a redirect:

```tsx
"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function OldPayslipRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/people/payroll/payslip/${params.id}`);
  }, [router, params.id]);
  return null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

### Task 20: Delete the old page.tsx leftovers and clean imports

**Files:**
- Modify: any remaining references to the old `/people/payslip` link or removed components

- [ ] **Step 1: Verify no file still imports removed names** — grep for `Segmented` usage inside `apps/web/src/app/(app)/people/` (should be zero; the tab bar is now `TabNav`) and for `/people/payslip/` links (should point to `/people/payroll/payslip/`). Fix any stragglers.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: no errors.

---

## Phase C — Tests and verification

### Task 21: Update the people e2e spec

**Files:**
- Modify: `apps/web/e2e/people-payroll-pro.spec.ts`

**Interfaces:**
- Consumes: the new routes (`/people/directory`, `/people/attendance`, `/people/payroll`, `/people/settings`) and Link-based tab bar (role `link`)

- [ ] **Step 1: Update selectors** — the tab bar is now `<Link>` elements. Change every `getByRole("button", { name: "Attendance" })`, `{ name: "Payroll" }`, `{ name: "Settings" }` to `getByRole("link", { name: "Attendance" })` etc. Note the exact-match issue: `getByRole("link", { name: "Payroll" })` must not match the payslip link; the tab links are exact labels. Keep navigating via `/people` first then clicking the tab link. The rest of the spec (kiosk button, import modal, settings save, role gate) is unchanged — those buttons are still buttons.

- [ ] **Step 2: Run the people spec**

Run: `npx playwright test e2e/people-payroll-pro.spec.ts --reporter=line` (workdir `apps/web`)
Expected: 3/3 pass.

### Task 22: Full verification

- [ ] **Step 1: API build**

Run: `npm run build` (workdir `apps/api`)
Expected: passes.

- [ ] **Step 2: Web typecheck**

Run: `npx tsc --noEmit` (workdir `apps/web`)
Expected: passes.

- [ ] **Step 3: Full e2e suite**

Run: `npx playwright test e2e/ --reporter=line --workers=1` (workdir `apps/web`)
Expected: 9/9 pass.

- [ ] **Step 4: Manual sanity checks** (with dev servers running):
- `http://localhost:3000/people` shows Overview with the tab bar.
- Clicking "Attendance" changes the URL to `/people/attendance` and the page content changes; browser back returns to `/people`.
- On `/people/directory`, clicking an employee row opens a **centered** modal (not a right drawer); Edit/Save work.
- `/people/payroll/payslip/<id>` renders a payslip; the old `/people/payslip/<id>` redirects to it.
- Direct-load `/people/settings` shows the attendance policy form; as `rahim@zoolyum.com` it shows the "Owner / HR/Admin only" empty state.

## Self-Review notes

- Spec coverage: Section 1 (API split) -> Tasks 1-9; Section 2 (nested routes + layout + extraction) -> Tasks 10-20; Section 3 (centered profile modal) -> Task 15 + Task 17; payslip move + redirect -> Task 19; e2e updates -> Task 21; API verification -> Task 9 Step 6; overall verification -> Task 22.
- No placeholders: every new-file step carries full code or an exact source-range cut instruction with the mapping table; every Verify step names the command and expected result.
- Type consistency: `TABS` is the single source for both `TabNav` and the route table; service method names are preserved from the original `people.service.ts` (no renames), so controller/iclock delegations match exactly.