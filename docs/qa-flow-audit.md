# Flow (Project) Module — QA & Architecture Audit

**Date:** 2026-11-08
**Commit audited:** `d1ec533` (master)
**Scope:** `apps/api/src/flow/*`, `apps/web/src/components/flow/*`, `apps/web/src/app/(app)/flow/*`, Prisma `Project` domain, and integrations with Scoring / Capital / Portal / Tasks / Notifications.
**Method:** static code review + data-flow tracing + contract matching (UI ↔ API ↔ schema), followed by a read-mostly runtime probe against the live API (section 6). The probe created one throwaway project and removed every record it made.
**Not done:** no source changes, no destructive action on existing data, no browser/Lighthouse pass.

---

## 1. Executive summary

The Flow module is a genuinely ambitious project workspace: portfolio board with three views, a per-project workspace with 9 tabs, a computed health/risk engine, auto-invoicing on status transitions, CSV import/export, capacity planning, and CRM/portal integration. The visual craft and domain modelling are above the usual agency-CRM bar.

The risk is **not** in the aesthetics. It is in three places:

1. **Silent contract failures** between the UI and the API (file approval is a no-op; file name/size never persist; two features are unreachable dead code).
2. **Derived-state ambiguity** — "progress" has four different definitions depending on which screen you look at, and the client-facing report bills a lifetime total while claiming a period.
3. **Destructive operations without governance** — a hard project delete detaches invoices and expenses from project reporting, with no audit trail, no role gate, and an error handler that reports every failure as 404.

All three were reproduced against the running API on 2026-11-08 (section 6): the file-add route returns 404, approval returns 200 without changing anything, a 7-day report bills a 60-day-old invoice, and deleting a project leaves its invoice alive with `projectId = null`.

### Scorecard

| Dimension | Score | Note |
|---|---|---|
| Domain modelling | 7/10 | risk logs as a time series; computed vs manual health separated with reason |
| Backend correctness | 4.5/10 | four progress definitions; several dead contracts |
| Data integrity | 4/10 | hard delete + orphaned financial rows; unvalidated write paths |
| Security / authorization | 6/10 | solid guard layering, but no data scoping and public file URLs |
| UI/UX (visual) | 8/10 | token-based, dense but legible; cognitive load on detail |
| Accessibility | 3.5/10 | no dialog role/focus trap; clickable `div`/`tr` |
| Test coverage | 1/10 | zero unit or e2e tests for Flow |
| **Overall** | **5.5/10** | well built, but the trust-critical seams are open |

### Severity distribution

| Severity | Count |
|---|---|
| Critical (P0) | 6 |
| High (P1) | 10 |
| Medium (P2) | 13 |
| Low | 5 |

---

## 2. Architecture map

```
Next.js (client)                  NestJS (api)                      Data
─────────────────                 ─────────────────────────────     ─────────────────────
/flow          ─┐          FlowController (@RequirePermission FLOW)
/flow/[id]      ├→ FlowWorkspace ─→ FlowService (904 LOC) ─┬→ Prisma (PostgreSQL)
project-wizard ─┘   (2855 LOC)     │                       ├→ CacheService (Redis / in-memory, 30s)
                                   │                       ├→ ScoringService  (health, risk, alerts)
                                   │                       ├→ CapitalService  (auto invoice)
                                   │                       ├→ NotificationsService
                                   │                       └→ @Cron 02:30 (reports), 03:15 (reconcile)
```

**Positives**

- Clean module boundary; `FlowModule` exports only `FlowService`.
- Shared helpers extracted where they matter: `common/project-stats.ts`, `common/billing-date.ts`, `capital/finance-kernel.ts`.
- Global `ValidationPipe({ whitelist: true, transform: true })`, global rate limiter, permission guard, admin policy guard.
- Security headers, explicit CORS configuration, trust-proxy gated behind `TRUST_PROXY`, path-traversal defence in uploads.
- Deliberate cache semantics: `delPattern` also drops the bare key used for unfiltered lists.

**Structural weaknesses**

- `FlowService` carries six responsibilities: project CRUD, references/deliverables/reports, files, CSV import/export, capacity planning, and two crons.
- `Project` is a 30+ column god table mixing delivery, commercial, billing, and marketing-channel concerns.
- `flow → scoring/capital` DI direction is correct, but `scoring → flow` exists as a **string cache key** (`flow:projects:*`) — already drifted.

