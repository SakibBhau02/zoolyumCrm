# Tasks 13-14 Report: People layout + modal extraction

Date: 2026-08-20
Brief: `.superpowers/sdd/people-module-restructure/tasks-13-14-brief.md`

## Status: DONE

## Task 13 — `apps/web/src/app/(app)/people/layout.tsx`

Created with the exact content from the brief. Verified the title contains a real
em-dash U+2014 (`People — HRM` — byte-verified U+2014 at the em-dash position).

## Task 14 — Modal extraction

All 10 modal components moved into 7 new files under `_components/modals/`.
`page.tsx` was NOT modified (read-only source).

| File | Components moved | Imports (as body requires) |
|---|---|---|
| `_components/modals/employee-form.tsx` | `EmployeeModal` | `useEffect`/`useState` (react), `apiFetch` (`@/lib/api`), `EMPLOYMENT_TYPES`, `label` (`../constants`), `Field`/`FormActions`/`Input`/`Modal`/`Select` (`@/components/ui`) |
| `_components/modals/attendance-modals.tsx` | `AttendanceModal`, `ImportPunchModal` | `useEffect`/`useState`, `apiFetch`, `ATT_STATUSES`/`label`/`todayLocal` (`../constants`), `Field`/`FormActions`/`Input`/`Modal`/`Select`/`Textarea` (`@/components/ui`) |
| `_components/modals/leave-modal.tsx` | `LeaveModal` | `useEffect`/`useState`, `apiFetch`, `LEAVE_TYPES`/`label` (`../constants`), `Field`/`FormActions`/`Input`/`Modal`/`Select` |
| `_components/modals/holiday-modal.tsx` | `HolidayModal` | `useEffect`/`useState`, `apiFetch`, `Field`/`FormActions`/`Input`/`Modal` |
| `_components/modals/performance-modals.tsx` | `ReviewModal`, `OkrModal` | `useEffect`/`useState`, `apiFetch`, `Plus`/`Trash2` (lucide-react), `Field`/`FormActions`/`Input`/`Modal`/`Select` |
| `_components/modals/training-modals.tsx` | `CourseModal`, `EnrollModal` | `useEffect`/`useState`, `apiFetch`, `COURSE_TYPES`/`label` (`../constants`), `Field`/`FormActions`/`Input`/`Modal`/`Select`/`Textarea` |
| `_components/modals/candidate-modal.tsx` | `CandidateModal` | `useEffect`/`useState`, `apiFetch`, `Field`/`FormActions`/`Input`/`Modal` |

Rules applied: `"use client"` at top of each file; all components exported as NAMED
exports with the exact original names; component signatures unchanged; constants from
`../constants`; no imports from the old `page.tsx`.

## Verbatim body verification

Extracted each function from `page.tsx` by name and compared (normalized whitespace)
against the new files:

- employee-form.tsx :: EmployeeModal — MATCH
- attendance-modals.tsx :: AttendanceModal — MATCH
- attendance-modals.tsx :: ImportPunchModal — MATCH
- leave-modal.tsx :: LeaveModal — MATCH
- holiday-modal.tsx :: HolidayModal — MATCH
- performance-modals.tsx :: OkrModal — MATCH
- performance-modals.tsx :: ReviewModal — DIFF (only difference: label text, see below)
- training-modals.tsx :: CourseModal — MATCH
- training-modals.tsx :: EnrollModal — MATCH
- candidate-modal.tsx :: CandidateModal — MATCH

### ReviewModal mojibake fix

Source `page.tsx` line 894 contains mojibake in the label: `Overall rating (1â€“5)`
(UTF-8-misread en-dash). Per the brief's global encoding rule ("never paste mojibake;
type the real character"), the extracted file uses `Overall rating (1–5)` with the real
en-dash U+2013 (byte-verified U+2013 at that position). This is the ONLY difference
between the source body and the extracted body (lengths 1880 vs 1878, exactly the 2
extra mojibake bytes).

## Deviations from brief import notes

The brief's table listed additional imports for several modals (e.g. `useToast`+`Toast`
from `../hooks` for EmployeeModal/AttendanceModal/ImportPunchModal/LeaveModal/
HolidayModal; `Plus`, `Upload`/`Fingerprint`, `CalendarOff`/`CalendarDays`, `Star`,
`Target`, `GraduationCap`, `Users`, `Textarea`, `monthNow` for various). None of these
are actually referenced by the component bodies in `page.tsx` (verified by inspection
of each function). Per the brief's rule "all other imports … as the component body
requires", each file imports only what its body uses. Notably, NO extracted modal uses
`../hooks` — the `useToast`/`Toast` calls live in the tab components (e.g.
`DirectoryTab`, `AttendanceTab`), which stay in `page.tsx`.

## Verification

Command: `npx tsc --noEmit` (workdir `apps/web`) — PASSED with no errors.

## Self-review checklist

- [x] All 10 modals from the brief's table moved into the 7 target files
- [x] Bodies verbatim (verified programmatically; only the mandated mojibake fix)
- [x] Constants imported from `../constants` where used
- [x] No imports from old `page.tsx`; `apiFetch` from `@/lib/api`; UI primitives from `@/components/ui`
- [x] `"use client"` at top of all 7 modal files and the layout imports `./_components/tab-nav`
- [x] Named exports with exact original names (two files export both components)
- [x] `page.tsx` untouched
- [x] `npx tsc --noEmit` passes

## Concerns

1. Brief's per-file import notes listed symbols the component bodies do not actually
   use (verified in source); files import only what the bodies require.
2. Mojibake fix in ReviewModal label (`â€“` → real en-dash U+2013) per brief's encoding
   rule — this is the only body deviation and is intentional.
