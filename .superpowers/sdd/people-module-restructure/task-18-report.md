# Task 18 Report: Create the 11 remaining tab pages

**Status:** DONE

## Summary

Moved 11 tab components out of `apps/web/src/app/(app)/people/page.tsx` into their own route pages under
`apps/web/src/app/(app)/people/<tab>/page.tsx`, each a `"use client"` default-export page component with its
logic kept byte-identical (verified by scripted diff against the original bodies). Shared constants/hooks are
imported from `../_components/constants` and `../_components/hooks`; modals from `../_components/modals/...`.
`page.tsx` was NOT modified. No git repo — no commit made. Verified with `npx tsc --noEmit` (workdir
`apps/web`): zero errors.

## Per-file details

| Page file | Component moved (function name) | Renamed default export | Imports (constants / hooks / modals) |
|---|---|---|---|
| `attendance/page.tsx` | `AttendanceTab` | `AttendancePage` | constants: `downloadCsv, fmtTime, monthNow`; hooks: `DataTable, Toast, useList, useToast`; modals: `AttendanceModal, ImportPunchModal` (attendance-modals) |
| `leave/page.tsx` | `LeaveTab` | `LeavePage` | hooks: `DataTable, Toast, useList, useToast`; modals: `LeaveModal` (leave-modal) |
| `payroll/page.tsx` | `PayrollTab` | `PayrollPage` | constants: `label, monthNow`; hooks: `DataTable, Toast, useList, useToast`; run modal kept inline (`Modal`/`FormActions` from `@/components/ui`) |
| `settings/page.tsx` | `SettingsTab` | `SettingsPage` | constants: `DAYS, dayShort`; hooks: `Toast, useList, useToast`; no modals |
| `performance/page.tsx` | `PerformanceTab` | `PerformancePage` | hooks: `DataTable, Toast, useList, useToast`; modals: `ReviewModal` (performance-modals) |
| `okrs/page.tsx` | `OkrsTab` | `OkrsPage` | constants: `okrTone`; hooks: `LoadOrError, Toast, useList, useToast`; modals: `OkrModal` (performance-modals) |
| `training/page.tsx` | `TrainingTab` | `TrainingPage` | constants: `label`; hooks: `DataTable, Toast, useList, useToast`; modals: `CourseModal, EnrollModal` (training-modals) |
| `candidates/page.tsx` | `CandidatesTab` | `CandidatesPage` | constants: `CANDIDATE_STAGES, label`; hooks: `DataTable, Toast, useList, useToast`; modals: `CandidateModal` (candidate-modal) |
| `holidays/page.tsx` | `HolidaysTab` | `HolidaysPage` | hooks: `LoadOrError, Toast, useList, useToast`; modals: `HolidayModal` (holiday-modal) |
| `org-chart/page.tsx` | `OrgNode` + `OrgChartTab` | `OrgNode` kept + `OrgChartPage` | hooks: `LoadOrError, useList`; no constants, no modals |
| `skills/page.tsx` | `SkillsTab` | `SkillsPage` | constants: `levelTone`; hooks: `DataTable, useList`; no modals |

All other imports (`react`, `next/link` where needed, `lucide-react` icons, `@/lib/api`, `@/lib/format`,
`@/components/shared`, `@/components/table`, `@/components/ui`, `@/components/charts`) were trimmed to exactly
what each moved body uses. The local definitions dropped from each file: the shared constants/helpers
(`DAYS`, `dayShort`, `LEAVE_TYPES`, `ATT_STATUSES`, `EMPLOYMENT_TYPES`, `EMPLOYMENT_STATUSES`, `COURSE_TYPES`,
`CANDIDATE_STAGES`, `label`, `okrTone`, `levelTone`, `monthNow`, `todayLocal`, `fmtTime`, `skillsOf`,
`utilBarCls`, `downloadCsv`, `TABS`, `Tab` type) and shared hooks/components (`useList`, `useToast`, `Toast`,
`LoadOrError`, `DataTable`) which now come from `../_components/constants` and `../_components/hooks`.
Unused imports (`Drawer`, `Segmented`, `PageHeader`, `motion`, `FadeIn`, etc.) were removed — none remain in
the new pages (verified by grep + usage scan; `Drawer`/`Segmented`/`PageHeader` remain only in the untouched
`page.tsx` and `payslip/[id]/page.tsx`).

## Payslip link update

`payroll/page.tsx`: `<Link href={`/people/payslip/${r.id}`} ...>` changed to
`<Link href={`/people/payroll/payslip/${r.id}`} ...>` (kept `Link` from `next/link`). This is the only
intentional body difference in any of the 11 files.

## Verification

- `npx tsc --noEmit` (workdir `apps/web`): **no errors** (strict mode on; both the new pages and the
  still-original `page.tsx` typecheck together, as the brief expected).
- Body-identity diff: scripted brace-matched extraction of each tab body from `page.tsx` vs. the moved body
  in each new file (signature line excluded). Result: **10 of 11 byte-identical**; `payroll` differs only on
  the payslip href line (intentional). `OrgNode` extracted and compared separately: identical.
- Import-usage scan (all named imports + `as`-aliases checked against the body of each new file):
  no unused imports in any of the 11 files.
- Encoding: multibyte UTF-8 counts (`·`, `÷`, `—`, `→`, `−`) match the expected occurrences per file;
  no mojibake introduced.
- `page.tsx` unmodified (no edits made to it in this task).

## Self-review checklist

- [x] All 11 pages created under `people/<tab>/page.tsx`
- [x] Each file is `"use client"` with a default-export page component
- [x] Bodies identical to originals — only imports/exports changed (verified by diff)
- [x] Payslip href updated to `/people/payroll/payslip/${r.id}`
- [x] No `Drawer`/`Segmented`/`PageHeader`/`motion` imports left in the new pages
- [x] All imports used; unused local definitions removed
- [x] Typecheck passes
- [x] No commit (no git repo)