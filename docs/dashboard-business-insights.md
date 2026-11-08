# Dashboard — Business Insights, Charts & Today's Work

> Implemented: 2026-11-05 · v2 adds the visual/decision layer

The dashboard is a business command center, not a wall of text. It answers three
questions in order:

1. **How healthy is the business?** — one weighted score + component bars.
2. **What needs a decision now?** — a ranked, severity-coded queue.
3. **What do I do today?** — a highlighted Today's Work board with one "Do first".
4. **What is each module doing?** — one card per module with a mini chart; details
   open on click.

Deep-dive charts from the old dashboard (revenue trend, pipeline, cash, delivery)
remain below the summary layers as drill-down.

---

## 1. Today's Work (highlighted board)

| Block | What it shows |
|---|---|
| Header chips | Due · Overdue · Follow-ups · Approvals · Events |
| **Do first** | The single most urgent task (overdue first, then due), with project, owner and priority |
| **My focus** | Up to 3 of *my* tasks; falls back to company-level due/overdue when nothing is assigned to me |
| **Team today** | Attendance ring + present / leave / absent bar + checked-in trend for the last 7 days |
| **Waiting on you** | Expense / leave / deliverable approvals and lead follow-ups, each linked to its action page |

Role filtering:

- **Employee** — Do first, my tasks, my schedule, my leave. No company approvals, no module grid.
- **Sales** — Personal focus + follow-ups; expense/leave approvals hidden.
- **Finance** — Expense approvals only.
- **HR** — Leave approvals only.
- **Manager / Owner / Admin** — full board.

---

## 2. Business health

A single 0–100 score so nobody has to average six numbers in their head:

| Component | Source | Weight |
|---|---|---|
| Cash & collections | collected ÷ invoiced | 30% |
| Delivery health | on-track projects ÷ active projects | 30% |
| Team availability | present ÷ headcount | 20% |
| Client health | average client health score | 20% |

Grades: **≥ 80 Healthy**, **60–79 Watch**, **< 60 At risk** — shown as a ring plus
four component bars, so the weakest driver is obvious at a glance.

> Example from current data: 58 / At risk — cash 49, delivery 86, team 10, clients 79.
> The bottleneck is attendance, not sales.

---

## 3. Needs attention (decision queue)

Alerts are computed server-side, ranked by severity then impact, and each carries a
metric, a plain-language reason, and a next action. Only actionable signals fire —
no vanity alerts.

| Signal | Severity rule | Action |
|---|---|---|
| Overdue invoices | **critical** if ≥3 invoices or overdue ≥25% of recognized revenue, else warning | Collect now |
| Projects at risk | **critical** if ≥2, else warning | Review projects |
| Tasks overdue | **critical** if ≥8, else warning (shows oldest days late) | Open task board |
| Stale leads | warning | Work the pipeline |
| Approvals waiting | warning (expense / leave / file counts) | Clear approvals |
| Clients at churn risk | warning | Review accounts |
| Attendance below 60% | warning | View attendance |
| Ad return (ROAS) below 1.5x | warning | Inspect campaigns |
| Vendor payables overdue | **critical** if ≥40% of total owed is overdue, else warning | Settle payables |
| Vendor payments due this week | warning | Plan payments |
| Dollar sales below cost | warning (loss-making sales this month) | Review sales |
| Renewals in 30 days | info | See renewals |

The queue shows the top four by default with “Show all N signals”. Alert counts are
mirrored onto the matching module card, so a red badge on *Capital* always means
“there is an overdue-invoice alert inside”.

---

## 4. Every module at a glance

One card per module: a single primary number, a small chart, one context line, a
severity badge, and a click target that opens a right-side detail drawer.

