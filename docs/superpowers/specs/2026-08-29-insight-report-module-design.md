# Insight & Report Module — Architectural Design

> Date: 2026-08-29
> Status: Approved (Approach B — Modular)
> Owner: Zoolyum OS
> Scope: Data Source (Google/Meta multi-account) + 10 Report Types + Automation + Manual Builder + Presentation

## 1. Purpose & Success Criteria

### 1.1 Problem
Agency needs a single panel to see marketing health across Google Ads + Meta Ads, compare performance, attribute revenue, detect anomalies, and auto-deliver white-label reports to clients. Current Insight module (`apps/api/src/insight/insight.service.ts:1`) only covers finance/lead-based overview (`overview()`, `clientHealth()`, `taxReport()`, `performance()`) and has no ads data, no scheduling, no builder.

### 1.2 Goals
- **CMO Dashboard**: custom date range, client-wise, campaign-wise, MoM comparison, health score, spend vs budget, ROAS/ROI/CAC.
- **Unified Ads**: Google Ads + Meta Ads, multi-account per Client, real-time or 6h sync, cross-platform combined view.
- **10 Report Types**: campaign, adset/adgroup, creative, audience/demographic, spend vs budget, ROAS/ROI, CTR/CPC/CPM/CPA, conversion (leads/purchases), cross-platform.
- **Automation**: daily/weekly/monthly scheduled reports, auto email/WhatsApp delivery, anomaly alerts (spend spike, CTR drop).
- **Manual**: custom date range, drag-drop builder (choose metrics), task-wise report, export PDF/Excel.
- **Presentation**: white-label dashboard (Zoolyum branding), visual charts (Recharts), AI-generated plain-language summary, this vs last month comparison.

### 1.3 Success Metrics
- API: `GET /insight/*` p95 < 400ms (cached), sync job < 2 min per 10 accounts.
- Frontend: Insight page loads with skeleton, no layout shift, PDF export < 5s for 1 month data.
- Data: unified `AdInsight` grain supports all 10 report types with single query.

### 1.4 Non-Goals (Defer)
- Real Google/Meta OAuth token exchange in v1 — stub with encrypted refresh_token + mock sync; real OAuth in v1.1 when credentials provided.
- Competitor ads tracking, market trend, keyword gap (v2).
- TikTok/LinkedIn/YouTube beyond Meta/Google (v2).

---

## 2. Architecture — Approach B (Modular)

### 2.1 Module Map
```
apps/api/src/insight/
  insight.module.ts          // aggregator, imports 4 submodules, re-exports
  insight.controller.ts      // keeps existing routes, delegates to sub-controllers
  insight.service.ts         // keeps overview/health/tax/performance (legacy)
  datasource/
    datasource.module.ts
    ad-account.service.ts    // CRUD AdAccount, link to Client
    google-ads.service.ts    // fetchCampaigns/insights (mock|real)
    meta-ads.service.ts      // fetchCampaigns/insights (mock|real)
    sync.service.ts          // unified sync → AdInsight upsert, cron 0 */6 * * *
    dto/ + controller
  reports/
    reports.module.ts
    reports.service.ts       // 10 report type builders, cross-platform combiner
    reports.controller.ts    // GET /insight/reports/* (new)
  automation/
    automation.module.ts
    scheduler.service.ts     // ScheduledReport CRUD + @Cron evaluator
    alerts.service.ts        // AlertRule eval + anomaly detection
    delivery.service.ts      // email via NotificationsService, WhatsApp stub
  presentation/
    presentation.module.ts
    dashboard.service.ts     // executive dashboard v2 (date range, comparison, health score)
    ai-insight.service.ts    // plain-language summary (rule-based v1, LLM v2)
```

### 2.2 Why Modular
- InsightService currently 276 lines (`insight.service.ts:9`); adding 10 report types + sync + alerts would exceed 1500 lines and violate single-responsibility.
- Each submodule has own cache namespace (`insight:ads:*`, `insight:reports:*`, `insight:automation:*`) so invalidation is scoped (`pulse.service.ts:264` pattern).
- Agency multi-tenancy: AdAccount scoped to Client, reports filtered by clientId — isolation at service layer.

