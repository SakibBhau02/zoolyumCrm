# Insight Settings Module — Plan

## Context
Insight & Report module (Google/Meta multi-account, 10 report types, automation, AI summary) is feature-complete but has **no Settings** — thresholds, intervals, defaults are hardcoded (`reports.service.ts:78` health weights, `sync.service.ts` cron `0 */6 * * *`, `alerts.service.ts` ctrDrop 30%, spendSpike 2×, cplLimit 400, `page.tsx` default 30d). `Control.Settings` JSON (14 keys, `control.service.ts:8`) and `BrandingConfig` are proven singleton patterns. Users need a single place to tune report prefs, sync, alerts, exports, branding without code changes. Goal: **InsightSettings singleton + gear button → Drawer with 5 active sections** (reportDefaults, sync, alerts, automation, exports; branding per-client deferred, permissions guard without UI editor).

## Approach
**Tracer is the whole slice** — one Prisma model, one GET/PATCH API, one Drawer, no split. Reuse proven patterns:

1. **Data model**: New `model InsightSettings` singleton (`id="default"`), JSON columns mapping the 5 sections, checked into `schema.prisma` after `ReportRun` (near `BrandingConfig`). Fields store validated DTO, not free JSON. Seed creates row with `DEFAULT_INSIGHT_SETTINGS`. Cache `insight:settings` 5min (like `control:settings`).
2. **Backend API** (`apps/api/src/insight/settings/`): `InsightSettingsService` (get/update with Zod/class-validator, merge defaults, audit `SystemAuditLog` `INSIGHT_SETTINGS_UPDATED`, invalidate `insight:settings` + `insight:reports:*`), `InsightSettingsController` `GET /insight/settings` (any authenticated) + `PATCH /insight/settings` (`@Roles("Owner","Finance")`, `JwtAuthGuard`+`RolesGuard`), imported into `InsightModule`. `ReportsService`, `SyncService`, `AlertsService`, `AiInsightService` read from settings via service (health weights, intervals) instead of hardcoded constants — injected, with fallback to defaults if no row.
3. **Frontend** (`apps/web/src/app/(app)/insight/page.tsx`): Add gear `Settings` button in `PageHeader` actions (next to Refresh/Export), opens `Drawer` (`ui.tsx:108`) with vertical nav (5 sections). Each section is a form card using `Field/Input/Select` + `FormActions`. On Save → `PATCH /insight/settings` → `mutate` + toast. Ad Accounts section reuses existing `AdAccountService` but adds read-only sync interval display linked to settings. No new route; drawer keeps tab context. `useApi("/insight/settings")` for load.
4. **Branding cut**: Keep global `BrandingConfig` (no per-client upload); settings `branding.template` enum (`executive|minimal`) only, `includeCharts` bool. Export respects `branding.template` when generating PDF header.
5. **Permissions cut**: Backend guard `Owner+Finance` enforced, frontend shows read-only note "Only Owner/Finance can edit" for others, no role matrix editor.

## Key decisions
- **Model B singleton, not Control.Settings namespace** — keeps Insight bounded, mirrors `BrandingConfig` precedent `prisma/schema.prisma:155`, avoids 14→15 key bloat. Rationale: Insight already has 9 dedicated tables; Control blob would leak domain.
- **5 sections, not 7** — `branding.perClientOverrides` and `permissions` editor deferred per YAGNI; both are local changes (add JSON key + UI card) when needed, no abstraction lost. Keeps Drawer scannable.
- **DTO validation with class-validator (already in deps)**, not Zod new dep — ladder rung: reuse `class-validator` already used in `Control` DTOs (`update-branding.dto.ts`).
- **Cache 5min + delPattern on PATCH** — matches `control.service.ts` pattern `CACHE_TTL 300`, prevents stale reports after settings change.
- **No cron-parser dep** — `sync.interval` as enum `6h|1h|24h` mapped to cron strings in service (`6h→0 */6 * * *`), defer full cron expression until user asks. Higher rung (cron-parser lib) would add dep for unproven need.
- **Seed singleton** — `prisma/seed.ts` upserts `InsightSettings` id default, so `GET` never 404.