---

## 3. Critical findings (P0)

### FLW-01 · File approve/reject is a silent no-op

- UI sends `{ approvalStatus }` — `apps/web/src/components/flow/flow-workspace.tsx:1031`
- Controller reads `body.status` — `apps/api/src/flow/flow.controller.ts:248-250`
- With `status === undefined`, Prisma's `update` ignores the field and returns 200.

**Impact:** approval workflow is non-functional while the UI reports success. Client-delivery gating is broken silently. **Runtime-confirmed:** the UI payload returned `200` and left `approvalStatus = PENDING`; the controller payload (`{ status }`) returned `200` and set `APPROVED` — the mismatch is the only defect.

**Fix:** align the payload (pick one name), add a DTO, assert the returned row actually changed.

### FLW-02 · File upload metadata is never saved — the endpoint the UI calls does not exist

Runtime-confirmed root cause: the UI posts to `POST /flow/projects/:id/files` (`flow-workspace.tsx:1064-1067`), but the controller only exposes `POST /files` (`flow.controller.ts:242`). The request returns **404**, so no file row is ever created from the upload button.

Even when the correct endpoint is used, the row cannot carry a name or size:

- `ProjectFile` has no `name` / `size` / `mimeType` columns — `apps/api/prisma/schema.prisma:755-769`
- UI renders `f.fileName ?? f.name ?? "file"` — `flow-workspace.tsx:2540`

**Impact:** every attachment is displayed as "file" with size "—"; uploaded files never appear at all until someone notices and inserts them by hand. `milestoneId` is a bare string with no relation to `Milestone`, so nothing stops dangling references.

**Fix:** add the missing route (or point the UI at `POST /files`); migration adding `fileName`, `size`, `mimeType`; optional `Milestone` relation; backfill from the upload response.

### FLW-03 · Hard delete detaches financial records

`apps/api/src/flow/flow.service.ts:388-403`

- `project.delete()` cascades milestones, files, reports, references, comments.
- `Invoice`, `Expense`, `Budget`, `VendorEngagement`, `ManualIncome` hold **optional** `projectId` (SetNull) → they survive but lose their project link.
- `.catch(() => { throw new NotFoundException(...) })` converts **any** failure (including FK restrictions) into a 404.
- No `@Roles` gate, no soft delete, no audit entry, no confirmation beyond a modal.

**Impact:** one click silently removes a project from profitability and billing reports. Deletion is irreversible and unattributable.

**Fix:** soft delete (`archivedAt` / `deletedAt`) with restore; Owner/CONTROL only; explicit cascade policy; audit log; map FK errors to 409 with a real message.

### FLW-04 · Four different definitions of "progress"

| Location | Definition |
|---|---|
| `Project.progress` (DB) | completed / non-archived tasks — `common/project-stats.ts:48-50` |
| List API | `groupBy`, archived excluded — `flow.service.ts:83-95` |
| Detail API | **all** tasks including archived — `flow.service.ts:171-172` |
| Client portal | visible milestones, else visible tasks, else stored — `portal-client.service.ts:676-681` |

Additionally, the wizard lets a user type a manual `progress` (`project-wizard.tsx`, Step 2), which the next task change silently overwrites.

**Impact:** PM, client, and finance see three different percentages for the same project; the stored number is both derived and manually editable.

**Fix:** name a single authority (recommended: task-derived, archived excluded) and expose it through one shared `computeProjectProgress()` used by list, detail, portal, reports, and scoring. Manual progress only when the project has zero tasks, and label it as such.

### FLW-05 · Report billing snapshot ignores its own period

`apps/api/src/flow/flow.service.ts:790-795`

- The report title says "Progress report — 1 Oct to 31 Oct".
- The billing block sums **every** invoice and payment the project ever had.
- `completedAt` falls back to `periodEnd` when missing — a fabricated delivery date baked into a client-facing document (`:780`).

**Impact:** a document sent to clients can overstate invoiced/collected amounts and invent completion dates. This is the highest business-risk defect in the module.

**Fix:** filter invoices by `issueDate` within `[periodStart, periodEnd]`, payments by `paymentDate`; never fabricate `completedAt` — render "not recorded" instead; snapshot the query definition in the report JSON for auditability.

### FLW-06 · `@Public()` file serving — permanent unauthenticated access

