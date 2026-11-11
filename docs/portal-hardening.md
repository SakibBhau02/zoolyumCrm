# Client Portal — Hardening & Remediation Log

**Date:** 2026-11-10
**Based on:** `docs/qa-portal-audit.md`
**Migration:** `20261110120000_portal_hardening`
**Verification:** 37/37 live API checks, portal + staff Playwright sweeps, `npm run test:portal` (16/16), existing portal e2e (1 passed), `tsc --noEmit` clean (api + web).

---

## 1. What changed (by audit id)

### Session & authorization

| ID | Status | Change |
|---|---|---|
| POR-01 | ✅ Fixed | `GET /portal/users`, create and reset responses now use explicit `select` — no `passwordHash`, `telegramChatId` or `telegramLinkCode`. Cache key bumped to `portal:users:v2`. |
| POR-02 | ✅ Fixed | An explicit access row with `modules: []` now denies every module (`access ? access.modules : all`). Schema defaults changed to `modules = []`, `canSeeAdSpend = false`. |
| POR-03 | ✅ Fixed | `JWT_SECRET` is mandatory at boot in production for auth/portal/notifications; portal tokens carry `jti` + `ver` and are checked against `PortalUser.tokenVersion`. `aud === "portal"` verified. |
| POR-04 | ✅ Fixed | `overview` no longer requires `WORK`; billing/files/ads sections are permission-gated. `projects`/`projectDetail` return explicit client DTOs (no risk, budget, spend, payment status, source ids or internal links); files/deliverables only with `FILES`; `reportDetail` only returns `billing` with `BILLING`. Dashboard hides sections it cannot show. |
| POR-05 | ✅ Fixed | `threads` filters the `general` thread by `clientId`; per-client counts and last-message times verified. |
| POR-06 | ✅ Fixed | Staff reset now sends `PATCH`; live browser test shows 200 + modal closes. |
| POR-07 | ✅ Fixed | Password reset/disable bumps `tokenVersion` (all older tokens 401); `POST /portal-client/logout` revokes the current `jti`. |
| POR-11 | ✅ Fixed | Contact emails are lower-cased on write, enforced unique (`ClientContact_email_key`), login matches case-insensitively, Prisma `P2002` maps to 409. |

### Data correctness

| ID | Status | Change |
|---|---|---|
| POR-08 | ✅ Fixed | DTOs (`class-validator`) for login, password change, portal users, access, messaging, approvals, task query, notifications, ads. Invalid status/decision/boolean → 400. |
| POR-09 | ✅ Fixed | Dashboard task stats use `groupBy`/`count` (no 500-row cap); invoices are no longer capped at 200 for totals. Recent lists remain bounded. |
| POR-10 | ✅ Fixed | Messages return the newest 50 (`desc` then reversed), support `before` + `limit` for older pages, and the UI adds "Load older". New replies can no longer disappear. |
| POR-12 | ✅ Fixed | Payments expose `type`; refunds render as negative/amber, have no receipt button, and the PAID banner requires balance ≤ 0. Table uses server `balance`. |
| POR-13 | ✅ Fixed | `/portal/approvals` includes file + project + version + notes; staff widget displays them instead of `file v<name>`. |
| POR-24 | ✅ Fixed | Report generator only lists deliverables whose `completedAt` falls inside the report period. |
| POR-28 | ✅ Fixed | Billing month boundaries use UTC, matching ads. |

### Files, messaging, Telegram

| ID | Status | Change |
|---|---|---|
| POR-14 | ✅ Fixed | Server returns a display `fileName` (falls back to the stored URL basename); live file row shows `gvs-script-v2.pdf`. |
| POR-16 | ✅ Fixed | File download errors render in the project/Files UI, not inside the invoice modal. |
| POR-17 | ✅ Fixed | Invoice table uses server `balance`. |
| POR-18 | ✅ Fixed | CPC/CPM/CPA deltas are inverted (cost up = red); verified DOM classes. |
| POR-19 | ✅ Fixed | Work tab: search, due-date chips, 50-row pages, "Load more", server count. |
| POR-20 | ✅ Fixed | Messages auto-scroll, 30s silent refresh while the tab is visible, older-page merge, attachment links, retry uses the active thread. |
| POR-29 | ✅ Fixed | Telegram link codes expire after 15 min, are single-use, and re-linking a chat detaches the previous portal account. |
| POR-30 | ✅ Fixed | Telegram HTML content is escaped. |
| POR-31 | ✅ Fixed | Login brute-force counters are per email+IP (8) and per email (30), return **429**, and no longer let one host lock a known client out. |
| POR-32 | ✅ Fixed | Rate limiter only trusts `X-Forwarded-For` when `TRUST_PROXY` is enabled. |
| POR-33 | ✅ Fixed | Per-portal-user budgets on message posting, approvals, downloads and password change. |
| POR-34 | ✅ Fixed (partial) | `FILE_DOWNLOADED` and `VIEWED_REPORT` activity actions; enum added. Invoice-view logging is still not emitted (no per-invoice endpoint). |
| POR-47 | ✅ Fixed | Revision requests require notes; one approval row per file/contact (unique + upsert); `approvedAt` set on approval. |

### Portal UI