### 2.3 Data Flow
```
[Google Ads API] ─┐
                  ├─▶ google-ads.service / meta-ads.service ─▶ sync.service ─▶ AdInsight (unified)
[Meta Graph API] ─┘                                              │
                                                                 ▼
Client ← AdAccount ← AdCampaign ← AdSet/AdGroup ← Ad ─▶ AdInsight (daily grain)
                                                                 │
                                                                 ▼
                                          reports.service ─▶ 10 report builders
                                                                 │
                                                                 ├─▶ dashboard.service (executive, comparison, cross-platform)
                                                                 ├─▶ scheduler.service (cron) ─▶ delivery.service (email/WhatsApp)
                                                                 ├─▶ alerts.service (anomaly) ─▶ Notification
                                                                 └─▶ ai-insight.service (summary)
```

---

## 3. Data Model (Prisma)

### 3.1 New Enums & Models (append after `schema.prisma:1673`)
```prisma
enum AdsProvider { GOOGLE META }
enum AdSyncStatus { PENDING RUNNING SUCCESS FAILED }

model AdAccount {
  id             String       @id @default(cuid())
  clientId       String?
  client         Client?      @relation(fields: [clientId], references: [id], onDelete: SetNull)
  provider       AdsProvider
  externalId     String       // Google CID / Meta act_xxx (without prefix stored as-is)
  name           String
  status         IntegrationStatus @default(CONNECTED)
  credentialsEnc String?      // encrypted refresh token / access token
  lastSyncAt     DateTime?
  createdAt      DateTime     @default(now())
  campaigns      AdCampaign[]
  syncLogs       AdSyncLog[]
  @@unique([provider, externalId])
  @@index([clientId])
  @@index([provider])
}

model AdCampaign {
  id          String   @id @default(cuid())
  adAccountId String
  adAccount   AdAccount @relation(fields: [adAccountId], references: [id], onDelete: Cascade)
  externalId  String
  name        String
  status      String   @default("ENABLED") // ENABLED/PAUSED/REMOVED
  budget      Decimal? @db.Decimal(14,2)
  objective   String?
  insights    AdInsight[]
  adSets      AdSet[]
  @@unique([adAccountId, externalId])
  @@index([adAccountId])
}

model AdSet {
  id         String @id @default(cuid())
  campaignId String
  campaign   AdCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  externalId String
  name       String
  status     String @default("ACTIVE")
  insights   AdInsight[]
  ads        Ad[]
  @@unique([campaignId, externalId])
}

model Ad {
  id           String  @id @default(cuid())
  adSetId      String
  adSet        AdSet   @relation(fields: [adSetId], references: [id], onDelete: Cascade)
  externalId   String
  name         String
  status       String  @default("ACTIVE")
  creativeUrl  String?
  creativeType String? // IMAGE/VIDEO/CAROUSEL
  insights     AdInsight[]
  @@unique([adSetId, externalId])
}

model AdInsight {
  id              String      @id @default(cuid())
  provider        AdsProvider
  date            DateTime    @db.Date
  // grain — exactly one of these is set (campaign/adset/ad), plus denormalized campaignId for fast filter
  campaignId      String?
  campaign        AdCampaign? @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  adSetId         String?
  adSet           AdSet?      @relation(fields: [adSetId], references: [id], onDelete: Cascade)
  adId            String?
  ad              Ad?         @relation(fields: [adId], references: [id], onDelete: Cascade)
  // denormalized for query without join
  adAccountId     String
  clientId        String?     // copied from AdAccount.clientId for fast client filter
  // metrics — unified
  impressions     Int         @default(0)
  clicks          Int         @default(0)
  spend           Decimal     @default(0) @db.Decimal(14,2)
  conversions     Int         @default(0)
  conversionValue Decimal?    @db.Decimal(14,2)
  reach           Int?
  frequency       Float?
  ctr             Float?      // clicks/impressions
  cpc             Decimal?    @db.Decimal(10,4)
  cpm             Decimal?    @db.Decimal(10,4)
  cpa             Decimal?    @db.Decimal(10,4) // spend/conversions
  roas            Float?
  qualityScore    Int?
  engagement      Int?
  videoViews      Json?       // {p3s, p50, complete}
  demographic     Json?       // {age, gender, location breakdown}
  @@unique([provider, date, campaignId, adSetId, adId])
  @@index([date, provider])
  @@index([clientId, date])
  @@index([campaignId, date])
  @@index([adAccountId, date])
}

model AdSyncLog {
  id          String     @id @default(cuid())
  adAccountId String
  adAccount   AdAccount  @relation(fields: [adAccountId], references: [id], onDelete: Cascade)
  startedAt   DateTime   @default(now())
  finishedAt  DateTime?
  status      AdSyncStatus @default(PENDING)
  recordsPulled Int      @default(0)
  error       String?
  @@index([adAccountId, startedAt])
}

model ScheduledReport {
  id          String   @id @default(cuid())
  reportDefId String
  reportDef   ReportDefinition @relation(fields: [reportDefId], references: [id], onDelete: Cascade)
  cron        String   // "0 9 * * 1" or "daily"/"weekly"/"monthly" alias
  recipients  Json     // [{email, name, whatsapp?}]
  isActive    Boolean  @default(true)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
  createdAt   DateTime @default(now())
}

model AlertRule {
  id            String   @id @default(cuid())
  name          String
  clientId      String?  // null = global
  metric        String   // spend|ctr|cpc|cpm|roas|cpa|conversions|impressions
  condition     String   // gt|lt|change_pct_gt|change_pct_lt
  threshold     Float
  windowDays    Int      @default(7)
  isActive      Boolean  @default(true)
  lastTriggeredAt DateTime?
  createdAt     DateTime @default(now())
}

model ReportRun {
  id            String   @id @default(cuid())
  reportDefId   String
  reportDef     ReportDefinition @relation(fields: [reportDefId], references: [id], onDelete: Cascade)
  ranAt         DateTime @default(now())
  params        Json     // {from, to, clientId, provider, campaignId}
  resultSnapshot Json    // frozen result for audit
  fileUrl       String?
  @@index([reportDefId, ranAt])
}

// Extend existing ReportDefinition (schema.prisma:1625)
 // Add optional fields via migration: clientId String?, provider AdsProvider?, reportType String @default("CUSTOM"), isCrossPlatform Boolean @default(false), taskId String?
// Extend Client: add adAccounts AdAccount[]
```