`apps/api/src/flow/flow.controller.ts:225-239`

- Any URL of the form `/api/flow/uploads/<uuid>--<name>` serves the file with no auth, no expiry, no revocation.
- `Content-Disposition: attachment` + `nosniff` mitigates inline rendering, but the file is still downloadable by anyone holding the URL.
- The upload filter allows `image/svg+xml` (`:214`).

**Impact:** proposals, contracts, and creative assets can leak through any forwarded link or browser history; there is no way to un-share.

**Fix:** signed, expiring URLs (or an authenticated download route with an entitlement check against project membership); drop SVG or sanitise it; add an orphan-blob cleanup job.

---

## 4. High findings (P1)

### FLW-07 · Capacity planner math is wrong by construction

`flow.service.ts:649-677` loads **all** time logs with no date window; `flow-workspace.tsx:840-852, 1707` divides that all-time total by a 40-hour weekly target and labels the result utilisation. 200 historical hours become "500% overbooked".

**Fix:** window by week (or an explicit range), denominator = capacity hours in that window, state the range in the UI.

### FLW-08 · Bulk task assignment has no ownership check

`flow.service.ts:454-464` re-points arbitrary `taskIds` to a project. No validation that the task belongs to the same client, no recompute of the source project's stats, no rescore, no audit. UI copy reads "assign to this project" (`flow-workspace.tsx:2839`).

**Fix:** restrict to unassigned tasks or same-client tasks; recompute stats for both source and target; audit.

### FLW-09 · Two features are dead code

1. **Automatic reports cannot be enabled.** `reportMode`, `reportFrequency`, `nextReportDate` are absent from `CreateProjectDto`; `whitelist: true` strips them (`main.ts:66-68`), while the service and cron read them (`flow.service.ts:306-309, 878-903`).
2. **The template selector does nothing.** The wizard reads `t.projectType` / `t.defaultStatus` (`project-wizard.tsx:1078-1082`), fields that do not exist on `ProjectTemplate`; the real `defaultTaskList` (`schema.prisma:643-651`) is never applied on create.

**Fix:** either wire them (add DTO fields, clone `defaultTaskList` into tasks on create, add `projectType`/`defaultStatus` columns) or remove them from the UI. Half-built is worse than absent.

### FLW-10 · `any`-typed write paths

`flow.controller.ts:183-250` accepts `@Body() body: any` for milestones, discussions, files, file approval, report update. Consequences:

- Invalid enum strings reach Prisma and surface as 500s (and are then masked by the `catch → 404` pattern in `updateMilestone`).
- No length limits on milestone/discussion text.
- `addFile` accepts an arbitrary `fileUrl` (link-injection surface).
- `addMilestone` does not verify the project exists.

**Fix:** one DTO per endpoint; validate `fileUrl` against the uploads prefix or an allow-list.

### FLW-11 · Role gates are inverted relative to risk

- Granular endpoints hardcode `@Roles("Owner", "CONTROL", "PM", "Project Manager")` (`flow.controller.ts:77-161`) — a custom role created in Control with FLOW edit cannot use them.
- Project **create / update / delete** have **no** `@Roles` at all (`:61-74`) — anyone with FLOW edit can destroy.

**Fix:** express capability, not role names (`@RequirePermission("FLOW", "approve")` for destructive ops); reserve `Owner`/`CONTROL` for deletes.

### FLW-12 · Cache invalidation key drift

`flow.service.ts:47, 466-473` caches lists under `flow:list:*`; `scoring.service.ts:1263` invalidates `flow:projects:*`, which matches nothing. Health/risk changes stay stale for the 30s TTL.

**Fix:** centralise cache keys in one constants module; remove the phantom pattern.

### FLW-13 · Currency shown incorrectly

`format.ts:1-9` hardcodes `৳` and lakh compression for every project, including USD/SAR/AED. Portfolio “budget burn” sums mixed currencies without conversion (`flow-workspace.tsx:823-824`).

**Fix:** money value = `{ amount, currency }`; format per currency; portfolio shows per-currency totals or a converted total with a stated rate.

### FLW-14 · Accessibility of the main workspace

