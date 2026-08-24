# Task 9 Report: Rewire module, controller, iclock controller; delete old service

**Date:** 2026-08-20
**Plan:** docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 9)
**Spec:** docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Status: DONE

## Files rewritten

| File | Action | Notes |
|------|--------|-------|
| `apps/api/src/people/people.module.ts` | Rewritten | Providers now the 7 new services (Directory, Attendance, Leave, Payroll, Performance, Training, Recruitment); imports `CapitalModule`; controllers unchanged (`PeopleController`, `IclockController`). |
| `apps/api/src/people/people.controller.ts` | Rewritten | Constructor injects the 7 services; all 50 handler bodies delegate to the appropriate service. |
| `apps/api/src/people/iclock.controller.ts` | Rewritten | Injects `AttendanceService`; `getRequest`/`cdata` delegate to `iclockGetRequest`/`iclockPushData`; `deviceCmd` unchanged; all three `@Public`. |
| `apps/api/src/people/people.service.ts` | Deleted | Removed after the first successful build; second build still succeeds. |

## Route-surface comparison (people.controller.ts)

Compared the current (pre-rewrite) file against the brief's content line-by-line before writing. All 50 route handlers are present, in identical order, with identical HTTP methods, paths, query/body param shapes, `@CurrentUser` args, and `@Roles` guards:

- Directory (9): overview, employees, employees/:id (GET), employees (POST), employees/:id (PATCH), employees/:id (DELETE), utilization, org-chart, skills-matrix
- Attendance (18): attendance, attendance/summary, attendance (POST), attendance/kiosk, attendance/recompute, attendance/:id/correct, attendance/report, attendance/late-list, attendance-policy (GET, `@Roles`), attendance-policy (PATCH, `@Roles`), punches, punches/import, punches/:id/map, holidays (GET), holidays (POST), holidays/:id (DELETE)
- Leave (4): leave-requests (GET/POST), leave-requests/:id (PATCH), leave-balances
- Payroll (4): payroll, payroll/run (POST, `@Roles`), payroll/:id (PATCH, `@Roles`), payroll/:id/payslip
- Performance (7): reviews (GET/POST), reviews/:id (PATCH), okrs (GET/POST), okrs/:id (PATCH), okrs/:id (DELETE)
- Training (6): courses (GET/POST), courses/:id (DELETE), enrollments (GET/POST), enrollments/:id (PATCH)
- Recruitment (4): candidates (GET/POST), candidates/:id (PATCH), candidates/:id (DELETE)

`@Roles(...HR_ROLES)` guards (`Owner`, `HR/Admin`) present on exactly the same 4 routes as before: attendance-policy GET/PATCH, payroll/run, payroll/:id.

## Deviation from brief (required to compile)

The brief's supplied controller content declared `private readonly payroll: PayrollService` as a constructor parameter alongside a handler method named `payroll()` — TypeScript rejects this as a duplicate identifier (`TS2300`). Renamed the injected property to `payrollService` and updated the 4 payroll handler bodies (`payroll`, `runPayroll`, `updatePayrollStatus`, `payslip`) to use `this.payrollService.*`. Route surface unchanged.

## Build verification

1. Build after writing module + controller + iclock controller (old service still present): FAILED — `TS2300: Duplicate identifier 'payroll'` (the collision above).
2. Fixed the collision.
3. Build again: **succeeded**.
4. Deleted `people.service.ts`.
5. Build again: **succeeded** (final state).

## Smoke tests (API already listening on port 4000, pid 3076)

Login: `POST /api/auth/login` with sakib@zoolyum.com/zoolyum123 → access token captured.

| # | Endpoint | Auth | Result |
|---|----------|------|--------|
| 1 | `GET /api/people/employees` | Bearer | **200**, array of 10 employees |
| 2 | `GET /api/people/attendance-policy` | Bearer | **200**, policy object with `weeklyOffDays` |
| 3 | `POST /api/people/attendance/recompute` body `{"month":"2026-08"}` | Bearer | **201**, `{"month":"2026-08","processed":148}` |
| 4 | `GET /api/people/payroll?period=2026-08` | Bearer | **200**, array of 10 payroll records |
| 5 | `GET /api/iclock/getrequest?SN=x` | none | **200**, body `OK` |
| 6 | `GET /api/people/attendance/report?month=2026-08` | Bearer | **200**, array of 10 report rows |

Note: POST /attendance/recompute returned 201 (NestJS default for POST) rather than the brief's stated 200; the response body is exactly as expected. This is a framework default, not a regression.

## Concerns

- None blocking. The 201-vs-200 on the recompute POST is a cosmetic framework default; the body matches the brief.
- The `payroll` property rename is the only deviation from the brief's literal content and was required for TypeScript to compile.