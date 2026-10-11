# Task Module Enhancement — Plan

> Date: 2026-10-11
> Status: Approved (user selected all 10 features)
> Scope: `apps/api/src/tasks/*` + `apps/web/src/app/(app)/tasks/*` + Task-related Prisma models

## 1. Current State (verified by inspection)

**Backend** (`apps/api/src/tasks/tasks.service.ts`, 740 lines)
- CRUD, clone, status change w/ activity log
- Subtasks (`parentTaskId`, `sortOrder`), task dependency graph (`TaskDependency`: blocked-by/blocks/related)
- Time logging (`TimeLog`, `loggedVia: MANUAL|TIMER`, `isBillable`), `recomputeActualHours`
- Comments with replies + emoji reactions (`TaskComment.reactions` JSON)
- Templates (`TaskTemplate.defaultTasks` JSON), automation rules (`AutomationRule`), workload (hardcoded `capacity = 40`)
- Recurring: spawns next occurrence on DONE (daily/weekly/monthly/quarterly/yearly)
- Permission model: `canViewTask` / `canEditFull` / `canEditProgress` (admin/PM/reporter/assignee)
- Cache: `tasks:stats`, `tasks:list:*`; invalidates `flow:overview`, `dashboard:overview`
- Notify: `notifyAssignee` on assign; WhatsApp triggers on assign + completion

**Frontend** (`apps/web/src/app/(app)/tasks/page.tsx`, 1703 lines)
- Views: Board (DnD + lanes by project), List (tree w/ `FragmentRow`), Calendar (month), Gantt (timeline)
- Stats strip (6 StatCards), filters (q/status/priority/type/project/mine/myDay), sort
- Detail drawer tabs: Activity, Subtasks, Comments, Time Log, Dependencies, Files & Links
- Templates + Automation panels; multi-select checkboxes exist (bulk actions missing)

**Models already present:** `Task`, `TaskDependency`, `TimeLog`, `TaskComment`, `TaskTemplate`, `AutomationRule`, `EstimateAccuracyLog`, `ProjectDeliverable`, `Project`, `ReportDefinition`

## 2. Gaps → Features (user-approved, 10 items)

| # | Feature | Gap | Effort |
|---|---------|-----|--------|
| 1 | **Checklist** (lightweight sub-items) | Task has subtasks (full tasks) but no zero-weight checklist | S |
| 2 | **Timer start/stop** | `LoggedVia.TIMER` enum unused; no running-timer persistence | M |
| 3 | **Bulk actions** | Checkboxes exist, no bulk status/assign/priority/delete | M |
| 4 | **Sprint / Cycle** | No planning batch layer; board can't scope to a cycle | L |
| 5 | **Saved views** | Filters reset every visit | S |
| 6 | **Board swimlanes** | Lanes fixed to project grouping | S |
| 7 | **Comment/mention notify** | `mentionedUserIds` stored but never notified; comments silent | S |
| 8 | **Overdue reminder cron** | No scheduled nudge for overdue/due-soon | S |
| 9 | **Employee capacity + leave-adjusted** | `capacity = 40` hardcoded; leave ignored | M |
| 10 | **Estimation accuracy report** | `EstimateAccuracyLog` written nowhere, no view | M |

Also fixing: recurring duplicate-spawn on DONE→reopen→DONE; `myDay()` in controller ignores `@CurrentUser` (always all tasks).

## 3. Batches (one session each, verify before next)

### Batch 1 — Quick wins (S/M)
1. **Checklist**: `TaskChecklistItem` model (id, taskId, content, done, sortOrder, doneById, doneAt) + API (`POST/PATCH/DELETE /tasks/:id/checklist`, `PATCH .../checklist/:itemId`) + detail-drawer tab + subtask-independent progress on card.
2. **Timer**: `TaskTimer` model (id, taskId, employeeId, startedAt, stoppedAt) — one running per employee. Endpoints: `POST /tasks/:id/timer/start|stop`, `GET /tasks/timers/running`. UI: play/stop on card + header pill showing elapsed; stop logs a `TimeLog` with `loggedVia: TIMER`.
3. **Fix `myDay`** to respect `@CurrentUser` employeeId; fix recurring re-spawn guard (`recurrenceSpawnedAt` or only spawn when `existing.status !== "DONE"`).