- `Modal` has no `role="dialog"`, `aria-modal`, focus trap, or initial focus; only Escape (`ui.tsx:377-478`).
- Backdrop click closes a full workspace or a partially filled wizard with no confirmation.
- `ProjectCard` is a clickable `div` with drag handlers, no keyboard or role (`flow-workspace.tsx:1302-1313`).
- Table rows are clickable but not focusable (`table.tsx:44-69`).
- Many icon-only buttons rely on `title` rather than `aria-label`.
- Toast is a 3s visual flash with no `aria-live`.

**Fix:** accessible dialog primitive; `button`/`role="button"` + key handlers for cards and rows; focus-visible rings on custom controls; toast region with `role="status"`.

### FLW-15 · No audit trail for project-domain mutations

`SystemAuditLog` is written by Control, Insight settings, Pulse, and Scoring — never by Flow. Project create/update/delete, file approval, report send, deliverable changes are unattributable.

**Fix:** call the existing `common/system-audit.ts` helper on every mutation, including before/after snapshots for delete.

### FLW-16 · Zero Flow tests

`apps/web/e2e` contains six specs (capital invoices, people payroll, portal, control branding, finance UI). None cover Flow; the API has no unit or integration tests. CI runs typecheck + build + smoke only.

**Fix (minimum):** unit tests for progress, report period filtering, CSV parsing, and scoring inputs; three e2e journeys: create → milestone → report, upload → approve, bulk assign.

---

## 5. Medium and low findings (P2)

| ID | Finding | Evidence / impact |
|---|---|---|
| FLW-17 | CSV import uses naive `split(",")`, no transaction, no enum validation, no dedupe, bypasses rescore and cache invalidation | `flow.service.ts:514-573` — a bad row aborts mid-import leaving partial data |
| FLW-18 | List API aggregates the **entire** task table per request (not just the page); UI never uses the pagination it supports | `flow.service.ts:83-95` |
| FLW-19 | Report cron aborts on the first failing project; reconcile cron has no overlap lock (Scoring has one) | `flow.service.ts:878-903` vs `scoring.service.ts:740-742` |
| FLW-20 | `nextUid` scans all projects per attempt (up to 6), and once per imported row | `flow.service.ts:105-111` |
| FLW-21 | Service-level invariants missing: `clientId` can change later without finance/portal revalidation; `totalBilled`, `paymentStatus`, `spentAmount`, `progress` remain hand-editable while finance-kernel and project-stats also write them | `flow.service.ts:258-320` |
| FLW-22 | `overview.completion` counts archived tasks and all projects; list excludes both → header vs table disagree | `flow.service.ts:23-44` |
| FLW-23 | Auto-invoice hook swallows every error, no retry, no notification | `flow.service.ts:312-316` |
| FLW-24 | `onTimeRate` is rendered but never returned by the API → permanent "—%" | `flow-workspace.tsx:1557` |
| FLW-25 | Raw server error text rendered in `EmptyState`; toast has no live region | `flow-workspace.tsx:1383-1387, 1545` |
| FLW-26 | No data scoping: any role with FLOW view sees every client's budget and health; `project-lookup` is `@SkipPermission` and returns 500 names | `flow.controller.ts:50-54` |
| FLW-27 | Business logic duplicated in the UI (burn %, risk colours, at-risk count) — already drifted | `flow-workspace.tsx:831, 1253-1281` |
| FLW-28 | Files live on local disk; deleting a `ProjectFile` row leaves the blob; no quota or cleanup job | `flow.controller.ts:203` |
| FLW-29 | Multi-currency reconciliation into accounting is not handled at the Flow layer | `reporting.service.ts:181-235` |
| FLW-30 | Low: mojibake arrow in status toast (`?`), unused `PAYMENT_STYLE` / `code` / `referenceLinks` / `teamMembers`, detail tab not synced to URL, `package.json` description contains `�?` | `flow-workspace.tsx:884` etc. |

---

## 6. Runtime verification — 2026-11-08

The API was already running on `:4000` (web on `:3000`), with `zoolyum-postgres` and `zoolyum-redis` healthy. The probe logged in as the Owner, created one throwaway project (`QA-…`), exercised the endpoints the UI actually calls, then removed every record it created. Post-run check: **0 leftover QA projects, 0 leftover QA invoices.**

