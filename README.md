# Zoolyum OS

Agency operating system — 9 modules unified under one dashboard: **Pulse** (leads), **Accounts** (clients), **Flow** (projects), **Tasks**, **People** (HRM), **Capital** (finance), **Insight** (analytics), **Portal** (client access), **Control** (admin).

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Frontend | Next.js 16 (App Router) + Tailwind CSS v4 + Recharts 3 + Framer Motion 12 |
| Backend  | NestJS 11 + Prisma 6                                         |
| Database | PostgreSQL 16 (Docker)                                       |
| Auth     | JWT + bcryptjs, RBAC via role permission matrix              |

Monorepo with npm workspaces:

```
apps/
  api/   NestJS API on :4000 (prefix /api)
  web/   Next.js app on :3000
docs/    design-system.md, zoolyum-os-master-prd.md
```

## Setup on a new machine

Prerequisites:

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.9+ (24 LTS tested) | `node -v` |
| npm | 10+ | ships with Node |
| Docker Desktop | any recent | runs Postgres + Redis; **must be open** while you work |
| Git | any | `git clone …` |

```bash
git clone <your-repo-url> zoolyumCrm
cd zoolyumCrm
npm install          # installs root + both workspaces
npm run setup        # env files, database, migrations, demo data
npm run dev          # starts API (:4000) + web (:3000)
```

Then open **http://localhost:3000** and log in with a demo account (see below).

### What `npm run setup` does

1. Creates `apps/api/.env` from `apps/api/.env.example`, generating strong
   `JWT_SECRET` / `FILE_URL_SECRET` values (never overwrites an existing file).
2. Creates the root `.env` that `docker compose` interpolates.
3. Starts Postgres (`:5544`) and Redis (`:6380`) via `docker compose`.
4. Waits until the database accepts connections.
5. Runs `prisma generate` + `prisma migrate deploy` (all migrations, no data loss).
6. Seeds demo data **only when the database has no users** — the seed truncates
   demo tables, so it never runs over existing data.

Useful flags:

```bash
npm run setup -- --no-docker   # Postgres already running elsewhere (edit DATABASE_URL first)
npm run setup -- --no-seed     # empty database, no demo data
npm run setup -- --seed        # force the demo seed even if users exist
```

`npm run dev` also probes `DATABASE_URL`/`REDIS_URL` from `apps/api/.env` and waits
up to 120s for them, so a cold start does not crash with `P1001 / Failed to fetch`.
Use `npm run dev:check` to test readiness only, or `node scripts/dev.mjs --timeout 30`
to change the wait.

- Web: http://localhost:3000
- API: http://localhost:4000/api
- API health: http://localhost:4000/api/health

### If something goes wrong

| Symptom | Fix |
| --- | --- |
| `Cannot connect to the Docker daemon` | open Docker Desktop, wait for “Engine running”, re-run `npm run setup` |
| `Can't reach database server at localhost:5544` | `npm run db:up`, then `docker compose ps` to confirm `zoolyum-postgres` is healthy |
| `EADDRINUSE :3000` / `:4000` | another dev server is running: `npx kill-port 3000 4000` or close the other terminal |
| `Cannot find module '…/dist/…'` | two watch servers are sharing `apps/api/dist`: stop the extra one, then `npm run dev` |
| Login fails / empty CRM | you skipped the seed: `npm run db:seed` (wipes demo tables), or `npm run db:reset` for a clean rebuild |
| Migrations out of sync | `npm run db:deploy` (applies pending migrations) |

## Demo credentials

| Role       | Email               | Password   |
| ---------- | ------------------- | ---------- |
| Owner      | sakib@zoolyum.com   | zoolyum123 |
| Finance    | sadia@zoolyum.com   | zoolyum123 |
| Business Dev | rahim@zoolyum.com | zoolyum123 |
| PM         | karim@zoolyum.com   | zoolyum123 |
| PM         | tanvir@zoolyum.com  | zoolyum123 |
| HR         | nusrat@zoolyum.com  | zoolyum123 |

## Module overview

