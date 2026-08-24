# Task 2 Report: Create directory.service.ts

- **Date:** 2026-08-20
- **Status:** DONE
- **Brief:** `.superpowers/sdd/people-module-restructure/task-2-brief.md`
- **Plan:** `docs/superpowers/plans/2026-08-20-people-module-restructure.md` (Task 2)

## What was created

`apps/api/src/people/directory.service.ts` — a NestJS `@Injectable()` service
with exactly the class skeleton specified in the brief:

```ts
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { invalidatePeopleCache } from "./people-utils";

@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}
  // ...
}
```

## Methods moved (10 total, copied verbatim from people.service.ts)

| # | Method | Notes |
|---|--------|-------|
| 1 | `overview` | verbatim |
| 2 | `employees` | verbatim |
| 3 | `employeeDetail(id)` | verbatim |
| 4 | `createEmployee(body, user?)` | `this.invalidatePeople()` → `invalidatePeopleCache(this.cache)` |
| 5 | `updateEmployee(id, body, user?)` | `this.invalidatePeople()` → `invalidatePeopleCache(this.cache)` |
| 6 | `deleteEmployee(id)` | `this.invalidatePeople()` → `invalidatePeopleCache(this.cache)` |
| 7 | `orgChart` | verbatim |
| 8 | `skillsMatrix` | verbatim |
| 9 | `utilizationTrend` | keeps `this.utilizationTrendCompute()` call as-is |
| 10 | `utilizationTrendCompute` (private) | verbatim |

## Transformations applied

1. **Cache invalidation:** The three CRUD methods (`createEmployee`, `updateEmployee`,
   `deleteEmployee`) now call `await invalidatePeopleCache(this.cache);` instead of
   `await this.invalidatePeople();`. Confirmed via ripgrep: 3 occurrences, all in the
   CRUD methods; no `this.invalidatePeople` reference remains in the new file.
2. **Old helper NOT moved:** `private async invalidatePeople()` stays in
   `people.service.ts` (not copied; the util function replaces it here).
3. **`utilizationTrend` → `utilizationTrendCompute` call preserved as-is** (both
   methods live in the same class now).
4. **Imports trimmed to what compiles:** `BadRequestException` and `CapitalService`
   are not used by the moved methods, so the new file imports only
   `ForbiddenException`, `Injectable`, `NotFoundException` from `@nestjs/common`, plus
   `PrismaService`, `CacheService`, and `invalidatePeopleCache` from `./people-utils`.
5. **No other behavior changed:** method bodies copied verbatim — signatures, cache
   key names, day-level UTC math, query shapes all identical to the source.

## Files touched

- Created: `apps/api/src/people/directory.service.ts`
- Not modified: `apps/api/src/people/people.service.ts` (still contains all methods;
  to be deleted in Task 9)

## Verification

- Command: `npm run build` (workdir `apps/api`) → **succeeded** (`nest build`,
  exit 0). Both `people.service.ts` (unchanged) and the new `directory.service.ts`
  compile under TypeScript strict.
- Grep audit of the new file: exactly 10 method declarations (9 `async` + 1
  `private async`), 3 `invalidatePeopleCache` calls, no `this.invalidatePeople()`.

## Self-review

- [x] All 10 methods moved (per brief list)
- [x] Only those 10 methods present in the new file
- [x] `this.invalidatePeople()` replaced with `invalidatePeopleCache(this.cache)` in the 3 CRUD methods
- [x] `utilizationTrend` still calls `this.utilizationTrendCompute()`
- [x] Imports limited to what the moved methods use
- [x] No other behavior changed (verbatim bodies)
- [x] Old `people.service.ts` untouched
- [x] Build passes
