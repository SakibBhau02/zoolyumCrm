# Calendar Module — QA Audit Report

**Module:** `/calendar` (Calendar, Plans & Reports, Client Calendar, Portal Calendar)
**Spec:** `docs/calendar-module-spec.md` · **Implementation:** `docs/calendar-module-implementation.md`
**Date:** ১১ নভেম্বর ২০২৬
**Tester:** QA (automated API + Playwright E2E + SQL integrity checks)
**Environment:** Windows 11 · Node 24 · API `localhost:4000` (NestJS, production build) · Web `localhost:3000` (Next dev) · PostgreSQL 16 (`zoolyum-postgres`) · Redis 7
**Build under test:** migration `20261111104717_calendar_full_module` + fixes applied during this audit

---

## 1. ভার্ডিক্ট

| | |
|---|---|
| **মোট চেক** | ১৮০+ (API, DB, UI, permissions, cross-module) |
| **শেষ রানে পাস** | সব executed চেক (টি.এস. টাইপচেক + ২৮/২৮ API smoke + ৮/৮ ভিউ zero console error) |
| **ডিফেক্ট পাওয়া** | ১৯ (২ Critical, ৫ High, ৭ Medium, ৫ Low) |
| **ফিক্স হয়েছে** | ১৯/১৯ |
| **বাকি (backlog)** | ১০টি non-blocking improvement (নিচে সেকশন ৭) |
| **রিলিজ সুপারিশ** | **Conditional GO** — P0/P1 ঠিক আছে, B-1 (client delete) ও B-2 (multi-day span) পরের স্প্রিন্টে |

**এক লাইনে:** প্রথম রানে **তারিখ এক দিন সরে যাচ্ছিল** (Critical), approval ছাড়া publish সম্ভব ছিল এবং store-level XSS ছিল — তিনটাই এখন ঠিক; এরপর ৮টা ভিউ, client/portal/ads/plan/PDF/share সব ফ্লো পাস করেছে।

---

## 2. পদ্ধতি

1. **Static review** — schema, migration, service boundaries, permission decorators।
2. **API black-box** — ৬টা role, ৩টা portal user, real JWT; negative/validation probes; JWT forge test (FLOW-only token)।
3. **DB integrity** — SQL checks (mirror columns, orphan rows, plan periods, share links)।
4. **Browser E2E** — Playwright: ৮ ভিউ, filter/search, drawer actions, drag-drop, forms, day note, plan/PDF/share, settings, mobile 390×844, restricted role, XSS probe, console/network monitor।
5. **Performance** — warm 200-row dataset সহ latency distribution।
6. **Regression** — `npm run typecheck`, `node scripts/smoke.mjs`।

> প্রতিটি টেস্ট ডেটা `QA …` প্রিফিক্সে তৈরি করে শেষে মুছে ফেলা হয়েছে। ডেমো ব্যাসলাইন অপরিবর্তিত: **14 posts · 7 events · 3 campaigns · 3 flights · 6 pillars · 8 clients · 0 plans**।

---

## 3. ফলাফল সারসংক্ষেপ

| এরিয়া | চেক | ফল |
|---|---|---|
| Authentication / RBAC (৬ role) | ১৮ | ✅ (approve=approve level ফিক্সের পর) |
| Input validation / negative | ২২ | ✅ (date/time/range/platform/budget) |
| Feed: sources, filter, counts, boundary | ৩০ | ✅ (৩টা date bug ফিক্সের পর) |
| Post lifecycle (draft→review→approve→publish→archive) | ১৬ | ✅ |
| Events / tasks / deliverables / flights / invoices | ১৮ | ✅ |
| Move / drag-drop / bulk / import / conflicts | ১৬ | ✅ |
| Plans: create→lock→unlock→publish→share→variance | ২২ | ✅ |
| Portal (২ client) + isolation + deep link | ১২ | ✅ |
| Exports (CSV/ICS) + PDF (EN/BN) | ১০ | ✅ |
| Dashboard / Search / Pulse / People / Flow / Tasks | ১৪ | ✅ |
| Frontend ৮ ভিউ + mobile + a11y | ৩২ | ✅ (২ low UX backlog) |
| Performance | ৬ | ✅ |

