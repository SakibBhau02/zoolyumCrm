# Production Readiness — Blocker Fix Log

Date: 11 Nov 2026
Companion to `docs/qa-production-readiness-report.md` (the audit). This file
records what changed for each of the 13 deployment blockers and how it was
verified.

All verification was run against a production build of the API
(`node dist/main.js`, `NODE_ENV=production`) and the seeded demo database.

---

## 1. Vendor payouts were counted as client income — FIXED

**Root cause:** `Payment` is one table for both directions. Expense payments were
created without a type, so they inherited `IN` and every report that summed
"payments" included cash that left the business.

**Changes**
- `PaymentType` gains `OUT` (`prisma/schema.prisma`).
- `expense.service.ts` writes `type: "OUT"` for every vendor/expense payout.
- Migration `20261112090000_payment_direction_out` + backfill
  `20261112090100_payment_direction_backfill` (`UPDATE … WHERE expenseId IS NOT NULL`).
- Canonical filter `RECEIPT_PAYMENT_FILTER` in `capital/finance-kernel.ts`, applied to:
  `reporting.service.ts` (overview split, reports data, period report, income stats),
  `invoice.service.ts` (`income()` list + refund sign), `dashboard.service.ts`,
  `insight.service.ts`, `masters.service.ts` (bank statement direction/amount).

**Verification:** created a payable expense, paid it via the API, and confirmed
`/capital/income/stats` total was unchanged (delta 0) and the payout never
appeared in `/capital/income`. Check: `qa/verify-fixes.mjs`.

---

## 2. Public upload route served every signed Flow file — FIXED

**Root cause:** `/api/pulse/uploads/:filename` was `@Public()` and read the same
directory as the signed Flow downloads.

**Changes**
- Pulse uploads now live in `uploads/pulse/` (`pulse.controller.ts`).
- The route requires a valid HMAC (`exp` + `sig`) bound to the `pulse` bucket
  (`common/signed-url.ts` now signs `bucket:filename:exp`).
- Attachment/proposal URLs are signed on read; deleting an attachment also
  removes the blob.
- Upload allowlist (extensions + MIME) added; `.html`/`.svg` are rejected.

**Verification:** unsigned and forged-signature requests return **403**.
Flow signatures cannot be replayed against the pulse route (bucket is signed).

---

## 3. `NEXT_PUBLIC_API_URL` was hardcoded to localhost — FIXED

**Changes**
- `apps/web/next.config.ts` fails a production build when the variable is
  missing, and warns when it is not HTTPS.
- `apps/web/Dockerfile` takes `ARG NEXT_PUBLIC_API_URL`, requires it, and now
  copies the standalone output.
- `docker-compose.yml` passes it as a build arg and refuses to build without it.
- The duplicated fallback in `notifications-dropdown.tsx` now imports `API_URL`.

**Verification:** `next build` without the variable exits with
`NEXT_PUBLIC_API_URL is required for a production build`; with it, the build
succeeds and emits standalone output.

---

## 4. Permission editor used keys no guard reads — FIXED

**Changes**
- `common/module-keys.ts` is the single source of truth
  (`PULSE, ACCOUNTS, FLOW, TASKS, PEOPLE, CAPITAL, INSIGHT, CALENDAR, PORTAL, CONTROL`)
  with a legacy alias map.
- `control.service.ts` normalises on read and write; `permissions.guard.ts`
  accepts legacy labels so tokens minted before the rename keep working.
- Migration `20261112090300_role_module_keys` renames existing role matrices.
- Web admin UI uses the canonical list.

**Verification:** `/control/roles` returns canonical keys for every role and no
legacy keys remain.

---

## 5. Webhooks accepted requests when the secret was unset — FIXED

**Changes**
- WhatsApp: POST returns **503** when `appSecret` is missing; verify-token
  comparison is constant-time.
- Telegram: returns **503** when `webhookSecret` is missing; secret comparison is
  constant-time.

**Verification:** WhatsApp webhook → 503 with no secret; Telegram webhook either
rejects or reports `disabled` without processing.

---

## 6. IP allowlist trusted `X-Forwarded-For` — FIXED

`admin-policy.guard.ts` now reads the header only when `TRUST_PROXY=1`, matching
`rate-limit.guard.ts`. Behind a proxy the first hop is used; otherwise the socket
address is authoritative.

---

## 7. JWT secret fell back to `"dev-secret"` — FIXED

- `common/env.ts` refuses to boot without `JWT_SECRET` (≥ 32 chars), without
  `DATABASE_URL`, and — in production — without `CORS_ORIGINS` or with the
  development placeholder.
- `auth.module.ts` throws instead of falling back; `common/crypto.ts` and
  `common/signed-url.ts` no longer contain literal secrets.

**Verification:** production start without the values exits with a configuration
report (observed twice during the fix run).

---

## 8. Money endpoints accepted invalid input — FIXED

- New DTOs: `RecordPaymentDto`, `PayExpenseDto`, `CreateCreditNoteDto`
  (`capital/dto/payment.dto.ts`) with positive amounts, enum methods, ISO dates
  and length caps.
