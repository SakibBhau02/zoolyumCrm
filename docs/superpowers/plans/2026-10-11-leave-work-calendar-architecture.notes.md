# Leave & Work-Calendar Architecture — Implementation Notes

## Architecture (the "ভালোভাবে" part)

Three bounded pieces, one shared rule:

- **`AttendanceService`** owns the question "is this date working?" — `overrideMap()`,
  `countWorkingDays()`, and the `syncDay`/report/employee/trends loops all read
  overrides with the same precedence: **explicit override > holiday > weekly off**.
- **`LeaveService`** owns quotas, balances, deduction, and decisions. It never
  re-derives workdays itself — it calls `AttendanceService.countWorkingDays()`,
  so deduction and attendance can never disagree about what counts.
- **Pure date logic** (`eachDayStr`, `isWorkingDay`) lives in `people-utils.ts`
  with no DB access, so both services (and future payroll use) share it.

`LeavePolicy` (quota table) → `ensureBalances` → `LeaveBalance` rows →
`approveLeave` deducts → `LeaveRequest` audit columns record it. One direction,
no cycles.

## Deviations & decisions

- **Deduction unit is working days, not calendar days** (user chose). A Mon–Wed
  request deducts 3; a Fri–Mon request deducts 1 (Sat/Sun off). Verified live.
- **Insufficient balance blocks approval** with an explicit message
  ("Insufficient CASUAL balance (9 left, needs 22)") instead of the old silent
  `Math.max(0, …)` clamp, which hid overdrafts.
- **Reject-after-approve restores** `deductedDays` (the old code had no restore
  path at all). Rejecting a PENDING request touches no balance.
- **UNPAID never touches balances** (no row, no deduction) but still marks
  attendance leave when approved — same as before.
- **Decisions recompute attendance** for the affected dates + invalidate people
  cache (the old `approveLeave` did neither, so reports stayed stale).
- **Past months are immutable** for calendar overrides (server rejects
  `date < current-month-01`): payroll already ran on history.
- **Default quotas** (editable): CASUAL 10, SICK 14, EARNED 18 / year, January
  reset, no carryover (user chose). Seeded in `seed.ts` via `createMany`.
- **Approve guard**: Owner/HR/Admin/Project Manager via `@Roles`-style check in
  `requireApprover` (role read from the caller's User row). Previously ANY login
  could approve — including the requester themselves.
- **Overlap guard**: PENDING/APPROVED requests for the same employee may not
  overlap; the error names the clashing request.
- **Detail page overwrite**: `attendance/[employeeId]/page.tsx` already existed
  (month calendar grid from an earlier commit). Replaced with the hours grid +
  range filters, but **kept the payroll deep-link** (`Payroll for {month} →`)
  in month mode. The old calendar-grid visual was dropped in favor of the daily
  hours table the user asked for.
- **Next 16 async `params`**: detail page uses `use(params)` — first version
  crashed, fixed before commit.
- **Settings calendar title bug**: day-cell tooltip read the *selected* day's
  default instead of the hovered cell's; fixed to per-cell text.
- **No per-day deduction cron or accrual**: quotas are granted whole at
  ensure-time (simple annual grant, matches "yearly reset, no carry").

## Verification

- `prisma format/validate` ✅, `migrate dev --name work_calendar_leave_policy`
  applied, `generate` ✅, both builds ✅
- Live API (sakib Owner / rahim Sales-BD outsider):
  - quotas set → 8 balance rows created (3 emp × 3 types, pre-existing kept)
  - apply Mon–Wed → `workingDays: 3`; overlap → 400 naming the clash
  - detail → employee/type/dates/working-vs-calendar/balance/timeline
  - outsider approve → 403; owner approve → `deducted: 3, 9 → 6`
  - reject-after-approve → 9 restored (9→6→9 ledger proven twice)
  - 30-day November request → 400 "needs 22"
  - override open Sat 10-10 → day flips off→absent; close Thu 10-08 →
    kind=holiday with note; report reflects both
- Browser: settings calendar renders with legend, open→"17open"→delete→"17off"
  cycle done by hand; quotas save; leave drawer shows timeline/balance/−3;
  drawer approve with note → APPROVED with note + timeline; only pre-existing
  logo 404 in console.

## Cleanup
All 4 test overrides and all 3 test leave requests deleted; balances restored
to 9/14/18; quotas + ensure-created balances kept as legitimate system state
(verified by re-query, including a direct DB count).

## Not done / follow-ups
- Overtime approval workflow (track-only, payroll decision)
- Auto check-out for forgotten checkouts
- Break deduction / multi-shift (first→last punch model stands)
- Tasks `workload()` capacity still uses weeklyOffDays + leaves only — does not
  consult calendar overrides (documented limitation, small follow-up)
- Old burndown-style problem doesn't exist here; snapshots N/A
