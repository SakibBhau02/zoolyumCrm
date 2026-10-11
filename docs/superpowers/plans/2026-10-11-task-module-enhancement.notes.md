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
- Weekly-off hours subtraction in capacity
- Gantt dependency arrows + drag rescheduling (explicitly out of scope)

---

# Follow-up Round (same day) — closing the three known gaps

## 1. `completedAt` backfill

**STOP condition was hit, and handled deliberately.** The plan said "backfill from
`activityLog` DONE entries; if any DONE task has no such entry, stop and report."
Checked the real data first:

```
total DONE returned: 11
Brand film script        | completedAt= | logEntries=0
Convocation edit final   | completedAt= | logEntries=0
... (9 more, all logEntries=0)
Payroll draft July       | completedAt= | logEntries=1   <- only this one had a log
```

10 of 11 had an empty `activityLog`. Root cause found in `prisma/seed.ts:633` —
seed tasks are created with `status: "DONE"` directly, never passing through
`updateStatus`, so no `activityLog` entry and no `completedAt` was ever written.

**Decision: fix the root cause, do not guess in a migration.**
- `prisma/seed.ts` now computes `due` once and sets
  `completedAt: t.status === "DONE" ? due : null`, so future seeds are correct.
- `apps/api/backfill-task-completed-at.mjs` — one-off repair scoped to an explicit
  list of the 11 seed DONE titles, only where `completedAt IS NULL`. Uses the task's
  own `dueDate` as the stamp (seeded DONE tasks are all past-due, so this is the
  closest honest proxy) and documents that it is a seed artefact, not a general
  heuristic.