- **Dashboard** — `/api/dashboard/overview` aggregates all modules: pipeline forecast, client health, project risk, task load, attendance/utilization, cash position, revenue trend, recent activity.
- **Pulse** — lead capture (sources/verticals), AI-ish scoring, stage pipeline with weighted forecast probabilities (10/25/50/75%), proposals, lost reasons.
- **Accounts** — client health scoring (GREEN/YELLOW/RED) from health drivers, churn watchlist, renewal calendar, billing cycles.
- **Flow** — projects with health status, risk scores, milestone/task split, file attachments, templates.
- **Tasks** — execution, dependencies, time logs, My Day, client-visible flags.
- **People** — attendance, leave approvals, 4-week utilization logs, payroll with cost rates.
- **Capital** — invoices (retainer/project/pass-through), line items, payments with aging, expenses (billable/absorbed, approval), bank accounts, profitability (vs project budgets).
- **Capital — accounting controls** — fiscal period close/lock, manual journal entries, fixed assets with monthly depreciation, VAT registers (Mushak 6.3 / 9.1) and withholding, bank statement import + reconciliation, FX revaluation, invoice approval workflow and client credit limits.
- **Capital — advanced** — deferred revenue recognition, bad-debt provisioning from AR ageing, realised FX on settlement, DSO/DPO/CCC treasury dashboard, 13-week cash forecast, petty-cash register, budget enforcement, retention release, OFX/CSV statement import and an auditor CSV export pack.
- **Insight** — metric snapshots (8-month trend), correlation insights (dismissible), weekly digests, reports.
- **Calendar** — unified agency timeline: tasks, content posts, meetings, milestones, deliverables, ad flights and invoices in one feed; client-wise views, drag-drop rescheduling, internal approval, monthly/weekly plan lock, plan→PDF/CSV/share-link reports, iCal export.
- **Portal** — client portal users, comments with sentiment, deliverable approvals, activity.
- **Control** — RBAC roles with module permission matrices, integrations (Slack/Dropbox), branding, audit logs.

## Useful commands

```bash
npm run db:reset    # migrate reset + re-seed (destructive, demo data)
npm run db:bootstrap # production bootstrap: roles + GL + owner ONLY (no demo data)
npm run build       # build api + web
npm run typecheck   # tsc --noEmit for api + web
npm run test:smoke  # live API smoke + authorization gate (needs API + seeded DB)
npm run test:finance # ledger invariants: balance, AR/AP reconciliation, orphans, assets, VAT
npm run test:e2e    # Playwright suite (starts API + web automatically)
npm run check       # typecheck + smoke
```

## Production deployment

1. **Environment** — the API refuses to start without a strong `JWT_SECRET`
   (≥32 chars, and in production it must also survive an entropy check: no
   `zoolyum`/`dev`/`secret`-style phrases, ≥16 distinct characters). In
   production `CORS_ORIGINS`, `FILE_URL_SECRET` (a second random secret — file
   links must not be signed with the session key) and, when behind nginx/ALB,
   `TRUST_PROXY=1` are required. Set `ICLOCK_DEVICE_KEY` for fingerprint
   devices; `ICLOCK_ALLOW_ANONYMOUS=1` is a local-demo opt-in only.
2. **Database** — `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`.
3. **First login** — run the bootstrap, never the demo seed:
   ```bash
   BOOTSTRAP_OWNER_EMAIL=you@company.com \
   BOOTSTRAP_OWNER_PASSWORD='a-long-random-password' \
   npm run db:bootstrap
   ```
   `npm run db:seed` refuses to run with `NODE_ENV=production`.
4. **Web build** — `NEXT_PUBLIC_API_URL` is compiled into the browser bundle and
   is mandatory for a production build:
   ```bash
   docker compose --profile app build \
     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api
   ```
5. **Health checks** — use `GET /api/health/ready` (verifies PostgreSQL and
   Redis) for load balancers; `GET /api/health` is a cheap liveness probe.

## Design system

Zoolyum UI follows the EduTrack-inspired design spec in `docs/design-system.md` — OKLCH tokens, violet→fuchsia→sky gradient brand, glass surfaces, dark mode, Geist/Space Grotesk/Hind Siliguri fonts, BDT formatting (lakh-style).