### 3.2 Indexes & Performance
- `AdInsight` unique on grain prevents duplicate sync; indexes on `clientId+date` and `campaignId+date` make 10 report queries index-only scans.
- Partition thought: if > 10M rows, move to monthly table partitioning (defer).
- Cache keys: `insight:reports:{type}:{clientId}:{from}:{to}:{provider}` TTL 120s, invalidated on sync.

---

## 4. API Design

### 4.1 Datasource
```
POST   /insight/datasource/accounts              // {clientId?, provider, externalId, name, credentialsEnc?}
GET    /insight/datasource/accounts?clientId=&provider=
PATCH  /insight/datasource/accounts/:id
DELETE /insight/datasource/accounts/:id
POST   /insight/datasource/accounts/:id/sync     // manual trigger
GET    /insight/datasource/sync-logs?accountId=
POST   /insight/datasource/sync-all              // admin, sync all accounts
GET    /insight/datasource/health                // lastSyncAt per account
```

### 4.2 Reports (10 types + combined + comparison)
```
GET /insight/reports/executive?from=&to=&clientId=&compare=true
  // returns healthScore, totalSpend, leads, CPL, ROAS, MoM delta, budget vs spend
GET /insight/reports/campaigns?from=&to=&clientId=&provider=&sort=spend
GET /insight/reports/adsets?campaignId=&from=&to=
GET /insight/reports/ads?adSetId=&from=&to=
GET /insight/reports/creatives?from=&to=&clientId=&sort=ctr
  // top performing, fatigue detection (ctr drop > 20% over 14d)
GET /insight/reports/audience?from=&to=&clientId= // demographic breakdown
GET /insight/reports/spend-budget?from=&to=&clientId=
GET /insight/reports/roas-roi?from=&to=&clientId=
GET /insight/reports/metrics/ctr-cpc-cpm-cpa?from=&to=&clientId=&provider=
GET /insight/reports/conversions?from=&to=&clientId=
GET /insight/reports/cross-platform?from=&to=&clientId=
GET /insight/reports/comparison?from=&to=&compareFrom=&compareTo=&clientId=
```