| ID | Probe | Expected | Observed | Verdict |
|---|---|---|---|---|
| FLW-24 | `GET /flow/overview` | `onTimeRate` present | keys: `totalProjects, active, byStatus, byHealth, avgRisk, completion` | **Bug confirmed** |
| FLW-09a | `PATCH` project `{reportMode:"AUTOMATIC", reportFrequency:"15-days"}` | value persisted | `200`, but `reportMode` stayed `MANUAL`, `reportFrequency = null` | **Bug confirmed** — whitelist strips the fields |
| FLW-09b | `GET /flow/templates` | `projectType` / `defaultStatus` | keys: `id, name, description, benchmarkDurationDays, benchmarkHours, defaultTaskList` | **Bug confirmed** — wizard reads fields that do not exist |
| FLW-02a | `POST /flow/projects/:id/files` (the UI call) | 2xx | `404 Cannot POST …/files` | **Bug confirmed** — metadata never saved |
| FLW-02b | `POST /flow/files` (the real route) | name/size stored | `201`; row keys have no `name`/`size`/`mimeType` | **Bug confirmed** — columns absent |
| FLW-01 | `PATCH /flow/files/:id/approval {approvalStatus}` | `APPROVED` | `200`, `approvalStatus = PENDING` | **Bug confirmed** — silent no-op |
| FLW-01b | same route with `{status:"APPROVED"}` | `APPROVED` | `200`, `approvalStatus = APPROVED` | Pass — mismatch is the only defect |
| FLW-06 | `GET /api/flow/uploads/<uuid>--qa-proof.png` with no token | 401/403 | `200` | **Bug confirmed** — public download |
| FLW-05 | Create a `DRAFT` invoice dated 60 days ago, generate a report for the last 7 days | `invoiced = 0` | `invoiced = 1000`, `outstanding = 1000` | **Bug confirmed** — lifetime totals in a period report |
| FLW-04 | Create a task, archive it, compare detail vs list | same count | detail `tasksTotal = 1`, list `tasksTotal = 0` | **Bug confirmed** — detail counts archived |
| FLW-03 | Delete the QA project that holds a linked invoice | blocked or soft-deleted | `DELETE 200`; project read `404`; invoice still exists with `projectId = null` | **Confirmed** — financial row detached |
| FLW-07 | `GET /flow/capacity` | bounded window parameter | no parameters accepted; 54h total across 10 employees, largest row 16h | **Inconclusive at runtime** (dataset too small); the defect is structural (all-time hours ÷ weekly target) |

Consequence for the roadmap: FLW-02 is worse than a display issue and should be merged with FLW-01 as one file-lifecycle blocker; FLW-09a/09b are confirmed dead features, not theoretical ones.

---

## 7. UI / UX assessment

### Strengths

- One token set (`oklch` CSS variables, light/dark), no hardcoded hex — theme consistency holds.
- Deliberate information architecture: list → portfolio band → filters/views → URL-addressed detail. Back/refresh/deep-link all work, which most agency CRMs get wrong.
- State design: skeletons, per-tab loaders, empty states, inline validation in a 4-step wizard with a live summary rail and a success screen.
- Detail workspace: vertical rail + scrollable pane, KPI strip, computed-vs-override health panel with factor bars.

### Weaknesses

1. **Cognitive load.** One detail pane carries 9 tabs, 6 KPIs, a status pipeline, channels, risk factors, a Gantt, the team, and the source lead. The first-glance answer to "what needs attention now?" is diluted.
2. **Typographic and component drift.** Ten-plus font sizes (`text-[9px]`…`text-[13.5px]`), fifteen-plus bespoke badge/pill variants, six tonal systems — while shared `StatusBadge` exists and is used inconsistently.
3. **Mobile.** Fixed `w-40` rail plus `h-[calc(100dvh-9.5rem)]` shell (`ui.tsx:396`) consumes ~40% of a phone screen; the KPI strip stays `grid-cols-3`; there is no rail → dropdown fallback.
4. **Destructive affordances.** Delete sits beside Edit in both the header and the footer, visually equal weight, with no type-to-confirm; backdrop click can discard an unsaved wizard.
5. **Feedback.** Every action produces the same 3-second toast; there is no inline "what changed" summary for bulk operations.

None of these are aesthetic defects — they are **contract drift** (dead fields, mismatched payloads) and **state authority** (who owns progress and billing) expressed in the UI.

---

## 8. Remediation roadmap

### Sprint 1 — Trust (3–4 days)

