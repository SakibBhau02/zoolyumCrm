# Client Portal Module — QA, Security & UX Audit

> **Status:** remediated on 2026-11-10 — see `docs/portal-hardening.md` for the fix log and verification (37/37 API checks, portal + staff browser sweeps, e2e pass).

**Date:** 2026-11-10
**Commit audited:** `1da9b94` (plus uncommitted `apps/web/next-env.d.ts`)
**Scope:** `apps/api/src/portal/*`, `apps/web/src/app/portal-client`, `apps/web/src/app/portal-login`,
`apps/web/src/app/(app)/portal`, `apps/web/src/lib/portal-*.ts`, `apps/web/src/components/portal-charts.tsx`,
Prisma `PortalUser` / `PortalContactAccess` / `ClientComment` / `DeliverableApproval` / `Notification`, and the
`Project` / `Invoice` / `AdInsight` read paths the portal consumes.

**Method:** static review (backend + frontend, line-by-line), contract matching (UI ↔ API ↔ schema), live API probes
(read-mostly, plus a few reversible write probes), Playwright UI sweep at 1440px and 390px (all tabs, modals,
invoice/receipt/report PDF downloads), and `typecheck` + the existing portal e2e spec.

**Not done:** no source changes, no Lighthouse/Core Web Vitals pass, no load test, no penetration test against a
production-like deployment. Test data created during probing (one approval, one notification, two access rows) was
removed and the touched file was restored to `APPROVED`.

---

## 1. Executive summary

The portal has a strong skeleton: a fail-closed, class-level `PortalAuthGuard`, a scope object derived only from the
signed token (never from a query string), ownership checks that return **404** (not 403) across clients, signed
upload URLs, branded invoice/receipt/report PDFs that actually download, and a responsive, visually consistent UI.

The trust-critical seams are still open, and they are concentrated in **authorization consistency** and **what the
API returns**, not in the visual layer:

1. **A staff monitoring endpoint returns every portal user's bcrypt password hash** (plus Telegram link codes).
2. **Permissions are sticky-open in one direction:** setting a contact's module list to `[]` grants **all** modules.
   Several endpoints also leak data for modules that are switched off (billing inside `overview`/`projects`,
   files inside `projects`).
3. **The client "General" thread counter is global across all clients** — one client sees another client's message
   count and last-message time (visually confirmed: "2 messages" next to an empty conversation).
4. **The staff "Reset password" button always fails with 404** because the UI sends `POST` to a `PATCH` route.
5. **Portal sessions cannot be revoked:** a password reset leaves the old 7-day JWT valid; there is no logout/refresh
   endpoint, no `jti`/`tokenVersion` for portal users.

None of these are visible in a happy-path demo. All of them are reproducible on the seeded data (section 8).

### Scorecard

| Dimension | Score | Note |
|---|---|---|
| Security / authorization | 3.5 / 10 | good guard base, but hash leak + module bypass + non-revocable 7-day tokens |
| Data correctness | 5 / 10 | billing/file leaks, thread counter leak, capped dashboard totals, thread truncation |
| API design / validation | 4.5 / 10 | inline body types, no DTOs, invalid enums → 500, over-fetching |
| UI / UX (visual) | 7.5 / 10 | polished, responsive, PDFs work; some mobile table/label issues |
| Accessibility | 6 / 10 | modal focus trap + Escape + labels; tab bar has no tab semantics, small mobile targets |
| Maintainability | 4 / 10 | 2,594-line single client component, duplicated billing card & formatters, dead imports |
| Test coverage | 3 / 10 | one portal e2e spec; no API/authz matrix tests; typecheck clean |
| **Overall** | **4.8 / 10** | solid product shell, unsafe data boundaries |

### Severity distribution

| Severity | Count |
|---|---|
| Critical (P0) | 3 |
| High (P1) | 10 |
| Medium (P2) | 40 |
| Low (P3) | 15 |

---

## 2. Architecture & permission model (as built)

```
Next.js client (localStorage bearer)
  /portal-login ──POST /portal-client/login──► PortalClientService.login (bcrypt, 8 fails / 15 min)
  /portal-client ──Bearer token────────────► PortalAuthGuard
                                                 │ verify JWT (scope === "portal")
                                                 │ PortalAccessService.resolve(sub)   [cached 60 s]
                                                 ▼
                                          PortalScope { clientId, modules[], projectIds, canSeeAdSpend }
                                                 │
        ┌────────────────────────────────────────┼───────────────────────────────────┐
        ▼                                        ▼                                   ▼
  requireModule(WORK/…)                 projectWhere(scope)                 assertProjectOwned()
```

The good parts:

- `PortalClientController` is `@Public()` for the staff guard and `@UseGuards(PortalAuthGuard)` at class level, so a
  newly added route is protected by default; only `login` opts out via `@PortalPublic()`.
- Client identity comes exclusively from the token → DB (`resolve`), not from `clientId` in the request.
- Cross-client access is denied with **404** (`assertProjectId`, `fileForDownload`, `reportDetail`) — verified live.
- Uploads are served through HMAC-signed `/api/flow/uploads/:name` URLs (15 min TTL), not raw paths.
- Portal PDFs (invoice, receipt, project report) are client-side, branded and verified working.

The weaknesses are all in **what is returned** and **which module gates apply** to each returned field.

