# Scoring Engine (Client Health & Project Risk)

Status: **Phase 1 + 2 shipped** — client health, project risk, overall score, segment
profiles, score alerts and churn backtest are all editable/computed.

## Why this exists

Before this change:

- `Client.healthScore` was computed by a hardcoded formula in `accounts.service.ts` (base 75, fixed ±points, fixed 70/40 thresholds).
- `Project.riskScore` / `Project.healthStatus` were typed in by the PM, so two PMs scored the same project differently.
- `Settings.healthScoreWeights` had a UI in Control → Settings but **the engine never read it**.

The scoring engine replaces all of that with one config-driven pipeline:

```
collect metrics → normalise each factor to 0-100 → weighted sum
→ override rules → band (level + label + action) → snapshot + breakdown
```

Every number an admin can change lives in `Settings.scoringConfig` (JSON).
No weights, thresholds or penalties are hardcoded in the engine.

## Where things live

| Piece | File |
|---|---|
| Types, defaults, metric registry, normalisation | `apps/api/src/scoring/scoring.config.ts` |
| Metric collection, evaluation, persistence, cron | `apps/api/src/scoring/scoring.service.ts` |
| Admin API | `apps/api/src/scoring/scoring.controller.ts` |
| Admin UI | `apps/web/src/app/(app)/control/scoring/page.tsx` |
| Client health delegate | `apps/api/src/accounts/accounts.service.ts` (`recomputeHealth`) |
| Project hooks | `apps/api/src/flow/flow.service.ts` (`rescore`) |

## API

All endpoints are admin-only (`Owner`, `CONTROL`) and live under `/api/scoring`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | Current normalised config |
| PATCH | `/config` | Save a full or partial config (arrays replace, objects merge) |
| POST | `/config/reset` | Restore defaults (audited) |
| GET | `/overview` | Averages, band distribution, stale/never-scored counts, last run |
| GET | `/backtest?days=90` | Outcome validation against churn/retention |
| GET | `/calibrate?days=90` | Suggested weights from the factor gap between churned and retained |
| GET | `/forecast?scope=&id=&points=8` | Least-squares trend + 4-week projection |
| GET | `/profiles` | Segment profile list for the client file (any signed-in user) |
| POST | `/overall/preview` | Weighted overall score from supplied component values |
| GET | `/subjects` | Client/project pickers for preview and history |
| POST | `/clients/:id/preview` | Evaluate a client with a draft config (`{ config, metrics }`), no write |
| POST | `/projects/:id/preview` | Same for a project |
| POST | `/clients/:id/recompute` | Recompute and persist one client |
| POST | `/projects/:id/recompute` | Recompute and persist one project |
| POST | `/recompute` | `{ scope: "clients" \| "projects" \| "all" }` |
| GET | `/clients/:id/history` | `ClientHealthLog` snapshots |
| GET | `/projects/:id/history` | `ProjectRiskLog` snapshots |

## Config shape

```jsonc
{
  "version": 1,
  "client": {
    "enabled": true,
    "factors": [
      {
        "code": "payment",
        "label": "Payment behavior",
        "weight": 30,              // weights are relative; the engine renormalises
        "enabled": true,
        "metric": "overdueInvoiceCount",
        "direction": "lowerBetter",
        "type": "bands",            // "bands" | "linear"
        "bands": [                  // first match wins, keep one catch-all (lte: null)
          { "lte": 0, "score": 100 },
          { "lte": null, "score": 0 }
        ],
        "missing": "exclude"        // "exclude" | "neutral" | "zero"
      }
    ],
    "bands": [                      // score -> level, label, colour, required action
      { "min": 70, "level": "GREEN",  "label": "Healthy",  "color": "#22c55e", "action": "…" },
      { "min": 40, "level": "YELLOW", "label": "Watch",    "color": "#f59e0b", "action": "…" },
      { "min": 0,  "level": "RED",    "label": "Critical", "color": "#ef4444", "action": "…" }
    ],
    "overrides": [
      {
        "id": "client-ov-overdue-30",
        "enabled": true,
        "metric": "oldestOverdueDays",
        "op": "gte",                // gte | gt | lte | lt | eq
        "value": 30,
        "action": "cap",            // cap = cannot be better than level, set = force level
        "level": "RED",
        "note": "An invoice is more than 30 days overdue."
      }
    ]
  },
  "project": { "…same shape…" },
  "schedule": { "enabled": true, "time": "02:00", "staleAfterHours": 24 }
}
```

