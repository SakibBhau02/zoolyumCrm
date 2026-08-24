# Tasks 10-12 Report: _components/constants.ts, hooks.ts, tab-nav.tsx

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Tasks 10, 11, 12)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md
Source (read-only): `apps/web/src/app/(app)/people/page.tsx` — NOT modified.

## Status: DONE_WITH_CONCERNS

## Per-file

### 1. `apps/web/src/app/(app)/people/_components/constants.ts` — created

- Copied verbatim from `page.tsx` lines 14-41: `DAYS`, `dayShort`, `LEAVE_TYPES`,
  `ATT_STATUSES`, `EMPLOYMENT_TYPES`, `EMPLOYMENT_STATUSES`, `COURSE_TYPES`,
  `CANDIDATE_STAGES`, `label`, `okrTone`, `levelTone`, `monthNow`, `todayLocal`,
  `fmtTime`, `skillsOf`, `utilBarCls`.
- Copied `downloadCsv` verbatim from `page.tsx` lines 457-470.
- `TABS` is the new href version from the brief (13 entries). Hrefs match the route list
  in the brief exactly:
  `/people`, `/people/directory`, `/people/attendance`, `/people/leave`,
  `/people/payroll`, `/people/settings`, `/people/performance`, `/people/okrs`,
  `/people/training`, `/people/candidates`, `/people/holidays`, `/people/org-chart`,
  `/people/skills`.
- Exports: all named exports, no default. `type Tab` from the source (line 17) was
  intentionally omitted — it is not in the brief's copy list and its definition depends on
  the old string-array `TABS`, so it would be semantically wrong against the new TABS.
- Encoding verified: `fmtTime` fallback contains a real U+2014 em-dash (codepoint 8212),
  no replacement chars / mojibake.

### 2. `apps/web/src/app/(app)/people/_components/hooks.tsx` — created

- **Filename deviation from brief (see Concerns):** the brief specifies `hooks.ts`, but the
  bodies (`Toast`, `LoadOrError`, `DataTable`) contain JSX, which TypeScript cannot parse in
  a `.ts` file (first `tsc` run failed with TS1005/TS1161 parse errors). Renamed to
  `hooks.tsx` so it compiles with bodies kept verbatim.
- Copied `useList`, `useToast`, `Toast`, `LoadOrError`, `DataTable` verbatim from
  `page.tsx` lines 43-97. All five exported as named exports.
- Imports added: `React` + `useCallback`/`useEffect`/`useState` from `react`;
  `motion` from `framer-motion`; `RefreshCw` from `lucide-react`; `apiFetch` from
  `@/lib/api`; `EmptyState`/`FadeIn`/`SkeletonBlock` from `@/components/shared`;
  `Btn`/`TableShell`/`THead`/`Th` from `@/components/table` (all imports actually
  referenced by the five copied bodies).
- `"use client"` at top (file exports JSX used by client pages, per brief).

### 3. `apps/web/src/app/(app)/people/_components/tab-nav.tsx` — created

- Content matches the brief exactly (default-exported `TabNav`, imports `Link`,
  `usePathname`, `cn`, `TABS`). No deviations.

## Verification

Command: `npx tsc --noEmit` (workdir `apps/web`).

- First run: failed — `hooks.ts` containing JSX produced TS parse errors (TS1005/TS1161).
- After renaming to `hooks.tsx`: run completed with **no output / no errors**.

## Self-review

- Exports: constants.ts exports exactly the identifiers from the brief list + new `TABS` +
  `downloadCsv`; hooks.tsx exports exactly the five functions; tab-nav.tsx default-exports
  `TabNav`. ✓
- Bodies: verbatim from source (constants lines 14-41 + downloadCsv 457-470; hooks 43-97);
  tab-nav verbatim from the brief. Only additions are import statements and `export`
  keywords. ✓
- TABS hrefs: match the route list in the brief (13 routes, verified above). ✓
- `page.tsx` untouched; `apps/web/src/components/ui.tsx` untouched.
- No commits (workspace is not a git repo).

## Concerns

1. **Filename `hooks.ts` → `hooks.tsx`:** the brief's Task 11 filename conflicts with its own
   requirement that the bodies be copied verbatim — `Toast`/`LoadOrError`/`DataTable` emit
   JSX, which is a parse error in a `.ts` file (confirmed by the failing `tsc` run). Renamed
   to `hooks.tsx` to satisfy "bodies verbatim" + "typecheck must pass". Downstream
   imports/tasks must use `./hooks` — importing from a `.tsx` module works identically
   (`import { useList } from "./hooks"`), so no call-site change is needed.
2. `type Tab` from the source was omitted from constants.ts (see per-file note); it is not in
   the brief's copy list and its old definition is incompatible with the new `TABS` shape.