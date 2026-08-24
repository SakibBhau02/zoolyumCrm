# Task 15 Brief: Create _components/modals/employee-profile.tsx (centered modal)

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 15)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/web/src/app/(app)/people/_components/modals/employee-profile.tsx`
- Read-only source: `apps/web/src/app/(app)/people/page.tsx` — the `DirectoryTab` component (locate by name; it spans roughly lines 223-455). Its employee detail UI is currently a right-side `Drawer` (roughly lines 315-452). DO NOT modify `page.tsx` in this task.

## Global constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`).
- Client component — add `"use client"` at the top.
- The user wants the employee profile to open as a CENTERED POPUP, not a right-side drawer. The shared `Modal` component in `@/components/ui` is centered by default.
- Do NOT modify `apps/web/src/components/ui.tsx`.
- No git repo — do not commit. Verify by typecheck.
- Do NOT dispatch subagents.
- Encoding: type real em-dash U+2014 / arrow U+2192 / en-dash U+2013 characters directly; never paste mojibake.

## Context

- Task 14 already moved the other modals into `_components/modals/`. This task creates the last one: the employee profile modal, converted from a `Drawer` to a centered `Modal`.
- The source `DirectoryTab` currently holds the profile state and actions: `detailId`, `detail`, `detailLoading`, `editing`, `editF`, `editBusy`, plus `openEdit()` and `saveEdit()` handlers, plus the `<Drawer>` block with: a title header (Avatar + name + roleTitle + StatusBadge), a footer (Edit profile / Cancel + Save changes), and a body with a view-detail grid + edit-form grids + sections (Attendance last 7, Leave history, Enrollments, OKRs).
- The new modal component will OWN the edit state (`editing`, `editF`, `editBusy`). The page (Task 17) keeps only: `detailId`, `detail`, `detailLoading` state and the data fetch, plus `onSave`/`onDelete` callbacks that perform the PATCH/DELETE via `apiFetch`.

## Component contract (default export)

```tsx
export default function EmployeeProfileModal({
  open,
  onClose,
  detail,
  loading,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  detail: any;
  loading: boolean;
  onSave: (payload: any) => Promise<void>;
  onDelete: () => Promise<void>;
}) { ... }
```

- `onSave(payload)` — the page PATCHes `/people/employees/{detail.id}` with the payload, then closes/refreshes.
- `onDelete()` — the page DELETEs `/people/employees/{detail.id}`, then closes/refreshes.
- The modal renders nothing (returns null) when `!open` or when `loading` is true (render the skeleton rows instead) or `!detail`.

## Implementation steps

1. Read the `DirectoryTab` source. Identify the Drawer's pieces and re-house them:

   - **Title:** reuse the Drawer's title header content (Avatar, name, roleTitle, StatusBadge) as the Modal's `title` prop.
   - **Body:**
     - While `loading`: render the skeleton rows the Drawer used.
     - When `editing && editF`: render the EDIT FORM (the two form grids the Drawer showed: basic fields grid + schedule/off-days grid, with the weekly-off day chips and inputs). Initialize `editF` exactly like the source's `openEdit()` does, and the save handler exactly like `saveEdit()` — BUT the actual PATCH is delegated to the `onSave` prop; the modal keeps its own `busy`/error state for the save button (or reuses `editBusy`).
     - Otherwise: render the VIEW DETAIL body (the contact grid, skills chips, Attendance last 7, Leave history, Enrollments, OKRs sections).
   - **Footer actions (sticky bottom row inside the modal body):** render only when `detail && !loading`:
     - view mode: a single `<Btn variant="outline">` with the Pencil icon and "Edit profile" that sets `editing`/initializes `editF`.
     - edit mode: Cancel (ghost, resets `editing`/`editF`) + Save changes (primary, calls `onSave`), and a Delete button (danger) that calls `onDelete` (with a `window.confirm` guard).
   - The Modal size is `"xl"`.

2. Imports needed: `useState` from react; `apiFetch` from `@/lib/api`; `formatBDT`, `formatDate`, `formatDay` from `@/lib/format`; `Avatar`, `SkeletonBlock`, `StatusBadge` from `@/components/shared`; `Btn` from `@/components/table`; `Field`, `Input`, `Modal`, `Select` from `@/components/ui`; icons from `lucide-react` (Pencil, CalendarClock, CalendarDays, GraduationCap, Target, Trash2); constants from `../constants` (DAYS, dayShort, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, label, skillsOf, fmtTime). Import ONLY what the actual moved code uses — if a symbol is unused, drop it. Note: the modal does NOT need `useToast`/`Toast` — the page owns toast notifications. If the moved edit-form code calls `notify(...)`, replace those calls with nothing (the page's onSave/onDelete handle success notifications).

3. Keep all class names and JSX structure identical to the source so the visual result matches.

## Verify

Run `npx tsc --noEmit` (workdir `apps/web`). Expected: no errors. The component is not yet imported by any page, so success means it compiles standalone.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-15-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path