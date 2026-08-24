# SDD ledger — plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md

## Setup rulings

- Ruling: No git repo in this workspace — the using-git-worktrees isolation and the skill's
  bash scripts (sdd-workspace, task-brief, review-package) cannot run. Work happens in place
  at `E:\open code\zoolyumCrm`. Implementers verify via build/typecheck commands instead of
  commits; reviews read changed files against the brief. Cost if wrong: no git history to
  fall back on, so verification evidence must be explicit per task.
- Ruling: Line-number references in the plan become invalid as soon as earlier tasks delete
  code from `page.tsx` (Task 14 removes modals; Tasks 17-18 remove tab bodies). Execution
  order is reordered so all extraction tasks (14, 15, 17, 18) run BEFORE the page.tsx rewrite
  (Task 16). All extraction briefs locate components by FUNCTION NAME, not line numbers.
  Cost if wrong: a task edits the wrong region of the file.

## Pre-flight conflict scan

| Tasks sharing a file/interface | Produces vs consumes | Finding |
|---|---|---|
| 1 (utils) -> 2,3,4,8 | dateStr/monthRange/minutesOf/toHHmm/weekdayName/leaveDays/invalidatePeopleCache | Names match the original service's private helpers; no conflict |
| 3 (AttendanceService) -> 8 (PayrollService) | PayrollService injects AttendanceService.attendanceReport | Method name preserved; ok |
| 2-8 -> 9 (module/controller wiring) | 7 services created before Task 9 deletes people.service.ts | Ordering ok; controller maps handlers to services (table in Task 9) |
| 14 (modals) + 16 (page rewrite) + 17/18 (tab pages) all touch page.tsx | Task 14 removes modal functions; 17/18 remove tab bodies; 16 rewrites file to Overview only | CONFLICT: original line numbers shift after each edit; page.tsx must not be rewritten until all bodies are extracted -> reorder (see ruling above) and reference by function name |
| 18 payroll page -> 19 payslip move | payslip href change in payroll page references the moved path | Task 18 changes href to /people/payroll/payslip/[id] BEFORE the file physically moves in Task 19; href target resolves after both tasks -> fine |
| 21 (e2e) -> 22 (verification) | e2e updated before full suite run | ok |

Each task self-agrees: extraction tasks cut by function name; verify steps name the exact command and expected result.

## Task progress

- Task 1: complete (file verified against brief, build passes, review clean)
- Task 2: complete (10 methods moved verbatim, transforms applied, build passes, review clean)
- Task 3: complete (22 methods moved, util substitutions + invalidatePeopleCache applied, build passes, review clean)
- Tasks 4-7: complete (leave 4, performance 8, training 6, recruitment 4 methods moved verbatim, builds pass, reviews clean)
- Task 8: complete (4 payroll methods moved, attendanceReport->attendance.attendanceReport + leaveDays util applied, build passes, review clean)
- Task 9: complete (module/controller/iclock rewired, old service deleted, 7/7 smoke endpoints pass, review clean)
  - Ruling: brief's controller content used injected property `payroll` colliding with the `payroll()` handler (TS2300) — renamed to `payrollService`. Required for TS to compile; route surface unchanged. Cost if wrong: any code expecting `this.payroll` in the controller would break (none does; handler bodies updated).
- Tasks 10-12: complete (constants.ts, hooks.tsx, tab-nav.tsx created, typecheck passes, review clean)
  - Ruling: brief named the hooks file `hooks.ts` but the copied bodies emit JSX (TS parse error in .ts) — renamed to `hooks.tsx`. Imports use `./hooks` and resolve identically. `type Tab` omitted from constants (old shape incompatible with new TABS). Cost if wrong: a downstream import using `./hooks.ts` literally would miss the file (all downstream imports use `./hooks`).
- Tasks 13-14: complete (layout.tsx + 7 modal files created, 10 modals moved verbatim, typecheck passes, review clean)
  - Ruling: brief's per-file import lists were illustrative — implementer imported only what each body actually references (none use ../hooks). Mojibake `1â€“5` in ReviewModal fixed to real en-dash `1–5` per the encoding constraint. Cost if wrong: none — imports compile.
- Task 15: complete (employee-profile.tsx centered Modal xl created, edit state internal, save/delete delegate to props, typecheck passes, review clean)
  - Ruling: Btn has no danger variant — delete button uses the repo's rose ghost pattern. Footer sticky per brief. Added useEffect reset-on-open + local busy state. Cost if wrong: minor visual variance from the plan sketch (sticky vs plain row).
- Task 17: complete (directory/page.tsx created, Drawer replaced by EmployeeProfileModal, typecheck passes, review clean)
- Task 18: complete (11 tab pages created, bodies byte-identical, payslip href updated, typecheck passes, review clean)
- Task 16: complete (page.tsx rewritten to Overview only, unused definitions removed, typecheck passes, review clean)
- Task 19: complete (payslip page moved to people/payroll/payslip/[id]/page.tsx; old path replaced with server-component redirect via next/navigation; typecheck passes)
- Task 20: complete (grep sweep — zero Segmented/Drawer/old /people/payslip/ references under people/ and entire web src)
- Task 21: complete (e2e tab clicks changed button->link for Attendance/Payroll/Settings; action buttons Run Payroll/Save policy/Import punches unchanged)
- Task 22: complete — FULL VERIFICATION
  - npm run build (apps/api): PASS
  - npx tsc --noEmit (apps/web): PASS
  - npx playwright test e2e/ --reporter=line --workers=1: 9/9 PASS (incl. attendance kiosk/import/report, payroll run + payslip via new nested route, role gate)
  - Old /people/payslip/[id] path: server RSC digest confirms NEXT_REDIRECT;replace;/people/payroll/payslip/5;307 (served inside SPA shell — 200 shell + redirect digest is correct Next 16 behavior)
  - /people layout renders PageHeader "People — HRM" + TabNav + "Payroll: July finalized" pill (confirmed in SSR HTML)

## ALL 22 TASKS COMPLETE — module restructure delivered.

## POST-DELIVERY BUGFIX (2026-08-20): performance page runtime crash
- Symptom: `Cannot read properties of undefined (reading 'replace')` at StatusBadge (shared.tsx:153) from performance/page.tsx:50.
- Root cause: `PerformanceReview` model had NO status column (schema, migration, seed, service all lacked it) — `r.status` was always undefined, and the UI's `StatusBadge` requires a string. Pre-existing latent bug surfaced by normal use (never covered by e2e). The "Mark completed" flow PATCHed `status` but the service whitelist dropped it, so it never persisted either.
- Fix (3 layers):
  1. schema.prisma: added `status String @default("PENDING")` to PerformanceReview; migration `20260820101701_performance_review_status` applied (existing rows default to PENDING).
  2. performance.service.ts: createReview sets `status ?? "PENDING"`; updateReview whitelist now includes "status".
  3. performance/page.tsx: defensive `status={r.status ?? "PENDING"}`.
- Prisma client regen hit EPERM (running API held the DLL); retried successfully after. The API dev process died during regen — restarted via `cmd /c npm run start:dev` (background, logs in %TEMP%\opencode\api-restart.log). Web dev untouched.
- Verification: nest build PASS, web tsc PASS, GET /people/reviews returns "status":"PENDING", PATCH COMPLETED→PENDING round-trip persists, data reverted to original state.