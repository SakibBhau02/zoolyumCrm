# Leave & Work-Calendar Architecture — Plan

> Date: 2026-10-11
> Status: Approved (user answered 5 scope questions)
> Scope: leave quotas, work calendar, deduction ledger, leave detail, approve guard

## 1. Decisions (user-confirmed)

- Leave types: existing CASUAL/SICK/EARNED/UNPAID + quotas from settings
  (defaults 10/14/18, UNPAID unlimited). "Paid" = EARNED.
- Yearly reset in January, no carryover.
- Deduction in **working days only** (weekends/holidays/closed days excluded).
- Saturday-open via **date-wise overrides** from a monthly calendar in settings.
- Approve restricted to Owner/HR/Admin/Project Manager (was: any login).

## 2. Architecture

- `AttendanceService`: "is this date working?" — `overrideMap()`,
  `countWorkingDays()`, override-aware report/employee/trends/`syncDay`.
  Precedence: **override > holiday > weekly off**.
- `LeaveService`: quotas, `ensureBalances`, working-day deduction on approve,
  restore on reject-after-approve, detail, approve guard. Calls
  `AttendanceService.countWorkingDays()` — never re-derives.
- Pure helpers (`eachDayStr`, `isWorkingDay`) in `people-utils.ts`.
- Flow: `LeavePolicy` → `ensureBalances` → `LeaveBalance` → approve deducts →
  `LeaveRequest` audit columns (`workingDays`, `deductedDays`,
  `balanceBefore/After`, `decidedAt`, `decisionNote`).
- Decisions recompute attendance for affected dates + invalidate people cache.

## 3. Files

**Schema:** `WorkdayOverride`, `LeavePolicy`, `LeaveRequest` audit columns,
`User.workdayOverrides` back-relation (+1 migration)
**API:** `attendance.service.ts`, `leave.service.ts` (rewrite),
`people.controller.ts` (calendar CRUD, policies, ensure, detail),
`payroll.service.ts` (compat only), `seed.ts` (default quotas)
**Web:** settings (calendar grid + quotas + seed balances), leave page (detail
drawer with timeline/balance/approve-note)
**Docs:** this plan + notes

## 4. Verification
Schema validate + migrate + generate, both builds, live API lifecycle
(apply→overlap→detail→outsider-403→approve→deduct→restore→overdraft→overrides),
browser (calendar flip cycle, quotas save, drawer approve with note), DB cleanup.

## 5. Out of scope
Overtime approval, auto check-out, breaks/multi-shift, payroll-run execution,
tasks-workload override awareness, mobile/GPS clock-in.

## 6. STOP conditions
- If deduction and attendance disagree on working days → stop (single source:
  `countWorkingDays`)
- If past-month override would rewrite payroll history → blocked server-side
- If balance restore can't find its row → stop, don't fabricate (restore only
  when the balance row exists)