---

## 3. Critical findings (P0)

### POR-01 · `/portal/users` leaks bcrypt password hashes and Telegram link codes

- `PortalService.users()` returns raw `portalUser` rows — `apps/api/src/portal/portal.service.ts:23-35`.
- `createPortalUser` / `resetPortalPassword` also return the written row including `passwordHash`
  (`portal.service.ts:114-126`, `135-140`).
- Prisma returns every scalar by default; `PortalUser` includes `passwordHash`, `telegramChatId`,
  `telegramLinkCode` (`schema.prisma:2088-2103`).

**Runtime proof**

```
GET /api/portal/users  (staff token)  → 200
rows[0] keys: [ id, clientContactId, userId, passwordHash, lastLoginAt, isActive, createdAt,
               telegramChatId, telegramLinkCode, telegramLinkedAt, clientContact, user ]
hasPasswordHash = true   hasTelegramCode = true
```

The staff page calls this endpoint on load (`apps/web/src/app/(app)/portal/page.tsx:31`), so the hashes are also in
the browser network panel and React Query cache. Any staff role with `PORTAL view` can dump them and crack client
passwords offline. A leaked `telegramLinkCode` can hijack a client's Telegram notifications.

**Fix**

- Replace `include` with an explicit `select` (or Prisma `omit: { passwordHash: true }`). Never return
  `passwordHash` / `telegramChatId` / `telegramLinkCode` from staff APIs.
- Return a dedicated response type for create/reset (`{ id, isActive, createdAt }`), and add a global
  serialization test asserting the string `"$2"` never appears in any `/portal` response.
- Flush the `portal:users` cache after deploying the fix (it may contain the old payload for 30 s).

### POR-02 · An empty module list grants every module

- `PortalAccessService.resolve`:
  `const modules = (access?.modules?.length ? access.modules : [...PORTAL_MODULES])` —
  `apps/api/src/portal/portal-access.service.ts:54`.
- `PortalService.contactAccess` uses the same fallback — `portal.service.ts:307`.
- The admin API accepts `modules: []` (`updateContactAccess`, `portal.service.ts:333-350`).

**Runtime proof** — set a contact to `modules: []` through the staff API, then `GET /portal-client/me`:

```
modules: ["WORK","PERFORMANCE","MESSAGES","FILES","BILLING"]
```

Unchecking every module is the most restrictive action an admin can take; it currently produces the **least**
restrictive account. `canSeeAdSpend` is also `true` by default for any new portal user (`schema.prisma:2118`).

**Fix**

- Distinguish "no access row" (defaults) from "row with empty modules" (deny). Use:
  `access ? access.modules : [...PORTAL_MODULES]`, and treat `[]` as no modules.
- Reject `modules: []` in `updateContactAccess` with a clear 400, **or** store an explicit `denyAll` flag.
- Default `canSeeAdSpend` to `false` (privacy-safe default) and require an explicit opt-in.

### POR-03 · Fallback JWT secret is a known constant; portal tokens are non-revocable

- `JwtModule` secret: `config.get("JWT_SECRET") ?? "dev-secret"` —
  `apps/api/src/portal/portal.module.ts:21` (same pattern in `auth.module.ts:15`).
- Portal token: `{ sub, scope: "portal", clientId, aud: "portal" }`, 7-day expiry, **no `jti`, no `ver`**
  (`portal.module.ts:22`, `portal-client.service.ts:86-91`).
- `PortalAuthGuard` verifies signature + `scope` only (`portal-auth.guard.ts:34-47`). There is no logout or
  revocation path.

**Why it matters**

- A deployment that forgets `JWT_SECRET` falls back to a public string; anyone can forge a portal token for any
  `portalUserId`.
- The `aud` claim is written but never verified (dead control).
- Password reset does **not** end sessions. Runtime proof: reset the password, then call `/portal-client/me` with the
  old token → **200**. A copied token stays valid for 7 days.
- The token lives in `localStorage` (`apps/web/src/app/portal-client/page.tsx:286-293`), so any XSS on the web origin
  is a durable account takeover with no kill switch.

**Fix**

- Fail fast at boot when `JWT_SECRET` is missing/short (`ConfigModule` validation), and use a **separate**
  `PORTAL_JWT_SECRET` so portal and staff tokens can be rotated independently.
- Add `jti` + a revocation check (the staff guard already does this: see `common/guards/jwt-auth.guard.ts`) and a
  `POST /portal-client/logout` that revokes the current token.
- Add `PortalUser.tokenVersion`; bump it on password reset / disable and verify it in `PortalAuthGuard`.
- Verify `aud === "portal"` in the guard; shorten the lifetime to 24 h and add a refresh token, or move to an
  httpOnly, SameSite cookie.

---

## 4. High findings (P1)

### POR-04 · Module permissions are not enforced consistently (billing and files leak)

The `modules` array is checked only at the **tab/service** boundary, not per field group.

**a. `overview` requires `WORK` and always returns billing**

- `overview()` throws unless `WORK` is enabled (`portal-client.service.ts:180`), then queries and returns invoices
  (`242-264`, `427-436`) without a `BILLING` check.

Runtime matrix (contact with only the listed module):

