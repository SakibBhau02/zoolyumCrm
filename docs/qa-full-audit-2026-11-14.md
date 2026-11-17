# Zoolyum OS — পূর্ণ QA অডিট রিপোর্ট

**তারিখ:** ১৪ নভেম্বর ২০২৬
**স্কোপ:** `E:\open code\zoolyumCrm` — ১২টি মডিউল, ৩২ controller / ~৬০০ route, ১৪১ Prisma model, ৬৫ migration
**স্ট্যাটাস:** 🔧 **সব P0/P1 এবং প্রায় সব P2/P3 ফিক্স করা হয়েছে** — দেখুন `docs/qa-fix-report-2026-11-14.md` ও `qa-evidence/audit-2026-11-14/fix-log.md`
**পদ্ধতি:** qa-skills (qa-project-context → risk-based → functional/API/DB, security, performance, accessibility, UI/UX) — লাইভ সার্ভারে সত্যিকারের রিকোয়েস্ট, স্ক্রিনশট ও SQL; কোড read-only
**পরিবেশ:** API :4000 (dev), Web :3000 (dev), PostgreSQL 16 (docker :5544), Redis :6380

---

## ১. এক নজরে ফলাফল (Scorecard)

| ক্ষেত্র | মার্ক | সংক্ষেপে |
|---|---:|---|
| কার্যকারিতা (API + CRUD) | **9.0 / 10** | ৭৪৭টা রিকোয়েস্টে **০টা 5xx**, ৮/৮ entity CRUD সম্পূর্ণ, সব update persist করেছে |
| ফিনান্স / হিসাব নির্ভুলতা | **8.5 / 10** | ১৪/১৪ ledger invariant পাস, ১২/১২ invoice মিলেছে; ড্যাশবোর্ড KPI কয়েকটা ভুল |
| সিকিউরিটি | **7.0 / 10** | বেসলাইন শক্ত (২৬/২৬ unauth → 401, ৫/৫ JWT forgery → 401), কিন্তু ১টা High authz bypass + dependency CVE |
| পারফরম্যান্স | **7.5 / 10** | খালি DB-তে সব দ্রুত; কিন্তু ২টা "scale-এ ভাঙবে" structural দুর্বলতা |
| UI / UX | **7.5 / 10** | ডিজাইন পরিপক্ব, ডার্ক মোড/empty state/মোবাইল ভালো; login-এ ১টা blocker |
| অ্যাক্সেসিবিলিটি (WCAG 2.2 AA) | **4.5 / 10** | ৩২১টা axe node, contrast ১৮৩, tap-target ৬৭, nested-interactive ৫০ |
| কোড / CI / অপারেশন | **7.0 / 10** | typecheck+build+CI+backup আছে; unit test **শূন্য**, ৮২% client component |
| **সামগ্রিক** | **7.5 / 10 (B)** | **ডেমো/ইন্টারনাল ব্যবহারে প্রস্তুত; পাবলিক প্রোডাকশনের আগে নিচের ৬টা ফিক্স বাধ্যতামূলক** |

### কথায়
এটা একটা "ভালো বানানো CRM" — ফিচার বিস্তার, ফিনান্স মডেল, RBAC, CI সবই আছে এবং ভাঙা endpoint প্রায় নেই। সমস্যাগুলো **ভাঙা ফিচার নয়, বরং ভুল হিসাব, ঢিলা authorization, scale-এ perf আর accessibility**। অর্থাৎ ভিত্তি মজবুত, ফিনিশিং বাকি।

---

## ২. যা পরীক্ষা করা হয়েছে (সংখ্যায়)