### Missing data

`exclude` (default) drops the factor and renormalises the remaining weights, and the
result reports `coverage` (share of configured weight that had data). This is why a
brand-new client with no invoices is no longer a false GREEN: the payment factor is
simply absent, and the UI shows the lower coverage.

### Override rules and score consistency

If a `cap`/`set` rule pulls the level down, the numeric score is clamped into that band
(`YELLOW` ≤ 69, `RED` ≤ 39). Project risk is stored as `100 - score`, so the number and
the traffic light can never disagree. `rawScore` keeps the pre-override value for
transparency.

## Default factors

### Client (weights 30 / 20 / 20 / 15 / 15)

| Factor | Metric | Notes |
|---|---|---|
| Payment behavior | `overdueInvoiceCount` | Overdue by due date, not by status |
| Delivery | `atRiskProjectCount` | Driven by the project engine |
| Engagement recency | `daysSinceContact` | Latest client comment, meeting or portal login |
| Renewal proximity | `renewalDays` | Blank renewal date → factor excluded |
| Relationship depth | `contactCount` | Single contact is a single point of failure |

Override defaults: 30+ days overdue → cap RED; churn flag (30d) → cap YELLOW.

### Project (weights 25 / 25 / 20 / 15 / 15)

| Factor | Metric | Notes |
|---|---|---|
| Schedule | `scheduleSlipDays` | Worst overdue milestone or passed target end date |
| Budget burn | `budgetBurnRatio` | `spend% ÷ progress%` (100 = on plan) |
| Progress vs plan | `progressGap` | Expected progress minus actual, in pp |
| Quality & blockers | `blockedTaskCount` | Open blocked tasks |
| PM confidence | `pmConfidence` | `Project.confidenceScore` (1-5), the only manual input |

`healthStatus` is derived: GREEN → `ON_TRACK`, YELLOW → `AT_RISK`, RED → `DELAYED`.
A PM can still override it; the override is stored in `Project.healthStatusOverride`
with `healthOverrideReason`, and clearing it restores the computed level.

Override defaults: 30+ days slip → cap RED; burn ≥ 150% → cap RED; progress ≥ 30pp
behind plan → cap YELLOW.

## Recompute triggers

- Client create/update, invoice create/update/void/payment, credit notes → `AccountsService.recomputeHealth` → engine.
- Project create/update → project score, then its client (at-risk count is a client factor).
- Manual: `Recompute` buttons on Accounts and on the Scoring page.
- Cron: every night at 02:00 (`@Cron("0 2 * * *")`), all projects then all clients.
  Scores older than `staleAfterHours` are flagged in the overview.

Task edits do not currently trigger a project rescore; the nightly run catches them.

## Storage added

| Column | Purpose |
|---|---|
| `Settings.scoringConfig` | The engine config |
| `Client.healthBreakdown`, `Client.healthComputedAt` | Cached factor breakdown + timestamp |
| `ClientHealthLog.level`, `.breakdown` | History with the explanation |
| `Project.confidenceScore` | PM's 1-5 input |
| `Project.healthStatusOverride`, `.healthOverrideReason` | Manual override + reason |
| `Project.healthBreakdown`, `.healthComputedAt` | Cached factor breakdown |
| `ProjectRiskLog.breakdown` | History with the explanation |

Migration: `apps/api/prisma/migrations/20261105144137_scoring_engine`.