| Contact modules | `GET /overview` | `GET /invoices` | Result |
|---|---|---|---|
| `["BILLING"]` | **403** "no access to the work section" | 200 | dashboard is unusable for a billing-only contact |
| `["WORK"]` | 200 **including billing totals** | 403 | billing data leaks to a non-billing contact |
| `[]` | 200 | 200 | all modules (see POR-02) |

The frontend always shows the Dashboard tab (`page.tsx:785-797`) but has no fallback when `overview` is forbidden, so
a billing-only client lands on a permanent error card whose "Retry" can never succeed.

**b. `/projects` returns billing, risk and internal links**

`projects()` spreads the whole Prisma row (`portal-client.service.ts:591-628`, `...p` at `600`). Runtime keys include:

```
budgetAmount, amount, monthlyRate, spentAmount, totalBilled, paymentStatus,
riskScore, riskDriver, confidenceScore, healthBreakdown, healthStatusOverride,
sourceLeadId, sourceProposalId, team, briefLink, driveLink, researchLink
```

A **WORK-only** contact still received `budgetAmount: "20000"`, `amount: "20000"`, `spentAmount: "0"`,
`paymentStatus: "PAID"`, `totalBilled: "8000"`, `riskScore: 28`, `healthBreakdown: true`. Those are agency-internal
commercial and health fields, not client deliverables.

**c. `/updates/:id` returns the billing snapshot with only `WORK`**

`reportDetail` selects and returns `billing` (`portal-client.service.ts:745-779`, return at `776`) without requiring
`BILLING`. The seeded report had `billing: null`, but any generated report with a non-null snapshot will expose
invoiced/collected/outstanding to a WORK-only contact — including through the PDF.

**d. Files and deliverables are listed without `FILES`**

`projects()` includes `files` and `deliverables` unconditionally (`562-565`), and `projectDetail()` does the same
(`638-641`). A WORK-only contact still receives file names, timestamps, approval statuses and raw `fileUrl`s; only the
download route is gated (`fileForDownload` requires `FILES` → runtime 403). Metadata and filenames are still leaked.

**Fix**

- Return a section-permission envelope from `/me` and build `overview` conditionally:
  `billing` only when `BILLING`, `files` only when `FILES`, `ads` only when `PERFORMANCE && canSeeAdSpend`.
- Make `overview` work without `WORK` (return an empty work section instead of throwing).
- Replace `...p` with an explicit client DTO in both `projects()` and `projectDetail()`; never return risk/health
  internals, source lead/proposal ids, internal links, `spentAmount` or `paymentStatus` unless a commercial module is
  explicitly enabled.
- Add server-side tests that assert every forbidden field is absent, not just that the route returns 403.

### POR-05 · "General" thread counter is global across all clients

- `threads()` groups by `threadKey` without a client filter:
  `where: { threadKey: { in: keys } }` — `portal-client.service.ts:951-956`.
- Project thread keys are unique project ids, so only `"general"` collides — but it collides for **every client**.

**Runtime proof**

| Client | API `threads[0]` | UI |
|---|---|---|
| Green Valley School | `messageCount: 2`, `lastMessageAt: 2026-11-03T11:05:26.427Z` | 2 bubbles |
| BanglaMart | `messageCount: 2`, **same** `lastMessageAt`, `unread: true` | **0 bubbles**, "No messages yet" |

BanglaMart's sidebar advertises "General · 2 messages" while the conversation is empty (evidence:
`qa-evidence/portal-messages-general-leak.png`). This leaks another client's messaging metadata and produces a false
unread state.

**Fix**

```ts
where: {
  threadKey: { in: keys },
  OR: [{ threadKey: "general", clientId: scope.clientId }, { threadKey: { in: projectIds } }],
}
```

Then add a regression test with two clients' general threads.

### POR-06 · Staff "Reset password" always returns 404

- Backend route is `PATCH /portal/users/:id/password` — `portal.controller.ts:42`.
- Staff UI calls it with `method: "POST"` for both create and reset —
  `apps/web/src/app/(app)/portal/page.tsx:130-138`.
- The backend logs show `Cannot POST /api/portal/users/<id>/password` (404); the modal displays it (evidence:
  `qa-evidence/portal-admin-reset-404.png`).

**Fix:** choose PATCH or POST and align both sides; add a Playwright check that resets a password and signs in with it.

### POR-07 · Password reset does not end existing sessions

The same finding as POR-03 from the user-support angle:

- Runtime: `PATCH /portal/users/:id/password` (200) → old portal token still returns `/me` 200.
- There is no logout endpoint and no session list.
- `setPortalAccess(false)` does kill access quickly (scope cache is invalidated and `resolve` rejects inactive users),
  but password reset does not.

**Fix:** `tokenVersion` on `PortalUser` + bump on reset/disable; add logout/revoke-all; optionally show "signed-in
devices" in the portal.

### POR-08 · No DTO validation → invalid input becomes a 500

Controllers type bodies inline (`@Body() body: { ... }`), which is erased at runtime, so the global `ValidationPipe`
has nothing to validate. Reproduced live:

| Request | Expected | Actual |
|---|---|---|
| `GET /portal-client/tasks?status=NOT_A_STATUS` | 400 | **500 Internal server error** |
| `POST /portal-client/files/:id/approval` with `decision: "HACK"` | 400 | **500 Internal server error** |
| `PATCH /portal/users/:id/access` with `isActive: "false"` (string) | 400 | **500 Internal server error** |