| পরীক্ষা | ফল |
|---|---|
| `npm run typecheck` (api + web) | ✅ পাস |
| `npm run test:smoke` (live API + RBAC gate) | ✅ **28/28** |
| `npm run test:finance` (ledger invariants) | ✅ **14/14** |
| Playwright E2E (৯ spec) | ✅ **16/16** (একা চালালে ৪৩.৬s) |
| GET route sweep — ২৫৯ route × ৩ role | **৭৪৭ call, ০× 5xx** |
| CRUD lifecycle — ৮ entity × ৬ step | **৪৮/৪৮** |
| DTO/validation negative test — ৪২ case | ৩৬ ঠিক, **৫ gap** |
| Security probe — ৩০ চেক (authn, authz, IDOR, JWT, XSS, SQLi, CORS, headers, upload, traversal) | ২৫ PASS, ২ FAIL, ২ not-tested |
| Performance — ১৬ endpoint ×৩০ sample + ৬০ concurrent + EXPLAIN + index + Redis | সব 2xx, ০ error |
| axe-core a11y — ১৩ route × desktop/mobile | **৩২১ node (desktop) + ৮৬ (mobile)** |
| UI walk — ১৩ route × 1440/1024/390 × light/dark | ০ console error, ০ failed request, ০ overflow |
| DB integrity — ২৫+ SQL check | ০ orphan / ০ duplicate / ০ negative money |

> বিস্তারিত প্রমাণ: `qa-evidence/audit-2026-11-14/` — `functional.md`, `security.md`, `performance.md`, `ui-ux-a11y.md`, `screens/`, ও raw JSON/PSQL আউটপুট।

---

## ৩. মডিউল-ভিত্তিক মার্ক

| মডিউল | মার্ক | মূল কথা |
|---|---:|---|
| Login | **5.5** | blocker: "Welcome to " — পণ্যের নাম অদৃশ্য; CTA contrast fail |
| Dashboard | **7.0** | সুন্দর ও ডেটা-সমৃদ্ধ, কিন্তু `dueToday` ভুল (0 vs 3) + ৪১ query/৬০s cron |
| Pulse (Leads) | **7.5** | CRUD/workflow ঠিক; সার্চ scale-এ অচল, UI ভালো |
| Accounts (Clients) | **8.0** | সবচেয়ে পরিপক্ব; nested-interactive row, নামে length cap নেই |
| Flow (Projects) | **7.0** | ঠিকঠাক; icon button label নেই, modal focus return নেই |
| Tasks | **6.5** | **SEC-01 authz bypass**, মোবাইলে ৬৪৫px chrome, title truncate |
| People (HRM) | **7.0** | CRUD+payroll ঠিক; ডাবল h1, খালি attendance chart "ভাঙা" দেখায় |
| Capital (Finance) | **7.5** | হিসাব নির্ভুল, ১২টা invoice clean; unbounded query + missing index |
| Insight | **6.5** | chart ঠিক, কিন্তু Revenue Trend x-axis **উল্টো (Nov→Oct→Sep)** |
| Calendar | **5.5** | সবচেয়ে দুর্বল: ১৯.৮px chip, inverted range accept করে |
| Portal (client-facing) | **6.0** | ডেটা আলাদা/নিরাপদ, কিন্তু table clipping + ৩টা h1 + খালি access row |
| Control (admin) | **7.0** | RBAC/audit ঠিক; health KPI ~১s "0/-" দেখায় |
| Notifications | **7.0** | কাজ করে; dropdown-এ role/focus নেই |

---

## ৪. ফিক্স করতে হবে — অগ্রাধিকার অনুযায়ী

### 🔴 P0 — এখনই (প্রোডাকশন আটকে দেয়)

