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

# 5. run both apps
npm run dev
```

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
- **Portal** — client portal users, comments with sentiment, deliverable approvals, activity.
- **Control** — RBAC roles with module permission matrices, integrations (Slack/Dropbox), branding, audit logs.

## Useful commands

```bash
npm run db:reset    # migrate reset + re-seed (destructive)
npm run build       # build api + web
```

## Design system

Zoolyum UI follows the EduTrack-inspired design spec in `docs/design-system.md` — OKLCH tokens, violet→fuchsia→sky gradient brand, glass surfaces, dark mode, Geist/Space Grotesk/Hind Siliguri fonts, BDT formatting (lakh-style).