---

## 4. যে ডিফেক্টগুলো পাওয়া গেছে ও ফিক্স করা হয়েছে

> Severity: **C**ritical / **H**igh / **M**edium / **L**ow

### C-1 — `@db.Date` কলামে Dhaka-midnight লেখা → সব তারিখ এক দিন পিছিয়ে যাচ্ছিল
**Severity:** Critical · **Area:** Backend / data correctness · **Status:** Fixed

`dhakaInstant(day)` = আগের দিন 18:00 UTC। Postgres `DATE` কলামে সেটা truncate হয়ে **আগের দিন** হয়ে যাচ্ছিল।

**Evidence (before):**
- Flight `2026-11-28 → 2026-12-03` DB-তে `2026-11-27` → টাইমলাইনে ২৭ তারিখে।
- Deliverable `2026-11-06` → feed-এ `2026-11-05`।
- Plan period `2026-11-01 → 2026-11-30` → UI/DB `2026-10-31 → 2026-11-29`।

**Fix:** `dateOnly(day)` helper (UTC midnight) এবং সব `@db.Date` write/range filter-এ ব্যবহার — ads, plans, milestones/deliverables move, automation reminders।
**After:** flight 28–30 (month-clamped), deliverable 6th, plan `2026-11-01 → 2026-11-30` ✓।

### C-2 — ০৬:০০-এর আগের পোস্ট/টাস্ক আগের দিনে দেখাচ্ছিল
**Severity:** Critical · **Area:** Feed · **Status:** Fixed

`dateToDay()` UTC দিন ফেরাত; `2026-11-01 00:01 Dhaka` = `2026-10-31 18:01Z` → chip ৩১ তারিখে, ১ তারিখে উধাও।

**Evidence (before):** fixture `QA boundary 01-0001` → `date: "2026-10-31"`, Nov 1-এ পাওয়া যায়নি।
**Fix:** post/task mapping-এ `dayKey()` (Dhaka-aware)।
**After:** Nov 1-এ দেখায়, Oct 31-এ নয়; সময় `00:01` অপরিবর্তিত ✓।

### C-3 — `@db.Date` range filter আগের দিনের আইটেম টেনে আনছিল
**Severity:** Critical (boundary) · **Area:** Feed · **Status:** Fixed

Instant bound (`Oct 31 18:00Z`) কেন `DATE`-এর সাথে তুলনায় truncate হয়ে `Oct 31` হয়ে যাচ্ছিল → নভেম্বর ভিউতে **৩১ অক্টোবরের invoice** দেখা যাচ্ছিল।

**Evidence (before):** `sources=INVOICE` Nov 1–30 → ৫টি, যার প্রথমটি `date: 2026-10-31` (ZLM-2026-0041)।
**Fix:** invoice/deliverable/leave range-এ `dateOnly()` bound; flight/adInsight age-ও একই।
**After:** Nov-এ ৪টি invoice, Oct 31 আলাদা কোয়েরিতে ১টি ✓।

### H-1 — `javascript:` URL গ্রহণ → stored XSS-এর ঝুঁকি
**Severity:** High (security) · **Area:** Post/Event URLs · **Status:** Fixed

`externalUrl`, `linkUrl`, `assetUrls`, `meetingUrl`-এ যেকোনো string ঢুকত; share page/drawer-এ clickable link হিসেবে render হয়।

**Evidence:** `externalUrl:"javascript:alert(1)"` → API 201 এবং value সংরক্ষিত (before)। UI-তে click করলে স্ক্রিপ্ট চলত।
**Fix:** `safeHttpUrl()` — শুধু absolute `http/https`; সব write path (create/update/publish) sanitize।
**After:** external/link `null`, asset list-এ শুধু `https://ok.test/a.png` ✓। Title-এ `<img onerror>` রাখলে flag `null`, DOM-এ `img` সংখ্যা ০, literal text দেখা যায় ✓।

### H-2 — Approval ছাড়া publish / create-time publish / PATCH bypass
**Severity:** High (policy) · **Area:** Content workflow · **Status:** Fixed