| # | সমস্যা | প্রমাণ | ফিক্স |
|---|---|---|---|
| **DEP-01** | `next@16.3.0`-এ **multiple unauthenticated RCE** অ্যাডভাইজরি (Image Optimization/`use cache`/next-og). Windows-hosted হলে আরও ঝুঁকি | `npm audit`: critical; GHSA-p293, GHSA-2xp9, GHSA-2464, GHSA-673q | `next` **≥16.4.1**-এ আপগ্রেড করে rebuild + visual regression |
| **SEC-01** | HR/Admin (TASKS permission নেই) `PATCH /api/tasks/:id` → **200** ফুল রেকর্ড; একই টাস্কে GET → 403 | আমি নিজে রিপ্রোডিউস করেছি (disposable task create→patch→delete) | `tasks.service.ts:141-146` role-name allowlist বাদ; `user.permissions.TASKS.edit` থেকে চালাও; `@SkipPermission()` শুধু self-scoped route-এ |
| **UX-01** | Login h1-এ "Welcome to " — ব্র্যান্ড নাম অদৃশ্য (`--brand-gradient` solid hex, `bg-clip-text text-transparent`) | `screens/desktop/01-login.png`; `apps/web/src/app/login/page.tsx:89-99` | fallback gradient ব্যবহার করো বা solid হলে `background-color` দাও |
| **BUG-001** | Dashboard `tasks.dueToday = 0` ও `today.dueTodayCount = 0`, অথচ একই response-এ `dueTasks` ৩টা ও `/tasks/stats` বলে ৩ | আমি নিজে ভেরিফাই করেছি | `dashboard.service.ts`-এ একই date boundary (Asia/Dhaka, UTC+6) ব্যবহার করো |

### 🟠 P1 — এই সপ্তাহে

| # | সমস্যা | প্রমাণ |
|---|---|---|
| **SEC-02 / BUG-009** | `/dashboard/overview` permission matrix মানে না — HR ও Sales/BD company cash, receivables, client revenue পায় | আমি নিজে ভেরিফাই: HR → 200 + `capital`, `pulse`, `accounts`, `topClients` |
| **PERF-02** | `JournalEntryLine.entryId`-এ index নেই → `seq_tup_read 206,525` (৪৪ row-এর টেবিলে) | `schema.prisma` + `pg_stat_user_tables` |
| **PERF-01** | `/dashboard/overview`: ৪১ query, `findMany()` without `where/take`, প্রতি ৬০s cron; uncached ১১৪ms vs cached ১৪.৬ms | performance.md §6 |
| **SEC-03** | JWT secret মানুষ-পাঠ্য phrase; `FILE_URL_SECRET` নেই → ফাইল URL সাইন JWT key দিয়েই | `env.ts:12-34`, `signed-url.ts:23-27`, boot warning |
| **SEC-04** | Login lockout শুধু email-এ keyed → যেকোনো account (Owner সহ) ১৫ মিনিট lock করে রাখা যায় | ৬ষ্ঠ ভুল পাসওয়ার্ডে lock; `/users` থেকে email পাওয়া যায় |
| **BUG-002** | অসম্ভব তারিখ চুপচাপ rollover: `2026-02-31` → `2026-03-03` | functional.md BUG-002 |
| **BUG-003** | Calendar inverted range accept করে (`endTime < startTime`, `endDate < date`) | functional.md BUG-003 |
| **UX-02** | ব্র্যান্ড কমলা `#FF5001` + সাদা = **3.14:1** (AA দরকার 4.5:1) — সব primary CTA | axe `color-contrast` ১৮৩ node; ফিক্স: গাঢ় কমলা `#C2410C` বা টেক্সট গাঢ় করো |
| **UX-06** | Calendar event chip উচ্চতা ১৯.৮px (WCAG 2.2 target 24px) → ৫০টা fail | axe `target-size` |
| **UX-05** | `<tr role="button" tabindex=0>`-এর ভিতরে button/select — ৫০টা invalid nested interactive | axe `nested-interactive` |
| **DEP-02..04** | `compression@1.8.1` (DoS), `multer@2.2.0` (DoS ×6), `proxy-addr@2.0.7` (**critical** IP spoofing, TRUST_PROXY=1 হলে) | `npm audit` |

### 🟡 P2 — পরের স্প্রিন্টে