| Module | Primary number | Card chart | Drill-down adds |
|---|---|---|---|
| Pulse | Active leads | Lead funnel by stage | Pipeline value, hot/stale/won/lost, stage values |
| Accounts | Avg health / 100 | Health mix (healthy / watch / at risk) | Renewals, churn risks, distribution |
| Flow | Active projects | Delivery split (on track / at risk / delayed) | At-risk project list with risk driver + score |
| Tasks | Open tasks | Status distribution | Priority mix, highest-priority open tasks |
| People | Present / headcount | Checked-in trend, last 7 days | Attendance %, utilization, leave, new joiners |
| Capital | Collected | Collected-by-month sparkline | Collection rate, recurring, cash, overdue invoices |
| Liabilities | Total owed to vendors | Paid vs open vs overdue bar | Advances, retention, other bills, next action |
| Dollar Desk | Profit this month | Monthly profit bars | USD sold, margin, avg sell rate, below-cost sales |
| Insight | ROAS | Ad spend, last 6 months | Spend, conversions, conversion value, insights |
| Calendar | Events today | Next 7 days | Today's events, milestone count |
| Portal | Active client users | Comments, last 7 days | Pending deliverables + recommended action |
| Control | Staff accounts | Integrations + audit events today | Workspace health + what to review |

Drill-downs use the existing `Drawer` component: Escape closes, the footer always
links to the full module.

---

## 5. Backend additions

`GET /dashboard/home` now returns (in addition to the previous payload):

```json
{
  "scorecard": {
    "score": 58,
    "grade": "At risk",
    "components": [
      { "key": "finance", "label": "Cash & collections", "value": 49, "weight": 0.3 }
    ]
  },
  "alerts": [
    {
      "id": "overdue-invoices",
      "severity": "critical",
      "module": "capital",
      "label": "Overdue invoices",
      "metric": 490800,
      "kind": "money",
      "hint": "4 invoices · largest ZLM-2026-0042 ৳240,000",
      "action": "Collect now",
      "href": "/capital/invoices"
    }
  ],
  "moduleAlerts": {
    "capital": { "severity": "critical", "count": 1 }
  },
  "moduleInsights": {
    "pulse": { "leadsByStage": [] },
    "accounts": { "green": 4, "yellow": 2, "red": 1 },
    "flow": { "onTrack": 6, "atRisk": 4, "delayed": 1 },
    "tasks": { "byStatus": {}, "byPriority": {} },
    "people": { "attendance7d": [] },
    "capital": { "trend": [] },
    "insight": { "adTrend": [] },
    "calendar": { "next7": [] },
    "portal": { "commentsSeries": [] }
  }
}
```

All series are computed inside the existing cached overview (30 s TTL), so the
dashboard still makes one request. Alert and module payloads are filtered **on the
server** per role — an employee receives `alerts: undefined` and no module insights.

### Role → modules

| View | Modules |
|---|---|
| owner / admin | all 12 + scorecard + full alert queue |
| finance | accounts, capital, flow, liabilities, dollar |
| manager | pulse, flow, tasks, people |
| hr | people, tasks, calendar |
| sales | pulse, accounts, tasks, calendar |
| employee | none (Today's Work uses personal data only) |

Role mapping order: owner → hr → finance → sales → admin (role name *or* `CONTROL`
view permission) → employee/member/staff/intern → manager/project/pm/lead → employee.

---

## 6. Visual system

- **Colour = meaning only**: rose = critical, amber = warning, sky = info, emerald =
  healthy; the base UI stays neutral.
- **One idea per chart**: funnel, segmented split, sparkline, mini bars, or ring —
  never a dual-axis or 3-D chart.
- **No chart without context**: every card has one short line, e.g.
  “৳7.97L due · ৳4.91L overdue”.
- **Progressive disclosure**: summary card → drawer → full module.
- Numbers use tabular figures so they do not jitter; chart components are plain SVG
  (no extra dependency) and respect dark mode via `currentColor`.

## 7. Verification

- `tsc --noEmit` clean for `apps/api` and `apps/web`.
- API role scoping re-checked: owner 12 modules + scorecard + 8 alerts, finance 5
  modules + filtered alerts, manager 4, HR 3, sales 4, employee 0 (`alerts` absent).
- Browser: all 12 module drawers open and close with no console errors; owner,
  finance, manager and employee layouts verified.
- Temporary QA user removed afterwards; users back to 6, maintenance off.