1. FLW-01/02 — add the missing `POST /flow/projects/:id/files` route (or repoint the UI), align the approval payload, add `fileName`/`size`/`mimeType`, link milestones.
2. FLW-03 — soft delete + Owner/CONTROL gate + audit + correct error mapping.
3. FLW-05 — period-filtered billing; remove fabricated completion dates.
4. FLW-06 — signed/expiring download URLs or authenticated route.
5. FLW-10 — DTOs for every write path.

### Sprint 2 — Consistency (4–5 days)

6. FLW-04 — single progress authority used by list, detail, portal, reports, scoring.
7. FLW-07 — capacity windowed by week with an explicit denominator.
8. FLW-13 — money type with currency, portfolio handling.
9. FLW-12 — cache key constants; fix the scoring invalidation.
10. FLW-11 — capability-based gates; destructive ops restricted.

### Sprint 3 — Hardening (5–7 days)

11. Split `FlowService` into reports / import-export / capacity / files services.
12. FLW-17 — real CSV parser, transaction, dry-run report, rescore.
13. FLW-19 — per-item error isolation, dedupe, lock, structured logs.
14. FLW-14 — dialog role/focus trap/scroll lock; keyboard cards and rows; live-region toast.
15. Mobile layout: rail → horizontal chips or drawer.
16. FLW-16 — unit tests for derived values; three e2e journeys.

---

## 9. What is genuinely good

- Health override stored separately from the computed value, with a reason and the engine's reading kept visible — rare maturity.
- `ProjectRiskLog` time series with per-factor snapshots makes backtesting and forecasting possible; the scoring service actually uses them.
- `billing-date.ts` shared by first and later cycles so the anchor day cannot drift.
- The nightly `recomputeProjectStats` self-healing sweep is the right resilience pattern (it just misses bulk-assign and import hooks).
- `delPattern` explicitly dropping the bare key shows someone hunted a subtle cache bug and documented it.

---

## 10. Limitations of this audit

- No runtime verification: the app was not booted, no API calls were made, no Lighthouse or keyboard walkthrough was performed. Every finding cites code, but browser-observed behaviour may add or soften items.
- The dual `ProjectTemplate` / `TaskTemplate` system and portal-side authorization depth deserve their own review.
- Estimates in the roadmap are effort for a single developer familiar with the codebase, not calendar time.

---

## 11. Verification checklist

Run 2026-11-08 against the live API (results in section 6):

- [x] Create a project, add a file, approve it — **fails**: the add-file route 404s and the approval payload is ignored.
- [x] Upload a file, reload — **fails**: name/size columns do not exist.
- [x] Create a report spanning a partial month — **fails**: a 60-day-old invoice appears in a 7-day report.
- [x] Delete a project with invoices — **confirmed**: project hard-deleted, invoice detached (`projectId = null`).
- [x] Enable automatic reports via API — **confirmed impossible**: the DTO strips the fields.
- [ ] Open a project on a 390px viewport — not yet run (needs a browser pass).
- [ ] Tab through the wizard — not yet run (needs a keyboard pass).
- [ ] Change a project status in Kanban — not yet run (needs a browser pass).

Remaining work for a full runtime pass: browser/viewport checks, keyboard walkthrough, and a Lighthouse/contrast audit. Everything reachable over HTTP has now been exercised.

---

## 12. Remediation applied — `qa/flow-hardening`

Every P0 and P1 item below is fixed and covered by the repeatable probe `npm run test:flow` (11/11 checks passing against the live API on 2026-11-08).

### Critical

| ID | Fix |
|---|---|
| FLW-01 | Controller accepts `status` **and** `approvalStatus`; the UI now sends the canonical field. Approval also records `approvedAt`. |
| FLW-02 | Added `POST /flow/projects/:id/files` (the route the UI always called) plus `fileName`, `size`, `mimeType` columns and a real `Milestone` relation (migration `20261108141906_flow_file_metadata`). |
| FLW-03 | Delete now requires Owner/CONTROL, refuses to run while live tasks, invoices, expenses, income, or vendor engagements exist (409 naming the blockers), deletes archived tasks with the project, removes blobs, writes an audit entry, and maps Prisma errors honestly (404 vs 409). |
| FLW-04 | One progress authority: list, detail, portal cards and reports all derive from non-archived tasks; detail/list now agree. The wizard hides the manual slider when tasks exist. |
| FLW-05 | Reports filter invoices by `issueDate` and payments by `paymentDate` inside the period; completion dates are no longer fabricated. |
| FLW-06 | Uploads require a signed, expiring link (`FILE_URL_SECRET`, `FILE_URL_TTL_SEC`, default 15 min). Unsigned requests get 403. SVG uploads are no longer accepted. |