**Fix:** add `class-validator` DTOs (enum for `decision`, `TaskStatus`, `PortalModule[]`; `IsBoolean()` for
`isActive`; `MaxLength` for `revisionNotes`/content; `IsIn` for `status`/`due`), and map Prisma validation errors to
400 in a global exception filter.

### POR-09 · Dashboard totals silently cap at 200 invoices / 500 tasks

- `overview()` fetches `take: 200` invoices (`portal-client.service.ts:263`) and `take: 500` tasks (`226`).
- All dashboard billing tiles and `byProject` totals are computed from that truncated list, while the Invoices tab
  fetches the full list (`781-889`).

For a long-tenured client, the dashboard and invoices tab will disagree, and "Paid to date"/"Outstanding" will be
wrong. Runtime seed data is small (6 tasks, 3 invoices), so this is code-level confirmed, not data-reproduced.

**Fix:** compute totals with `aggregate`/`groupBy` in the DB (or paginate and sum), and use separate bounded queries
for "recent" lists. Never derive financial totals from a capped "recent" query.

### POR-10 · Long message threads show the oldest 300 messages and lose the newest

- `messages()` orders `createdAt: "asc"` and takes `300` (`portal-client.service.ts:922-923`).
- There is no pagination or cursor; the UI renders the returned array as-is (`page.tsx:2074-2099`).

Once a thread passes 300 messages, the client never sees any new reply — the worst possible truncation direction.

**Fix:** query `orderBy: desc`, `take: 50`, reverse for display, and add a `before` cursor for "load older". Also add
auto-scroll to the newest message and a periodic refresh (or SSE/WebSocket).

### POR-11 · Login identity is case-sensitive and not unique

- `login()` lowercases the submitted email, then queries `where: { email: normalized }` (exact match) —
  `portal-client.service.ts:52-64`.
- `ClientContact.email` is nullable and **not unique** (`schema.prisma:595-608`); contact writes trim but do not
  lowercase (`accounts.service.ts:691-734`).
- Duplicate emails are allowed; `findFirst` then picks an arbitrary account.

Consequences: a contact saved as `John@Client.com` can never sign in (login looks for `john@client.com`), and two
contacts sharing an email have non-deterministic login. Seed data is all lowercase, so the happy path hides this.

**Fix:** normalize emails on write and read (`lower(trim(email))`), add a partial unique index (email where not null),
and return a clear 409 for duplicates. Consider `mode: "insensitive"` as a safety net.

### POR-12 · Invoice payments show refunds as receipts

- `payments` are mapped without `type` (`portal-client.service.ts:860-879`), although the Prisma payment row has
  `type` (`IN` / `REFUND`).
- The UI renders every payment with a green check and a "Receipt" button (`page.tsx:2462-2481`) and shows a
  "PAID IN FULL" banner based only on `status === "PAID"` (`2411-2415`).

A refunded invoice therefore looks fully paid with an extra receipt, and the balance shown in the table (`amount -
paid`) can disagree with the server's clamped `balance`.

**Fix:** return `type`, render refunds distinctly (negative amount, "Refund" label, no receipt), and use the server's
`balance` field in the table (`page.tsx:1987`) instead of recomputing.

### POR-13 · Staff approvals widget shows the wrong record

- `apps/web/src/app/(app)/portal/page.tsx:476`:

```tsx
file v{a.portalUser.clientContact.name.split(" ")[0]} · {timeAgo(a.decidedAt)}
```

This prints `file vKarim` instead of the file/project name and version. Approvals also don't show the project, the
file, or the revision notes, so the widget is not actionable.

**Fix:** include `projectFile` (fileName/versionNumber) and `project` in `PortalService.approvals()`, then render
`<file> · <project> · v<version>` + decision + note.

---

## 5. Medium findings (P2)