- **UX-03** skip link নেই (প্রতি পেজে ১১টা nav link আগে), **UX-04** সব route-এ একই `<title>` (SEO + screen reader)
- **UX-07/08** ৯টা icon-only button/select-এ accessible name নেই (axe critical)
- **UX-09** মোবাইল Tasks: ৮৪৪px-এর ৬৪৫px chrome, প্রথম task নিচে
- **UX-15** Insight Revenue Trend x-axis উল্টো (API newest-first দেয়)
- **UX-10/11/12** table header sticky নয়, title ১৫০px-এ কাটে, `aria-sort` সেট হয় না
- **UX-13/14** Portal table clipping, ০ contact client-এ খালি row
- **UX-17/18** People-এ ২টা h1, Portal-এ ৩টা
- **UX-20** Task delete-এ native `window.confirm()` বাকি সব জায়গায় in-app dialog
- **UX-22/23/25** notification popover role/focus, modal focus return, Control health flicker
- **PERF-03** `/capital/invoices` সব invoice মেমরিতে এনে পরে paginate করে
- **PERF-04/05** ৪টা hot endpoint uncached; Pulse ILIKE সার্চ index-অযোগ্য
- **PERF-07** ৯৫টা Prisma call loop-এর ভেতরে (worst: `tasks.service.ts:1616` প্রতি task-এ ৩ query)
- **BUG-004** client name / expense description-এ length cap নেই
- **BUG-005** একই KPI-র দুই উত্তর (`staleLeads` 5 vs 3, `expensesMonth` 399,500 vs 339,500)
- **BUG-006** leave request cancel/delete route নেই
- **SEC-05..10** cross-user password change, web CSP/HSTS নেই + localStorage token, dev-এ `/iclock/*` খোলা, `/users` সবার email, 404-vs-403 oracle, X-Forwarded-For unscoped
- **ডিপেন্ডেন্সি** `dompurify` (transitive, সরাসরি ব্যবহার নেই → کم ঝুঁকি), `prisma`/`@nestjs/cli` dev-only

### ⚪ P3 — পরিচ্ছন্নতা
- **ইউনিট টেস্ট শূন্য** — finance kernel, scoring, payroll math-এ Vitest দরকার (এখন শুধু live-API smoke)
- **CI**: lint job নেই, coverage gate নেই, Playwright trace/artifact upload নেই, sharding নেই
- **`node_modules/zoolyum-os/node_modules/zoolyum-os/...` অন্তত ৮ স্তর recursive** — npm workspace self-link; CI/ডিস্ক/tooling ধীর করে
- রুট ফোল্ডারে ৫৪টা ফাইল: ১৪ PNG, ২২ log, ৮ ad-hoc JS — `qa-evidence/` বা স্ক্রিপ্ট ফোল্ডারে সরাও (অনেকগুলো gitignore-এ আছে, তবু কাজের ডিরেক্টরি নোংরা)
- `docker-compose.yml`-এ postgres পাসওয়ার্ড `zoolyum` ও port হোস্টে খোলা (শুধু dev-এ ঠিক)
- ২টা endpoint `200` + **০ byte** body (`/control/telegram/link`, `/tasks/timers/running`) → `204` বা `null` JSON

---

## ৫. যা সত্যিই ভালো (রাখতে হবে)

1. **ভাঙা endpoint নেই** — ৭৪৭ রিকোয়েস্টে একটাও 5xx নয়; required-param মিস করলে পরিষ্কার 400।
2. **ফিনান্স ইঞ্জিন সৎ** — journal balanced, trial balance 0, GL vs AR/AP/bank/VAT/deferred/bad-debt সব মিলে; ১২ invoice-এর line math, payment, ageing সব clean।
3. **RBAC বেসলাইন শক্ত** — ৫টা global guard, HS256 pinned, `tokenVersion`+`jti` revocation, DTO whitelist, সব Prisma parameterized, signed file URL, 2MB/11MB body limit, login + public-invoice rate limit।
4. **ডিজাইন সিস্টেম পরিপক্ব** — `৳4.07L` lakh formatting, empty state, skeleton, modal contract (aria-modal/labelledby/focus trap/Escape/scroll-lock), ⌘K palette, সত্যিকারের ডার্ক মোড, মোবাইল nav drawer। ৩৯০px-এও horizontal overflow শূন্য।
5. **CI + ops** — typecheck → build → smoke → portal → E2E; nightly `pg_dump` backup profile; `.env` gitignored; bootstrap path demo-seed ছাড়া।
6. **ডেটা হাইজিন** — orphan FK, duplicate email, negative money, ৩-দশমিক টাকা, ভবিষ্যতের timestamp, NULL required — সব ০।

