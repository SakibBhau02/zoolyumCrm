# Control Module — QA Report

> Date: 2026-11-05
> Scope: `/control` — every tab, settings sub-tab, data surface, guard and destructive flow.
> Method: API integration tests (50 checks) + browser UI smoke/interaction tests + rollback-safe destructive test.

## 1. Coverage

| Area | What was tested |
|---|---|
| Settings | All 18 sections render; every section saved via API and re-read; UI save on Company Profile / Appearance |
| Security policy | Password rules, clamp of bad numeric values, lockout (3 failures → 1 min lock), restore |
| Email/SMTP | host/port/from saved, password stored flag, clear password |
| System | maintenance mode enforcement (non-owner write 503, reads 200, owner write 200), feature flags merge |
| Users | search, role/status filters, add modal, create, duplicate email, invalid email, weak password, role change, deactivate (token revoked), reset (one-time password + old token revoked), self/last-owner protection, delete, empty filter state |
| Roles | create, duplicate name rejection, update permissions, delete empty role, delete assigned role rejected, Owner immutable, Owner edit/save from UI |
| Integrations | create with encrypted credentials (no plaintext/leak), test, connect/disconnect, delete, credential editor modal |
| Audit | filters (action / entity / q / date), pagination, actor names, CSV export (1000-row cap) |
| Data | export JSON (217 KB), backup counts, danger-zone typed confirmation, CSV export |
| WhatsApp | config load/save, test connection (mock), test send (mock), logs, template toggle, simulate, sweep |
| Telegram | config load/save, test connection graceful without token, test-send validation, link-code (valid + missing target), links, logs, webhook info |
| Branding | read, update, upload PNG (multipart), public serve 200, invalid URL rejected, restore |
| RBAC | finance blocked from admin endpoints; CONTROL-view role allowed; destructive routes Owner-only; CONTROL cannot assign/modify Owner |
| Health | DB latency, cache mode, uptime, memory, uploads, counts |
| Navigation/UI | all 7 top tabs + all 18 settings sub-tabs, console errors, modals, toasts |

Automated suites:

- `node scripts/qa-control.mjs` → **45/45 pass**
- `node scripts/qa-control-2.mjs` → **5/5 pass**
- `node scripts/qa-delete-all-rollback.mjs` → **rollback-safe pass** (uses the exact production SQL, forces rollback, verifies business tables empty + users/roles/settings/audit preserved)

## 2. Bugs found & fixed

### B1 — Role permission normalization dropped edit-only permissions (fixed)
Sending `{ edit: true }` without `view` silently produced `{ edit: false }`. Now edit/approve imply view.

### B2 — Editing the Owner role always failed (fixed)
The UI always sent `modulePermissions`, which the API correctly rejects for Owner. The form now sends only `name`/`description` for Owner.

### B3 — Privilege escalation: CONTROL admin could manage Owners (fixed)
A CONTROL admin could create a user with the Owner role, deactivate/modify an Owner, or reset an Owner password. Added checks: only an Owner may assign the Owner role or modify/reset an Owner account.

### B4 — “Delete All Data” left records behind / could fail on FKs (fixed)
The old ordered delete list:
- never removed journal entries/lines → financial statements survived a wipe;
- never removed punch logs → employee deletion could fail with a fingerprint device;
- deleted projects/clients before budgets, calendar events, content posts and expenses that reference them → FK errors;
- missed credit notes / manual income → payment/client deletion could fail.

Replaced with one `TRUNCATE ... RESTART IDENTITY CASCADE` covering all business roots, with `User.employeeId` detached first and `Employee` deleted afterwards so staff accounts, roles, settings and the audit trail survive. Verified via rollback transaction with inside checks.

### B5 — Audit CSV silently capped at 200 rows (fixed)
Frontend requested 1000; the service capped at 200. Cap is now 1000.

### B6 — Blank Users/Roles screens when a filter matched nothing (fixed)
Added proper empty states.

## 3. Not executed on live data (by design)

- `POST /control/delete-all` was **not** run against the working database. Instead the exact SQL was executed inside a transaction with in-transaction assertions and forced rollback.
- IP allowlist was not enabled on the live instance (would lock out the current IP). Code path is exercised by unit-level reading; documented as an operational risk.
- 2FA/TOTP and real external provider probes are out of scope (documented in `control-admin-production-audit.md`).

## 4. Environment notes

- The delete-all SQL is PostgreSQL-specific (`TRUNCATE ... CASCADE`), matching the project database.
- It takes ACCESS EXCLUSIVE locks; run it when no other writes are in flight.
- QA left no test users/roles/integrations/stages/settings behind; branding, email password, security policy and maintenance mode were restored.

## 5. Reproduce

```bash
node scripts/qa-control.mjs
node scripts/qa-control-2.mjs
# from repo root with DATABASE_URL loaded:
node scripts/qa-delete-all-rollback.mjs
```