## Files to modify
- `apps/api/prisma/schema.prisma` — add `model InsightSettings` (+ relation if needed), extend? no, standalone
- `apps/api/prisma/seed.ts` — upsert default row
- `apps/api/src/insight/settings/insight-settings.service.ts` — new, cache + audit + defaults merge
- `apps/api/src/insight/settings/insight-settings.controller.ts` — new, GET/PATCH
- `apps/api/src/insight/settings/dto/update-insight-settings.dto.ts` — new, class-validator
- `apps/api/src/insight/settings/insight-settings.module.ts` — new
- `apps/api/src/insight/insight.module.ts` — import `InsightSettingsModule`
- `apps/api/src/insight/reports/reports.service.ts:78` — replace hardcoded health weights / TAX-like constants with `insightSettingsService.get()` fallback
- `apps/api/src/insight/datasource/sync.service.ts` — read `sync.interval` / `sync.backfillDays` from settings for cron & window
- `apps/api/src/insight/automation/alerts.service.ts` — read `alerts.*` defaults from settings (windowDays, thresholds) as fallback when rule not set
- `apps/web/src/app/(app)/insight/page.tsx` — add gear button, Drawer, 5 section forms, `useApi` settings load, PATCH on save, toast
- `apps/web/src/components/table.tsx:78` — no change (Btn already patched)
- `apps/web/src/lib/api.ts` — no change

## Out of scope
- Per-client logo upload & file storage (deferred, needs `uploads/insight-branding/` + S3) — reason: global `BrandingConfig` suffices for v1, per-client requires file handling + client picker complexity
- Full role matrix editor UI for INSIGHT_SETTINGS — reason: backend guard covers correctness, UI editor is horizontal admin work not needed for tracer
- Export `pageSize/font` picker — reason: `defaultFormat+includeCharts+locale` covers 95% cases, YAGNI
- Real Google/Meta OAuth re-auth flow inside settings — reason: `credentialsEnc` base64 stub still, real token refresh is separate integration task
- Data retention cleanup job — reason: `retentionDays` stored but no `DELETE` cron yet, defer until table >1M rows

## Verification
- `npx prisma format && npx prisma validate` — passes
- `npx prisma migrate dev --name insight-settings` — creates `InsightSettings` table, seed upserts default
- `npm run build --prefix apps/api` — no TS errors, routes `GET /insight/settings`, `PATCH /insight/settings` appear in log
- `npm run build --prefix apps/web` — Insight page compiles, gear button renders, Drawer opens, 5 forms visible
- Manual: login `sakib@zoolyum.com / zoolyum123`, `GET /api/insight/settings` → defaults, `PATCH` as Owner → 200, as Team Member → 403, `GET` reflects change; change `sync.interval` to `1h` → `SyncService` cron reflects; change `alerts.cplLimit` → alert evaluation uses new threshold; export respects `exports.includeCharts`
- Existing: `GET /insight/reports/executive` still returns 709k spend (settings fallback), no regression

## STOP conditions
- If `InsightSettings` singleton conflicts with existing `Settings` id generation (Prisma `cuid` vs hardcoded `"default"`), stop and report — do not auto-choose id strategy
- If `RolesGuard` does not support `Finance` role name (actual role is `"Finance"` vs `"FINANCE"`), stop — verify `seed.ts` role names
- If `Drawer` import path `ui.tsx:108` missing or topbar already has gear, stop and confirm placement

## Implementation notes file
`docs/superpowers/plans/2026-08-29-insight-settings-module.notes.md` — executor appends `## Deviations` per change

## Acceptable finish
Insight gear button opens Drawer, 5 sections load/save via `PATCH /insight/settings`, `Owner/Finance` can edit (others 403), `Reports/Sync/Alerts` read live settings (verified by changing a threshold and re-evaluating), `npm run build` passes both workspaces, no existing report regressed.
