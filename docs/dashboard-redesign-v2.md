# Dashboard v2 — Decision-first redesign

> Implemented: 14 November 2026
> Source spec: `zoolyum-os-crm-ui-data-hierarchy-guide.md` (sections 3–7, 12–19)

## 1. What changed

The dashboard used to open with a large Time clock card, then attendance, then the
12-module grid, and only after the fold did the KPI row appear. It now answers the
owner's three questions in order:

| Zone | Content | Question answered |
|---|---|---|
| Z1 | Global header, compact clock chip, privacy toggle, `Ctrl/⌘+K` palette | — |
| Z2 | Greeting + one-line brief + period switcher + quick create | Where am I? |
| Z3 | 6 KPI cards | Am I healthy? |
| Z4 | Business health + Action Center | What is burning, what do I do? |
| Z5 | Today · Cash & revenue · Pipeline · Project health · AR aging · Clients · Capacity | Why? |
| Z6 | Module launcher (collapsed) | Where else can I go? |
| Z7 | Activity feed + my day / team attendance (collapsed) | What happened? |

The Time clock moved to the header as `In 15:44 · [Out]` and the full punch
timeline is in People → My space (and a collapsed block at the bottom). The
12-module grid is now a collapsed launcher. "Needs attention" and the Inbox
approvals were merged into one Action Center.

## 2. Role layouts

`GET /dashboard/home?period=month|quarter|year` still narrows the payload by role;
each role gets a different KPI strip and panel mix, sharing the same primitives:

| Role | KPI strip | Main panels |
|---|---|---|
| Owner / Admin | Revenue · Collected · Overdue · Cash & runway · Pipeline · At risk | Health, Action Center, Today, Cash & revenue, Pipeline, Project health, AR aging, Clients & concentration, Capacity |
| Finance | Collected · Overdue · Outstanding · Cash · Expenses · Collection rate | Cash & revenue, AR aging, Clients & concentration, Payment mix, Data quality |
| Manager | Active projects · At risk · Open tasks · Due today · Capacity · Blocked | Health, Action Center, Project health, Pipeline, Capacity, Today, Data quality, Activity |
| HR | Employees · Present · On leave · Utilization · Overloaded · Pending leave | Health, Action Center, Capacity, Data quality, Today, My leave |
| Sales | My pipeline · Weighted forecast · Active leads · Follow-ups · My tasks · Won | Health, Action Center, Pipeline, Clients & concentration, Today, Data quality, My tasks, Activity |
| Employee | My tasks · Due today · Overdue · Follow-ups · Events | Today, My tasks, My leave, My attendance |

Finance and delivery numbers are still filtered server-side: the API never sends
people/pipeline data to Finance, and never sends company finance to an employee.

## 3. New data (single definition, one service)

All fields are computed in `apps/api/src/dashboard/dashboard.service.ts` and are
period-aware. Balances (outstanding, overdue, cash) are point-in-time; flows
(invoiced, collected, expenses, net) use the selected window.

| Field | Definition |
|---|---|
| `period` | `{ key, label, months, from, to, days }` — month / quarter / year |
| `capital.periodRevenue` | recognised invoice value issued in the period (excl. pass-through) |
| `capital.periodCollected` | payments received in the period |
| `capital.periodExpenses` | approved expenses dated in the period |
| `capital.revenueDelta` / `collectedDelta` / `expensesDelta` | change vs the previous equal-length window |
| `capital.monthlyRevenueTarget` | `Settings.financeConfig.monthlyRevenueTarget` (0 = hidden) |
| `capital.targetForPeriod` / `targetProgress` | target × months, and revenue ÷ target |
| `capital.monthlyBurn` | max(trailing-3-month average spend, `monthlyFixedCost`) |
| `capital.runwayMonths` | cash ÷ monthly burn (null when burn is 0) |
| `capital.dsoDays` | outstanding ÷ period revenue × days in period |
| `capital.aging[]` | 0–30 / 31–60 / 61–90 / 90+ buckets with amount + count |
| `concentration` | top 1 / top 3 share, up to five clients, warning (50%) and critical (60%) levels |
| `capacity` | six weeks × employee utilization heatmap |
| `completeness` | budget, estimate, next-action and time-logging gaps with links |
| `today.approvalItems` | pending expenses, leave requests and deliverables with ids |