---

## ৬. একজন টেস্টার হিসেবে "সবকিছু" টেস্ট করার চেকলিস্ট

নিচের ম্যাট্রিক্সটাই পূর্ণ দাবি — ✅ = এই অডিটে চালানো হয়েছে, ⏳ = এখনো বাকি (কেন)।

### ক. ফাংশনাল
| টেস্ট | অবস্থা |
|---|---|
| প্রতিটি মডিউলের প্রতিটি GET route (৩ role) | ✅ ৭৪৭ call |
| ৮ core entity-র create→read→update→delete | ✅ ৪৮/৪৮ |
| ৫৩টা বাকি write route (POST/PATCH/DELETE) | ⏳ (ডেটা নষ্টের ঝুঁকি; disposable seed DB দরকার) |
| Required field / wrong type / negative money / oversized | ✅ ৪২ case (৫ gap) |
| Cross-module consistency (dashboard vs list) | ✅ ১০ KPI, ২ ভুল |
| Invoice/payment/ageing/GL reconciliation | ✅ |
| Payroll run → payslip → finance posting | ⏳ (E2E-তে UI flow আছে, deep math যাচাই বাকি) |
| Calendar plan → lock → PDF/CSV/share-link | ⏳ (share link token দিয়ে দেখা হয়নি) |
| Portal end-to-end (real portal user) | ⏳ (portal credential দেওয়া হয়নি; code + token forgery টেস্ট হয়েছে) |
| Search relevance ও empty query | 🟡 `q=a` → ২ byte (প্রায় খালি) |
| Notification delivery (Telegram/WhatsApp) | ⏳ (token নেই, fail-closed যাচাই হয়েছে) |
| File upload → signed URL → download/expiry | 🟡/⏳ (MIME/size/path traversal ✅, real file round-trip বাকি) |
| Attendance device (iClock) / fingerprint login | ⏳ (হার্ডওয়্যার দরকার) |

### খ. ডেটা ও ডেটাবেস
| টেস্ট | অবস্থা |
|---|---|
| Orphan FK, duplicate unique, NULL required, negative money | ✅ ২৫ query |
| Migration state / drift | ✅ ৬৫ migration, up-to-date |
| Index coverage + EXPLAIN on hot query | ✅ (১টা বড় hole) |
| Backup নেওয়া | ✅ profile আছে (nightly, ১৪ দিন) |
| **Backup restore drill** | ⏳ — কখনো প্রমাণ হয়নি; এটাই সবচেয়ে বড় অপারেশনাল ঝুঁকি |
| বড় ডেটাসেটে (১০০k+ row) আচরণ | ⏳ — DB মাত্র ২০MB / max ৫০ row |
| Transaction rollback / double-submit | ⏳ |
| Soft-delete vs hard-delete policy | 🟡 code-এ আছে, systematic টেস্ট নেই |

### গ. সিকিউরিটি
| টেস্ট | অবস্থা |
|---|---|
| Unauth access (২৬ endpoint) | ✅ সব 401 |
| RBAC matrix ৬ role × ২৬ endpoint | ✅ (২ deviation) |
| IDOR / object-level authz | ✅ (SEC-01 bypass পাওয়া গেছে) |
| JWT forgery (alg:none, re-sign, empty sig, scope forgery) | ✅ ৫/৫ 401 |
| SQL injection / mass assignment / stack leak | ✅ কোনোটা নেই |
| Stored XSS (live UI) | ✅ escaped |
| CORS / headers / body limit / rate limit | ✅ (web-এ CSP/HSTS নেই) |
| File upload/traversal/signed URL | ✅ |
| Dependency CVE (`npm audit`) | ✅ ৩ critical / ১১ high |
| `git log -p` secret archaeology | ⏳ (skip) |
| Pen-test: SSRF, XXE, GraphQL (নেই), race condition | ⏳ — আলাদা engagement দরকার |
| Prod-only branches (NODE_ENV=production, TRUST_PROXY) | ⏳ — শুধু code review |

