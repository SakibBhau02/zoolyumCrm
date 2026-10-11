# Attendance Professional Upgrade — Implementation Notes

## Deviations

- **Plan assumed month-only endpoints.** `lateList()` and `attendanceMonth()` were
  also generalized to the same range object (the page keeps all sections in sync
  via one `qs`). `punches()` stays month-scoped — it's a raw device log, not a metric.
- **Plan said "new detail page".** Built at `attendance/[employeeId]` with
  `React.use(params)` — Next 16 makes route params a Promise; first version
  crashed with sync-access errors, fixed before commit.
- **No migration for data, only policy.** `overtimeThresholdMinutes` defaults to
  30 via schema; existing policy row gets it on migrate (nullable read with
  `?? 30` fallback in code anyway).
- **Payroll callers updated, not refactored.** `runPayroll` + recompute pass
  `{ month: period }` — identical behavior, verified by field list, but the
  payroll *run* itself was not executed (destructive).

## Verification

- `npx prisma format` + `migrate dev --name attendance_overtime_threshold`
  applied `20261011104616`, `prisma generate` ✅
- `npm run build --prefix apps/api` ✅, `npm run build --prefix apps/web` ✅
  (one fix: page-local `TaskRow`-style duplication doesn't exist here, but the
  detail page needed the `use(params)` fix above)
- Live API (sakib):
  - `report?days=7` → hours fields present (`workedMinutes`, `avgWorkedMinutes`,
    `overtimeMinutes`, `daysCounted`); `report?month=2026-10` → same shape +
    all deduction fields (payroll-safe)
  - `live` → `{total:3, inside:0, left:1, notIn:2}` with per-person in/out/hours
  - `trends?days=30` → flags fire (`miss streak ×21` on sparse dev data — real
    signal, dev data is genuinely absent-heavy)
  - `employee/:id?days=7` → 7-day grid with per-day worked/OT
- Browser:
  - Month mode: 6 stat cards, live pills, WORKED/AVG/OT columns with real data
    (Sakib 2h37m / 52m avg), trends flags, detail grid showing a genuine
    10h34m → 2h34m overtime day with "11 punches" note
  - 7D chip: everything re-queries (`Last 7 days` labels, 5 working days);
    detail page 7D/15D/30D/month switching works
  - Only console error: pre-existing missing branding logo (unrelated)

## Two process incidents (documented so they don't repeat)

1. **Wrong-dir build is silent.** `npm run build --prefix apps/api` executed with
   cwd `apps/api` resolves to a nonexistent nested path and prints nothing —
   my `Select-String` filter then hid the failure and "api-build-ok" lied.
   `late-list?days=7` / `attendance?days=7` 500'd (old signature,
   `dhakaDaysInMonth(undefined)`) until a real root build + restart.
   Lesson: always build from repo root and check the raw tail, not a filtered slice.
2. **Stale process held port 4000.** A previous prod process (PID 37636) survived
   the pipeline kill, so the fresh build's restart bound nothing and requests
   kept hitting old dist. Now verified by PID: kill → port free → start → login.

## Cleanup
No test rows created by this work (all checks were reads except the settings
field render, which was not saved). DB untouched.

## Not done / follow-ups
- Overtime approval workflow (track-only for now)
- Auto check-out for forgotten checkouts
- Break deduction / multi-shift days (first→last punch model documented in code)
- The 10-07/10-08 "half with 0m" rows: status-only records with no times —
  correct output, but HR may want a "missing punches" exception view (OrangeHRM
  pattern) as a next step