## Migrating from the old weight table

On first read, if `scoringConfig` is empty, the engine maps the legacy
`healthScoreWeights` names (`Payment History`, `Engagement`, `Project Activity`) onto
the new factor codes, drops `NPS Score` (it had no data source), and rescales the
profile to 100. The first save writes a normalised config.

## Phase 2 shipped

### Overall business score

`config.overall` holds four components — finance, delivery, people, clients — with editable
weights and bands. The dashboard still computes the raw numbers (collection rate, on-track
share, attendance, average client health); the engine only combines them. `POST /scoring/overall/preview`
accepts `{ values }` and returns the weighted score, band and per-component contribution.

Default bands: ≥80 Healthy, ≥60 Watch, otherwise At risk (the old hardcoded thresholds, now editable).

### Segment profiles

`config.client.profiles` is a list of `{ id, label, match: { billingCycleType: [...] }, weights: { code: n } }`.
The first profile whose billing cycle matches the client wins; base factors are reused with only
their weights replaced. This covers retainer vs project-based clients without a second scoring model.
Profiles are optional — with none configured every client uses the base factors.

A client can also **pin a profile explicitly** via `Client.scoreProfile` (select in the client file,
`PATCH /accounts/clients/:id { scoreProfile }`). An explicit id wins over the billing-cycle match;
`null` returns to automatic. Unknown ids are rejected with a 400. `GET /scoring/profiles` exposes the
list to every signed-in staff member.

### Outcome validation (backtest)

`GET /scoring/backtest?days=90` takes each client's newest snapshot at or before the cutoff and
compares it with what happened after: archived or churn-flagged = churned. It returns:

- **catch rate** — share of churners that were amber/red at the cutoff
- **false alarm rate** — share of retained clients that were flagged
- **precision** — share of flagged clients that actually churned
- **surprises** — clients that churned while green

Only data that existed at the cutoff is used, so there is no look-ahead leak. The History tab
renders this with a 30/60/90/180-day selector.

### Score alerts

`config.alerts` defines, per scope, which levels fire and which roles to notify. A notification
(`SCORING_ALERT`) is sent only when a score **worsens** into one of the selected levels, so the
nightly recompute does not re-alert an account that has been red for weeks. Defaults: client → RED →
Owner; project → RED → Owner and PM.

`alerts.notifyImprovements` also notifies when a score **recovers** into a better band
("Client recovered to GREEN: …"). Bulk `POST /scoring/recompute` runs silently; the nightly cron
still alerts on downgrades, and a single project/client change alerts immediately.

### Weight calibration

`GET /scoring/calibrate?days=90` compares each factor's average for churned vs retained clients at
the cutoff. The gap becomes the suggested weight (proportional, normalised to 100). The History tab
shows a table and an **Apply to draft** button, so an admin can test the suggestion before saving.

If fewer than four historical breakdowns exist, it falls back to each client's current breakdown,
marks the result `method: "current-snapshot"` and returns a caveat — it is an exploratory view, not a
backtest.

### Trend forecast

`GET /scoring/forecast?scope=client|project&id=…&points=8` runs a least-squares regression over the
last N snapshots and returns the slope per week, projected score in 4 weeks, R², direction, and the
next band crossing (e.g. "crosses 40 in ~5.3w"). The History tab renders it under the trend chart.

### Task events

Task create/update/delete now trigger a project rescore when a field the engine reads changes
(`status`, `dueDate`, `isBlocked`, `estimatedHours`, `projectId`), followed by the client rescore.
This keeps the project and client scores fresh without waiting for 02:00.

## Remaining ideas

- Confidence adjustment on the forecast (widen the band when R² is low or sample is small).
- Persist calibrated weight history so a calibration can be rolled back as a version.
- Segment at the project level too (fixed-price vs retainer weights).
- Notify the account owner by email as well as in-app (currently the notification fan-out handles channels).

