# Task 2 Brief: Create directory.service.ts

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 2)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/api/src/people/directory.service.ts`
- Read-only source: `apps/api/src/people/people.service.ts` (still contains the methods to move)

## Global constraints that bind this task

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- API routes must NOT change. Method names and signatures are preserved verbatim — do not rename.
- Day-level date math keeps the UTC-getter convention; do not change timezone logic.
- No git repo in this workspace — do not commit. Verify by running the build.
- Do NOT dispatch subagents.
- PeopleService will keep the other methods for now; Task 9 deletes it. You only ADD a new file.

## What to produce

Create `apps/api/src/people/directory.service.ts`. It is a NestJS `@Injectable()` service.

### Methods to move (locate by FUNCTION NAME in `people.service.ts`; copy bodies verbatim)

Move these methods out of `apps/api/src/people/people.service.ts` into the new file:
- `overview`
- `employees`
- `employeeDetail`
- `createEmployee`
- `updateEmployee`
- `deleteEmployee`
- `orgChart`
- `skillsMatrix`
- `utilizationTrend`
- `utilizationTrendCompute` (private helper used by utilizationTrend — move it too)

DO NOT move anything else. The old file keeps all remaining methods for now.

### Class skeleton

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

  // moved method bodies go here
}
```

### Required transformations inside the moved bodies

- In `createEmployee`, `updateEmployee`, `deleteEmployee`: replace the call
  `await this.invalidatePeople();` with `await invalidatePeopleCache(this.cache);`
- `utilizationTrend` body calls `this.utilizationTrendCompute()` — keep that call as-is
  (both methods are in this class).
- Remove the old `private async invalidatePeople()` helper entirely (it is NOT moved;
  the util function replaces it).
- Keep `import` statements limited to what the moved methods actually use:
  `BadRequestException` is NOT used here (createEmployee/updateEmployee use
  `ForbiddenException`, deleteEmployee uses `NotFoundException`). Adjust the `@nestjs/common`
  import to only what compiles.

## Verify

Run `npm run build` (workdir `apps/api`). Expected: succeeds.
Note: the old `people.service.ts` still exists and still compiles — a successful build now
means BOTH files compile.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-2-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path