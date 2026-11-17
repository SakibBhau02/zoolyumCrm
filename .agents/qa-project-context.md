# QA Project Context — Zoolyum OS

> Source of truth for all QA skills. Filled from evidence in the repo + live system on 2026-11-14.
> Unknowns are explicitly marked; nothing here is aspirational.

## Product
- **Name:** Zoolyum OS (`package.json` name `zoolyum-os`, v0.1.0)
- **What it does:** Agency operating system — CRM, projects, tasks, HRM/payroll, finance/GL, analytics, client portal and admin under one dashboard.
- **Type:** Internal-tool style multi-tenant SaaS (single-org per deployment), BDT-first.
- **Modules (12):** Dashboard, Pulse (leads), Accounts (clients), Flow (projects), Tasks, People (HRM/payroll), Capital (finance/GL), Insight (analytics), Calendar, Portal (client-facing), Control (admin/RBAC), Notifications/Search.
- **Environments:**
  - Dev API `http://localhost:4000/api`, dev web `http://localhost:3000`
  - Public demo: Cloudflare tunnel scripts exist (`scripts/public-demo.ps1`, `start-tunnel.cmd`); live public URL not recorded in repo → **unknown**.
  - Staging: **none detected**.
- **Critical user journeys (inferred from routes + smoke tests, confirmed by module list):**
  1. Login → dashboard overview loads with cross-module KPIs.
  2. Lead capture → stage move → proposal → win (Pulse).
  3. Client onboarding → health score → renewal/billing cycle (Accounts).
  4. Project create → milestones/tasks → progress + risk (Flow/Tasks).
  5. Employee attendance → leave approval → payroll run → finance posting (People → Capital).
  6. Invoice create (line items) → approve → payment → ageing/GL (Capital).
  7. Expense submit → approve → billable/absorbed → profitability.
  8. Calendar plan → publish/lock → client share link / PDF (Calendar).
  9. Client portal login → see own invoices/deliverables → approve/comment (Portal).
  10. Role/permission change → audit log entry (Control).

## Tech Stack
- **Frontend:** Next.js `^16.0.0` (App Router), React `^19.0.0`, Tailwind CSS v4, Recharts 3, Framer Motion 12. Source: `apps/web/package.json`.
- **Backend:** NestJS `^11.0.1`, TypeScript, REST under `/api`, 32 controllers / ~600 routes. Source: `apps/api/package.json`, `qa/routes.json`.
- **Database:** PostgreSQL 16 (Docker), Prisma ORM, 141 models. Source: `apps/api/prisma/schema.prisma`.
- **Cache/queue:** Redis (used by cache module); no job queue detected.
- **Auth:** JWT (`@nestjs/jwt`) + bcryptjs, RBAC permission matrix (`CONTROL` module), client-portal JWT separate flow.
- **Monorepo:** npm workspaces — `apps/api`, `apps/web` (build/typecheck are separate per app; see CI).

## Test Stack
### E2E
- **Framework:** Playwright `^1.62.1` (`apps/web/package.json` devDependency); installed 1.62.1 in root `node_modules`.
- **Config:** `apps/web/playwright.config.ts`
- **Tests:** `apps/web/e2e/*.spec.ts` — 9 specs (capital invoice + download, control branding, dollar/portal finance, finance-pro UI, people authz API, people directory CRUD, people payroll-pro, portal invoice download).
### API / integration
- **Smoke + authorization gate:** `scripts/smoke.mjs` (`npm run test:smoke`) — 28 checks, live API + seeded DB.
- **Finance invariants:** `apps/api/scripts/finance-check.mjs` (`npm run test:finance`) — 14 ledger checks.
- **Portal regression:** `scripts/qa-portal.mjs` (`npm run test:portal`).
- **Flow verification:** `scripts/flow-verify.mjs`, `scripts/flow-shoots-verify.mjs`.
- **Ad-hoc QA scripts (not wired to npm):** `qa/*.mjs` (bench, loadtest, query-count, bundle-size, people sweeps), `apps/web/qa-*.js`.
### Unit / component
- **Framework:** **none**. No Jest/Vitest config; no `*.test.ts` unit suite. `npm test` is absent at root.
### Visual / performance / a11y
- Visual: screenshots produced ad hoc into `qa-evidence/` and repo root PNGs — no baseline tooling (no Chromatic/Argos).
- Performance: `qa/bench.mjs`, `qa/loadtest.mjs`, `qa/query-count.mjs`, `qa/bundle-size.mjs`, `qa/bench-results.json`.
- Accessibility: **no axe/Lighthouse automation** wired.

