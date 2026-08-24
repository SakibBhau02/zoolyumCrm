# Task 16 Brief: Rewrite page.tsx as the Overview page

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 16)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Rewrite: `apps/web/src/app/(app)/people/page.tsx`

## Global constraints

- TypeScript strict. Web typecheck: `npx tsc --noEmit` (workdir `apps/web`).
- Client page — add `"use client"` at the top.
- Do NOT modify `apps/web/src/components/ui.tsx`.
- No git repo — do not commit. Verify by typecheck.
- Do NOT dispatch subagents.
- Encoding: type real em-dash U+2014 / arrow U+2192 directly; never paste mojibake.

## Context

- Tasks 14, 15, 17, 18 already moved every modal and every tab body OUT of `page.tsx` into their own files under `people/` and `people/_components/`. Only the `OverviewTab` body (locate by function name in the current `page.tsx`) remains in this file, along with the old `PeoplePage` default export (the tab-state + Segmented switcher) and a pile of now-unused constants/imports.
- The people `layout.tsx` (Task 13) already renders the PageHeader + TabNav. So `/people` should render ONLY the Overview content.

## What to produce

Rewrite `apps/web/src/app/(app)/people/page.tsx` to be a small Overview page:

1. Default export = the Overview component. Rename `OverviewTab` to `OverviewPage` (or keep the body under the default export name — either is fine as long as the default export renders exactly the OverviewTab body).
2. DELETE the old `PeoplePage` default export (the `tab` state, `Segmented`, the conditional tab rendering, `FadeIn key={tab}`, `PageHeader`).
3. DELETE all now-unused local definitions: the constants block (TABS/DAYS/dayShort/LEAVE_TYPES/ATT_STATUSES/EMPLOYMENT_TYPES/EMPLOYMENT_STATUSES/COURSE_TYPES/CANDIDATE_STAGES/label/okrTone/levelTone/monthNow/todayLocal/fmtTime/skillsOf/utilBarCls), `useList`/`useToast`/`Toast`/`LoadOrError`/`DataTable`, `downloadCsv`, and every modal/tab component that Tasks 14-18 moved out.
4. Import whatever the OverviewTab body needs from `./_components/constants` and `./_components/hooks` (if it uses any of them — check the body carefully). Keep `apiFetch`, `useApi`, shared components, table components, and lucide icons only if the Overview body references them.
5. Add `"use client"` at the top (the body uses hooks/state).

## Verify

Run `npx tsc --noEmit` (workdir `apps/web`). Expected: no errors.
Also verify no other file still imports from `./page` or references the removed local names — the pages import from `./_components/...`, so this should hold; if something imports a name that no longer exists here, fix that import (it should now come from `_components`).

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-16-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path