- `invoice.service.ts`: one `normalizeLines()` validator for create **and**
  update (negative rate, zero quantity, `amount`-as-unit-price ambiguity fixed);
  `assertRates()` bounds `taxRate`/`discountRate` to 0–100 and rejects negative
  shipping/discount/exchange rate.
- `createCreditNote`: type whitelist, `clientId` required, **refund requires an
  invoice**.
- `expense.service.ts`: exchange-rate/markup bounds; `payExpense` now uses a
  compare-and-set on `paidAmount` (no double debit on concurrent clicks).
- `payroll.service.ts`: PAID records are immutable, every money field must be
  ≥ 0, net pay cannot go negative, and the duplicate bank debit in
  `syncPostedSalary` is removed.

**Verification:** negative payment → 400, `taxRate: 1500` → 400, negative line →
400, refund without invoice → 400.

---

## 9. Missing hot-path indexes — FIXED

Migration `20261112090200_hot_path_indexes` adds 25 indexes, including
`InvoiceLineItem(invoiceId)`, `TaskComment(taskId, createdAt)`,
`Task(archivedAt, parentTaskId, dueDate)`, `LeaveRequest(status, startDate, endDate)`,
`ClientContact(clientId)`, `Employee(employmentStatus)`,
`Payment(type, paymentDate)` and `Expense(isPayable, approvalStatus, dueDate)`.

**Verification:** `prisma migrate deploy` applies cleanly on a fresh database and
on the existing one.

---

## 10. Unbounded list responses — FIXED (bounded + paged)

| Endpoint | Before | After |
|---|---|---|
| `GET /flow/projects` | all projects (1.4 MB) | 300-row cap; `page/pageSize` envelope for paged callers |
| `GET /capital/invoices` | all invoices + full lines (710 KB) | 200-row cap, line items reduced to `{amount, revenueTag}`, paged envelope supported |
| `GET /capital/expenses` | 500 full rows (489 KB) | `limit` (default 300) |
| `GET /capital/income` | every payment/manual/FX row | `limit` (default 300) per source |
| `GET /tasks` | 500 rows incl. 100-entry `activityLog` | `activityLog` omitted from list rows |
| `GET /accounts/clients` | financial summary recomputed every request | summary moved inside the cache |

`/flow/export` pages through the list endpoint so exports stay complete.
Web consumers unwrap the paged envelope (`capital-context`, collections modal,
invoices page).

**Verification:** `/flow/projects` 1.4 MB → 355 KB (perf dataset with 1,210
projects), `/capital/invoices` 710 KB → 194 KB, accounts cold 323 ms → warm 18 ms.

---

## 11. Dashboard cold path — MITIGATED

**Changes**
- `overview()` now uses stale-while-revalidate: the previous snapshot is served
  instantly while a refresh runs in the background.
- A 60-second cron keeps the snapshot warm; the process also keeps the last
  snapshot in memory so a cache flush cannot expose the cold path.
- Removed the extra project query, resolved assignee/project names only for the
  rendered rows, aggregated weekly hours in SQL, replaced the OR-list
  utilization query with `DISTINCT ON`, and trimmed invoice/task selects.

**Verification (perf dataset):** request latency after the warmer settles is
**10–17 ms** (was 452–543 ms cold on every cache miss); the one-off cold build
dropped from ~543 ms to ~392 ms. Query count on the cold build remains ~65 —
the remaining work is aggregating the many independent `count()` calls, tracked
as a performance follow-up rather than a blocker.

---

## 12. Schema + calendar migration were uncommitted — FIXED

The calendar module schema, its migration and the new fix migrations are now
part of the repository, so a clean checkout can run `prisma migrate deploy`.

---

## 13. Demo seed could reach production — FIXED

- `prisma/seed.ts` refuses to run with `NODE_ENV=production` unless
  `ALLOW_DEMO_SEED=1` (disposable staging only). Demo hashes now use bcrypt cost 12.
- New `prisma/bootstrap.ts` (`npm run db:bootstrap`) creates only configuration:
  6 roles with the canonical matrix, the GL chart of accounts, pipeline stages,
  default settings/attendance policy, branding, and one Owner from
  `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` (≥ 12 chars, bcrypt 12).
  It is idempotent and never inserts demo records.

---

## Extra hardening shipped with the fixes

- `GET /health/ready` checks PostgreSQL and Redis and returns 503 when either is
  down (the existing `/health` stays a cheap liveness probe).
- `GET /tasks?archived=true` now returns archived tasks instead of ignoring the
  filter.
- Expense list approval capabilities are computed from one policy read instead
  of one settings query per distinct amount.
- Pulse attachment deletion removes the stored file.

## Verification runs

```
qa/verify-fixes.mjs        16/16 checks passed
qa/verify-high.mjs          9/9 checks passed
npm run test:smoke         28/28 checks passed
npm run test:portal        16/16 checks passed
npm run typecheck          api + web clean
npm run build              api + web clean (web requires NEXT_PUBLIC_API_URL)
npx prisma migrate deploy  all migrations applied
```