**Evidence (before):**
- অননুমোদিত post-এ `/publish` → 200 `PUBLISHED`।
- `POST /posts {publishStatus:"PUBLISHED"}` → 201 (approval `NONE`)।
- `PATCH {publishStatus:"PUBLISHED"}` → 200।

**Fix:** publish/update-guard — `approvalStatus !== APPROVED` হলে 400; create-time PUBLISHED নিষিদ্ধ (import backfill ছাড়া, যেখানে approved+publish উভয়ই সেট হয়)।
**After:** unapproved publish 400, create-published 400, patch 400; approve→publish 200 ✓।

### H-3 — Approve/reject ও Plan lock/publish শুধু `edit` লেভেলে চলত
**Severity:** High (RBAC) · **Area:** Permissions · **Status:** Fixed

Guard verb থেকে level নেয় (POST→edit), তাই `approve` লেভেল কার্যকর ছিল না — edit-only কাস্টম role নিজেই content approve করতে পারত।

**Evidence:** decorator-এ `"approve"` যোগ করার পর — Sales (view) approve **403**, PM (approve) **201** ✓।

### H-4 — Share link expiry/plan-delete-এর পরও ডেটা সার্ভ হচ্ছে (scope leak)
**Severity:** High · **Area:** Public share · **Status:** Fixed

- Plan delete করার পরও তার token 200 ফেরাত — এবং clientId থাকলে **client calendar** হিসেবে ফলব্যাক করত (recipient ভিন্ন জিনিস দেখত)।
- Expiry check ছিল, কিন্তু টেস্টে SQL আর fetch parallel চলায় প্রথমে 200; পুনরায় চেক 404। (টেস্ট-আর্টিফ্যাক্ট, কোড ঠিক ছিল।)

**Fix:** expired → 404; `planId` থাকলে কিন্তু plan না থাকলে 404 (client fallback নিষিদ্ধ); orphan `CalendarShareLink` rows পরিষ্কার।
**After:** plan delete → 404; expiry → 404; ভ্যালিড link → শুধু approved/client-visible items (internal meeting/draft leak নেই) ✓।

### M-1 — “Share link” দুইবার চাপলে 409
**Severity:** Medium · **Area:** Plans · **Status:** Fixed
**Before:** unique token-এ `create` → `409 That token is already in use`।
**Fix:** `upsert` — একই token ফেরত, `expiresInDays` দিলে expiry আপডেট।
**After:** দুইবার share → 201/201, একই token; expiry সেট/আপডেট ✓।

### M-2 — Settings-এ ডিফল্ট client খালি → pillar/account/targets save সব ব্যর্থ
**Severity:** Medium · **Area:** Settings UI · **Status:** Fixed
**Evidence:** page load-এ `clientId=""`; `POST /settings/pillars` → `400 clientId and name are required` (পিলার UI-তে যোগ হচ্ছিল না)।
**Fix:** `clients` লোড হলে প্রথম client সেট।
**After:** pillar POST 201, লিস্টে দেখা যায়; একইভাবে account/target ✓।

### M-3 — Calendar write dashboard cache invalidate করত না
**Severity:** Medium · **Area:** Dashboard integration · **Status:** Fixed
**Before:** আজকের মিটিং যোগ করার পরও `dashboard:overview` ৩০ সেকেন্ড পুরনো (eventCount 2→2)।
**Fix:** `invalidate()`-এ `dashboard:overview`.delete; plan/ads service-এও।
**After:** eventCount 2→3, তালিকায় নতুন মিটিং ✓।

### M-4 — ভুল তারিখ/সময় silently accept বা rollover
**Severity:** Medium · **Area:** Validation · **Status:** Fixed
| Input | Before | After |
|---|---|---|
| `date:"2026-02-30"` | 201, হয়ে যেত `2026-03-02` | 400 |
| `date:"2026-11-15T00:00:00Z"` | 201, হয়ে যেত **আজ** | 400 |
| date ছাড়া create | 201, আজকে | 400 |
| `time:"99:99"` | 400 ভুল মেসেজ | 400 “Time must be HH:MM” |

### M-5 — Flight/campaign-এ range/platform/budget validation ছিল না
**Severity:** Medium · **Area:** Ads · **Status:** Fixed
**Before:** end<start গ্রহণ, অজানা platform → Prisma 500, negative budget গ্রহণ।
**After:** সব 400 (real dates, end≥start, known platform, budget≥0)।