- Ran it: **11/11 stamped** (e.g. "Brand film script" → 2026-07-20, "Payroll draft
  July" → 2026-08-19). Verified after: `DONE with completedAt: 11, without: 0`.

I did **not** write a migration that applies a dueDate heuristic to arbitrary rows,
because on real data that would silently fabricate completion dates.

## 2. `SprintDailySnapshot` + accurate burndown

- New model `SprintDailySnapshot` (`[sprintId, date]` unique, cascade on sprint
  delete) capturing total/done/open/remaining/estimatedHours/actualHours.
- `captureSprintSnapshot(sprintId)` is idempotent via upsert.
- `sprintBurndown()` now calls `captureSprintSnapshot` first (so today always has a
  live anchor), then builds the series from snapshots where present and falls back to
  the reconstruction where not.
- **Every point carries `source: "snapshot" | "estimated"`** — the UI draws estimated
  segments with a dashed line and shows a legend + "N snapshot days", so the reader is
  never misled about which parts are reconstructed.
- New nightly cron `@Cron("30 23 * * *") snapshotActiveSprints()` snapshots all
  PLANNED/ACTIVE sprints, so history accumulates from here on.
- New endpoint `POST /tasks/sprints/:id/snapshot`.
- Reconstructed-day caveat from round 1 still applies to *old* days (a re-opened or
  deleted task can skew them) — that is now visible, not hidden.

## 3. Per-day dedupe for overdue reminders

- `overdueReminders()` now checks for an existing `Notification` with the same
  `(userId, type, link)` created since local midnight, and skips if found.
- Cron time moved `0 9` → `30 9` (avoids colliding with other 09:00 jobs).
- Returns `{ sent, skipped, scanned }`.

**Proof (not just a code read).** `apps/api/verify-overdue-dedupe.mjs` runs the exact
cron query twice and writes real rows between passes:

```
pass 1 (cold):
  first run : scanned=15 sent=2 skipped=0 noLinkedUser=13
pass 2 (should skip everything pass 1 sent):
  second run: scanned=15 sent=0 skipped=2 noLinkedUser=13

DEDUPE OK — second pass sent 0, skipped 2
cleanup: removed 2 notification row(s)
```

(13 of 15 overdue tasks have no assignee, so they are correctly skipped — that is
also why the original round's smoke test saw 0 notifications.)

## Verification — round 2

- `npx prisma format` + `npx prisma validate` ✅
- `npx prisma migrate dev --name sprint_daily_snapshot` applied `20261011093023`
- `npx prisma generate` ✅ (killed the API process again to release the engine DLL)
- `npm run build --prefix apps/api` ✅ 0 TS errors
- `npm run build --prefix apps/web` ✅ (one fix needed: `toXY` needed an explicit
  `[number, number]` return type for the split estimated/snapshot paths)
- Live checks:
  - `GET /tasks?...&status=DONE&archived=true` → `11/11` now carry `completedAt`
  - `POST /tasks/sprints/:id/snapshot` → row written `{total:4,done:4,remaining:0}`
  - `GET /tasks/sprints/:id/burndown` → `snapshotDays:1`, point sources
    `estimated=97, snapshot=1` (1-day sprint window so mostly estimated — correct)
  - dedupe script → **OK** (above)
- Browser: selected the sprint in the picker; burndown card renders with all four
  legend entries (`actual remaining`, `estimated`, `ideal`, `snapshot days`) and the
  Estimation Accuracy section still shows its empty state.
- **Cleanup verified directly in the DB:** `sprints: 0`, `snapshots: 0` (cascade
  confirmed), `DONE with completedAt: 11 / without: 0`, dedupe script removed its own
  2 notification rows.

## Remaining follow-ups (unchanged)
- Weekly-off hours subtraction in capacity
- Gantt dependency arrows + drag rescheduling
- Old burndown days stay "estimated" — expected; snapshots only accumulate forward

---

# Full-module audit round ("shob kichu dekho") — same day

Re-read the whole plan + notes, then audited schema ↔ code ↔ UI end to end.
Found one P0, several P1 permission holes, and closed the last plan follow-up.

## P0 — `ScheduleModule.forRoot()` was never registered

`@nestjs/schedule` is installed and three `@Cron`s exist in `tasks.service.ts`
(`overdueReminders` 09:30, `closeStaleTimers` 03:00, `snapshotActiveSprints` 23:30),
but `app.module.ts` never imported `ScheduleModule.forRoot()` — and there are no
other `@Cron`s anywhere in the repo. **Without it Nest never discovers cron
methods, so all three jobs were silently dead code.** One-line fix in
`app.module.ts` with a comment explaining why it must stay.

## P1 — permission holes closed

All verified live as rahim (Sales/BD, no employee) → 403 in every case:

| Endpoint | Before | After |
|---|---|---|
| `POST/DELETE :id/dependencies` | no user param at all — any login could rewire the graph | `canWorkOnTask` required |
| `DELETE :id/comments/:commentId` | any login could delete anyone's comment | author (by User id) or `canEditFull` |
| `PATCH :id/comments/:commentId/reactions` | no check | `canViewTask` required |
| Sprint create/update/delete | open to every login | `requirePlanner()` (PM/Admin) |
| `POST /sprints/:id/tasks` | open + no cross-project check | per-task `canEditFull` + project-match, returns `{affected, skipped}` |
| Template create/delete, automation create/update/delete | open to every login | `requirePlanner()`; template *use* stays open |

Also: `updateSprint` now rejects `endDate < startDate` (create already did).

## P1 — assigner provenance plugged everywhere

`assignedById` was only stamped on manual create/update. Now also on:
`clone()`, `spawnRecurrence()`, `useTemplate()`, and bulk `assign` (which moved
from `updateMany` to per-task updates so each task keeps its own `assigned`
activity entry — handover history must survive bulk ops). Verified live:
bulk-assign to Sohan → `assignedBy: Sakib Chowdhury`; clone → same.

## P2 — UI gaps closed

- Timer buttons on board cards + list rows (plan Batch 1 promised "play/stop on
  card"; only the drawer had one). 24 cards + drawer = 25 buttons confirmed.
- Non-planners no longer see sprint create/delete, template New/delete, or
  automation add/toggle/delete (`canPlan` from `/auth/me` roleName, mirroring
  backend `isPM()`; backend 403s regardless).
- Drawer metadata gained the missing **Sprint** select (`PATCH :id/sprint`,
  `canFull`-gated) — previously tasks could only enter sprints via API.
- Form-mode project panel no longer prints a wrong "0 tasks" (the Flow project
  fetch has no `_count`; the count now renders only when present).

## Plan leftover closed — weekly-off capacity

`Employee.weeklyOffDays` empty means "follow policy", not "no offs" — the first
implementation treated it as no offs (all DB employees have `[]`). Now falls
back to `AttendancePolicy.default.weeklyOffDays` (Fri/Sat). Live result for the
Sun–Sat window: `off=2, capacity=24` with reason
"2 weekly off day(s) in window"; UI badge shows "2d off".

## Incidental findings (no change)

- `BulkTaskDto.value` has no decorator but survives `whitelist: true` (only
  *undeclared* props are stripped); verified live twice. Left as-is + comment.
- `nest start --watch` + `deleteOutDir: true` self-destructs under rapid saves
  (two overlapping compilations → `Cannot find module dist/main`, process dies
  and never recovers). Switched the running dev server to
  `build` + `start:prod` with explicit rebuilds. Recommend the same for
  day-to-day backend work until `deleteOutDir` is turned off.
- `page.tsx` has a *local* `TaskRow` duplicating the modal's — pre-existing;
  both gained `sprintId`. A merge/dedupe pass would help but is cosmetic.
- Each timer button fetches `/tasks/timers/running` on mount (~25 parallel
  trivial queries per board load). Cheap enough to leave; lift state up if it
  ever shows in profiling.

## Verification — audit round

- `npm run build --prefix apps/api` ✅ 0 errors, `npm run build --prefix apps/web` ✅
  (one fix: page-local `TaskRow` needed `sprintId`; one revert of my own bad edit
  in sprint.tsx caught before build)
- Live (prod-mode API, sakib Owner / rahim Sales-BD):
  - workload → `off=2, capacity=24` for all three employees
  - sprint/template/automation create as rahim → 403 × 3
  - dependency add, comment delete as rahim → 403 × 2; author delete → ok
  - sprint move as owner → ok; as rahim → 403; cross-project bulk assign → skipped → 403 with message
  - bulk assign + clone assigner stamps → correct; clone + test rows deleted
- Browser: Sprint field + "Backlog (no sprint)" in drawer, planner buttons
  visible as Owner, 25 timer buttons, "2d off" badge; only the pre-existing
  logo 404 in console.
- No DB residue: all audit rows removed (verified by re-query, not assumed).
