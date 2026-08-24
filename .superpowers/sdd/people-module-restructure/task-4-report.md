# Task 4 Report: Create leave.service.ts

Status: DONE

## Summary

Created `apps/api/src/people/leave.service.ts` by mechanically extracting the 4 leave
methods from `apps/api/src/people/people.service.ts`:

- `leaveRequests`
- `applyLeave`
- `approveLeave`
- `leaveBalances`

The private helper `leaveDays` was NOT moved; all `this.leaveDays(...)` calls inside the
moved bodies were rewritten to the imported `leaveDays` from `./people-utils` (Task 1),
whose implementation is byte-identical to the original private method
(`people-utils.ts:23-26` vs `people.service.ts:606-609`).

## Files

- Created: `apps/api/src/people/leave.service.ts`
- Read-only source: `apps/api/src/people/people.service.ts` (not modified)

## Transformations applied

1. Copied the 4 method bodies verbatim from `people.service.ts` (lines 611-665) into the
   new `LeaveService` class using the brief's skeleton.
2. Replaced `this.leaveDays(start, end)` → `leaveDays(start, end)` in `applyLeave`
   (1 occurrence) and `approveLeave` (1 occurrence).
3. Imports limited to what the moved methods use:
   - `Injectable` (class decorator)
   - `NotFoundException` (used by `approveLeave`)
   - `PrismaService`
   - `leaveDays` from `./people-utils`
   No unused imports. Did not bring over `AttendanceStatus`, `CacheService`,
   `CapitalService`, or `BadRequestException`/`ForbiddenException` (unused by the moved
   methods).

## Self-review checklist

- All 4 methods moved by name: `leaveRequests`, `applyLeave`, `approveLeave`,
  `leaveBalances` — present in `leave.service.ts`.
- `this.leaveDays` fully replaced with imported `leaveDays` in the new file — grep for
  `this.leaveDays` in `apps/api/src/people/leave.service.ts` returns 0 matches. The 3
  remaining matches are all in the untouched `people.service.ts` (2 inside the moved
  methods, 1 in `runPayroll` which stays) — cleanup of the old service is out of scope
  for this task per the brief.
- No other behavior changed: method bodies, signatures, and query logic copied verbatim.
- Class skeleton matches the brief: `@Injectable()`, `LeaveService`, constructor takes
  `PrismaService` only (the old methods only used `this.prisma`).

## Verification

`npm run build` (workdir `apps/api`) — **succeeded** (nest build, no errors).

## Concerns

None. Note for later tasks: `LeaveService` is not yet wired into `people.module.ts`
providers/controller — registration is presumably a later task in the plan; the build
passes regardless since the file is standalone.