Control → Finance now has **Dashboard planning** fields: monthly revenue target,
monthly fixed cost, concentration warning/critical thresholds.

Metric definitions are available in-app through the ⓘ next to each KPI/panel.

## 4. Action Center

Tabs: **Attention · Approvals · Follow-ups · Overdue tasks**.

- Approve an expense inline (PATCH `capital/expenses/:id`) with Undo.
- Approve leave (PATCH `people/leave-requests/:id`).
- Approve a client deliverable (PATCH `flow/files/:id/approval`) with Undo.
- "Mark reminded" logs a payment reminder against every overdue invoice
  (POST `capital/invoices/:id/reminders`), with Undo via the new
  DELETE `capital/invoices/:id/reminders/:reminderId`.
- Snooze hides a row for one hour (stored in localStorage).
- Zero state is positive: "Nothing is on fire", "No pending approvals".

Self-approval is still blocked by the API (an owner cannot approve an expense
they submitted themselves).

## 5. Global additions

| Feature | Where | Notes |
|---|---|---|
| Period switcher | Dashboard header | Persisted in localStorage; quarter/year snapshots cached separately |
| Privacy (৳ hide) | Topbar eye | CSS-masks `.money`; new panels render money through `<Money>`; alert hints use `<MaskAmounts>` |
| Command palette | `Ctrl/⌘+K` or `/` | Actions + pages + live `/search` records, arrow/enter navigation |
| Clock chip | Topbar | `GET /people/attendance/today`, one-click punch, hidden below `md` |
| Toasts with Undo | Global | `ToastProvider` + `useToast().undo()` |

## 6. Typography

Minimum size is now **12px** (`--text-micro` and `--text-meta` were 10.5/11.5px).
Body stays 12.5px, and a new `--text-kpi` (32px) is used only for dashboard KPIs
(`--text-stat` is now 24px). Full scale in `docs/design-system.md`.

## 7. API changes

- `GET /dashboard/home?period=` and `GET /dashboard/overview?period=`
- New response fields listed in §3
- `DELETE /capital/invoices/:id/reminders/:reminderId`
- `flow.atRisk` is no longer truncated to five, so the KPI and the list agree
- Dashboard cache: a missing cache (i.e. after a write) now recomputes instead of
  serving the previous snapshot, so approvals and amounts reflect the action the
  user just took.

## 8. Verification

- `npm run typecheck` — clean for `apps/api` and `apps/web`.
- Playwright at 1440×900, 1366×768 and 390×844: no console errors, no horizontal
  overflow on dashboard, capital, invoices, pulse, tasks, flow, accounts, people,
  insight.
- Owner, Finance, Manager, HR and Sales dashboards rendered with real logins.
- Approve + Undo and Mark reminded + Undo verified end-to-end against the API
  (HTTP 200/201 then DELETE 200).
- Privacy toggle verified: `.money` computed colour becomes transparent and
  `html[data-privacy="on"]` is set.
- Period switch verified: subtitle changes to “Last 3 months” and the payload
  switches to the quarter cache key.

## 9. Known limitations

- Chart axis labels are SVG text and are not masked by privacy mode.
- The brand colour stays whatever Control → Branding defines; the guide's orange
  is only a default, not a hard-coded token.
- `GET /control/branding` returns 403 for non-admin roles (pre-existing); the UI
  falls back to default branding but logs a console error on first load.
- Dashboard snapshots for quarter/year are cached for 120s and invalidated only
  on the next write or expiry.