### 4.3 Automation
```
POST   /insight/automation/schedules              // {reportDefId, cron, recipients}
GET    /insight/automation/schedules
PATCH  /insight/automation/schedules/:id
DELETE /insight/automation/schedules/:id
POST   /insight/automation/schedules/:id/run-now
GET    /insight/automation/alerts
POST   /insight/automation/alerts                // {name, metric, condition, threshold, windowDays, clientId?}
PATCH  /insight/automation/alerts/:id
DELETE /insight/automation/alerts/:id
GET    /insight/automation/alerts/history        // triggered alerts log (via Notification)
POST   /insight/automation/deliveries/test       // send test email
```

### 4.4 Manual Builder & Export
```
POST /insight/reports/custom                      // {from,to,clientId,provider,metrics[], dimensions[], filters}
GET  /insight/reports/custom/:id/export?format=pdf|excel
  // pdf via jspdf + html2canvas (existing web deps), excel via xlsx on API
POST /insight/reports/task/:taskId/snapshot      // task-wise manual report
GET  /insight/reports/runs?reportDefId=         // history
```

### 4.5 Presentation / AI
```
GET /insight/presentation/dashboard?from=&to=&clientId=
  // white-label flag, branding from BrandingConfig, charts data, AI summary
GET /insight/presentation/ai-summary?from=&to=&clientId=
  // rule-based v1: "CPL up 32% because frequency up, CTR down" — future LLM
```

Auth: all routes behind JwtAuthGuard + RolesGuard (`app.module.ts:43`), `@Roles('ADMIN','MANAGER')` for write, VIEW for read. ClientMember via Portal guard if exposed.

---

## 5. Frontend (apps/web)

### 5.1 Insight Page Redesign (`apps/web/src/app/(app)/insight/page.tsx:41` — extend tabs)
Current 6 tabs → 9 tabs:
```
Overview (executive v2) | Accounts | Campaigns | Creatives | Audience | Reports Library | Builder | Schedules/Alerts | Presentation
```
- Keep existing `overview/library/health/tax/performance/correlations` but `overview` upgraded to executive v2 (custom date range, client picker, campaign picker, MoM comparison, health score, spend vs budget).
- New components under `apps/web/src/app/(app)/insight/_components/`:
  - `date-range-picker.tsx` (preset + custom)
  - `client-account-picker.tsx`
  - `campaign-table.tsx`, `creative-grid.tsx`, `audience-breakdown.tsx`
  - `report-builder.tsx` (drag-drop KPI Card/Chart/Table/Text/Image/Recommendation — via simple grid + dnd-kit)
  - `schedule-form.tsx`, `alert-rules.tsx`
  - `export-buttons.tsx` (PDF/Excel)
  - `ai-summary-card.tsx`
  - `comparison-view.tsx`

### 5.2 Data Fetching
- Use `useApi` (`lib/use-api.ts`) + `@tanstack/react-query` for caching (already in web deps).
- Recharts for all charts (already in `package.json:21`), `jspdf` + `html2canvas` for PDF export (already present).
- Excel export: call API `GET .../export?format=excel` and trigger download.

### 5.3 White-Label
- Read `BrandingConfig` (`/control/branding`) via existing context, apply CSS vars to dashboard header, cover page of PDF.

---

## 6. Automation & Scheduling

### 6.1 Scheduler
- `SchedulerService` uses `@Cron('0 * * * *')` (every hour) to evaluate `ScheduledReport` where `nextRunAt <= now && isActive`.
- Compute `nextRunAt` from `cron` via `cron-parser`.
- On due: `reports.service.run(reportDefId, {from,to,clientId})` → `delivery.service.send(recipients, result, format)` → create `ReportRun` + `Notification`.
- `delivery.service` uses `NotificationsService.broadcast` for in-app + nodemailer for email (reuse existing), WhatsApp via stub (log + notification) — real provider later.