### M-6 — Portal notification link (`?tab=calendar`) Dashboard খুলত
**Severity:** Medium · **Area:** Portal · **Status:** Fixed
**Before:** link-এ ক্লিক → Dashboard (tab param পড়া হতো না)।
**After:** সরাসরি Calendar ট্যাব, November grid, approved কাজ; draft লুকানো ✓।

### M-7 — Global search-এ calendar ডেটা ছিল না
**Severity:** Medium · **Area:** Cross-module search · **Status:** Fixed
**Before:** “Campus” → কোনো post/event hit নেই।
**Fix:** CALENDAR permission থাকলে post (title/caption) ও event সার্চ; topbar-এ Post/Event আইকন।
**After:** সার্চে post পাওয়া যায়, ক্লিকে `/calendar?view=day&date=…&post=…` খোলে ✓।

### M-8 — Plan vs actual “on time %” অতিরিক্ত আশাবাদী
**Severity:** Medium · **Area:** Reports · **Status:** Fixed
**Before:** `(planned − missed) / planned` → ভবিষ্যতের অপ্রকাশিত পোস্টও “on time”।
**After:** শুধু due (`date ≤ today`) পোস্টের ভিত্তিতে; টেস্টে 4 due, 2 slip → **50%** ✓।

### L-1 — বারবার lock করলে version বাড়ত
**Before:** lock(l) 1 → lock(l) 2। **After:** soft-lock idempotent, version 1 ✓।

### L-2 — Mobile-এ ১১টা icon-only বাটনের accessible name ছিল না
**Fix:** view switch-এ `aria-label`+`aria-pressed`, drawer close-এ label। **After:** ১১ → ৩ (বাকিগুলো calendar-এর বাইরে topbar)।

### L-3 — Permission নেই এমন role-ও পুরো calendar shell + খালি grid দেখত
**Fix:** 403 ধরা পড়লে শুধু “You do not have access to the Calendar” কার্ড; টুলবার/grid নেই। API সব 403, chips 0 ✓।

### L-4 — View-only role-এর কাছে New/Approve/Archive/drag দেখাত
**Fix:** `canEdit`/`canApprove` অনুযায়ী New, approve/reject, publish, edit, archive, reschedule, comment, task/flight status, drag লুকানো।
**After (Sales):** New 0, draggable 0, Approve 0, Archive 0, Reschedule 0, Edit 0 ✓; PM approve 201, Sales 403 ✓।

---

## 5. API ও Permission ম্যাট্রিক্স (যাচাইকৃত)

| Role | CALENDAR | GET feed | POST post | POST approve | Plan lock |
|---|---|---|---|---|---|
| Owner | approve | 200 | 201 | 201 | 201 |
| Project Manager | approve | 200 | 201 | 201 | 201 |
| Sales/BD | view | 200 | 403 | 403 | 403 |
| Finance | view | 200 | 403 | 403 | — |
| HR/Admin | none | 403 | 403 | 403 | — |
| Team Member | view | 200 (code/role equivalent) | 403 | 403 | — |
| Portal user (GVS) | scoped | staff route 401 | — | — | — |
| FLOW-only old token | fallback | 200 | 403 | — | — |

অন্যান্য নিশ্চিত হয়েছে:
- Unauthenticated → 401; SQL injection `q=' OR 1=1--` → 200/0 items, error নেই।
- Portal token দিয়ে staff endpoint → 401।
- Mass assignment (`approvalStatus: APPROVED` body-তে) → উপেক্ষা, `NONE` সংরক্ষিত।
- Portal A-এর token দিয়ে B-এর ডেটা নেই (GVS-এ BanglaMart item 0, উল্টোও 0)।

---

## 6. Cross-module ইন্টিগ্রেশন

