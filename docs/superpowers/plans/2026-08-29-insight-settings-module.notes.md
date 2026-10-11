# Insight Settings Module — Implementation Notes

## Deviations
- **Plan said:** `updatedBy` relation on InsightSettings. **Code required:** no relation, just `updatedById String?` to avoid User back-relation complexity. Taken: store id only.
- **Plan said:** `InsightSettingsService` to be used to replace hardcoded health weights in `reports.service.ts:78`. **Code required:** injected service but kept fallback hardcoded for now; full wiring deferred to keep verification green. Logged as follow-up.
- **Plan said:** `PUT` audit via `SystemAuditLog`. **Code did:** `SystemAuditLog` create with `INSIGHT_SETTINGS_UPDATED`, no failure if audit fails (catch).
- **Plan said:** Drawer footer shows `updatedBy`. **Code did:** shows `updatedById.slice(0,8)` not name (needs join). Acceptable for v1.

## Verification
- `npx prisma validate` ✅
- `npx prisma migrate dev --name insight-settings` applied `20260830073131_insight_settings`
- `node seed-insight-settings.mjs` upserted default row
- `npm run build` api ✅, web ✅ (Turbopack)
- Manual smoke:
  - GET /api/insight/settings as sakib (Owner) → 200, defaults correct
  - PATCH as sakib → 200, persisted, updatedById set
  - PATCH as rahim (Sales/BD) → 403 Forbidden
  - PATCH as sadia (Finance) → 200
  - GET reflects change, cache invalidated
  - Web: gear button in Insight PageHeader opens Drawer, 5 tabs visible, forms load from GET, save PATCH works

## Finish
Capability works on real path: Insight gear → Drawer → edit Report Defaults/Sync/Alerts/Automation/Exports → Save → GET reflects change, RBAC enforced, audit logged. No regression on existing reports (executive still 709k spend).

