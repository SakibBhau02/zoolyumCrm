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

## Quick start

```bash
# 1. install dependencies
npm install

# 2. start postgres (docker)
docker compose up -d postgres

# 3. generate client + create migration
npm run prisma:generate
npm run db:migrate        # prisma migrate dev --name init

# 4. seed realistic demo data (roles, users, leads, clients, projects, invoices…)
npm run db:seed

# 5. run both apps (waits for Postgres/Redis first, then starts API + web)
npm run dev
```

> `npm run dev` probes `DATABASE_URL`/`REDIS_URL` from `apps/api/.env` and waits up to
> 120s for them to accept connections before booting Nest — so a cold start no longer
> crashes with `P1001 / Failed to fetch`. Use `npm run dev:check` to test readiness only,
> or `node scripts/dev.mjs --timeout 30` to change the wait.

- Web: http://localhost:3000
- API: http://localhost:4000/api

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
npm run test:e2e    # Playwright suite (starts API + web automatically)
npm run check       # typecheck + smoke
```

## Production deployment

1. **Environment** — the API refuses to start without a strong `JWT_SECRET`
   (≥32 chars). In production it also requires `CORS_ORIGINS`; set
   `TRUST_PROXY=1` when running behind nginx/ALB and `FILE_URL_SECRET` to
   decouple file-link signing from the JWT key.
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