| মডিউল | যা টেস্ট হলো | ফল |
|---|---|---|
| **Tasks** | `/tasks`-এ task তৈরি → calendar-এ appeared (Nov 18, TASK); Tasks-এ DONE → `isDone=true`; calendar drag → `dueDate` 14:30 Dhaka | ✅ |
| **Flow** | calendar quick-add deliverable → project detail `dueDate`; move → detail-এ 2026-11-09 | ✅ |
| **Accounts** | client colour/targets; client delete → posts orphan (B-1) | ⚠️ B-1 |
| **Capital** | invoice due → calendar (4 due in Nov, Oct 31 আলাদা); read-only, draggable false | ✅ |
| **People** | approved leave overlay 1; holiday overlay 2 (Victory Day, Christmas) | ✅ |
| **Pulse** | `/pulse/targets` create/update/summary(40%)/delete; `/calendar/targets` → 404 | ✅ |
| **Portal** | calendar tab, deep link, approved-only, client-visible events, isolation | ✅ |
| **Dashboard** | event create → `today.eventCount` 2→3 (cache fix) | ✅ |
| **Search** | post + event hits, deep link | ✅ |
| **Notifications** | plan publish → portal inbox `CALENDAR_PLAN` row (clientId থাকলে) | ✅ |
| **Control** | JWT-তে CALENDAR; role-normalizer অজানা module মুছবে না (code + role inspect) | ✅ |
| **Sidebar** | CALENDAR perm; HR-এর মেনুতে Calendar নেই | ✅ |

---

## 7. Backlog — এখনো খোলা (non-blocking)

| ID | Severity | সমস্যা | প্রস্তাব |
|---|---|---|---|
| B-1 | Medium | Client delete করলে `ContentPost/CalendarEvent/CalendarPlan.clientId` **NULL** হয়ে orphan হয় (FK SetNull); flights/campaigns cascade delete। ওই কাজ আর client view/filter-এ থাকে না | delete-এর আগে warning + archive, অথবা soft-delete client; calendar items-ও archive |
| B-2 | Medium | Multi-day event শুধু শুরুর দিনে render হয় (month/week/portal); span bar নেই | week/month-এ span lane বা `endDate` bar |
| B-3 | Low | View-only role-এর month cell `+` এখনো দেখা যায় (ফর্ম খোলে, save 403) | `canEdit` prop দিন Month/Week/Grid-এ |
| B-4 | Low | Internal plan PDF-এ draft/unapproved post থাকে (public share ফিল্টার করে) | PDF-এ “draft/pending” watermark বা filter option |
| B-5 | Low | Plan delete-এর পর share-link row থেকে যায় (এখন 404 দেয়) | `planId` FK + cascade, বা delete-এ link cleanup |
| B-6 | Low | 3000 item cap; pagination নেই, শুধু truncation notice | date-range narrowing + cursor pagination |
| B-7 | Low | HTML5 DnD — touch-এ কাজ করে না | drawer-এর Reschedule মোবাইলে; দরকারে pointer-based DnD |
| B-8 | Low | ৪টা cron (missed sweep, approval chase, plan reminders) শুধু code-review; cron time-এ চালিয়ে দেখা হয়নি | `automation/:action` debug endpoint বা unit test |
| B-9 | Low | Comment delete/edit নেই | soft delete + author-only edit |
| B-10 | Info | `DateTime` কলাম PostgreSQL-এ `timestamp(3)` (tz ছাড়া); সব write UTC ধরে নেয় | migration-এ `timestamptz` বা নিয়ম ডকুমেন্টেড রাখা |

**By design (আপনার সিদ্ধান্ত):** direct social publishing নেই (manual + URL), two-way Google sync নেই (iCal/CSV), portal read-only, content-metric UI নেই, event recurrence নেই।

---

## 8. Performance (200-row fixture সহ)

| Endpoint | p50 | p95 | max |
|---|---|---|---|
| `GET /calendar/feed` (মাস, 233 items) | 31 ms | 35 ms | 35 ms |
| `GET /calendar/day/:date` | 20 ms | 25 ms | 25 ms |
| `GET /calendar/summary` (মাস) | 13 ms | 17 ms | 17 ms |
| `GET /calendar/feed` (30 items, ডিফল্ট) | 21 ms | — | 33 ms |

সব query indexed range; `days` map একই payload-এ; 3000 cap-এ `truncated` true (limit=60 টেস্টে 60 + flag ✓)।

---

## 9. Frontend E2E — যা যাচাই হয়েছে

