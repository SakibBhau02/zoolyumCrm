# People Module Restructure — Design

Date: 2026-08-20
Status: Approved by user (all 3 sections)

## Problem

The People module is one giant connected page:

- `apps/web/src/app/(app)/people/page.tsx` (1647 lines) holds all 12 tabs behind a single
  `tab` state. Tab switches do not change the URL, so tabs cannot be bookmarked,
  shared, or navigated with the browser back button.
- Clicking an employee profile opens a right-side `Drawer`; the user wants a centered popup.
- `apps/api/src/people/people.service.ts` (1059 lines) mixes 7 domains in one service.

## Goals

1. Each tab is its own URL (nested route) — viewable, shareable, back/forward works.
2. Employee profile opens as a centered modal popup (replaces the right Drawer).
3. API service split into domain services — routes unchanged, zero API breaking changes.
4. Keep all existing behavior, look & feel, and e2e coverage green.

## Section 1 — API split (approved)

One `PeopleModule`, 7 domain services. All 53 API routes and payloads unchanged.

| Service | Methods (moved from people.service.ts) |
|---|---|
| `directory.service.ts` | overview, employees, employeeDetail, createEmployee, updateEmployee, deleteEmployee, orgChart, skillsMatrix, utilizationTrend |
| `attendance.service.ts` | attendancePolicy, updateAttendancePolicy, importPunches, iclockGetRequest, iclockPushData, punches, mapPunch, kioskPunch, recomputeMonth, correctAttendance, attendanceReport, lateList, recordAttendance, attendanceMonth, attendanceSummary, holidays, createHoliday, deleteHoliday, recomputeDay/syncDay/computeDayStatus helpers |
| `leave.service.ts` | leaveRequests, applyLeave, approveLeave, leaveBalances |
| `payroll.service.ts` | payroll, runPayroll, updatePayrollStatus, payslip — injects AttendanceService (runPayroll needs attendanceReport) |
| `performance.service.ts` | reviews, createReview, updateReview, okrs, createOkr, updateOkr, deleteOkr |
| `training.service.ts` | courses, createCourse, deleteCourse, enrollments, createEnrollment, updateEnrollment |
| `recruitment.service.ts` | candidates, createCandidate, updateCandidate, deleteCandidate |

- `people.controller.ts` stays a thin router delegating to the 7 services.
- `iclock.controller.ts` injects `AttendanceService` (iclockGetRequest, iclockPushData).
- `people.module.ts` providers: all 7 services. PayrollService imports AttendanceService.
- PrismaService / CacheService / CapitalService injected where needed, same as today.

## Section 2 — Frontend nested routes + structure (approved)

New structure under `apps/web/src/app/(app)/people/`:

```
layout.tsx              PageHeader + tab bar (Link-based, active via usePathname)
page.tsx                Overview content (default tab at /people)
overview/page.tsx       (or page.tsx itself renders Overview)
directory/page.tsx
attendance/page.tsx
leave/page.tsx
payroll/page.tsx
settings/page.tsx
performance/page.tsx
okrs/page.tsx
training/page.tsx
candidates/page.tsx
holidays/page.tsx
org-chart/page.tsx
skills/page.tsx
payroll/payslip/[id]/page.tsx   (moved from people/payslip/[id])
_components/constants.ts        TABS (value + href), DAYS, statuses, downloadCsv, helpers
_components/hooks.ts            useList, useToast, DataTable, LoadOrError
_components/modals/employee-form.tsx
_components/modals/employee-profile.tsx
_components/modals/attendance-modals.tsx   (Record/Correct + ImportPunch)
_components/modals/leave-modal.tsx
_components/modals/holiday-modal.tsx
_components/modals/performance-modals.tsx  (Review + OKR)
_components/modals/training-modals.tsx     (Course + Enroll)
_components/modals/candidate-modal.tsx
```

Tab bar: same visual as `Segmented` but each option is a `<Link>` to its route;
active tab derived from `usePathname()` (`/people` → Overview). Local `TabNav`
component in the people layout — shared `Segmented` untouched (capital module uses it).

Each tab page fetches its own data (useList on its own endpoint) — tabs are now
independent pages, no shared tab state.

Route table:

| Tab | Route |
|---|---|
| Overview | /people |
| Directory | /people/directory |
| Attendance | /people/attendance |
| Leave | /people/leave |
| Payroll | /people/payroll |
| Settings | /people/settings |
| Performance | /people/performance |
| OKRs | /people/okrs |
| Training | /people/training |
| Candidates | /people/candidates |
| Holidays | /people/holidays |
| Org Chart | /people/org-chart |
| Skills | /people/skills |
| Payslip | /people/payroll/payslip/[id] |

## Section 3 — Profile popup, payslip move, tests (approved)

1. **EmployeeProfileModal** — replaces the right `Drawer` in DirectoryTab:
   - Centered `Modal` size `xl` (max-w-4xl), scrollable content.
   - Same content as today's drawer: header (avatar, name, role), contact cards,
     deviceId, shift/schedule, weekly-off chips, attendance (last 7), leave balance,
     enrollments, OKRs.
   - Edit mode inside the modal (Save / Delete actions at the bottom).
   - `Drawer` import no longer used in the people module.
2. **Payslip move**: `/people/payslip/[id]` → `/people/payroll/payslip/[id]`.
   Old path keeps a tiny redirect page (next/navigation redirect) so old links work.
3. **e2e updates**: tab bar switches from `<button>` to `<Link>`, so
   `people-payroll-pro.spec.ts` selectors change from `getByRole("button", {name})`
   to `getByRole("link", {name})`. Full suite must stay 9/9 green.
4. **API verification after split**: `npm run build --prefix apps/api`, then smoke
   policy / punches / recompute / payroll-run / payslip endpoints.

## Out of scope

- No API route changes, no schema changes, no seed changes.
- No feature/behavior changes — pure reorganization (plus the profile popup UX change).
- Shared `Segmented`/`Drawer` components in ui.tsx remain (used elsewhere).

## Verification

- `npx tsc --noEmit` (apps/web)
- `npm run build --prefix apps/api`
- `npx playwright test e2e/ --reporter=line --workers=1` (apps/web) — 9/9 green
- Manual: /people direct-load, tab navigation updates URL, back button, profile popup centered.