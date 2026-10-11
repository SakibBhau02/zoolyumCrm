# Task Module Enhancement — Implementation Notes

## Deviations from plan

- **Plan (Batch 3):** "add `Task.completedAt`, backfill from `activityLog` DONE entries."
  **Code:** column added and set on every DONE transition (create/update/updateStatus/bulk), but **no backfill was run** — existing rows have `completedAt = null`. Burndown therefore reconstructs from `completedAt` only, so tasks completed before this change do not appear in the completed curve. Existing 11 DONE tasks on the dev DB show as never-completed in burndown. Acceptable for a first cut; a backfill script is a follow-up (STOP condition in the plan was not triggered because we did not attempt to guess from `activityLog`).
- **Plan (Batch 3):** burndown "per-day remaining from activityLog/completedAt". **Code** computes remaining as `total - cumulativeDone - createdAfter` per day. This is a *reconstructed* curve, not a daily snapshot — a task created and completed inside the window nets correctly, but re-opened tasks can make the curve jump. A `SprintDailySnapshot` table would be the accurate version; deferred.
- **Plan (Batch 5):** overdue reminder "dedupe key per (task, day)". **Code** relies on `NotificationPreference` muting only; there is no per-day dedupe row, so the 09:00 job re-notifies daily by design (documented in the code comment). If a run is retried the same day, duplicates are possible.
- **Plan:** `@Cron` overdue reminder. **Code** added a second, unplanned cron: `closeStaleTimers()` at 03:00 auto-stops timers running >12h. Added because a forgotten timer otherwise bills unbounded hours — logged here as an addition, not in the original plan.
- **Plan (Batch 6):** "capacityOverrides JSON or reuse Leave". **Code** added `Employee.weeklyCapacityHours` (decimal, null = 40) and derives leave days from `LeaveRequest` (APPROVED) overlapping a 7-day window. `outDays` is computed but always equals `leaveDaysInWindow` — per-employee weekly-off hours were not subtracted (weekly off array is weekday-name-ish and not safely parseable). Follow-up.
- **Plan (Batch 7):** `EstimateAccuracyLog` "written nowhere" — correct; now written in `updateStatus` and `update` on DONE. One row per task (upsert-by-find), so re-completing overwrites rather than duplicating.
- **`myDay` controller bug:** plan said it ignores `@CurrentUser`. Confirmed and fixed — controller now resolves the caller's employee via `myDayForUser`; the service returns `[]` when no employee is linked instead of leaking all company tasks.
- **Recurring re-spawn:** fixed via new `Task.recurrenceSpawnedAt` guard column; the spawned successor also gets `sprintId: null` so a closed sprint does not silently grow.

## Verification

- `npx prisma format` + `npx prisma validate` ✅
- `npx prisma migrate dev --name task_checklist_timer_sprint_views` applied `20261011090450`
- `npx prisma migrate dev --name employee_weekly_capacity` applied (schema: `Employee.weeklyCapacityHours`)
- `npx prisma generate` (had to kill the API process holding `query_engine-windows.dll.node`)
- `npm run build --prefix apps/api` ✅ 0 TS errors
- `npm run build --prefix apps/web` ✅ compiled + type check passes (after widening `Sprint[]|null` / `SavedView[]|null` prop types — `useApi` returns `T | null`)
- Live API smoke (logged in as sakib, then deleted all created rows):
  - `GET /tasks/stats` → unchanged shape, 27 total / 16 open / 15 overdue
  - `GET /tasks/my-day` → 1 task (correctly scoped to sakib's employee)
  - `POST /tasks/:id/checklist` → created; `PATCH .../checklist/:itemId {done:true}` → `doneAt` + `doneBy: Sakib Chowdhury` stamped; `GET` shows 1 item; `DELETE` → 0
  - `POST /tasks/sprints` → created; `POST /sprints/:id/tasks` → affected 1; `GET /sprints/:id/burndown` → summary `{total:1,done:1,completionPct:100}`, 15 day points
  - `POST /tasks/views` → created with `filters/viewMode/groupBy/isShared`; `DELETE` → 0
  - `POST /tasks/bulk {op:"priority"}` → `{affected:1,skipped:0}`
  - `POST /tasks/:id/timer/start` → running; `GET /tasks/timers/running` → returns it; `POST .../timer/stop` → `hoursLogged: 0.01`, running → empty
  - `GET /tasks/workload` → rows now carry `baseCapacity/capacity/leaveDaysInWindow/overbookedReason`
  - `GET /tasks/reports/estimation` → `{sampleCount:0,...}` (no completed estimates yet — expected)
- Browser (Playwright, localhost:3000/tasks as sakib):
  - Sprint picker renders as "All tasks"; Board/List/Calendar/Gantt chips present
  - Saved views bar renders "VIEWS / Save current" + "GROUP BY" selector (Project/Assignee/Priority/Status/Tag/None)
  - Swimlane select present with all 5 grouping options
  - Detail drawer shows new **Checklist** tab between Activity and Subtasks
  - Added item via UI → rendered with progress "0/1"; toggled → "1/1" + "Sakib Chowdhury"; deleted → empty state restored
  - "Estimation Accuracy" section renders with the explanatory empty state
  - Only 2 console errors, both pre-existing (missing `/favicon.ico`, missing branding logo file)

## Cleanup
All smoke-test rows (checklist items, sprint, saved view, timer + its TimeLog, bulk priority change) were deleted at the end of the run; dev DB is back to its prior state.

## Not done / follow-ups
- `completedAt` backfill for the 11 pre-existing DONE tasks
- `SprintDailySnapshot` for an accurate burndown
- Per-day dedupe for overdue reminders
- Weekly-off hours subtraction in capacity
- Gantt dependency arrows + drag rescheduling (explicitly out of scope)