### 6.2 Alerts / Anomaly
- `AlertsService` runs `@Cron('0 */30 * * * *')` (every 30m) or on sync finish.
- For each `AlertRule` where `isActive`, compute metric over `windowDays` vs previous window. If condition met, create `Notification` + update `lastTriggeredAt`.
- Built-in anomaly: if `spend` today > avg 7d * 2 and `conversions == 0` → "Campaign spending without leads" alert.
- Store triggered alerts as `Notification` with `type='report_alert'`.

### 6.3 Sync
- `SyncService.syncAccount(accountId)` — fetch from provider service (mock in v1: generate deterministic synthetic insights for last 30d), upsert into `AdInsight`, update `AdSyncLog`, invalidate caches.
- Real provider switch: `if (credentialsEnc && providerCredsValid) useRealApi else useMock`.

---

## 7. AI Insight (v1 Rule-Based)

- `AiInsightService.summarize({from,to,clientId})` — computes deltas vs previous period, checks:
  - CPL up > 20% → "frequency up and CTR down" if both true.
  - ROAS 3x better campaign → "Shift 20% budget to Campaign X".
  - Creative fatigue: CTR of top creative down > 15% over 14d → "Audience fatigue detected".
- Returns `{summary: string, bullets: string[], recommendations: {action, reason, campaignId?}[]}`.
- Prompt-ready for LLM v2: pass same deltas to OpenAI with system prompt "You are a marketing analyst...".

---

## 8. Error Handling & Edge Cases
- AdAccount externalId duplicate → 409.
- Sync failure → AdSyncLog status FAILED with error, don't block other accounts (Promise.allSettled).
- No data for date range → return empty arrays with `meta: {from,to,hasData:false}` not 404.
- Export with no data → PDF with "No data for selected period" placeholder.
- Rate limit (real API) → exponential backoff, log, retry next cron.
- Client deleted → AdAccount.clientId set null (not cascade), reports still queryable by provider.

---

## 9. Testing Strategy
- Unit: `reports.service` — each report type with synthetic AdInsight rows (in-memory).
- Integration: `sync.service` — mock provider → upsert → query reports.
- E2E: Playwright on `apps/web` Insight tabs (existing `playwright.config.ts`), mock API via MSW.
- Manual: seed script `prisma/seed-ads.ts` generates 2 clients × 2 accounts × 3 campaigns × 30 days insights.

---

## 10. Rollout Plan
- **Phase 1 (this spec)**: Prisma migrate, datasource CRUD + mock sync, executive dashboard v2, 6 core reports (campaign/adset/creative/spend-budget/roas/ctr-cpc), scheduler + alerts stub, builder v1, export PDF, AI summary rule-based.
- **Phase 1.1**: Real Google/Meta OAuth when credentials ready (swap mock).
- **Phase 2**: Audience/demographic full, conversion attribution with Lead funnel join, WhatsApp delivery, fatigue detection ML.

---

## 11. Open Decisions
- WhatsApp provider: Twilio vs Meta WhatsApp Cloud API — defer to Phase 2.
- Google Ads API developer token — needs manager account; mock until provided.
- White-label PDF cover: use existing `BrandingConfig.logoUrl` + `appName`.

---

## 12. File Touch List
- `apps/api/prisma/schema.prisma` — new models + extend ReportDefinition/Client
- `apps/api/src/insight/insight.module.ts` — aggregator
- `apps/api/src/insight/datasource/*` — new
- `apps/api/src/insight/reports/*` — new
- `apps/api/src/insight/automation/*` — new
- `apps/api/src/insight/presentation/*` — new
- `apps/web/src/app/(app)/insight/page.tsx` — major extend
- `apps/web/src/app/(app)/insight/_components/*` — new
- `apps/web/src/lib/api.ts` — add helper if needed
- `docs/superpowers/specs/2026-08-29-insight-report-module-design.md` — this file