### Batch 2 — Bulk actions (M)
`POST /tasks/bulk` with `{ids[], op: status|assign|priority|dueDate|archive|delete, value}`. Permission-checked per task. UI: selection bar with count, action dropdown, optimistic refresh.

### Batch 3 — Sprint/Cycle (L)
`Sprint` model (id, name, goal, projectId?, startDate, endDate, status PLANNED|ACTIVE|COMPLETED, capacityHours?). `Task.sprintId`. Endpoints: Sprint CRUD + `POST /tasks/:id/sprint`, `GET /sprints/:id/burndown` (per-day remaining from `activityLog`/`completedAt`). Note: `Task` has no `completedAt` — add it, backfill from `activityLog` DONE entries. UI: sprint picker in header, board scoped to sprint, burndown mini-chart.

### Batch 4 — Saved views + swimlanes (S)
`SavedTaskView` model (id, userId, name, filters JSON, viewMode, groupBy, isShared). Endpoints CRUD + `GET /tasks/views`. UI: view switcher chips ("My overdue", "Team sprint") + `groupBy` selector (project | assignee | priority | status | tag) driving board lanes.

### Batch 5 — Notifications (S)
- `addComment` → notify mentioned users + task assignee/reporter (exclude author), body excerpt.
- `@Cron` overdue reminder: daily, notify assignee for overdue + due-in-24h; dedupe key per (task, day) via NotificationPreference gate.
- Wire `mentionedUserIds` (currently dead data).

### Batch 6 — Capacity (M)
`Employee.weeklyCapacityHours` (default 40) + `Employee.capacityOverrides` JSON or reuse Leave. `workload()` computes effective capacity = base − leave days in window, returns utilization vs capacity, flags overbooked with reason. UI: workload table gains capacity column + leave-adjusted bar.

### Batch 7 — Estimation accuracy (M)
- Write `EstimateAccuracyLog` on task DONE (estimatedHours vs actualHours, varianceRatio, employeeId, taskType).
- `GET /tasks/reports/estimation` — per employee/taskType: avg variance, bias (over/under), sample count.
- UI: new "Reports" section/tab on tasks page with table + top offenders.

## 4. Files to touch

**Schema:** `apps/api/prisma/schema.prisma` (+1 migration per batch that adds models: B1, B3, B4, B6)
**API:** `tasks/tasks.service.ts`, `tasks/tasks.controller.ts`, new `tasks/dto/*`, new `tasks/sprint.service.ts` (B3), `tasks/reports.service.ts` (B7), `people/payroll.service.ts` (B6 leave), `notifications/notifications.service.ts` (B5)
**Web:** `apps/web/src/app/(app)/tasks/page.tsx` (all batches), extracted `_components/` if page >2000 lines (B3 trigger), `apps/web/src/lib/types.ts`
**Docs:** this plan + `notes.md` per batch

## 5. Verification per batch
- `npx prisma validate` + `npx prisma migrate dev --name <batch>`
- `npm run build --prefix apps/api` — 0 TS errors
- `npm run build --prefix apps/web` — route compiles
- Manual smoke via running dev servers: feature exercised on real task, then `GET` reflects it
- Regression: existing stats/list/board still load; `GET /tasks/stats` unchanged shape

## 6. Out of scope
- Custom workflow per project (status columns are global enum) — separate epic
- Time tracking billing export to invoices — Capital module owns invoices
- Gantt dependency arrows + drag rescheduling — visual only, defer
- Real AI task breakdown — needs LLM provider decision
- Mobile app — web responsive only

## 7. STOP conditions
- If adding `Sprint` conflicts with existing `Project.reportFrequency` scheduling semantics → stop and confirm scope
- If `Task.completedAt` backfill finds tasks with no DONE entry in `activityLog` → stop, report count, do not guess
- If board lane extraction (B4) requires >400-line refactor of `page.tsx` → stop and confirm component split
