# Tasks 13-14 Brief: Create people layout + extract modal components

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Tasks 13, 14)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/web/src/app/(app)/people/layout.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/employee-form.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/attendance-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/leave-modal.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/holiday-modal.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/performance-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/training-modals.tsx`
- Create: `apps/web/src/app/(app)/people/_components/modals/candidate-modal.tsx`
- Read-only source: `apps/web/src/app/(app)/people/page.tsx` (1647 lines — DO NOT modify it in this task)

## Global constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`).
- Client components need `"use client"` at the top.
- Do NOT modify `apps/web/src/components/ui.tsx` (shared Segmented/Drawer/Modal used elsewhere).
- No git repo — do not commit. Verify by typecheck.
- Do NOT dispatch subagents.
- Encoding: type real em-dash U+2014 / arrow U+2192 directly; never paste mojibake.

## Context

- Task 10 created `_components/constants.ts` (exports: TABS, DAYS, dayShort, LEAVE_TYPES,
  ATT_STATUSES, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, COURSE_TYPES, CANDIDATE_STAGES, label,
  okrTone, levelTone, monthNow, todayLocal, fmtTime, skillsOf, utilBarCls, downloadCsv).
- Task 11 created `_components/hooks.tsx` (exports: useList, useToast, Toast, LoadOrError, DataTable).
- Task 12 created `_components/tab-nav.tsx` (default export TabNav).
- The modal components to extract live in `page.tsx` — locate each by FUNCTION NAME.

## Task 13: Create `apps/web/src/app/(app)/people/layout.tsx`

Exact content:

```tsx
import { PageHeader } from "@/components/shared";
import TabNav from "./_components/tab-nav";

export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="People — HRM"
        subtitle="Attendance through payroll, with utilization intelligence."
        actions={<span className="rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">Payroll: July finalized</span>}
      />
      <div className="overflow-x-auto pb-1">
        <TabNav />
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
```

Note: the title text contains a real em-dash between "People" and "HRM" — type the real
U+2014 character.

## Task 14: Extract the modal components

Move each modal component (function found by NAME in `page.tsx`) into its new file. Copy the
body verbatim. Adjust imports so each file compiles standalone:

| New file | Component(s) to move | Notes on imports |
|---|---|---|
| `_components/modals/employee-form.tsx` | `EmployeeModal` | uses `apiFetch`, `useToast`+`Toast` (from `../hooks`), `label` (from `../constants`), `Field`/`Input`/`Select`/`Modal`/`FormActions` from `@/components/ui`, `Plus` from `lucide-react` |
| `_components/modals/attendance-modals.tsx` | `AttendanceModal`, `ImportPunchModal` | AttendanceModal uses `todayLocal`, `ATT_STATUSES`, `label` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`Textarea`/`FormActions`, `apiFetch`, `Upload`/`Fingerprint` from lucide-react; ImportPunchModal uses `useToast`+`Toast`, `Modal`/`Textarea`/`FormActions`, `apiFetch`, `Upload` |
| `_components/modals/leave-modal.tsx` | `LeaveModal` | uses `LEAVE_TYPES`, `label`, `monthNow` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`FormActions`, `apiFetch`, `CalendarOff` |
| `_components/modals/holiday-modal.tsx` | `HolidayModal` | uses `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`FormActions`, `apiFetch`, `CalendarDays` |
| `_components/modals/performance-modals.tsx` | `ReviewModal`, `OkrModal` | ReviewModal uses `label`, `monthNow` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`Textarea`/`FormActions`, `apiFetch`, `Star`; OkrModal uses `label`, `monthNow` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`Textarea`/`FormActions`, `apiFetch`, `Target` |
| `_components/modals/training-modals.tsx` | `CourseModal`, `EnrollModal` | CourseModal uses `COURSE_TYPES`, `label` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`Textarea`/`FormActions`, `apiFetch`, `GraduationCap`; EnrollModal uses `label`, `monthNow` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Select`/`FormActions`, `apiFetch`, `GraduationCap` |
| `_components/modals/candidate-modal.tsx` | `CandidateModal` | uses `CANDIDATE_STAGES`, `label` (from `../constants`), `useToast`+`Toast`, `Modal`/`Field`/`Input`/`Select`/`Textarea`/`FormActions`, `apiFetch`, `Users` |

Rules:
- Add `"use client"` at the top of each file.
- Import the constants from `../constants` and the hooks from `../hooks` (NOT from the old
  page.tsx). All other imports come from their original locations (`@/components/ui`,
  `@/components/table`, `@/lib/api`, `lucide-react`, etc.) as the component body requires.
- The component signatures (props) are unchanged.
- Export each component as a NAMED export with the exact original name (e.g.
  `export function EmployeeModal(...)`). Files with two components export both.

## Verify

Run `npx tsc --noEmit` (workdir `apps/web`). Expected: no errors. The new files are not yet
imported by any page, so success means they compile standalone.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/tasks-13-14-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path