# Tasks 5-7 Report: performance.service.ts, training.service.ts, recruitment.service.ts

Status: DONE

Date: 2026-08-20

## Summary

Created three new NestJS service files in `apps/api/src/people/`, each extracting a group of
methods (bodies verbatim) from `people.service.ts`. The old service was NOT modified (it still
contains all original methods — no removal was requested in this task). Verified via `npm run build`.

## Task 5: performance.service.ts

Methods moved (8, all bodies verbatim from `people.service.ts`):
- `reviews` (was line 773)
- `createReview` (was line 780)
- `updateReview` (was line 794)
- `okrs` (was line 807)
- `createOkr` (was line 815)
- `updateOkr` (was line 828)
- `deleteOkr` (was line 840)
- `recomputeOkr` — private helper, moved as required by brief (was line 847)

Internal calls preserved: `this.recomputeOkr(okr.id)` in `createOkr` and `this.recomputeOkr(id)`
in `updateOkr` kept as-is (same class).

Imports (trimmed to what moved methods use):
```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
```
`NotFoundException` used in the `.catch()` of `updateReview`, `updateOkr`, `deleteOkr`.

## Task 6: training.service.ts

Methods moved (6, all bodies verbatim):
- `courses` (was line 859)
- `createCourse` (was line 866)
- `deleteCourse` (was line 880)
- `enrollments` (was line 887)
- `createEnrollment` (was line 897)
- `updateEnrollment` (was line 910)

Imports (trimmed):
```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
```
`NotFoundException` used in `deleteCourse` and `updateEnrollment`.

## Task 7: recruitment.service.ts

Methods moved (4, all bodies verbatim):
- `candidates` (was line 922)
- `createCandidate` (was line 926)
- `updateCandidate` (was line 947)
- `deleteCandidate` (was line 958)

Imports (trimmed):
```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
```
`NotFoundException` used in `updateCandidate` and `deleteCandidate`.

## Verification

`npm run build` (workdir `apps/api`): **SUCCEEDED** — `nest build` completed with no errors or warnings.

## Self-review

Per file, against the brief:

- `performance.service.ts`: exactly the 8 listed methods; no extra methods. Bodies match the
  source verbatim (copied from the read of `people.service.ts` lines 773-856). Private
  `recomputeOkr` included; `this.` internal calls preserved.
- `training.service.ts`: exactly the 6 listed methods; no extra methods. Bodies match source
  lines 859-919 verbatim.
- `recruitment.service.ts`: exactly the 4 listed methods; no extra methods. Bodies match source
  lines 922-963 verbatim.
- Method-name/signature check via grep of `^(\s+)(async|private async) \w+` in the three new
  files: only the intended methods are declared.
- `people.service.ts` unmodified — all original methods still present; no edits made to it.
- Imports minimal: only `Injectable`, `NotFoundException`, `PrismaService` per file; all are used
  (decorator, catch blocks, constructor), so strict TypeScript has no unused-import errors
  (confirmed by successful build).

## Concerns

None. Note for later tasks: the methods still exist in `people.service.ts`; the removal/rewiring
step (controller → new services, module providers) is presumably a later task.