| ID | Area | Finding | Evidence | Fix |
|---|---|---|---|---|
| POR-14 | Portal UI | File name blank when `ProjectFile.fileName` is null; only `fileUrl` exists | Runtime: file row text begins empty; `page.tsx:2362`, model allows null | Fall back to `basename(fileUrl)` server-side and always return a display name |
| POR-15 | Portal UI | Approval action doesn't refresh the open project modal; status badge stays stale | `submitApproval` calls `loadProjects()` but not `loadProjectById` — `page.tsx:819-841` | Re-fetch `openProject` after approval, or patch the local object |
| POR-16 | Portal UI | File-download failure is invisible (error written to `pdfError`, which only renders inside the invoice modal) | `page.tsx:1005` vs render at `2429` | Add a dedicated `fileError`/toast in the project modal |
| POR-17 | Portal UI | Invoice table "Balance" = `amount - paid`; server returns a clamped `balance` | `page.tsx:1987` | Use `inv.balance` |
| POR-18 | Portal UI | Unit-cost deltas have inverted semantics: rising CPC/CPM/CPA are green | Runtime DOM: `+40.0%` CPC, `+34.0%` CPM, `+191.1%` CPA all `text-emerald-600`; `page.tsx:428-448` | Add `invert`/`goodWhenDown` to `MiniMetric` for cost metrics |
| POR-19 | Portal UI | Work tab ignores the API's `q` and `due` filters; caps at 100 with no pagination or "100 of N" | `page.tsx:591-603`, API caps at 100 (`tasks` `475`) | Add search + due chips + cursor pagination (API already supports it) |
| POR-20 | Portal UI | Messages: no auto-scroll, no refresh, no attachment support; opening any thread marks *all* notifications read; retry loads `general` even when another thread is active | `page.tsx:671`, `1042`, `2074-2099` | Auto-scroll, poll/SSE, per-thread read, retry with `activeThread` |
| POR-21 | Branding | Public pages call staff-only `/control/branding` → 401 console error; portal login shows fallback logo/colors, not configured branding | `branding-context.tsx:53-58`; live 401 on `/portal-login` and `/portal` | Use `/portal-client/branding` (or a truly public branding endpoint) on portal routes; skip the staff call when no staff token |
| POR-22 | Web security | No security headers / no `noindex` for portal routes | `apps/web/next.config.ts:1-5`; no `robots.ts` | Add CSP/HSTS/X-Frame-Options/Referrer-Policy, `robots: { index: false }` for `/portal-client` & `/portal-login`, and `robots.txt` disallow |
| POR-23 | Mobile UI | Invoice line-item table is clipped at 390px (Rate/Amount cut, no affordance) | `qa-evidence/portal-invoice-mobile.png` | Stack line items into cards on small screens, or make the table scroll region explicit |
| POR-24 | Report PDF | Section says "Completed this period" but the generator includes **all currently delivered** deliverables, not those completed in the period | `flow.service.ts:1292-1318`; `portal-report-pdf.ts:212` | Filter `completed` by `completedAt` inside the period (or rename the section) |
| POR-25 | Report PDF | Long titles/notes are not wrapped or truncated; they can collide with right-aligned metadata | `portal-report-pdf.ts:231`, `264` | Use `splitTextToSize` for titles and limit to 2 lines |
| POR-26 | Ads | `budgetUsedPct` compares window spend to a monthly budget for 7/90-day windows | `portal-ads.service.ts:358-359` | Only compute for a full-month range, or label it "spend vs monthly budget" |
| POR-27 | Ads | `available:false` reasons (`DISABLED` vs `NO_ACCOUNT`) are ignored; UI always says "No advertising data yet" | `page.tsx:1677-1686` | Map reasons to distinct empty states / hide the tab when ads are off |
| POR-28 | Timezone | Billing month uses local time (`buildBilling`, `119`), ads month uses UTC (`184`); Dhaka month boundaries can disagree | same file | Standardize on one clinic timezone (Asia/Dhaka) or UTC everywhere |
| POR-29 | Telegram | `LINK_CODE_TTL_MS` is reported but never enforced; codes never expire; re-linking a chat leaves the old portal user's `telegramChatId` attached | `telegram.service.ts:5`, `60-74`, `102-115` | Check `telegramLinkedAt`/`updatedAt` TTL on consume; clear the previous owner's chat on re-link |
| POR-30 | Telegram | Message content is inserted into `parse_mode: "HTML"` without escaping; a `<` in a client message fails silently | `telegram.service.ts:130-135` | Escape HTML or use plain text |
| POR-31 | Auth hardening | Login lockout is per email: 8 failures locks the real client out for 15 min (DoS); returns 400 not 429 | `portal-client.service.ts:54-59` | Per email+IP threshold, exponential backoff, 429 + Retry-After, notify on lock |
| POR-32 | Rate limiting | `RateLimitGuard` always trusts `X-Forwarded-For`, even when `TRUST_PROXY` is off | `rate-limit.guard.ts:65-67`; `main.ts` comment says the opposite | Fall back to `req.ip` unless `trust proxy` is enabled |
| POR-33 | Rate limiting | No budgets on message posting, approvals, file downloads | `portal-client.controller.ts` | Add per-portal-user limits (messages 10/min, approvals 20/h, downloads 60/min) |
| POR-34 | Audit | Activity log records only `LOGGED_IN`, `COMMENTED`, `APPROVED_DELIVERABLE`; no invoice/report/file views or downloads, although the seed contains `VIEWED_INVOICE` | `portal-client.service.ts:81-83`, `1008-1015`, `1087-1094` | Log view/download events; surface a client-visible activity feed and an agency audit view |
| POR-35 | Auth UX | No change-password, forgot-password, or email-verification flow; only agency-side reset; 6-char minimum; no email delivery of credentials | `portal-login/page.tsx`; `portal.service.ts:104-141` | Add self-service reset via email token, strength rules, and an invite email |
| POR-36 | Access setup | A contact with a null email can still get a portal user (login impossible); staff UI offers "Create access" for them | `createPortalUser` (`104-127`) doesn't require email | Block creation with a clear message, or require email first |
| POR-37 | Staff UI | Stat cards show fake deltas `+1/+3/+2/0` | `page.tsx:178-181`; visible in `qa-evidence/portal-admin.png` | Remove or compute from real periods |
| POR-38 | Staff UI | "Portal URL: portal.zoolyum.com" is hardcoded and doesn't match the actual `/portal-client` route | `page.tsx:172` | Use `window.location.origin + "/portal-client"` or an env value |
| POR-39 | Staff UI | Create/reset password field is `type="text"` (plaintext) | `page.tsx:570` | `type="password"` + reveal toggle + generator |
| POR-40 | Staff UI | No per-contact access editor (scope/projects/modules/ads) although the API exists; only Preview | `page.tsx` (no calls to `/portal/contacts/:id/access`) | Add an access drawer with module toggles, project scope, ad-spend switch |
| POR-41 | Staff UI | Destructive actions (Disable, Hide all) have no confirmation; errors from `setVisibility`/`toggleAccess` go to `modalError`, which only renders inside the password modal | `page.tsx:49`, `159` | Confirmation dialog + toast/error banner at page level |
| POR-42 | Staff UI | Visibility audit shows a skeleton forever when the list is legitimately empty | `page.tsx:189-190` | Add an empty state |
| POR-43 | Staff UI | Approvals list lacks file/project/notes; comments list is capped at 6 with no search despite "searchable thread" copy | `page.tsx:379`, `471-480` | Add detail + pagination/search |
| POR-44 | Portal UX | No notification centre; notifications only drive a badge, and there is no UI to read them or open a linked thread when already inside the portal | `page.tsx` (only `loadUnread`) | Add a notifications drawer with deep links |
| POR-45 | Portal UX | No central Files tab and no Reports/Updates feed, although both APIs exist (`/files`, `/updates`) | `page.tsx` TABS (`453-460`) | Add tabs, or hide the `FILES` module until it has a surface |
| POR-46 | Portal UX | "Next milestone" can be an overdue milestone without any overdue styling/label | dashboard card `1281-1285`; project cards `1491-1494` | Add "Overdue" state |
| POR-47 | Portal UX | Input validation: revision can be requested with empty notes; repeated approvals create unlimited rows | `page.tsx:2567-2575`; `portal-client.service.ts:1066-1114` | Require notes for revisions; upsert one decision per file/client; show history |
| POR-48 | Privacy | Invoice payload includes up to 3 client contacts (name/email/phone) for every invoice | `portal-client.service.ts:795-800` | Return only the billing name/address the PDF needs |
| POR-49 | Privacy | `/branding` returns invoice numbering format and default payment details/terms to any portal token | `portal-client.service.ts:44-49` | Return only display fields (logo/colours/contact) |
| POR-50 | Login UX | Login page password-reveal button has no `aria-label`/title | `portal-login/page.tsx:106-112` | Add accessible name |
| POR-51 | Login UX | No "forgot password / contact your agency" link | `portal-login/page.tsx` | Add a mailto/support line |
| POR-52 | A11y | Tab bar is a row of buttons with no `role="tablist"`/`aria-selected`; active tab isn't announced | `page.tsx:1092-1113` | Adopt tab semantics and focus management |
| POR-53 | A11y | Mobile tap targets for tabs are ~28px high (below 44px) | same | Increase padding/height on mobile |

