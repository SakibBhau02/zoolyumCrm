# Task 17 Report: Create directory/page.tsx

**Status:** DONE
**Date:** 2026-08-20

## Summary

Created `apps/web/src/app/(app)/people/directory/page.tsx` — a standalone default-export page (`DirectoryPage`) extracted from the `DirectoryTab` body in `apps/web/src/app/(app)/people/page.tsx` (lines 223-455), with the right-side `Drawer` replaced by the Task 15 `EmployeeProfileModal`.

## What was done

### Kept from source `DirectoryTab` (behavior-identical)
- `refresh`/`reload` state + `useList<any[]>("/people/employees", refresh)` fetch
- Search `q`, department filter `dept` + `depts` memo, `addOpen` for the Add-Employee modal
- `detailId`, `detail`, `detailLoading` + the detail fetch `useEffect` (dropped only the `setEditing(false)` reset, which belonged to the removed modal-owned edit state)
- `rows` memo, the toolbar (search input, department `Select`, "Add Employee" button), the table with the Device ID column, utilization bars via `utilBarCls`, row `onClick` -> `setDetailId(e.id)`, empty state, `LoadOrError` with retry, `<EmployeeModal open={addOpen} ... />` for Add
- `flash`/`notify` via `useToast` (used by Add-modal `onSaved` and the new PATCH/DELETE callbacks)

### Replaced
- The entire `<Drawer>` block (title, footer with Edit/Save, and the inline edit form + view body) removed
- Wired `EmployeeProfileModal` with the full contract:
  - `open={!!detailId}` / `onClose={() => setDetailId(null)}`
  - `detail={detail}` / `loading={detailLoading}`
  - `onSave` -> `apiFetch(PATCH /people/employees/{id})` + `notify("Employee updated")` + `reload()`
  - `onDelete` -> `apiFetch(DELETE /people/employees/{id})` + `notify("Employee deleted")` + `setDetailId(null)` + `reload()`

### Removed (modal-owned state/handlers)
- `editing`, `editF`, `editBusy`, `openEdit`, `saveEdit` — all now live inside `EmployeeProfileModal` (Task 15)

### Imports (from `../_components/...` + shared paths)
- `label`, `utilBarCls` from `../_components/constants`
- `useList`, `useToast`, `Toast`, `LoadOrError` from `../_components/hooks`
- `EmployeeModal` from `../_components/modals/employee-form`, `EmployeeProfileModal` from `../_components/modals/employee-profile`
- `apiFetch` from `@/lib/api`, `formatBDT` from `@/lib/format`
- Shared: `Avatar`, `EmptyState`, `FadeIn`, `StatusBadge`, `cn`; table: `Btn`, `TableShell`, `Td`, `THead`, `Th`, `Tr`; ui: `Select`
- Removed: `Drawer`, `Pencil`, `motion`, `Field`/`Input`/`FormActions`/`Modal`/`Textarea`, `useApi`, `Employee` type, `dayShort`, `DAYS`, `skillsOf`, `fmtTime`, `CalendarClock`/`CalendarDays`/`GraduationCap`/`Target`, `EMPLOYMENT_TYPES`/`EMPLOYMENT_STATUSES` — none used in the kept JSX

## Verification

- `npx tsc --noEmit` (workdir `apps/web`): **passed, no errors** (0 output)
- `page.tsx` (source) NOT modified — its own `DirectoryTab` remains untouched as required
- `apps/web/src/components/ui.tsx` NOT modified
- Not committed (no git repo)

## Self-review checklist

- [x] Drawer fully removed from this file (no `Drawer`, `Pencil`, `Footer`/`title` JSX remnants)
- [x] `EmployeeProfileModal` wired with `open`/`onClose`/`detail`/`loading`/`onSave`/`onDelete`
- [x] Unused state (`editing`, `editF`, `editBusy`, `openEdit`, `saveEdit`) and unused imports dropped
- [x] Table/toolbar/fetch/Add-modal behavior otherwise identical to source `DirectoryTab`
- [x] Default export named `DirectoryPage`
- [x] Real em-dash/arrow characters encoded correctly (no mojibake)

## Concerns

None.
