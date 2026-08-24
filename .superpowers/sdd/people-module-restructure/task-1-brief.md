# Task 1 Brief: Create shared people-utils.ts

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 1)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/api/src/people/people-utils.ts`

## Global constraints that bind this task

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- Day-level date math must keep the UTC-getter convention (dateStr, monthRange); punch
  time-of-day keeps local getters. Do not change timezone logic.
- Encoding: type real em-dash U+2014 and arrow U+2192 characters directly if needed; never
  paste mojibake sequences.
- No git repo in this workspace — do not try to commit. Verify by running the build.
- Do NOT dispatch subagents. Do this task's work yourself.

## What to produce

Create `apps/api/src/people/people-utils.ts` with exactly this content:

```ts
import type { CacheService } from "../cache/cache.service";

// Day keys follow the app convention: DATE columns round-trip as UTC
// midnight, so all day-level math uses UTC getters; punch time-of-day
// (late detection) uses local getters (device wall time).
export const dateStr = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export const monthRange = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const toHHmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const weekdayName = (d: Date) => ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][d.getUTCDay()];

export const leaveDays = (start: Date, end: Date): number => {
  const ms = new Date(end.getTime()).setHours(0, 0, 0, 0) - new Date(start.getTime()).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
};

export const invalidatePeopleCache = async (cache: CacheService) => {
  await cache.del("people:overview");
  await cache.del("people:employees");
};
```

The helper names and signatures are the exact interface that Tasks 2, 3, 4 and 8 depend on —
do not rename anything.

## Verify

Run `npm run build` (workdir `apps/api`). Expected: build succeeds.
(This file is not imported anywhere yet, so success just means it compiles.)

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-1-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- One-line verification summary
- Concerns, if any
- The report file path