---

## 6. Low findings & cleanups (P3)

1. `POST /portal-client/login` returns **201** (Nest default for POST); 200 is conventional for a session.
2. Unused imports in the portal page: `Activity`, `buildInvoicePdf` (`page.tsx:6`, `35`); no lint script exists.
3. `money()` and `formatMoney()` are byte-for-byte duplicates (`page.tsx:416-425`).
4. The dashboard re-implements `BillingProjectCard` inline (`1208-1273`) although the component exists (`361-409`).
5. `page.tsx` is 2,594 lines in one component with ~30 `useState` calls — split into tab components + hooks.
6. `ErrorCard` is redefined inside every render (`1045-1052`).
7. `PortalService.contactAccess` route is `/contacts/:id` but the path param is a **portalUserId**, not a contact id;
   rename to `/users/:id/access` to prevent future mistakes.
8. `preview()` returns 200 with `{ error }` for a failed section; a 5xx or a typed `null` section is clearer.
9. `PortalService.setTaskVisibility` invalidates `dashboard:overview`, but `bulkTaskVisibility` does not.
10. `revisionNotes` has no maximum length; `content` is capped at 5,000.
11. `fileForDownload` doesn't set `Cache-Control: private, no-store`; a downloaded deliverable may be cached by a
    shared proxy.
12. `PortalAuthGuard` writes `request.portalUser` but no handler reads it; dead state.
13. `telegram.createLink` writes a code even when Telegram is not configured (`enabled: false`).
14. `notifyClient` sends sequentially; at 50 contacts this delays the response.
15. `approveDeliverable` creates a new approval row on every click with no idempotency key.

---

## 7. What can be updated / added (product backlog)

These are not defects; they are the highest-leverage improvements for the module.

### 7.1 Portal (client-facing)

