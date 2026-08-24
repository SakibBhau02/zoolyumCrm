# Tasks 10-12 Brief: Create _components/constants.ts, hooks.ts, tab-nav.tsx

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Tasks 10, 11, 12)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/web/src/app/(app)/people/_components/constants.ts`
- Create: `apps/web/src/app/(app)/people/_components/hooks.ts`
- Create: `apps/web/src/app/(app)/people/_components/tab-nav.tsx`
- Read-only source: `apps/web/src/app/(app)/people/page.tsx` (1647 lines — the file these are extracted from)

## Global constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`).
- Next.js 16 / React 19. Client components need `"use client"` at the top.
- Frontend tab routes: /people, /people/directory, /people/attendance, /people/leave,
  /people/payroll, /people/settings, /people/performance, /people/okrs, /people/training,
  /people/candidates, /people/holidays, /people/org-chart, /people/skills.
- Do NOT modify `apps/web/src/components/ui.tsx` (shared Segmented/Drawer used elsewhere).
- No git repo — do not commit. Verify by typecheck.
- Do NOT dispatch subagents.
- Encoding: type real em-dash U+2014 / arrow U+2192 characters directly; never paste mojibake.

## Task 10: Create `_components/constants.ts`

Copy verbatim from `apps/web/src/app/(app)/people/page.tsx`:
- lines 14-41 constants and helpers: `DAYS`, `dayShort`, `LEAVE_TYPES`, `ATT_STATUSES`,
  `EMPLOYMENT_TYPES`, `EMPLOYMENT_STATUSES`, `COURSE_TYPES`, `CANDIDATE_STAGES`, `label`,
  `okrTone`, `levelTone`, `monthNow`, `todayLocal`, `fmtTime`, `skillsOf`, `utilBarCls`
- the `downloadCsv` function (locate it by name in the source and copy verbatim)
- the `TABS` constant is REPLACED by a new version with hrefs:

```ts
export const TABS = [
  { value: "Overview", href: "/people" },
  { value: "Directory", href: "/people/directory" },
  { value: "Attendance", href: "/people/attendance" },
  { value: "Leave", href: "/people/leave" },
  { value: "Payroll", href: "/people/payroll" },
  { value: "Settings", href: "/people/settings" },
  { value: "Performance", href: "/people/performance" },
  { value: "OKRs", href: "/people/okrs" },
  { value: "Training", href: "/people/training" },
  { value: "Candidates", href: "/people/candidates" },
  { value: "Holidays", href: "/people/holidays" },
  { value: "Org Chart", href: "/people/org-chart" },
  { value: "Skills", href: "/people/skills" },
] as const;
```

Export every identifier (it is a module file, no default export). The `label`, `okrTone`,
`levelTone` consts and `monthNow`/`todayLocal`/`fmtTime`/`skillsOf`/`utilBarCls` helpers are
plain functions/objects — export them as named exports.

## Task 11: Create `_components/hooks.ts`

Locate in the source by name and copy verbatim: `useList`, `useToast`, `Toast`, `LoadOrError`,
`DataTable` (they are near the top of the file, around lines 43-97). Export all five as named
exports. Add the imports they need: `useCallback`, `useEffect`, `useState` from `react`,
`apiFetch` from `@/lib/api`, `SkeletonBlock` from `@/components/shared`. Do not add `"use client"`
to this file unless the contents require it — if the file uses no hooks that need client
directives (it does use useState/useEffect so it WILL be imported only by client components;
it does not need its own directive unless it exports JSX that must be client — check the actual
bodies: `Toast`, `LoadOrError`, `DataTable` render JSX used by client pages, so add `"use client"`
at the top).

## Task 12: Create `_components/tab-nav.tsx`

Exact content:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/shared";
import { TABS } from "./constants";

export default function TabNav() {
  const pathname = usePathname();
  const active = TABS.reduce((best, t) => {
    const match = pathname === t.href || pathname.startsWith(t.href + "/");
    if (match && t.href.length > (best?.href.length ?? 0)) return t;
    return best;
  }, undefined as (typeof TABS)[number] | undefined);
  return (
    <div className="inline-flex overflow-x-auto rounded-xl border border-border bg-card p-1">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all",
            active?.value === t.value
              ? "bg-brand-gradient text-white shadow-md shadow-violet-500/25"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.value}
        </Link>
      ))}
    </div>
  );
}
```

## Verify

Run `npx tsc --noEmit` (workdir `apps/web`). Expected: no errors. The new files are not yet
imported anywhere, so success means they compile standalone.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/tasks-10-12-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path