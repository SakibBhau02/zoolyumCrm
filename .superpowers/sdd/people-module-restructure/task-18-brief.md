# Task 18 Brief: Create the 11 remaining tab pages

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 18)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create (each a default-export page component):
  - `apps/web/src/app/(app)/people/attendance/page.tsx`
  - `apps/web/src/app/(app)/people/leave/page.tsx`
  - `apps/web/src/app/(app)/people/payroll/page.tsx`
  - `apps/web/src/app/(app)/people/settings/page.tsx`
  - `apps/web/src/app/(app)/people/performance/page.tsx`
  - `apps/web/src/app/(app)/people/okrs/page.tsx`
  - `apps/web/src/app/(app)/people/training/page.tsx`
  - `apps/web/src/app/(app)/people/candidates/page.tsx`
  - `apps/web/src/app/(app)/people/holidays/page.tsx`
  - `apps/web/src/app/(app)/people/org-chart/page.tsx`
  - `apps/web/src/app/(app)/people/skills/page.tsx`
- Read-only source: `apps/web/src/app/(app)/people/page.tsx` — DO NOT modify it in this task.

## Global constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`).
- Client pages — add `"use client"` at the top of each.
- Do NOT modify `apps/web/src/components/ui.tsx`.
- No git repo — do not commit. Verify by typecheck.
- Do NOT dispatch subagents.
- Encoding: type real em-dash U+2014 / arrow U+2192 directly; never paste mojibake.

## Context

- `_components/constants.ts` exports TABS, DAYS, dayShort, LEAVE_TYPES, ATT_STATUSES,
  EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, COURSE_TYPES, CANDIDATE_STAGES, label, okrTone,
  levelTone, monthNow, todayLocal, fmtTime, skillsOf, utilBarCls, downloadCsv.
- `_components/hooks.tsx` exports useList, useToast, Toast, LoadOrError, DataTable.
- `_components/modals/` exports the modal components (from Tasks 14-15): employee-form
  (EmployeeModal), attendance-modals (AttendanceModal, ImportPunchModal), leave-modal
  (LeaveModal), holiday-modal (HolidayModal), performance-modals (ReviewModal, OkrModal),
  training-modals (CourseModal, EnrollModal), candidate-modal (CandidateModal),
  employee-profile (default EmployeeProfileModal).

## What to produce

For each row, move the tab body (component found by FUNCTION NAME in `page.tsx`) into the
page file as the default export, keeping its internal state/data-fetching IDENTICAL. Import
shared constants/hooks from `../_components/constants` and `../_components/hooks`, and modals
from `../_components/modals/...`. Remove the now-unused local definitions (the constants and
helpers the source file declared at the top are no longer local — import them instead).
Remove imports that the kept code no longer uses (e.g. `Drawer`, `Segmented`, `PageHeader`,
`motion`, `FadeIn`, icons no longer referenced).

| Page file | Tab component(s) to move (by name) | Modals it imports |
|---|---|---|
| `attendance/page.tsx` | `AttendanceTab` | AttendanceModal, ImportPunchModal |
| `leave/page.tsx` | `LeaveTab` | LeaveModal |
| `payroll/page.tsx` | `PayrollTab` | (run modal inline) |
| `settings/page.tsx` | `SettingsTab` | none |
| `performance/page.tsx` | `PerformanceTab` | ReviewModal |
| `okrs/page.tsx` | `OkrsTab` | OkrModal |
| `training/page.tsx` | `TrainingTab` | CourseModal, EnrollModal |
| `candidates/page.tsx` | `CandidatesTab` | CandidateModal |
| `holidays/page.tsx` | `HolidaysTab` | HolidayModal |
| `org-chart/page.tsx` | `OrgNode` + `OrgChartTab` | none |
| `skills/page.tsx` | `SkillsTab` | none |

### Payslip link update

In `payroll/page.tsx`, the payroll table's payslip link currently points to
`/people/payslip/${r.id}` (or similar, found in `PayrollTab`). Change it to
`/people/payroll/payslip/${r.id}`. If the link uses `Link` from `next/link`, keep it.

### Keep identical

Tab bodies keep all their logic: useList calls, refresh state, modals wiring, toasts,
CSV exports, tables, forms. Only the file location, the default export, and the import
sources change.

## Verify

Run `npx tsc --noEmit` (workdir `apps/web`). Expected: no errors.
Note: `page.tsx` still contains all the original components until Task 16 rewrites it — the
typecheck covers both. Duplicate symbols across files are fine (they are separate modules).

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-18-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path