| Priority | Update | Why | Effort |
|---|---|---|---|
| High | **Fix module-aware dashboard** (billing-only users get a billing dashboard; hide empty sections) | currently broken for any non-WORK contact | S |
| High | **Central Files tab** with version history, approval status, download audit | `FILES` module exists but has no surface | M |
| High | **Reports/Updates feed** with search + PDF for every report | `/updates` API exists; UI only shows the latest | S |
| High | **Notifications centre** with per-thread deep links and read state | notifications currently only drive a badge | M |
| High | **Self-service password change / forgot password** (email token) | clients are locked out without agency intervention | M |
| High | **Messages 2.0**: auto-scroll, refresh/SSE, attachments, load older, per-thread unread | core collaboration channel feels static | M |
| Medium | **Work tab filters**: search, due (week/overdue), project filter, infinite scroll | API already supports `q`/`due`; UI ignores it | S |
| Medium | **Invoice UX**: status/date filter, statement ZIP, installment schedule, "Pay now" instructions, refund rows | billing is the #1 portal use case | M |
| Medium | **Performance**: week granularity, custom range, platform filter, honest empty states | API already supports granularity/range | S |
| Medium | **Approval flow**: notes required, decision history, per-file comments, undo window | repeated/opaque approvals today | M |
| Medium | **Dashboard "needs attention" block**: overdue invoices, overdue tasks, files awaiting approval | turns a status page into a work queue | S |
| Medium | **Mobile invoice line items as cards**, 44px tap targets, sticky tabs | current table clips | S |
| Medium | **Branded portal login/shell** via public branding endpoint | agency logo/colours currently don't reach the portal | S |
| Low | Bangla/English toggle (portal strings are English-only) | Bangladesh client base | M |
| Low | Telegram notification preferences + connection health | one-channel fit-all today | S |
| Low | Portal analytics for staff (last seen, page views, download log) | helps account managers | M |

### 7.2 Agency (staff-facing portal admin)

| Priority | Update | Why | Effort |
|---|---|---|---|
| High | Per-contact **access editor** (scope, projects, modules, ad-spend toggle) | backend exists, UI doesn't | M |
| High | **Invite flow** (email credentials / magic link) instead of typing passwords | security + onboarding | M |
| High | Approvals **detail + filter** (file, project, notes, client) | current widget is unreadable | S |
| Medium | Real stat deltas for portal users/decisions/comments | fake `+1/+3/+2` undermines trust | S |
| Medium | Portal activity/audit view (logins, downloads, views, messages) | support + compliance | M |
| Medium | Search/filter/pagination for clients, contacts and comments | scales poorly now | M |
| Medium | "Preview as client" should render the **real** portal shell (screenshots), not JSON cards | closer to reality | M |
| Low | Confirmation dialogs + toasts for destructive actions | accidental "Hide all" today | S |

### 7.3 Engineering / maintainability

- Replace inline body types with DTOs (`class-validator`) across both portal controllers.
- Introduce `PortalProjectDto`, `PortalInvoiceDto`, `PortalReportDto` so "what a client can see" is a single,
  testable contract instead of a Prisma spread.
- Split `apps/web/src/app/portal-client/page.tsx` into `portal/dashboard.tsx`, `portal/work.tsx`,
  `portal/performance.tsx`, `portal/projects.tsx`, `portal/invoices.tsx`, `portal/messages.tsx` + `usePortalApi`.
- Extract shared `money`/`formatBDT` and reuse `BillingProjectCard`.
- Add `openapi`/markdown endpoint + permission matrix documentation (see section 9).
- Add a portal seed user with restricted modules to the e2e fixtures (today every contact has all modules, which is
  why the leaks were never caught by CI).

---

## 8. Runtime evidence (2026-11-10)

Environment: dev API `http://localhost:4000/api`, web `http://localhost:3000`, PostgreSQL + Redis running,
seed data (Green Valley School / BanglaMart / Smart Kids Academy). All probes were read-only except a reversible
access-row matrix and one approval that was deleted afterwards.

### 8.1 Authorization / module matrix

| Check | Result |
|---|---|
| No token → `/portal-client/me` | 401 |
| Portal token → `/portal/users` (staff) | 401 "Portal tokens are not valid on staff routes" |
| Bogus token | 401 |
| Cross-client file download | 404 |
| Cross-client report detail | 404 |
| `modules: ["BILLING"]` → `/overview` | **403** |
| `modules: ["BILLING"]` → `/invoices` | 200 |
| `modules: ["WORK"]` → `/overview` | **200 with billing totals** |
| `modules: ["WORK"]` → `/invoices` | 403 |
| `modules: []` → `/me` | **all five modules** |
| `modules: ["WORK"]` → `/projects` files | listed (1 file), download 403 |
| `modules: ["WORK"]` → `/projects` commercial fields | budgetAmount / amount / spentAmount / paymentStatus / totalBilled present |

### 8.2 Functional probes

| Check | Result |
|---|---|
| Portal login (seed) | 201, 268-char token, `exp-iat = 604800` (7 d), `aud: "portal"` |
| Invoice PDF download | `ZLM-2026-0051.pdf`, no failure |
| Receipt PDF download | `ZLM-2026-0051-P1.pdf`, no failure |
| Project report PDF download | `Demo-weekly-update.pdf`, no failure |
| File download (own project) | 200, `application/pdf`, `attachment`, 68 bytes |
| Invalid task status | **500** |
| Invalid approval decision | **500** |
| Revision approval without notes | **201** (accepted) |
| Reset password via staff UI method (`POST`) | **404** |
| Reset password via `PATCH` | 200 (response includes `passwordHash`) |
| Old portal token after reset | **200** (still valid) |
| Uppercase email login | 201 (works because seed email is lowercase) |
| Repeated failed logins from one IP | 429 (`Retry-After: 60`) |
| General thread counts | GVS `2`, BanglaMart `2` — **same timestamp** |
| UI: BanglaMart General | sidebar "2 messages", conversation 0 bubbles |
| UI: all tabs at 1440 / 390 | no horizontal document overflow |
| UI console | only 401 from `/api/control/branding` on public pages |
| `tsc --noEmit` (api + web) | clean |
| `playwright test portal-invoice-download` | **1 passed (4.7 s)** |

