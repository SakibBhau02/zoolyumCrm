# Attendance Professional Upgrade — Plan

> Date: 2026-10-11
> Status: Approved (user selected all 4 groups + threshold OT + new detail page)
> Scope: `apps/api/src/people/attendance.*` + payroll callers + `apps/web/src/app/(app)/people/attendance/*` + people settings

## 1. Current state (verified by inspection)

**Backend** (`attendance.service.ts`, 682 lines) — data pipeline is strong:
- Punch engine: ZKTeco ADMS push, CSV import, kiosk/self punch, unmatched mapping
- Day engine: `computeDayStatus` (PRESENT/LATE/HALF_DAY/ABSENT), shift/grace/half-day-cutoff per employee or policy
- `attendanceReport(month)` — counts + payroll deductions (late ladder, half-day, absent)
- `employeeAttendance(id, month)` — per-day kind/checkIn/checkOut/punches/leave/holiday
- `todayStatus(user)` — caller's own punch state + team counts (dashboard use)
- `lateList(month)`, `attendanceMonth(month)`, holidays CRUD, devices CRUD
- Bangladesh weekend Fri–Sat, Dhaka-day helpers in `people-utils.ts`

**Frontend** (`attendance/page.tsx`, 248 lines) — thin, ops-focused:
- Month picker, kiosk in/out, import, recompute, devices card
- Monthly deduction report, late list, daily records, raw punches

## 2. Gaps (user ask + enterprise research: Odoo, OrangeHRM, HRKubes, Spica)

| # | Gap | Fix |
|---|---|-----|
| 1 | Working hours computed **nowhere** (times exist, duration doesn't) | `dayHours()` engine: worked/overtime/undertime per day |
| 2 | Month picker only — no 7/15/30-day view | `resolveDays()`: month OR trailing-N OR from→to on report/late/records/employee/trends |
| 3 | No live "who's in" on the page (`todayStatus` unused here) | New `liveBoard()`: per-employee state + hours-so-far |
| 4 | No overtime concept at all | Policy `overtimeThresholdMinutes` (default 30); extra ≥ threshold = OT |
| 5 | No patterns view (habitual lates, streaks) | New `attendanceTrends()`: late/absent/avg/streak + flags |
| 6 | Report name links to `/people/attendance/:id` — **page doesn't exist (404)** | New detail page `[employeeId]` with daily hours grid |
| 7 | Daily records show times but no duration | Worked column (live "inside" badge when open) |
| 8 | Threshold not editable | Field on people/settings policy form |

Research patterns adopted: Odoo's worked/expected/difference model, OrangeHRM's
review-by-exception (flags, not raw rows), HRKubes' live floor + overtime rules.

## 3. Files

**Schema:** `AttendancePolicy.overtimeThresholdMinutes` (+1 migration)
**API:** `attendance.service.ts` (engine + range + live + trends),
`people.controller.ts` (range params + 2 new routes), `payroll.service.ts`
(signature compat: `{ month }`)
**Web:** `attendance/page.tsx` (range chips, 6 stat cards, live board, hours/OT
cols, trends), `attendance/[employeeId]/page.tsx` (new), `people/settings`
(threshold field)
**Docs:** this plan + notes

## 4. Verification
- `prisma validate` + migrate + generate, both builds 0 errors
- Live API: report/live/trends/employee × (days + month), payroll shape intact
- Browser: month + 7D modes, live pills, trends flags, detail grid incl. a real
  10h34m → 2h34m overtime day, range switching, settings field
- Only console error is the pre-existing missing logo file

## 5. Out of scope
- Overtime *approval* workflow (track-only for now; approval is a payroll decision)
- Auto check-out for forgotten checkouts (Odoo pattern — needs a policy decision)
- Break deduction (single-shift model, no breaks tracked)
- Payroll *run* regression (destructive — shape verified, run not executed)
- Mobile/GPS clock-in

## 6. STOP conditions
- If `resolveDays` range breaks payroll's month path → stop, payroll owns money
- If per-day hours disagree with punch pairs (multi-shift days) → stop and confirm
  single-shift assumption (confirmed: first→last punch model, documented)
