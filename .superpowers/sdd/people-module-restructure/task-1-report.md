# Task 1 Report: Create shared people-utils.ts

**Status:** DONE

## What was created

- `apps/api/src/people/people-utils.ts` (31 lines) — created at exactly the path in the brief.

The file contains exactly the content from the task brief, transcribed verbatim:

- `import type { CacheService } from "../cache/cache.service";` — verified that `apps/api/src/cache/cache.service.ts` exists (it does).
- Comment block documenting the UTC-getter day convention vs. local-getter punch time-of-day.
- Exports (names/signatures exactly as specified in the brief — the interface Tasks 2, 3, 4 and 8 depend on, nothing renamed):
  - `dateStr = (d: Date) => string` — UTC year/month/date, zero-padded.
  - `monthRange = (period: string) => { start: Date; end: Date }` — UTC month-start and next-month-start.
  - `minutesOf = (hhmm: string) => number` — minutes since midnight from "HH:mm".
  - `toHHmm = (d: Date) => string` — local hours/minutes, zero-padded.
  - `weekdayName = (d: Date) => string` — UTC day-of-week name (SUNDAY..SATURDAY).
  - `leaveDays = (start: Date, end: Date) => number` — inclusive day count, minimum 1.
  - `invalidatePeopleCache = async (cache: CacheService) => Promise<void>` — deletes `people:overview` and `people:employees` keys.

## Verification

Command run: `npm run build` (workdir `apps/api`).

Output:

```
> @zoolyum/api@0.1.0 build
> nest build
```

Exit code 0, no errors or warnings. Build succeeds. (File is not imported anywhere yet, so this confirms it compiles on its own, including the `CacheService` type-only import.)

## Self-review

- File content compared line-by-line against the brief's code block: matches verbatim (all 31 lines, including the comment block, em-dash in comment, empty line between functions, trailing newline).
- All 7 export names match the brief exactly: `dateStr`, `monthRange`, `minutesOf`, `toHHmm`, `weekdayName`, `leaveDays`, `invalidatePeopleCache`. No renames.
- Timezone convention respected: day-level helpers (`dateStr`, `monthRange`, `weekdayName`, `leaveDays`) use UTC getters; punch time-of-day (`toHHmm`) uses local getters. No timezone logic changed.
- Import path `../cache/cache.service` resolves (`apps/api/src/cache/cache.service.ts` exists).
- No git repo in workspace — no commit attempted, per brief.

## Concerns

None.