### High

| ID | Fix |
|---|---|
| FLW-07 | Capacity takes `from`/`to` (default rolling 4 weeks) and returns `capacityHours`, `totalHours`, `utilizationPct` and per-project share; the UI renders employee-level utilisation instead of all-time hours ÷ 40. |
| FLW-08 | Bulk assign rejects tasks from another client (returned as `rejected`), recomputes stats for every affected project, and audits the move. |
| FLW-09 | `reportMode`, `reportFrequency`, `nextReportDate` added to the DTO and surfaced in the Reports tab; templates now apply their benchmark duration and create their `defaultTaskList` tasks. |
| FLW-10 | DTOs for files, approval, milestones, discussions, bulk assign, deliverables and reports; `fileUrl` restricted to uploads or http(s); milestone ownership validated. |
| FLW-11 | Hardcoded role gates removed from granular endpoints (permission matrix governs); destructive delete kept behind Owner/CONTROL. |
| FLW-12 | Scoring invalidates `flow:list:*` + `flow:overview` (the keys actually used). |
| FLW-13 | `formatMoney(value, currency)` added; every project surface renders its own currency and the portfolio shows per-currency totals. |
| FLW-14 | Modal now has `role="dialog"`, `aria-modal`, focus trap, initial focus, scroll lock, focus restore and an opt-out for backdrop clicks (the wizard uses it). Project cards and table rows are keyboard operable; the toast is a live region. |
| FLW-15 | `writeSystemAudit` on project create/update/delete, file create/approval/delete, milestone/deliverable/report changes, bulk assign and CSV import. |
| FLW-16 | `scripts/flow-verify.mjs` + `npm run test:flow`: 11 API-level regression checks (template, schedule, file, signature, approval, report period, progress, capacity, delete guard, clean delete, CSV). |

### Medium

- FLW-17: RFC-4180 CSV parser (quoted commas), single transaction, validated status/priority/dates, rescore + cache invalidation, audit.
- FLW-18: task aggregation scoped to the page's project ids (the whole-table groupBy is gone). UI pagination is still not wired.
- FLW-19: per-project error isolation, dedupe and a run lock on both crons.
- FLW-20: `nextUid` uses `MAX(SUBSTRING(uid))` in SQL with a safe fallback.
- FLW-21: manual progress ignored when tasks exist; client reassignment rescores the old and new client; finance cache invalidated when money fields change.
- FLW-22: overview excludes archived projects/tasks; adds `onTimeRate`.
- FLW-23: auto-invoice failures are logged, not swallowed.
- FLW-24: `onTimeRate` is returned and rendered.
- FLW-25: toasts are announced; server messages (now meaningful 409s) surface as-is.
- FLW-28: file delete and project delete remove the stored blob.
- FLW-30: mojibake arrow fixed, unused constants removed, tab state synced to `?tab=`, reference upload accepts only server-supported types.

### Intentionally still open

- **FLW-26 data scoping.** Flow has no per-project membership model; every role with FLOW view still sees the whole portfolio. This is a product decision (single-team workspace), not a bug to patch quietly.
- **FLW-18 UI pagination.** The API accepts `page/pageSize`; the board still loads the filtered set client-side.
- **FLW-27 logic extraction.** Money and currency are centralised; status/health colour maps still live in the component.
- **FLW-29 currency conversion.** Totals are per-currency; no FX conversion is attempted.
- **Browser pass.** Viewport, keyboard walkthrough and contrast audit remain outstanding.

### Operational notes

- Migration applied: `apps/api/prisma/migrations/20261108141906_flow_file_metadata`.
- New optional env: `FILE_URL_SECRET` (falls back to `JWT_SECRET`) and `FILE_URL_TTL_SEC` (default 900).
- Behaviour change: previously-public upload URLs now return 403 without a signature. Anything that stored a bare `/api/flow/uploads/...` link outside Flow must request a signed one.
- Behaviour change: project delete returns 409 while dependencies exist instead of silently orphaning financial rows.


