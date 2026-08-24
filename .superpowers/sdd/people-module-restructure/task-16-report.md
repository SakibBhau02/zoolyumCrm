# Task 16 Report: Rewrite page.tsx as the Overview page

Status: DONE

## What the file now contains

`apps/web/src/app/(app)/people/page.tsx` is now a small (96-line) Overview page:

- `"use client"` at the top.
- Imports limited to what the Overview body references:
  - `CalendarDays, Gauge, Users` from `lucide-react`
  - `useApi` from `@/lib/use-api`
  - `Employee` type from `@/lib/types`
  - `Avatar, CardShell, FadeIn, SkeletonBlock, StatCard, StatusBadge` from `@/components/shared`
  - `TableShell, Td, THead, Th, Tr` from `@/components/table`
  - `UtilizationHeatmap` from `@/components/charts`
- `export default function OverviewPage()` renders exactly the former `OverviewTab` body (4 StatCards, employees table, leave-requests panel, Utilization Trend heatmap) — unchanged, byte-for-byte in JSX.

## What was removed

- The old `PeoplePage` default export (tab state, `Segmented` switcher, conditional tab rendering, `FadeIn key={tab}`, `PageHeader`) — the layout.tsx already renders header + TabNav.
- All moved-out components: `EmployeeModal`, `DirectoryTab`, `AttendanceModal`, `ImportPunchModal`, `AttendanceTab`, `LeaveModal`, `LeaveTab`, `PayrollTab`, `ReviewModal`, `PerformanceTab`, `OkrModal`, `OkrsTab`, `CourseModal`, `EnrollModal`, `TrainingTab`, `CandidateModal`, `CandidatesTab`, `HolidayModal`, `HolidaysTab`, `OrgNode`, `OrgChartTab`, `SkillsTab`, `SettingsTab`.
- Local definitions now living in `_components`: `TABS`, `DAYS`, `dayShort`, `LEAVE_TYPES`, `ATT_STATUSES`, `EMPLOYMENT_TYPES`, `EMPLOYMENT_STATUSES`, `COURSE_TYPES`, `CANDIDATE_STAGES`, `label`, `okrTone`, `levelTone`, `monthNow`, `todayLocal`, `fmtTime`, `skillsOf`, `utilBarCls`, `useList`, `useToast`, `Toast`, `LoadOrError`, `DataTable`, `downloadCsv`.
- Unused imports: `Link`, react hooks (`useCallback`/`useEffect`/`useMemo`/`useState`), `motion`, `apiFetch`, format helpers (`formatBDT`/`formatDate`/`formatDay`), `PageHeader`/`EmptyState`/`SectionTitle`/`cn`, `Btn`, all of `@/components/ui`, `ProgressRing`, and 20 unused lucide icons.
- The `type Tab` alias (moved with TABS into `_components/constants.ts`).

## Verification

- `npx tsc --noEmit` (workdir `apps/web`): passed, no errors, no output.
- Grepped whole `people/` tree: no file imports `./page` or `../page`; all moved-out names are now imported from `../_components/constants`, `../_components/hooks`, or `../_components/modals/*` by their new homes.
- Grepped new `page.tsx` for all removed names: only false positives (`label=` JSX prop, `Tab` inside `TableShell`); no actual references to removed definitions.

## Self-review

- Overview renders as the default export: yes — `export default function OverviewPage()`.
- No leftover references to removed names: confirmed via rg on page.tsx.
- No imports of removed local definitions: imports now only cover the Overview body's needs; nothing pulled from `_components/constants` or `_components/hooks` because the Overview body uses neither (verified against the body source).
- File much smaller: 1647 lines → 96 lines.

File: `apps/web/src/app/(app)/people/page.tsx`