| ID | Status | Change |
|---|---|---|
| POR-21 | ✅ Fixed | New public `GET /control/branding/public`; `BrandingProvider` uses it for anonymous/portal pages, full branding for staff. No more 401 on login/portal load. |
| POR-22 | ✅ Fixed | Web security headers (nosniff, frame deny, referrer, permissions, COOP), `X-Robots-Tag: noindex` on portal routes, `robots.ts`. |
| POR-23 | ✅ Fixed | Invoice line items render as cards below `sm`; mobile table hidden. Verified at 390px (scrollWidth 390). |
| POR-35 | ✅ Partial | Self-service change-password endpoint + portal modal (rotates `tokenVersion`, keeps current tab signed in). Password minimum 8. Forgot-password still routes the client to the agency (no email-token flow yet). |
| POR-36 | ✅ Fixed | Portal access cannot be created for a contact without an email; UI disables the button. |
| POR-44 | ✅ Fixed | Notification bell + popover (50 latest, read state, deep links, Escape/outside-click close). |
| POR-45 | ✅ Fixed | New **Files** and **Updates** tabs (global file list, all reports with PDF). |
| POR-46 | ✅ Fixed | Next-milestone shows an "Overdue" state. |
| POR-50/51/52/53 | ✅ Fixed | Login reveal button has aria-label; "forgot password" contact link; tablist/tab/aria-selected semantics; mobile tab height 44px. |

### Staff portal

| ID | Status | Change |
|---|---|---|
| POR-37 | ✅ Fixed | Fake `+1/+3/+2` stat deltas removed. |
| POR-38 | ✅ Fixed | Portal URL computed from `window.location.origin + /portal-client`. |
| POR-39 | ✅ Fixed | Password fields are `type=password` with reveal toggle; minimum 8. |
| POR-40 | ✅ Fixed | Per-contact **Access** editor: modules, project scope (all/custom), project checklist, ad-spend toggle. |
| POR-41 | ✅ Fixed | Confirmation dialogs for disable and hide-all; page-level error banner instead of errors hidden in the password modal. |
| POR-42 | ✅ Fixed | Visibility audit shows an empty state instead of a permanent skeleton. |
| POR-43 | ✅ Fixed | Approvals show file/project/version/notes; comment search box. |

### Cleanups

- Login returns 200 (`@HttpCode(200)`); unused `Activity`/`buildInvoicePdf` imports removed; duplicate `formatMoney` removed; dashboard reuses `BillingProjectCard`.
- Cache invalidation now clears comments variants and both approval cache versions; bulk visibility invalidates the dashboard cache.
- File downloads send `Cache-Control: private, no-store`; file/report views are audited.
- Telegram fan-out is parallel; link creation returns disabled without writing a stale code.
- Ads `budgetUsedPct` only exists for a full calendar month.

---

## 2. Behaviour changes to be aware of

1. **Advertising spend is opt-in for new portal contacts.** Creating portal access now writes an access row with ad spend hidden; legacy contacts without a row keep their previous visibility. Enable it per contact in the staff **Access** editor.
2. **Empty module list locks the contact out.** This is intentional; the Access editor warns about it.
3. **Portal sessions are revocable.** Password reset, disable and self-service password change invalidate all older tokens; clients must sign in again on other devices.
4. **Portal passwords now require 8 characters.** Existing shorter passwords still work until changed.
5. **Staff reset uses PATCH.** Any external script calling POST must be updated.
6. **Contact emails are unique and stored lower-case.** Duplicate emails now return 409.

---

## 3. Verification run

**API matrix — 37/37 passed**, including:

- no hash/link-code in staff payload; public branding 200
- token has `jti` + `ver` + `aud`
- WORK-only: billing hidden; no risk/budget fields; no files
- BILLING-only: overview + invoices 200, projects 403
- `modules: []` → `/me` modules empty and overview safe
- invalid task status/approval/boolean → 400
- revision without notes → 400
- file download 200 + `no-store` + `FILE_DOWNLOADED`
- general thread isolated (GVS 2 / BanglaMart 0)
- password reset, logout, password change all revoke the old token
- approvals payload includes file/project
- ads 30-day `budgetUsedPct` null

**Browser**

- Portal login/dashboard/work/files/updates/performance/invoices/messages at 1440 and 390: no page errors, no failed requests, no console errors.
- Billing-only contact: tabs = Dashboard + Invoices; billing hero visible; projects hidden.
- No-module contact: Dashboard only.
- Mobile invoice: 1 card row, desktop table hidden, no horizontal overflow.
- Staff portal: no fake deltas, dynamic URL, access editor opens, reset returns PATCH 200, demo confirm fires, approvals readable.

**Tooling**

- `npm run typecheck --prefix apps/api` ✅
- `npm run typecheck --prefix apps/web` ✅
- `npx playwright test portal-invoice-download` ✅ (5.3s)
- `npm run test:portal` ✅ (16/16)
- `npm run test:smoke` ✅ (28/28)

---

## 4. Remaining optional work

These are enhancements, not defects:

- Email-token "forgot password" flow (currently contact-your-agency).
- Real-time messages (SSE/WebSocket) instead of 30s polling.
- Per-invoice "viewed" audit event (needs a single-invoice endpoint).
- Split `portal-client/page.tsx` into tab components; add lint + portal API tests to CI.
- CSP for the web app (headers currently cover the non-CSP protections).