Screenshots (committed to `qa-evidence/`):

- `portal-dashboard.png` — desktop dashboard
- `portal-messages-general-leak.png` — "2 messages" vs empty conversation
- `portal-invoice-mobile.png` — clipped line-item table at 390px
- `portal-performance-mobile.png` — unit-cost deltas coloured green while rising
- `portal-admin.png` — staff portal shell (fake deltas, hardcoded URL)
- `portal-admin-reset-404.png` — reset modal error from the POST/PATCH mismatch

---

## 9. Test coverage gaps & recommended suite

Current state:

- API: no unit/integration tests for portal; `typecheck` is the only automated API check.
- E2E: one spec (`portal-invoice-download.spec.ts`) that logs in with seeded credentials and downloads one invoice.
- CI: `typecheck` + `build` + smoke + all e2e; no lint, no portal matrix.

Recommended (cheapest first):

1. **Authorization matrix test** (node/supertest): for each module combination, assert route status **and** forbidden
   field absence (`passwordHash`, `billing`, `files`, `riskScore`, `budgetAmount`…).
2. **Cross-tenant test**: two clients, two portal users; every id route (`project`, `file`, `report`, `thread`) must
   return 404 for the other client.
3. **Validation test**: invalid `status`, `decision`, `isActive` → 400 (not 500).
4. **Session test**: reset password / disable user → old token 401; logout → token 401.
5. **Thread isolation test**: two clients post in `general`; each sees only its own count and messages.
6. **Data consistency test**: dashboard totals equal invoices-tab totals for a fixture with >200 invoices and >500
   tasks (catches POR-09).
7. **E2E**: restricted-module contact (BILLING-only and WORK-only), mobile 390 invoice modal, messages empty/unread,
   approval flow, file download, brand logo on login.
8. **CI**: add `npm run test:portal` and a lint step; seed a restricted contact so module regressions fail CI.

---

## 10. Roadmap

**0–2 days (do first, small diffs)**

1. POR-01 `select`/`omit` on `/portal/users` + create/reset responses.
2. POR-02 empty-module semantics (deny) + default `canSeeAdSpend: false`.
3. POR-06 PATCH/POST alignment for staff reset.
4. POR-03/POR-07 `JWT_SECRET` fail-fast + `tokenVersion`/logout.
5. POR-05 general-thread client filter.
6. POR-08 DTOs for the three write endpoints (decision, status, isActive).
7. POR-13 "file v<name>", POR-37 fake deltas, POR-38 hardcoded URL.
8. POR-09 capped aggregates (DB totals).
9. POR-17 `inv.balance`, POR-18 delta semantics, POR-14 file display name.

**Week 1 (security & data contract)**

- Module-aware `overview` + explicit DTOs for projects/reports/files (POR-04, POR-08).
- Message pagination + newest-first (POR-10).
- Email normalization + unique index (POR-11).
- Refund handling (POR-12).
- Public branding endpoint for portal pages (POR-21).
- `noindex` + web security headers (POR-22).
- Portal authz matrix + cross-tenant tests in CI.

**Week 2–3 (product)**

- Files tab, Reports/Updates feed, Notifications centre, self-service password reset (POR-35/44/45).
- Work search/due filters/pagination (POR-19).
- Messages auto-scroll/refresh/attachments (POR-20).
- Access editor in staff portal (POR-40).
- Mobile invoice cards, tap targets, tab semantics (POR-23/52/53).
- Branded login + Bangla toggle (backlog).

---

## 11. Appendix — files reviewed

**API**

- `apps/api/src/portal/portal.module.ts`
- `portal.controller.ts`
- `portal-client.controller.ts`
- `portal-auth.guard.ts`
- `portal-access.service.ts`
- `portal-ctx.decorator.ts`
- `portal.service.ts`
- `portal-client.service.ts`
- `portal-ads.service.ts`
- `telegram.service.ts`
- `apps/api/src/common/decorators/portal-public.decorator.ts`
- `apps/api/src/common/guards/{jwt-auth,rate-limit,permissions}.guard.ts`
- `apps/api/src/common/file-storage.ts`, `signed-url.ts`
- `apps/api/src/cache/cache.service.ts`
- `apps/api/src/flow/flow.controller.ts` (upload route), `flow.service.ts` (report billing)
- `apps/api/prisma/schema.prisma` (Portal*, ClientContact, ClientComment, DeliverableApproval, ProjectFile,
  ProjectReport, Notification, BrandingConfig)

**Web**

- `apps/web/src/app/portal-client/page.tsx` (2,594 lines)
- `apps/web/src/app/portal-login/page.tsx`
- `apps/web/src/app/(app)/portal/page.tsx`
- `apps/web/src/components/portal-charts.tsx`
- `apps/web/src/lib/portal-report-pdf.ts`
- `apps/web/src/lib/branding-context.tsx`
- `apps/web/src/app/layout.tsx`, `apps/web/next.config.ts`
- `apps/web/e2e/portal-invoice-download.spec.ts`
- `apps/web/playwright.config.ts`

**Docs**

- `docs/client-portal-billing-reports.md`
- `docs/qa-flow-audit.md` (format reference)
