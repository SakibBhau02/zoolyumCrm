# Task 15 Report: Create `_components/modals/employee-profile.tsx` (centered modal)

Date: 2026-08-20
Brief: `.superpowers/sdd/people-module-restructure/task-15-brief.md`

## Status: DONE

## What was built

Created `apps/web/src/app/(app)/people/_components/modals/employee-profile.tsx` —
`EmployeeProfileModal`, a default-exported client component (`"use client"` at top)
with the exact prop contract from the brief:

```tsx
export default function EmployeeProfileModal({
  open, onClose, detail, loading, onSave, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  detail: any;
  loading: boolean;
  onSave: (payload: any) => Promise<void>;
  onDelete: () => Promise<void>;
}) { ... }
```

## How the Drawer content was re-housed

Read the `DirectoryTab` source (page.tsx lines 223-455) and moved its profile UI
(`<Drawer>` block, lines 315-452) into the modal:

- **Title:** the Drawer's title header (Avatar, name, roleTitle, StatusBadge — lines
  318-324) became the `Modal` `title` prop verbatim, including the `loading ? "Loading…" : ...` fallback.
- **Body:** `Modal size="xl"` (centered by default in `@/components/ui`). The body
  renders:
  - `loading` → the Drawer's 6-row `SkeletonBlock` stack (lines 336-337) verbatim.
  - `!detail` → null (returns nothing).
  - `editing && editF` → the edit form (two grids: basic fields + schedule/off-days
    with weekly-off chips, lines 339-376) verbatim.
  - otherwise → the view-detail body (contact grid, skills chips, Attendance last 7,
    Leave history, Enrollments, OKRs — lines 378-450) verbatim.
- **Footer:** the Drawer's `footer` prop became a sticky bottom action row *inside*
  the modal body, rendered only when `detail && !loading`:
  `className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t border-border/60 bg-card pt-4"`
  (sticky so the actions stay visible while the tall profile scrolls; `bg-card` keeps
  scrolled content from showing through). View mode shows a single
  `<Btn variant="outline"><Pencil /> Edit profile</Btn>`; edit mode shows Cancel
  (ghost, resets `editing`/`editF`), Save changes (primary), and Delete (danger,
  ghost-with-rose classes per the existing codebase pattern, e.g.
  accounts.tsx:716 / flow.tsx:1292 — `Btn` has no danger variant) with a
  `window.confirm` guard.

## Edit state ownership

The modal owns `editing`, `editF`, and `busy`:

- `openEdit()` initializes `editF` exactly like the source `openEdit()` (page.tsx
  lines 249-253) — copied verbatim.
- `saveEdit()` builds the exact payload the source `saveEdit()` PATCHed (page.tsx
  line 258) but delegates the write to `await onSave(payload)`; on success it resets
  `editing`/`editF` (matching the source's `setEditing(false)` on success). `busy`
  drives the Save button's `opacity-60` class, same as source `editBusy`.
- `deleteEmployee()` guards with `window.confirm`, then delegates to
  `await onDelete()`.
- Added a small `useEffect` that resets `editing`/`editF` when `open` flips to true —
  this preserves the Drawer's behavior (the page's effect reset `editing` when
  `detailId` went null) so a stale edit form can't leak into a newly opened profile,
  regardless of whether the page keeps the modal mounted or conditionally mounts it.
- No `useToast`/`Toast`, no `notify(...)` — the brief mandates the page owns
  notifications; the moved `notify(...)` calls were dropped (the page's `onSave`/
  `onDelete` handle success/error toasts). The modal keeps its own `busy` state.

## Imports (only what the moved code uses)

- `useEffect, useState` from `react` (effect is the one addition, see above)
- `CalendarClock, CalendarDays, GraduationCap, Pencil, Target, Trash2` from `lucide-react`
- `formatBDT, formatDate, formatDay` from `@/lib/format`
- `Avatar, SkeletonBlock, StatusBadge, cn` from `@/components/shared`
- `Btn` from `@/components/table`
- `Field, Input, Modal, Select` from `@/components/ui`
- `DAYS, dayShort, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, label, skillsOf, fmtTime`
  from `../constants`

Dropped vs. the brief's suggested list: `apiFetch` (the PATCH is delegated to
`onSave`, so it is unused — per the brief's "import ONLY what the actual moved code
uses" rule). Added: `cn` (used by the weekly-off chips and the OKR progress bar,
lines 367/444 of the source) and `useEffect` (reset-on-open, see above). All other
listed symbols are used verbatim by the moved JSX.

## Verification

Command: `npx tsc --noEmit` (workdir `apps/web`) — PASSED, zero errors. The
component is not yet imported by any page (Task 17 wires it in), so this proves it
compiles standalone.

Encoding check (byte-level): 3 real U+2192 arrows, 9 real U+2014 em-dashes, 1 real
U+2026 ellipsis (`Loading…`), 0 mojibake byte patterns (no C3 A2 / C3 82 / C3 93
sequences). All special characters are the real Unicode code points.

## Self-review checklist

- [x] Centered `Modal` with `size="xl"` used (not the right-side `Drawer`)
- [x] Edit form initializes exactly like source `openEdit()`; save builds the source's exact PATCH payload
- [x] Save delegates to `onSave(payload)`; delete delegates to `onDelete()` with `window.confirm`
- [x] No `useToast`/`Toast`/`notify` in the modal (page owns notifications)
- [x] JSX and class names verbatim from the Drawer body (view grid, edit grids, sections, skeleton, title)
- [x] Modal renders null when `!open` / `loading` (skeleton rows) / `!detail`
- [x] Imports trimmed to what the code actually uses; `page.tsx` and `@/components/ui` untouched
- [x] `npx tsc --noEmit` passes

## Concerns

1. `Btn` has no `variant="danger"`, so the Delete button uses the repo's established
   danger styling via ghost variant + rose classes (`text-rose-400 hover:bg-rose-500/10
   hover:text-rose-400`), matching accounts/flow/control pages.
2. The footer is sticky within the modal body (`sticky bottom-0 ... bg-card`) per the
   brief's "sticky bottom row" wording; the plan sketch showed a plain row. Visual
   difference is minimal (actions stay pinned at the bottom while scrolling).
3. Two small additions beyond the moved code: the `useEffect` reset on open and the
   `busy` state (source used `editBusy`) — both documented above.