### ঘ. পারফরম্যান্স
| টেস্ট | অবস্থা |
|---|---|
| Endpoint p50/p95 (৩০ sample × ১৬) | ✅ |
| Cold vs warm cache | ✅ |
| Concurrent load ৩০/৬০ | ✅ ০ error, ~৪৫০ req/s (dashboard) |
| Production build bundle/Web Vitals | ⏳ — dev server ভাঙার ভয়ে build করা হয়নি; CI করে |
| বড় ডেটায় load test | ⏳ — আসল সংখ্যা দরকার |
| N+1 / index / EXPLAIN | ✅ ৯৫ N+1, ১ missing index |
| Soak test (১ ঘণ্টা), memory leak | ⏳ |

### ঙ. UI/UX + Accessibility
| টেস্ট | অবস্থা |
|---|---|
| ১৩ route × ৩ breakpoint × light/dark | ✅ ০ console error / ০ overflow |
| axe-core WCAG 2.2 AA | ✅ ৩২১+৮৬ violation |
| Keyboard navigation / focus trap / Escape | 🟡 (modal ভালো, focus return নেই) |
| Screen reader (NVDA/VoiceOver) | ⏳ — manual দরকার |
| Contrast, tap target, heading order, labels | ✅ |
| রিয়েল ডিভাইস (iOS Safari, Android Chrome) | ⏳ |
| Slow network (3G) / offline | ⏳ |
| Zoom 200% / forced colors | ⏳ |

---

## ৭. প্রস্তাবিত অ্যাকশন প্ল্যান

**ডে ১–২:** DEP-01 (Next upgrade), SEC-01 (tasks authz), UX-01 (login), BUG-001 (dashboard counter) → CI green রেখে deploy।
**সপ্তাহ ১:** SEC-02/03/04, PERF-02 (index), BUG-002/003 (date validation), contrast fix।
**সপ্তাহ ২:** PERF-01 (dashboard query + cache TTL), `/capital/invoices` pagination, a11y critical (skip link, title, labels, nested-interactive)।
**সপ্তাহ ৩–৪:** ইউনিট টেস্ট (finance/payroll/scoring), CI-তে lint + a11y gate + artifact upload, recursive node_modules পরিষ্কার, backup restore drill।

---

## ৮. রিপ্রোডিউস করার কমান্ড

```bash
# সার্ভার
npm run dev                      # api :4000 + web :3000

# ফাংশনাল
npm run typecheck
npm run test:smoke               # 28/28
npm run test:finance             # 14/14
npm run test:e2e                 # 16/16 (একা চালালে)

# নিরাপত্তা / পারফরম্যান্স
npm audit
docker exec zoolyum-postgres psql -U zoolyum -d zoolyum_os -c "select relname,seq_tup_read from pg_stat_user_tables order by seq_tup_read desc limit 5;"

# বিস্তারিত প্রমাণ
qa-evidence/audit-2026-11-14/{functional,security,performance,ui-ux-a11y}.md
```

---

## ৯. সীমাবদ্ধতা (সৎ দাবি)

- DB খালি (২০MB, সর্বোচ্চ ৫০ row) → **পারফরম্যান্স "পাস" মানে খালি ডেটাবেসে পাস**।
- সব পরিমাপ **dev mode**-এ (Nest watch + Turbopack) → production সংখ্যা ভিন্ন ও দ্রুততর হবে।
- Portal-এর আসল লগইন/IDOR, প্রোডাকশন-only branch, হার্ডওয়্যার attendance, backup restore — এই চারটা যাচাই হয়নি (উপরে ⏳)।
- কোনো bug বানানো হয়নি; প্রতিটা ফাইন্ডিং-এর পাশে রিকোয়েস্ট/স্ক্রিনশট/SQL প্রমাণ ফাইলে আছে।
