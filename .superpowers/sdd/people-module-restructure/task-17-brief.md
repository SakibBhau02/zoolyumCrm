# Task 17 Brief: Create directory/page.tsx

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 17)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/web/src/app/(app)/people/directory/page.tsx`
- Read-only source: `apps/web/src/app/(app)/people/page.tsx` — the `DirectoryTab` component (locate by function name; it spans roughly lines 223-455). DO NOT modify `page.tsx` in this task.
- Read-only: `apps/web/src/app/(app)/people/_components/modals/employee-form.tsx` (exports `EmployeeModal`) and `_components/modals/employee-profile.tsx` (default export `EmployeeProfileModal`, created in Task 15).

## Global constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`).
- Client component — add `"use client"` at the top.
- Do NOT modify `apps/web/src/components/ui.tsx`.
- No git repo — do not commit. Verify by typecheck.
- Do NOT dispatch subagents.
- Encoding: type real em-dash U+2014 / arrow U+2192 directly; never paste mojibake.

## Context

- Task 15 created `EmployeeProfileModal` with this prop contract:
  `{ open, onClose, detail, loading, onSave: (payload) => Promise<void>, onDelete: () => Promise<void> }`. The modal owns edit state; the page owns the data fetch and the PATCH/DELETE calls.
- `_components/hooks.tsx` exports `useList`, `useToast`, `Toast`, `LoadOrError`, `DataTable`.
- `_components/constants.ts` exports `label`, `utilBarCls`, `fmtTime`, etc.

## What to produce

Create `apps/web/src/app/(app)/people/directory/page.tsx` — a default-export page component built from the `DirectoryTab` body, with these changes:

1. Keep from the source `DirectoryTab`: `refresh`/`reload`, `employees` (via `useList<any[]>("/people/employees", refresh)`), search `q`, `dept` filter + options, `addOpen`, `detailId`, `detail`, `detailLoading` + the fetch effect, `depts` and `rows` memos, the toolbar, the table (rows with the Device ID column, utilization bars, row onClick -> `setDetailId(e.id)`), the empty state, `LoadOrError`, and the `<EmployeeModal open={addOpen} ... />` for Add (imported from `../_components/modals/employee-form`).

2. REMOVE the `<Drawer>` block and its footer/title JSX entirely. Replace it with:

```tsx
<EmployeeProfileModal
  open={!!detailId}
  onClose={() => setDetailId(null)}
  detail={detail}
  loading={detailLoading}
  onSave={async (payload) => {
    if (!detail) return;
    await apiFetch(`/people/employees/${detail.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    notify("Employee updated");
    reload();
  }}
  onDelete={async () => {
    if (!detail) return;
    await apiFetch(`/people/employees/${detail.id}`, { method: "DELETE" });
    notify("Employee deleted");
    setDetailId(null);
    reload();
  }}
/>
```

3. Remove the now-unused state/handlers from the source that live INSIDE the modal now: `editing`, `editF`, `editBusy`, `openEdit`, `saveEdit`. Keep `flash`/`notify` (used by the onSave/onDelete callbacks above and by the Add-Employee modal).

4. Import from `../_components/...` (constants, hooks) instead of local definitions; `apiFetch` from `@/lib/api`; shared components from `@/components/shared` and `@/components/table` as the kept JSX requires; `Drawer`, `Pencil` and any other now-unused imports must be removed.

5. The default export is the page component (name it `DirectoryPage`).

## Verify

Run `npx tsc --noEmit` (workdir `apps/web`). Expected: no errors.

Note: `page.tsx` still exists and still references its own `DirectoryTab` — that is expected and fine until Task 16 rewrites it. The build/typecheck covers this new file standalone.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-17-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path