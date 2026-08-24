# Tasks 5-7 Brief: Create performance.service.ts, training.service.ts, recruitment.service.ts

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Tasks 5, 6, 7)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/api/src/people/performance.service.ts`
- Create: `apps/api/src/people/training.service.ts`
- Create: `apps/api/src/people/recruitment.service.ts`
- Read-only source: `apps/api/src/people/people.service.ts`

## Global constraints

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- Method names/signatures preserved verbatim — do not rename. No route changes.
- No git repo — do not commit. Verify by running the build.
- Do NOT dispatch subagents.

## Task 5: performance.service.ts

Move these methods (locate by FUNCTION NAME in `people.service.ts`):
- `reviews`, `createReview`, `updateReview`
- `okrs`, `createOkr`, `updateOkr`, `deleteOkr`
- `recomputeOkr` (private helper — move it too; it is used by createOkr/updateOkr)

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  // moved method bodies go here
}
```

Keep `this.recomputeOkr(...)` internal calls as-is (same class). Keep imports limited to what
the moved methods use.

## Task 6: training.service.ts

Move these methods (locate by FUNCTION NAME in `people.service.ts`):
- `courses`, `createCourse`, `deleteCourse`
- `enrollments`, `createEnrollment`, `updateEnrollment`

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  // moved method bodies go here
}
```

Keep imports limited to what the moved methods use.

## Task 7: recruitment.service.ts

Move these methods (locate by FUNCTION NAME in `people.service.ts`):
- `candidates`, `createCandidate`, `updateCandidate`, `deleteCandidate`

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  // moved method bodies go here
}
```

Keep imports limited to what the moved methods use.

## Notes for all three

- Do NOT modify `people.service.ts` in this task.
- Do NOT move any other methods.
- Bodies copied verbatim; only trim/keep imports so the file compiles under strict TypeScript.

## Verify

Run `npm run build` (workdir `apps/api`). Expected: succeeds (all existing files + the 3 new ones compile).

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/tasks-5-7-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path