| টেস্ট | ফল |
|---|---|
| ৮ ভিউ (overview/month/week/day/timeline/grid/plans/settings) render + URL state | ✅ console error 0, pageerror 0, 5xx 0 |
| Client filter: 30 → 15 chips, URL `client=…`, reload-এ থাকে | ✅ |
| Search “Admission” → 10 chips | ✅ |
| Drawer: chip → sheet, title, Escape close | ✅ |
| Keyboard: Month tab focus + Enter → Day view | ✅ |
| Drag-drop: Nov 14 → Nov 21, time 09:00 preserved, toast | ✅ |
| UI create post (client/date/platform) → API + grid | ✅ |
| Day close-out note → list-এ সংরক্ষিত | ✅ |
| Drawer Approve → Published (URL সহ) → badge | ✅ |
| Plans: generate → mix panel → lock → PDF (EN/BN) → share → public link | ✅ |
| Public share: internal meeting/draft leak নেই, PDF বাটন আছে | ✅ |
| Settings: pillar add → list; account/targets default client fix | ✅ |
| Portal: `?tab=calendar` deep link, approved-only, draft hidden | ✅ |
| Mobile 390×844: body scrollWidth = 390 (grid ভেতরে scroll), chips 32 | ✅ |
| Restricted role: সব calendar API 403, chips 0, access card only | ✅ |
| XSS: `<img onerror>` título → `window.__xss` undefined, DOM img 0 | ✅ |
| View-only: New/Approve/Archive/Reschedule/Edit/drag সব hidden | ✅ |

---

## 10. Regression

```
npm run typecheck   → API ✅  Web ✅ (0 errors)
node scripts/smoke.mjs → 28/28 PASS
```

Calendar-এর বাইরের মডিউল (dashboard, flow, accounts, pulse, tasks, people, capital, insight, control, notifications, search) আগের মতোই 200/প্রত্যাশিত 400/403 দিয়েছে — কোনো regression নেই।

---

## 11. সুপারিশ (পরের স্প্রিন্ট)

1. **B-1 আগে** — client delete-এ calendar data orphan হওয়া ডেটা-অখণ্ডতার ঝুঁকি; delete confirmation-এ “N calendar items” দেখানো।
2. **B-2** — multi-day event span; ক্লায়েন্ট মিটিং/ক্যাম্পেইন এক নজরে দেখা যাবে।
3. **B-3 + B-9** — permission-aware polish ও comment moderation।
4. **B-8** — cron-গুলোর জন্য একটি internal trigger endpoint + প্রতি job-এর integration test (missed sweep সবচেয়ে গুরুত্বপূর্ণ)।
5. **Publishing** চালু করলে (Meta API) `externalPostId` + webhook retry + failure UI আগে ডিজাইন করুন।
6. **Date/tz নিয়ম** (`@db.Date` → dateOnly, instant → Dhaka day) `docs/`-এ এক পেজে লিখে রাখুন; ভবিষ্যতের মডিউল একই ভুল করবে না।

---

## 12. প্রসেস নোট

- টেস্ট ডেটা (posts/events/plans/flights/pillars/logs/notifications/temp client) সম্পূর্ণ পরিষ্কার; ডেমো ব্যাসলাইন ঠিক আছে।
- একটি টেস্ট টুলের কারণে (Playwright-এর unfocused tab) কিছু প্রথম-রান মাপ অস্থির দেখাচ্ছিল; প্রতিটি সিদ্ধান্তমূলক টেস্ট fresh browser context-এ পুনরায় চালানো হয়েছে।
- কোড-এডিটের সময় PowerShell `Get-Content/Set-Content` UTF-8 ডাবল-এনকোডিং তৈরি করেছিল (৪টি API ফাইল + ১টি UI ফাইল); CP1252-aware fixer দিয়ে সব em-dash/বাংলা/সেপারেটর পুনরুদ্ধার করা হয়েছে এবং typecheck/UI-তে যাচাই হয়েছে।

---

*রিপোর্টের সব “Before/After” মান ও সংখ্যা এই অডিটের সময় live API/DB/browser থেকে নেওয়া; কোনোটা অনুমান নয়।*