## CI/CD
- **Platform:** GitHub Actions — `.github/workflows/ci.yml`, triggers on push to `master`/`main` and all PRs, concurrency cancel-in-progress.
- **Jobs:**
  1. `static` — npm ci → prisma generate → `npm run typecheck` → `npm run build`.
  2. `e2e` — Postgres 16 + Redis services → migrate deploy → seed → start API → `test:smoke` → `test:portal` → Playwright chromium → `npx playwright test`.
- **Gates:** typecheck, production build, smoke/authz, portal regression, 9 E2E specs. No lint job detected; no coverage gate; no a11y/perf gate.
- **Artifacts:** not uploaded (no `actions/upload-artifact`) — Playwright traces/screenshots are lost on failure.
- **Sharding:** none (single runner).

## Environments
| Env | API | Web | DB | Notes |
|---|---|---|---|---|
| Local dev | :4000/api | :3000 | docker `zoolyum-postgres` → host **:5544** | Redis host **:6380** |
| Public demo | Cloudflare tunnel scripts | same origin | same DB | `docs/public-demo.md`; tunnel URL unknown |
| Staging | — | — | — | not detected |
| Production | — | docker compose `app` profile | managed PG assumed | README deployment section |
- Dev/CI parity is good: CI uses the same Postgres 16 + Redis 7 and the same seed script.

## Quality Goals
- **Agreed numeric targets: none recorded in the repo.** (No coverage config, no thresholds, no flake budget.)
- **Proposed starting targets** (label: proposal, not agreed):
  - Unit coverage 60% on business logic (finance kernel, scoring, payroll math) — currently 0% unit.
  - All 10 critical journeys covered by E2E; suite < 15 min.
  - API p95 < 300 ms on dashboard/list endpoints; payload < 300 KB.
  - Flake rate < 2% over rolling 30 days; zero 5xx in smoke.
  - WCAG 2.2 AA: zero critical/serious axe violations on the 12 module pages.

## Risk Areas
Evidence: README, prior audits in `docs/qa-*.md`, finance kernel size, portal being client-facing.

| Area | Risk | Impact | Notes (evidence) |
|---|---|---|---|
| Capital / finance GL (ledger, VAT, payroll posting) | **Critical** | Money wrong = business harm | Largest service surface (`finance-kernel.ts`, ledger/billing/invoice/expense/liabilities services); 14 invariants exist because drift is real |
| Portal (client-facing auth + data isolation) | **Critical** | Cross-client data leak | Separate login, share links, invoice/file download; `docs/portal-hardening.md`, `docs/qa-portal-audit.md` |
| Auth / RBAC matrix | **Important** | Privilege escalation | JWT + role matrix; smoke asserts 403s; `people-authz-api.spec.ts` |
| Payroll math + attendance | **Important** | Wrong pay | `docs/qa-people-audit.md`, payroll E2E |
| Dashboard aggregates | **Monitor** | Wrong management decisions | Aggregates 12 modules in one call; perf-sensitive |
| Calendar plan→share→PDF | **Monitor** | Broken client deliverable | `docs/qa-calendar-audit.md` |
| File uploads / media (signed URLs) | **Important** | Unauthorized file access | `media` module, `FILE_URL_SECRET` in README |
| DB migrations / seed safety | **Important** | Data loss | `db:seed` refuses in production; bootstrap path |
- Incident history: **not recorded** — likelihood values above are analyst estimates, not measured.

## Team
- **Headcount / QA engineers:** unknown; repo indicates a solo owner-operator + AI agents (no CODEOWNERS, no QA folder owner).
- **Methodology:** not documented.
- **Ownership model implied:** dev owns all tests (solo/zero-QA row) → lean on automation + CI gates, no manual regression suite.

## Conventions
- **Test file naming:** Playwright `*.spec.ts` under `apps/web/e2e/`; ad-hoc Node scripts `qa-*.mjs` / `qa/*.mjs`.
- **Selector strategy:** mixed — specs use role/text selectors in places and CSS/`data-testid` elsewhere; **no documented `data-testid` convention**. Recommendation for new tests: `getByRole` + `data-testid` for icons/charts.
- **Test data:** seeded demo users (password `zoolyum123`) against a real seeded Postgres; disposable records created and deleted by scripts (`people-endpoint-sweep.mjs` pattern).
- **Branching:** `master` is default; CI on push/PR.
- **Code style:** TS strict-ish per app tsconfig; no ESLint/Prettier config detected at root → formatting not enforced.
