# Control (Admin Panel) — Production Readiness Audit

> Scope: `apps/api/src/control/*`, `apps/api/src/users/*`, `apps/api/src/common/guards/*`, `apps/web/src/app/(app)/control/*`
> Audit date: 2026-11-05 · Status: **Phases 1–3 implemented & verified**

## 1. Current state (after this pass)

| Area | Before | After |
|---|---|---|
| Overview | none | Live admin strip: API status, users, roles, integrations, audit count, maintenance |
| Settings | 14 JSON sections, unvalidated | 17 sections incl. Security, Email/SMTP, System; whitelisted + validated |
| Users | create/edit/reset/delete | + search, role & status filters, last login, audited changes, one-time temp passwords |
| Roles | read-only | Full CRUD + permission matrix (Owner-only mutations) |
| Integrations | connect toggle | Credentials (AES-256-GCM), test, add/remove, masked listing |
| Audit log | latest 50 | Filters (q/action/entity/date), pagination, actor names, CSV export |
| Security | none | Password policy, session hours, lockout, IP allowlist |
| System | none | Health panel, maintenance mode (enforced), feature flags, audit retention |
| Data | JSON export + wipe | Backup summary, export audit, danger zone with typed confirmation |

## 2. Implemented changes

### Phase 1 — Security foundation ✅
- `User.tokenVersion` + `lastLoginIp`; `Settings.adminConfig` (migration `20261105160000_control_admin_security`).
- `JwtAuthGuard` now verifies account is active and the token version matches → password reset, role change or deactivation kills old sessions instantly.
- `@Roles("Owner","CONTROL")` on every admin route; destructive routes Owner-only. Branding GET and settings GET stay readable (settings sanitised for non-admins). A role with `CONTROL → View` in its permission matrix also qualifies, matching the sidebar.
- `AdminPolicyGuard`: enforces IP allowlist and maintenance mode (writes blocked for non-Owner, reads continue).
- Password policy enforced on create/reset/change; reset generates a one-time random password (no more `password123`).
- Last-Owner and self-protection guards (cannot deactivate/delete/demote the final Owner or yourself).
- Integration credentials encrypted with AES-256-GCM and never returned; list exposes only field names + `hasCredentials`.
- Login lockout after N failed attempts (policy-driven, in-memory).
- Admin audit trail written for every mutation (actor, before/after, entity).

### Phase 2 — Admin features ✅
- Roles CRUD with permission matrix editor; Owner role immutable.
- Users tab: search, role filter, status filter, last-login column, audited role/status changes.
- Audit tab: query filters, server pagination, actor names, CSV export.
- Integrations: credentials editor, credential validation test, add/remove.
- Security settings section (password/session/lockout/IP).
- Email/SMTP settings section (password stored encrypted, `hasSmtpPassword` flag).

### Phase 3 — Operations ✅
- `GET /control/health`: DB latency, Redis/memory cache, uptime, RSS, uploads size, record counts, last audit, maintenance state.
- System settings: maintenance mode (enforced by guard), feature flags, audit retention.
- Settings whitelist + validation; unknown payloads can no longer 500 Prisma.
- Admin overview strip + backup summary.
- Audit trail deliberately survives “delete all data”.
- Audit retention is enforced by a daily 03:00 cron (`pruneAuditLogs`).
- Control page renders an “Admin access required” state for roles without `CONTROL → View`; the API returns 403 at the same time.

## 3. Verification evidence

- `tsc --noEmit` clean for `apps/api` and `apps/web`.
- RBAC: Finance user → `GET /control/settings` returns 403.
- Session revocation: deactivated user’s existing token → 401.
- Last-owner guard: self-deactivate/self-delete → 400 with clear message.
- Maintenance: Finance write → 503, Finance read → 200, Owner write → 200.
- Roles CRUD + settings patch produce audit rows with actor names.
- Health endpoint returns DB/Redis/counts/storage.
- UI smoke test: overview strip, Security/Email/System sections, Roles “New role” modal + permission matrix, Data audit filters, Integrations Configure/Test.

## 4. Remaining (recommended next)

- 2FA/TOTP for Owner accounts.
- Real provider probes in integration “Test” (currently validates stored config).
- SMTP send test using the saved host/credentials.
- Enforce feature flags in the modules they name (currently stored + displayed).
- Move login lockout counters to Redis for multi-instance deployments.
- Scheduled backups + restore flow.
