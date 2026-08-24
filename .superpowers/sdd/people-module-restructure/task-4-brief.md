# Task 4 Brief: Create leave.service.ts

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 4)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Create: `apps/api/src/people/leave.service.ts`
- Read-only source: `apps/api/src/people/people.service.ts`

## Global constraints

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- Method names/signatures preserved verbatim — do not rename. No route changes.
- No git repo — do not commit. Verify by running the build.
- Do NOT dispatch subagents.

## What to produce

Create `apps/api/src/people/leave.service.ts`.

### Methods to move (locate by FUNCTION NAME in `people.service.ts`)

- `leaveRequests`
- `applyLeave`
- `approveLeave`
- `leaveBalances`

The old private helper `leaveDays` is NOT moved — use the imported util `leaveDays` from
`./people-utils` instead (Task 1 created it; identical implementation).

### Class skeleton

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { leaveDays } from "./people-utils";

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  // moved method bodies go here
}
```

### Transformations

- Inside the moved bodies, replace `this.leaveDays(...)` with `leaveDays(...)` (the import).
- Keep imports limited to what the moved methods use. `NotFoundException` is used by
  `approveLeave`; keep it. Remove any unused imports.

## Verify

Run `npm run build` (workdir `apps/api`). Expected: succeeds.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-4-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line)
- Concerns, if any
- The report file path