---

# Part 2 — HIGH severity fixes

Everything the audit rated HIGH (below the 13 blockers) that could be fixed
without a redesign. Same verification rules: production build, real HTTP calls,
`qa/verify-high.mjs`.

## Security / access control

| Area | Change |
|---|---|
| Role & status changes (`/users/:id/role`, `/:id/active`) | Bump `tokenVersion` (old sessions die immediately), refuse demoting/deactivating the last active Owner, write a `SystemAuditLog` entry |
| Staff directory `/users` | Explicit projection — `passwordHash`, `lastLoginIp`, `tokenVersion` and WebAuthn handles no longer reach any signed-in role |
| JWT verification | Pin `HS256` in the staff, portal and SSE verifiers |
| Scoped tokens | Any `scope` (`sse`, `portal`, future) is rejected on staff routes; a 2-minute SSE token can no longer call `/auth/me` or `/search` |
| Secret comparison | Telegram/WhatsApp webhook secrets compared in constant time |

## Money correctness

| Area | Change |
|---|---|
| Payroll unpaid leave | Clip the leave to the payroll window and charge **working days** (weekly offs/holidays excluded) via `countWorkingDays`, instead of calendar days |
| Payroll finalize | Expense + GL journal + bank movement + `balanceDeducted` now run in **one transaction** (`postExpenseLedgerWithin`) |
| Payroll edits | A `PAID` record is immutable; every money field must be ≥ 0; net pay cannot go negative |
| Vendor payments | Row lock (`SELECT … FOR UPDATE`) + balance recomputed inside the transaction, so concurrent payments cannot overpay |
| Credit notes | Refund requires an invoice; type whitelist; client required |

## Performance (backend)

| Area | Before | After |
|---|---|---|
| `tasks/stats` | every task + every time log into Node | 6 bounded aggregate queries |
| Task list subtask counts | `groupBy` over the whole table | scoped to the page's ids |
| Trial balance / P&L / balance sheet | full journal-line scan + JS | one `groupBy` per statement (~20 rows) |
| Profitability | projects → invoices → lines → payments → tasks → time logs | 6 SQL aggregates |
| Lead nightly audit | `activities` list per lead + one UPDATE per lead | `_count` + one transaction per 200 leads |
| Lead phone backfill | one UPDATE per lead **during boot** | deferred 5s, batched SQL |
| Round-robin assignment | every active lead id per user | one `groupBy` count |
| Expense list approval | one settings read per distinct amount | policy read once per request |
| AP aging | all payments included | `groupBy` sum per expense |
| Budgets | every approved expense ever | bounded to the budgets' date window |
| People overview | every approved leave ever + OR-list utilization | `count` + `DISTINCT ON` |
| Leave balances | 800 findUnique/insert/update | one read + `createMany` + chunked updates |
| Vendor engagement list | unbounded | filtered + capped at 500 |
| Lead list export | entire lead book, all columns | 5,000 cap, explicit projection |
| Lead convert | 5 independent writes | one transaction with an atomic claim |
| Lead create | 7 independent writes | one transaction for follow-up/score/flags/activity/note |
| Task status (board) | project progress never recomputed | rescore on status change and after bulk status moves |

## Performance (frontend)

| Area | Change |
|---|---|
| App shell | Renders the real layout skeleton immediately instead of a full-screen spinner, so first paint no longer waits for `/auth/me` |
| jsPDF | Capital tabs, portal-client and Flow's invoice modal load the PDF stack on demand (`dynamic()` / `import()`), removing ~170 KB gz from those routes |
| Tasks search | 300 ms debounce (7 requests per word → 1) |
| Tasks page | Uses the shell's `/auth/me` instead of a duplicate request |
| Accounts page | Reads `clientTiers` from `/accounts/overview` instead of downloading the whole admin settings document |
| Notifications | One 120s poll, paused while the tab is hidden, plus refresh on focus; the dashboard's second 60s loop is gone |
| Fonts | Noto Sans Bengali is self-hosted via `next/font` — no render-blocking third-party stylesheet/preconnect |

## Deliberately not done (documented, not forgotten)

- **Attendance recompute batching** (`recomputeMonth`, nightly cron, iclock burst):
  the correct fix is a single-pass batch writer. It touches the most
  safety-critical code in the product (attendance → payroll), so it needs its
  own regression suite before changing.
- **Frontend mega-components** (Pulse 3,470 lines / 84 state hooks, Flow 2,480,
  Accounts 2,400, Control 110 hooks): splitting them is a product-level
  refactor, not a safe mechanical edit.
- **Capital context request fan-out** (25 calls per `/capital/*` route): needs
  the tabs to own their data, which is the same refactor as above.
- **CSV import batching** (leads/projects): correct fix is a queued job with
  progress reporting; the current path is correct but slow for very large files.
- **framer-motion removal** from `ui.tsx` / `sidebar.tsx`: still ~44 KB gz; the
  rewrite is pure UI animation work with visual-regression risk.

Each is tracked as a follow-up, not a deployment blocker.

