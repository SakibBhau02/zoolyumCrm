# Zoolyum OS — Production Readiness QA Report

**তারিখ:** ১১ নভেম্বর ২০২৬
**Scope:** সম্পূর্ণ monorepo — `apps/api` (NestJS 11 + Prisma 6 + PostgreSQL 16), `apps/web` (Next.js 16 + React 19 + Tailwind 4), ১২টি মডিউল, ৬০০ route handler, ১২৮ টেবিল
**উদ্দেশ্য:** Production deployment-এর আগে correctness, security, database এবং **speed** — চারটি অক্ষে পূর্ণ যাচাই
**রিপোর্টের ধরন:** Evidence-based QA audit (কোড + রানটাইম মাপ + DB query plan)

> **Update (11 Nov 2026):** নিচের ১৩টি blocker-এর **সবগুলোই ঠিক করা হয়েছে**।
> কী বদলেছে ও কীভাবে যাচাই করা হয়েছে: `docs/production-readiness-fixes.md`।
> Performance target-এর মধ্যে dashboard cold-query সংখ্যা (~65) এখনো পুরোপুরি
> নামেনি — বাকি অংশ follow-up, তবে user-facing latency stale-while-revalidate
> cache-এ ১০–১৭ ms।

---

## 0. এক নজরে (Executive Summary)

### রায়: ❌ এখনই production-এ দেওয়া যাবে না

সিস্টেমের **আর্কিটেকচার ভালো** — double-entry GL, RBAC guard chain, tenant isolation, signed file URL, transactional payment flow, honest error mapping। কিন্তু **৪টি এমন সমস্যা আছে যা production-এ গেলে সরাসরি টাকা/ডেটা ভুল দেখাবে বা ডেটা ফাঁস করবে**, এবং **performance-এর ভিত্তি (foundation) বড় ডেটায় ভেঙে পড়বে**।

| ক্ষেত্র | স্কোর /১০ | মন্তব্য |
|---|---|---|
| Correctness (business logic) | **5** | Finance reporting-এ vendor payout কে income হিসেবে গোনে; task drag-drop-এ project progress আপডেট হয় না |
| Security | **6** | Auth chain শক্ত, কিন্তু public upload route সব ফাইল খুলে দেয়; webhook secret না থাকলে fail-open |
| Database design | **7** | Schema সুন্দর, 346 index; কিন্তু ৭৭টি FK column unindexed, hot ৪টি টেবিলে index নেই |
| API performance | **4** | Warm cache-এ চমৎকার, **cold-এ ০.৩–০.৯ সেকেন্ড এবং ৬০–৬৬ query**; ১০ concurrent-এ p95 ২.২ সেকেন্ড |
| Frontend performance | **3** | প্রতি পেজে **৩০০–৬২৭ KB gzip JS** (budget ১০০–১৫০ KB); jsPDF সব পেজে লোড হয় |
| Deployment readiness | **5** | Build/migrate/CI ঠিক, কিন্তু `.env`, demo password, uncommitted migration, health probe |
| Observability | **3** | কোনো request log/metric/Sentry নেই; health probe DB দেখে না |
| **সামগ্রিক** | **4.7 / ১০** | **১৩টি blocker ঠিক না করে deploy করা যাবে না** |

### যে ১০টি সমস্যা আগে ঠিক করতে হবে (Priority 0)

| # | সমস্যা | প্রভাব |
|---|---|---|
| 1 | **Vendor/expense payment গুলো customer income হিসেবে report হয়** — `Payment.type` default `IN`, আর expense payout-এ type সেট হয় না | Revenue, collection rate, cash-flow, bank statement — সব ভুল সংখ্যা |
| 2 | **`GET /api/pulse/uploads/:filename` সম্পূর্ণ `@Public()`** এবং Flow-এর signed file directory-ই সার্ভ করে | লগইন ছাড়াই client deliverable/invoice ফাইল ডাউনলোড |
| 3 | **`NEXT_PUBLIC_API_URL` build-এ `localhost:4000` বেক হয়ে যায়** (web-এ কোনো `.env` নেই) | Production-এ frontend "Cannot reach the server" — পুরো অ্যাপ অচল |
| 4 | **`CONTROL_MODULES` = CLIENTS/LEADS/PROJECTS/FINANCE/INSIGHTS**, কিন্তু guard চায় ACCOUNTS/PULSE/FLOW/CAPITAL/INSIGHT | Admin permission বদলালেও **কোনো প্রভাব পড়ে না** (silent privilege retention) |
| 5 | **Dashboard/Home cold: ৪৫২–৫৪৩ ms, ৬০–৬৬ SQL query**; `/capital/overview` cold ৯৩৪ ms | প্রতিবার ৩০ সেকেন্ডে একজন ব্যবহারকারী এই খরচ দেয় |
| 6 | **`/flow/projects` ১.৪ MB, `/capital/invoices` ৭১০ KB, `/tasks` ৪৭৫ KB — কোনো pagination নেই** | মোবাইল/ধীর নেটওয়ার্কে সেকেন্ডে সেকেন্ড, browser freeze |
| 7 | **Finance API-গুলোতে DTO/validation নেই** (`@Body() body: any`) — ৭৬০টি `any` | ঋণাত্মক invoice, `taxRate: 1500`, negative payroll গ্রহণ করে |
| 8 | **`InvoiceLineItem.invoiceId`, `TaskComment.taskId`, `LeaveRequest`, `Task(parentTaskId/archivedAt/dueDate)` index ছাড়া** — EXPLAIN-এ seq scan প্রমাণিত | ডেটা বাড়লে প্রতিটি invoice/task খোলা ধীরে ধীরে ভয়ংকর হবে |
| 9 | **Webhook + JWT + IP allowlist fail-open** (`dev-secret`, secret না থাকলে accept, XFF spoof) | Forgery, allowlist bypass, forged attendance/approval |
| 10 | **Demo seed (`zoolyum123`, bcrypt cost 10) production-এ চালানোর ঝুঁকি** | সব demo account-এ দুনিয়ার কাছে জানা পাসওয়ার্ড |

---

## 1. কীভাবে টেস্ট করা হয়েছে (Methodology)

একটি রিপোর্ট হিসেবে বিশ্বাসযোগ্য হতে হলে পদ্ধতিটা জানা দরকার। যা করেছি:

**১. স্ট্যাটিক রিভিউ — ১০০% কভারেজ**
- `apps/api/src` — ১৬৬ ফাইল (১.৫ MB), ৩১ controller, **৬০০ route handler** (GET ২৫৯, POST ১৮৭, PATCH ৮১, DELETE ৭২, PUT ১)। প্রতিটি মডিউল আলাদাভাবে পড়া হয়েছে।
- `apps/web/src` — ১৫৩ ফাইল (২.৯ MB), ১৩২ component/page (এর মধ্যে **১১৭টি `"use client"`**)।
- `prisma/schema.prisma` — ৯৯ KB, ১২৮ model, ৬০ migration।

**২. রানটাইম মাপ (আসল সার্ভার, ঠাট্টা নয়)**
- `apps/api` production build (`nest build`) আলাদা port-এ চালানো, NODE_ENV=production।
- **ডেটা ভলিউম:** শুধু seed ডেটায় মাপলে সব কিছু "দ্রুত" দেখায় — তাই আলাদা পারফরম্যান্স ডেটাবেস বানিয়ে বাস্তব ভলিউম ঢোকানো হয়েছে:

| টেবিল | রো সংখ্যা |
|---|---|
| Task | 8,025 |
| TaskComment | 20,002 |
| TimeLog | 12,016 |
| LeadActivity | 12,004 |
| CalendarEvent | 10,008 |
| InvoiceLineItem | 9,014 |
| Attendance | 8,620 |
| Lead | 4,010 |
| Expense | 4,008 |
| Invoice | 3,012 |
| Payment | 2,935 |
| Notification | 15,000 |
| Employee / Client / Project | 50 / 307 / 1,210 |

এটা একটি **৩–৪ বছরের মাঝারি এজেন্সির** বাস্তব চিত্র। এর চেয়ে বড় হলে সংখ্যা **রৈখিকভাবে খারাপ হবে** — নিচে যেখানে "linear growth" বলা হয়েছে সেটা এই কারণে।

**৩. পরিমাপের যন্ত্র**
- প্রতি endpoint-এ p50/p95 latency, payload size, status (৫ বার চালিয়ে median)।
- **প্রতি request-এ কত SQL query** — PostgreSQL-এর `log_statement=all` দিয়ে marker বসিয়ে হুবহু গণনা।
- **SQL execution time vs মোট সময়** আলাদা করা (DB-তে কত, Node-এ কত)।
- `EXPLAIN (ANALYZE, BUFFERS)` — index আছে কিনা তা অনুমান নয়, plan দেখে।
- Frontend bundle — production build-এর actual chunk গুলো gzip করে মাপা।
- **Load test:** ১০ concurrent virtual user, ৩০ সেকেন্ড, cache প্রতি ৫ সেকেন্ডে expire।

**৪. সীমাবদ্ধতা (সৎভাবে)**
- সব মাপ **লোকাল Docker Postgres**-এ (network latency ≈ 0)। Production-এ DB আলাদা machine/region হলে প্রতি query-তে ০.৫–২ ms যোগ হবে — **৬৬ query মানে ৩৩–১৩০ ms শুধু নেটওয়ার্ক**।
- DB ও Redis একই হোস্টে; production-এ আলাদা হলে cache hit-ও ধীর হবে।
- Browser-ভিত্তিক Lighthouse/Core Web Vitals চালানো হয়নি (bundle + API মাপ করা হয়েছে, যা মূল কারণ)।

---

## 2. Performance — আসল সংখ্যা

> এখানেই সবচেয়ে বড় ফাঁদ: **warm cache-এ সব দ্রুত দেখায়**। কিন্তু cache TTL ৩০ সেকেন্ড, আর cache গুলো user-specific নয় — অর্থাৎ ৩০ সেকেন্ডে একবার "কেউ একজন" পুরো খরচটা দেয়। ১০ জন কাজ করলে সেটা ঘন ঘন ঘটে।

### 2.1 Warm vs Cold (একই endpoint, একই ডেটা)

| Endpoint | Warm (cache hit) | **Cold (cache miss)** | DB time (cold) | Query সংখ্যা | Payload |
|---|---|---|---|---|---|
| `/dashboard/overview` | 1৩ ms | **৫৪৩ ms** | ১৪১ ms | **৬৬** | ১৮২ KB |
| `/dashboard/home` | ১৮ ms | **৪৫২ ms** | ১৫২ ms | **৬০** | ১৯৪ KB |
| `/accounts/clients` | **৩৯০ ms** | ২৭৩–৪৭১ ms | ৪১ ms | ৭ | **৪২০ KB** |
| `/flow/projects` | ৪২ ms | **২১১–২৬৪ ms** | ২১ ms | ৫ | **১,৪৩৭ KB** |
| `/capital/invoices` | ৭৬ ms | ৮৪–১০৫ ms | ১৪ ms | ৮–১৪ | ৭১০ KB |
| `/capital/expenses` | ৬৬ ms | ৭৮–১১৩ ms | ১০ ms | ১০ | ৪৮৯ KB |
| `/capital/overview` | ৫ ms | **৬৫১–৯৩৪ ms** | **৬৯ ms** | ১০ | ২ KB |
| `/tasks` | ২১ ms | ৭৬–৯৫ ms | ২৫ ms | ৬ | ৪৭৫ KB |
| `/calendar/feed` | ২৫ ms | ১৩৯–১৬৭ ms | ৩৫ ms | ২৫ | ৪৯৯ KB |
| `/people/attendance` | ১৯ ms | ২৪ ms | ২ ms | ৪ | ১৩৯ KB |
| `/pulse/leads` | ২৪ ms | ৩১ ms | ৬ ms | ৯ | ৮৩ KB |

**দুটো গুরুত্বপূর্ণ পর্যবেক্ষণ:**

1. **`/capital/overview`-এ DB সময় মাত্র ৬৯ ms, কিন্তু মোট ৯৩৪ ms** → **৮৬৫ ms খরচ হচ্ছে JavaScript-এ**, ডেটাবেসে নয়। অর্থাৎ সমস্যা SQL নয়, "সব ডেটা Node-এ এনে loop চালানো" — এটা ঠিক করা সহজ ও সবচেয়ে বড় লাভ।
2. **`/accounts/clients` warm-এও ৩৯০ ms** — কারণ `financialSummary()` cache-এর **বাইরে** চলে (নিচে 4.5 দেখুন)। এটাই একমাত্র endpoint যেখানে cache কাজেই আসে না।

### 2.2 Concurrency test — ১০ জন একসাথে কাজ করলে

১০ virtual user, ৬টি ভারী পেজ loop করে, cache প্রতি ৫ সেকেন্ডে expire (৩০ সেকেন্ড):

| Metric | ফলাফল |
|---|---|
| Throughput | **১৫.৬ req/s** (একটি Node process) |
| p50 | ৩৭৪ ms |
| **p95** | **২,২৩৮ ms** |
| **p99** | **২,৫৫০ ms** |
| Error rate | ০% (ভালো — crash করে না) |
| ৩০ সেকেন্ডে transfer | **২৪০ MB** |
| `/capital/overview` p50 | **১,৬৩৪ ms** |
| `/accounts/clients` p50 | ৭১৯ ms |
| `/flow/projects` p50 | ৬৪৮ ms |

**এর মানে:** ১০ জন ব্যবহারকারী একসাথে কাজ করলে page switch-এ ২ সেকেন্ডের বেশি অপেক্ষা। এটি production-এ অগ্রহণযোগ্য। মূল কারণ একটাই — **একটি Node process, single thread, আর প্রতিটি request ২০০–৯০০ ms CPU ধরে রাখে (JSON serialization + JS aggregation)**।

### 2.3 Payload size — "কেন মোবাইলে আস্তে লাগে"

| Endpoint | Bytes | কেন এত বড় |
|---|---|---|
| `/flow/projects` | **1.44 MB** | ১,২১০ project + প্রতিটির client/PM/_count, কোনো pagination নেই |
| `/capital/invoices` | 710 KB | সব invoice + line item + payment |
| `/capital/expenses` | 489 KB | সব expense |
| `/tasks` | 475 KB | ৫০০ task, প্রতিটির **`activityLog` JSON (১০০ entry পর্যন্ত)** |
| `/accounts/clients` | 420 KB | ৩০৭ client + invoice financials |
| `/calendar/feed` | 499 KB | ৮ টেবিলের merged feed |

API-তে `compression()` আছে (gzip), তাই wire-এ ~৭০–৮৫% কম যায় — কিন্তু browser-কে **১.৪ MB JSON parse** করতেই হয় (মোবাইলে ৫০–১৫০ ms + মেমরি), আর React state-এ রাখলে re-render-এ আবার খরচ।

### 2.4 Frontend bundle — সবচেয়ে বড় ধাক্কা

Production build থেকে মাপা (eager chunk, **gzip**):

| Route | gzip JS | Budget (ভালো SaaS dashboard) | Excess |
|---|---|---|---|
| `/flow` | **৬২৭ KB** | ১০০–১৫০ KB | **৪–৬×** |
| `/capital` | **৫৯৫ KB** | ১০০–১৫০ KB | **৪×** |
| `/pulse` | **৪৪০ KB** | ১০০–১৫০ KB | **৩×** |
| `/dashboard` | **৪২৭ KB** | ১০০–১৫০ KB | **৩×** |
| `/tasks` | ৩১৫ KB | ১০০–১৫০ KB | ২× |
| `/accounts` | ৩০৭ KB | ১০০–১৫০ KB | ২× |
| `/login` | **২৫৯ KB** | ৮০–১২০ KB | ২× |

**কারণ (মাপা chunk attribution):**

| Library | gzip | কোথায় লোড হয় |
|---|---|---|
| jsPDF | **১৪৩ KB** | `/capital`, `/flow`, `/portal-client`, `/p/inv/[token]`, payslip — **সব জায়গায় static import** |
| Recharts | **১০৬ KB** | dashboard/capital/insight |
| framer-motion | **৪৪ KB** | `shared.tsx`-এ, অর্থাৎ **সব ৪৪টি route-এ, `/login`-এও** |
| qrcode | ~১৫ KB | invoice print view |

`flow-workspace.tsx:20`-এ `InvoiceDetailModal` static import → শুধু এক invoice দেখানোর জন্য **১৭১ KB gz** project management পেজে ঢোকে।

### 2.5 কেন এত ধীর — ৬টি প্যাটার্ন (কোডে গণনা করা)

| Pattern | কতবার | উদাহরণ |
|---|---|---|
| `findMany()` **`take` ছাড়া** | কোডবেসে মোট ৪৭৭টি `findMany`; এর মধ্যে বহুতে limit নেই | `flow.service.ts:168`, `invoice.service.ts:163`, `control.service.ts:1063` |
| `include`/`select` ছাড়া **পুরো row** | বহু | `tasks.service.ts:1047`, `pulse.service.ts:175` |
| **JS-এ aggregation** (DB-তে groupBy না করে) | ১০+ | `dashboard.service.ts:104-991`, `reporting.service.ts:243/264/306` |
| **N+1 loop** (loop-এর ভেতরে await) | ২০+ | `attendance.service.ts:555`, `leave.service.ts:70`, `pulse.service.ts:1896` |
| **JSON column** list-এ টানা | ২ | `Task.activityLog`, `Task.attachments` |
| Cache **invalidation** `SCAN` দিয়ে | প্রতিটি write-এ | `cache.service.ts:99-116` |

---

## 3. Database Audit

### 3.1 বর্তমান অবস্থা
- ১২৮ টেবিল, **৩৪৬ index**, DB size (পরীক্ষামূলক ডেটাসহ) ২২ MB → বাস্তব ডেটায় শত শত MB হবে।
- Migration: ৬০টি, নতুন DB-তে `prisma migrate deploy` **সফলভাবে চলে** (যাচাই করেছি) — এটা ভালো খবর।
- Money field-গুলো ঠিকঠাক `Decimal(14,2)` — `Float` ব্যবহার হয়নি (ভালো)। `Float` শুধু rate/metric-এ।

### 3.2 Missing index — EXPLAIN দিয়ে প্রমাণিত

**১. `InvoiceLineItem.invoiceId` — index নেই**

```
Seq Scan on "InvoiceLineItem"  (rows=3, Rows Removed by Filter: 9011)
```

প্রতিটি invoice খোলা, invoice list, delete-line-items — সবই full scan। ৯ হাজারে ০.৯ ms, কিন্তু **১ লাখে ~১০–১৫ ms প্রতিবার**, আর `accounts/clients` এই join-ই করে।

**২. `TaskComment.taskId` — index নেই**

```
Seq Scan on "TaskComment" (rows=2, Rows Removed by Filter: 20000)  → 2.1 ms
```

Task detail খোলা মানেই ২০,০০০ row scan। প্রতিদিন বাড়ছে।

**৩. `Task(parentTaskId, archivedAt, dueDate)` — index নেই**

```
Seq Scan on "Task" (rows=50, rows=8025) + Sort  → 2.5 ms
```

Task board প্রতিবার পুরো টেবিল scan করে sort করে।

**৪. `LeaveRequest` — একটিও index নেই**

`WHERE status='APPROVED' AND startDate <= now AND endDate >= now` — এই query চলে attendance recompute, payroll run, nightly cron, dashboard-এ। **রাতে ২৯টি cron-এর প্রতিটি এটা চালায়।**

**৫. আরও ৭৩টি FK column index ছাড়া** — এর মধ্যে উল্লেখযোগ্য: `TaskComment.parentId`, `TaskComment.authorId`, `TaskDependency.dependsOnTaskId`, `ClientContact.clientId`, `LeaveRequest.employeeId`, `ProjectRiskLog.projectId`, `Employee.reportingManagerId`।

**যা যোগ করা উচিত (এক migration-এ):**
```prisma
model InvoiceLineItem { @@index([invoiceId]) }
model TaskComment { @@index([taskId, createdAt]) @@index([parentId]) }
model Task { @@index([archivedAt, parentTaskId, dueDate]) @@index([assignedToId, status, dueDate]) @@index([parentTaskId]) @@index([completedAt]) }
model LeaveRequest { @@index([employeeId, status, startDate]) @@index([status, startDate, endDate]) }
model ClientContact { @@index([clientId]) }
model Client { @@index([healthScore]) @@index([healthLevel]) @@index([industryVertical]) }
model Project { @@index([status, healthStatus, createdAt]) @@index([reportMode, nextReportDate]) }
model Attendance { @@index([employeeId, date]) }   // unique আছে, কিন্তু payroll-এর জন্য composite দরকার
model TaskDependency { @@index([dependsOnTaskId]) }
model EstimateAccuracyLog { @@unique([taskId]) }
```

### 3.3 중요: Production migration-এর ঝুঁকি

`git status` অনুযায়ী **`apps/api/prisma/schema.prisma` modified এবং `20261111104717_calendar_full_module` migration untracked**। অর্থাৎ git থেকে deploy করলে Calendar module-এর টেবিল/column তৈরি হবে না → API crash করবে। **Commit + push না করে deploy করা যাবে না।**

### 3.4 Transaction / integrity
- ভালো: invoice create/payment/credit-note `$transaction`-এ চলে, double-entry GL balanced-check আছে।
- ঝুঁকি: payroll finalize (৫টি money write একসাথে নয়), expense payment (check→write একই transaction-এ নয়), lead convert (৫টি write, race-এ দুটি client তৈরি হতে পারে), retainer billing (double invoice)।

### 3.5 Backup
`docker-compose.yml`-এ nightly `pg_dump` profile আছে (১৪ দিন retention) — **ভালো**, কিন্তু optional profile, আর restore drill কোথাও ডকুমেন্টেড নয়। Production-এ অবশ্যই enable + মাসে একবার restore test।

---

## 4. মডিউল-ভিত্তিক ফলাফল

প্রতিটি মডিউলে: ✅ যা ভালো, ❌ সমস্যা (severity সহ)। Severity: **P0** = deploy blocker, **P1** = প্রথম সপ্তাহে, **P2** = পরে।

---

### 4.1 Auth / Login — 🟡 Acceptable

**✅ ভালো:** tokenVersion-based session revocation, bcrypt, login rate-limit (৩০/মিনিট), portal/staff token আলাদা, IP audit।

**❌ সমস্যা**

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| P0 | `auth/auth.module.ts:20` | `NODE_ENV !== "production"` হলে JWT secret falls back to **`"dev-secret"`** → staging-এ যে কেউ Owner token বানাতে পারে |
| P0 | `common/guards/admin-policy.guard.ts:71` | IP allowlist `X-Forwarded-For` **সবসময়** পড়ে → header spoof করে allowlist bypass |
| P1 | `auth.service.ts:53-64` | lockout শুধু in-memory, per-email (IP নয়) → ৫ ভুল password-এ যেকোনো user কে lock করা যায় (DoS); dummy email দিয়ে counter evict করা যায় |
| P1 | `users/users.service.ts:28-46` | role পরিবর্তনে `tokenVersion` bump হয় না → demote করা Owner পুরো session জুড়ে Owner থাকে |
| P1 | `auth.service.ts:141` | logout revocation শুধু Redis-এ; Redis ছাড়া/multi-instance-এ কাজ করে না |
| P2 | `jwt-auth.guard.ts:45` | `algorithms` pin করা নেই |
| P2 | `auth.controller.ts:16` | `POST /auth/login` 201 ফেরে (200 হওয়া উচিত) |
| P2 | `portal.service.ts:182` | portal password bcrypt cost **10**, staff **12** |

---

### 4.2 Control (Admin) — 🔴 Broken feature

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| **P0** | `control/control.service.ts:15` | `CONTROL_MODULES = ["CLIENTS","LEADS","PROJECTS","TASKS","FINANCE","PEOPLE","INSIGHTS","CONTROL","CALENDAR"]` কিন্তু guard চায় `ACCOUNTS, PULSE, FLOW, CAPITAL, INSIGHT`। **অ্যাডমিন "Clients/Leads/Finance" unchecked করলে কোনো কিছুই revoke হয় না** — UI মিথ্যা দেখায়। এটা security theater। |
| P1 | `control/control.service.ts:1063` | `GET /control/export` **পুরো DB** এক request-এ memory-তে লোড করে (কোনো `take` নেই) → OOM |
| P1 | `control.service.ts:958` | pipeline stage update `data: body` — mass assignment |
| P1 | `control.service.ts:899` | empty body-তে password change → bcrypt throw → **500** |
| P2 | `control.service.ts:265` | audit-log `from`/`to` unvalidated |

---

### 4.3 Dashboard — 🟠 সবচেয়ে ভারী প্রথম পেজ

**❌ সমস্যা**

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| P0 | `dashboard.service.ts:117-226` | `Promise.all`-এ একসাথে **৩৫টি top-level query** + ৩টি অনুসরণীয় query; Prisma-র relation load মিলিয়ে **৬৬ SQL query** (মাপা), সব `findMany` full-table: সব lead, সব task, সব invoice+lineItems+payments, সব payment, সব expense, সব vendorEngagement+payments, সব dollarSale, সব metricSnapshot |
| P0 | `dashboard.service.ts:974` | পুরো company snapshot **প্রতিটি role-কে** generation করে, পরে filter করে (`home()`) → employee-ও ৬৬ query চালায়, শুধু দেখায় না |
| P1 | `dashboard.service.ts:280-286` | `atRisk` project-এর জন্য দ্বিতীয় query (N+1) |
| P1 | `dashboard.service.ts:306-311` | `utilizationLog` OR-list query (employee সংখ্যা বাড়লে query বাড়ে) |
| P2 | cache key global | সব user একই ৩০ সেকেন্ডের snapshot পায়, role filter আলাদা করে — ঠিক আছে, কিন্তু cache miss-এ সবাই একসাথে ০.৫ সেকেন্ড দেয় |

**লক্ষ্য:** ৬৬ → ৮–১২ aggregate query, ৫৪৩ ms → < ১৫০ ms।

---

### 4.4 Pulse (Leads) — 🟠

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| P0 | `pulse.service.ts:1896-1970` | CSV import: প্রতি row-এ duplicate-check + create + update — **N+1**, ২০ হাজার row = ~৬০ হাজার query, transaction নেই |
| P1 | `pulse.service.ts:688-751` | `convert()` — ৫টি write, transaction নেই → **double-click-এ দুটি client + project** তৈরি হতে পারে |
| P1 | `pulse.service.ts:1376` | `quickLog`-এ `stage: "LOST"` **নীরবে উপেক্ষিত** (`STAGE_ORDER`-এ LOST নেই) → rep "lost" মার্ক করলেও lead queue-তে থাকে |
| P1 | `pulse.service.ts:695` | "latest proposal" `status desc` দিয়ে order → enum ordinal অনুযায়ী **REJECTED** সবার আগে → project ভুল proposal-এ link হয় |
| P1 | `pulse.service.ts:390-518` | lead create-এ ৭টি আলাদা write, transaction নেই |
| P1 | `lead-rules.service.ts:500-548` | nightly audit: সব lead + সব activity load করে **প্রতি lead-এ একটি UPDATE** |
| P1 | `pulse.service.ts:1796` | `/pulse/export` সব lead full row, streaming নেই |
| P2 | `pulse.service.ts:1230` | worklist ১০০০-এ চুপচাপ কাটা, count ভুল দেখায় |
| P2 | `pulse.controller.ts:340` | **`@Public()` upload serve** (P0 — 4.14 security দেখুন) |

---

### 4.5 Accounts — 🔴 Performance-এর সবচেয়ে খারাপ endpoint

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| **P0** | `accounts.service.ts:230-257` + `:327` | `list()` cache করে শুধু `client.findMany`; তারপর **`financialSummary()` cache-এর বাইরে** চলে → প্রতিবার **সব client-এর সব invoice + lineItems + payments** (≈১৫,০০০ row) লোড। এজন্যই warm-এও ৩৯০ ms। |
| P1 | `accounts.service.ts:345-465` | client detail: সব invoice + সব line item + সব expense + সব dollar sale |
| P1 | `accounts.service.ts:208-213` | `/accounts/client-lookup` — সব client, `@SkipPermission`, কোনো limit নেই |
| P1 | `accounts.service.ts:215-222` | health distribution সব client ফেরে |
| P2 | `accounts.service.ts:734-756` | primary contact বদল transactional নয় → primary ছাড়া client থেকে যেতে পারে |

---

### 4.6 Flow (Projects) — 🟠

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| P0 | `flow.service.ts:168-217` | `GET /flow/projects` **default-এ paginated নয়** → ১.৪ MB response, সব project + task aggregation |
| P1 | `flow.service.ts:107-139` | overview: সব task load করে completion % বের করে (`groupBy` যথেষ্ট) |
| P1 | `flow.service.ts:264-317` | project detail: সব task + file + report + milestone + deliverable একসাথে |
| P1 | `flow.service.ts:948-957` | CSV import-এ প্রতি row-এ re-score (N+1) |
| P1 | `flow.service.ts:1420-1439` | nightly reconcile: প্রতি project-এ ৩ query (৫,০০০ project = ১৫,০০০ query, একই সময়ে pulse audit-ও চলে) |
| P2 | `flow.service.ts:526-534` | auto-invoice failure শুধু `logger.warn` — invoice হয় না, retry নেই |
| P2 | `flow.service.ts:142-167` | query param সরাসরি Prisma enum-এ cast → ভুল值时 400/500 |

---

### 4.7 Tasks — 🟠

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| **P0** | `tasks.service.ts:1439-1467` | **Board-এ status বদলালে (`PATCH /tasks/:id/status`) project progress/health recompute হয় না** — কিন্তু `PATCH /tasks/:id` করে। অর্থাৎ drag-drop করে ৪০টি task Done করলে project ০% দেখায় (রাতে cron ঠিক করার আগ পর্যন্ত)। |
| P0 | `tasks.service.ts:1046-1081` | list-এ `groupBy` **পুরো Task টেবিল** scan করে, page-এ scoped নয় |
| P0 | `tasks.service.ts:1047` | list-এ `select` নেই → প্রতিটি task-এ `activityLog` (১০০ entry) + attachments + customFields JSON → ৪৭৫ KB |
| P1 | `tasks.service.ts:237-265` | `stats()` সব task + **সব time log** (ঐতিহাসিক) লোড করে JS-এ গণনা; প্রতিটি task write-এ invalidate হয় |
| P1 | `tasks.service.ts:439-443` | bulk action-এ প্রতি task-এর জন্য আলাদা `user.findUnique` (২০০ task = ২০০–৪০০ query) |
| P1 | `tasks.service.ts:1374` | `body.status === "DONE"` raw string চেক → `"done"` পাঠালে recurrence/estimate/notification কাজ করে না |
| P1 | `tasks.service.ts:1998-2069` | workload: employees × tasks JS loop |
| P2 | `tasks.service.ts:1049` | `archived=true` ফিল্টার আসলে **ফিল্টার সরিয়ে দেয়** → Archived tab-এ সব task দেখায় |
| P2 | `tasks.service.ts:379-396` | timer race: দুটি tab-এ দুটি running timer |
| P2 | `tasks.service.ts:1144` | `activityLog` read-modify-write → concurrent edit-এ audit entry হারায় |

---

### 4.8 People (HRM) — 🟠 (Payroll math সহ)

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| P0 | `capital/expense.service.ts:399-412` | `payExpense()` **`Payment.type` সেট করে না** → expense payout "IN" হিসেবে report হয় (P0 #1) |
| P1 | `payroll.service.ts:127-138` | unpaid leave: calendar day গণনা (weekend বাদ যায় না), মাসের সীমা clip হয় না |
| P1 | `payroll.service.ts:78-91` | payroll edit-এ bank **দুইবার debit** হতে পারে (`updateExpense` + `syncPostedSalary`) |
| P1 | `attendance.service.ts:555-562` | `recomputeMonth`: ২০০ employee × ২২ দিন = **৪,৪০০ sequential upsert** (৫–৯ সেকেন্ড), HTTP request আটকে থাকে |
| P1 | `people-automation.service.ts:80-94` | nightly cron: ২০০ × ২ × ৮ = **৩,২০০ query** প্রতিরাতে |
| P1 | `leave.service.ts:70-123` | `ensureBalances`: ২০০ × ৪ = **৮০০ SELECT + ৮০০ write** |
| P1 | `directory.service.ts:56-75` | overview: **সব approved leave** (ঐতিহাসিক) লোড করে اليومের count বের করে |
| P2 | `attendance.service.ts:393-417` | ZKTeco ATTLOG column mapping ভুল (status ↔ verify method swapped) |
| P2 | `iclock.controller.ts:43-58` | `NODE_ENV` না থাকলে device auth **fail-open** |
| P2 | `attendance.service.ts:148-155` | `attendancePolicy()` প্রতিবার **write (upsert)** করে — read path-এ write |

**✅ ভালো:** `runPayroll()` সত্যিই batched (২০০ employee-এ ~১০ query) — এটি সঠিক pattern, বাকি recompute-গুলোকে এভাবেই করা উচিত।

---

### 4.9 Capital (Finance) — 🔴 সবচেয়ে বেশি গুরুত্বপূর্ণ bugs

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| **P0** | `reporting.service.ts:434, 921-935` + `expense.service.ts:399` | ভেন্ডর/expense payment `type` ছাড়া তৈরি হয় (default `IN`), আর report-গুলো `type === "IN"` ফিল্টার করে → **কোম্পানি থেকে বের হওয়া টাকা income হিসেবে গোনা হয়**। Revenue, collection rate, cash-flow, bank statement — সব ভুল। |
| **P0** | `invoice.service.ts:532-543` | `updateInvoice` line item-এ **কোনো validation নেই** (`unitPrice: -5000` গ্রহণ করে, GL-এ negative revenue post হয়) |
| P1 | `invoice.service.ts:433-442` | create-এ `amount`-কে unit price ধরে, validator-এ line total ধরে → `{amount:1000, quantity:2}` = ২০০০ |
| P1 | `invoice.service.ts:1211-1226` | invoice ছাড়া `REFUND` credit note → সীমাহীন cash-out |
| P1 | `expense.service.ts:385-394` | `payExpense` stale read → double payment-এ vendor overpay + bank double debit |
| P1 | `payroll.service.ts:309-348` | payroll finalize-এ ৫টি money write, transaction নেই |
| P1 | `invoice.service.ts:163-184` | `invoicesPage` **পুরো টেবিল** লোড করে JS-এ slice করে ("server-side slice" comment মিথ্যা) |
| P1 | `reporting.service.ts:243/264/306/381` | ৪টি financial statement প্রতিবার **সব journal line** লোড করে JS-এ aggregate |
| P1 | `expense.service.ts:52-62` | expense list-এ প্রতি row-এ approval-policy query → **৫০০ expense = ৫০১ query** |
| P2 | `finance-kernel.ts:52-55` | VAT pre-discount subtotal-এ গণনা হয় |
| P2 | `billing.service.ts:244-289` | retainer auto-billing idempotent নয় → duplicate invoice |
| P2 | `ledger.service.ts:47,76` | plain `Error` → 500 |

**✅ ভালো:** double-entry GL, balanced-entry check, payment/credit-note transaction, aging calculation, `invoiceTotals()` একক source of truth হিসেবে ব্যবহার।

---

### 4.10 Calendar — 🟡 নতুন কোড, संरचना ভালো

- Feed-এ `take` cap আছে (১২০০/৮০০/৫০০…) — সচেতন ডিজাইন।
- ❌ ৮ টেবিল parallel load + ৮টি JS loop, ২৫ query, ৪৯৯ KB।
- ❌ নতুন migration + `schema.prisma` **git-এ commit করা হয়নি** (deploy blocker)।
- ❌ `calendar-public.controller.ts:15`-এ rate limit নেই (অন্য public token endpoint-এ আছে)।
- ❌ Plan lock/share token-এর expiry/rotation নীতি ডকুমেন্টেড নয়।

---

### 4.11 Insight — 🟡

- প্রতিটি report আলাদা endpoint, `where`-এ date bound আছে (ভালো)।
- ❌ `reports.service.ts`-এ ৩১টি `findMany`, কোনো `take` নেই; কয়েকটি query-তে date filter-ও নেই (`/insight/reports/campaigns` সব AdInsight)।
- ❌ প্রতিটি report JS-এ aggregate করে — AdInsight বছরে ৩০ হাজার row হলে প্রতিটি report ৩০ হাজার row transfer করবে।
- ✅ `pg_stat_user_tables`-এ দেখা যায় `AdInsight.clientId/date` index আছে — ভালো।

---

### 4.12 Portal (Client-facing) — 🟠 Security-sensitive

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| P0 | `portal.service.ts:441` | শুধু `canSeeAdSpend` patch করলে `modules: []` দিয়ে row তৈরি হয় → client-এর **সব tab বন্ধ** হয়ে যায় |
| P1 | `portal-client.service.ts:1601-1622` | calendar query-তে `projectIds` restriction প্রয়োগ হয় না → CUSTOM scope client অন্য project-এর post/event দেখে |
| P1 | `portal/telegram.service.ts:64` | link code `Math.random()` দিয়ে → PRNG recover করে অন্যের chat bind করা সম্ভব |
| P1 | `portal.service.ts:165-226` | portal credential/access পরিবর্তনের **audit log নেই** |
| P2 | `portal-client.service.ts:165` | password change "LOGGED_IN" হিসেবে log হয় |

**✅ ভালো:** portal token scope আলাদা, cross-client IDOR পাওয়া যায়নি, invoice public link token-bound + rate-limited।

---

### 4.13 Notifications / Search — 🟡

| Sev | সমস্যা |
|---|---|
| P1 | `GET /notifications/sse` `@Public()` + token query string-এ; `scope` চেক শুধু `"portal"` reject করে → ২ মিনিটের SSE token দিয়ে সাধারণ API call করা যায় |
| P2 | Dashboard + dropdown **দুটি আলাদা polling loop** (৪৫s + ৬০s) একই endpoint-এ |
| P2 | Search: কোনো debounce নেই (tasks page), প্রতিটি keystroke-এ full query |

---

### 4.14 Frontend / UI — 🔴 Speed-এর প্রধান কারণ

| Sev | ফাইল:লাইন | সমস্যা |
|---|---|---|
| **P0** | `components/app-shell.tsx:22-28` | `/auth/me` না আসা পর্যন্ত **শুধু spinner** → প্রতিটি route-এর HTML খালি; LCP = JS download + hydrate + RTT + page fetch (৩–৪ ধাপ serial) |
| **P0** | `app/(app)/capital/_components/capital-context.tsx:81-102` | `/capital/*` mount-এ **২৫টি API request** (statements, aging, profitability সব), আর `capital/layout.tsx`-এ provider থাকায় **প্রতিটি sub-route-এ ২৫টি** |
| **P0** | `capital/_components/tabs.tsx:19` | jsPDF static import — ১৪৩ KB gz প্রতিটি capital পেজে |
| **P0** | `flow-workspace.tsx:20` | `InvoiceDetailModal` static import — `/flow`-এ ১৭১ KB gz |
| P1 | `components/shared.tsx:3` | `cn()` যে ফাইলে, সেই ফাইলে framer-motion → ৪৪ KB gz **সব route-এ** (login সহ) |
| P1 | `pulse/page.tsx` | ৩,৪৭০ লাইনের single component, **৮৪ `useState`**, `React.memo` শূন্য → typing-এ পুরো page re-render (INP খারাপ) |
| P1 | `tasks/page.tsx:409-429` | search debounce নেই → "invoice" টাইপে ৭টি request |
| P1 | `accounts/page.tsx:890` | পুরো `/control/settings` লোড করে শুধু `clientTiers` পড়ে |
| P1 | `app/layout.tsx:33-36` | Google Fonts external stylesheet, preconnect নেই → render-blocking third-party |
| P1 | কোনো `middleware.ts` নেই | logged-out user পুরো ৬০০ KB JS download করে তারপর `/login`-এ যায় |
| P2 | `next.config.ts` | `output: "standalone"` নেই, `images` config নেই, `next/image` কোথাও ব্যবহার হয়নি |
| P2 | `package.json:18` | `html2canvas` dead dependency |

---

## 5. Security Summary

**ঠিক আছে ✅**
- RBAC guard chain: RateLimit → JWT → Roles → Permissions → AdminPolicy (সঠিক ক্রম)
- `PermissionsGuard` JWT-তে থাকা matrix থেকে চেক করে — প্রতি request-এ DB query নয়
- Security headers (CSP, HSTS in prod, nosniff, frame-deny), CORS explicit allowlist
- কোনো committed secret নেই, `.env` untracked
- `$queryRaw` সব static SQL, user input interpolate হয় না
- Flow file signed URL: `timingSafeEqual` + expiry
- Prisma error → 409/404/400 mapping (500 leak কমায়)

**সমস্যা ❌ (P0/P1)**
1. Public uploads route → Flow-এর signed-file protection bypass
2. WhatsApp/Telegram webhook secret না থাকলে **fail-open**
3. IP allowlist XFF spoof
4. JWT `dev-secret` fallback
5. Permission editor ভুল module key
6. `users.list()`-এ কোনো permission guard নেই (সব staff email/IP দেখা যায়)
7. Demo seed password production-এ
8. ৬০০টি route-এর মধ্যে মাত্র **১৫টিতে `@RateLimit`**

---

## 6. Reliability / Observability — 🔴

| সমস্যা | প্রভাব |
|---|---|
| `/api/health` **DB/Redis চেক করে না** | DB down হলেও health "ok" → load balancer traffic পাঠাতে থাকে |
| কোনো request logging/interceptor নেই | কোন endpoint কত সময় নিচ্ছে জানা যায় না |
| কোনো error tracking (Sentry) নেই | production ৫০০ error অন্ধভাবে হারায় |
| কোনো APM/metrics endpoint নেই | capacity planning অসম্ভব |
| ২৯টি `@Cron` একই process-এ, কয়েকটি একই মিনিটে (03:15-এ ২টি ভারী job) | একসাথে চলে event loop ব্লক করে |
| File upload local disk-এ | horizontal scaling-এ ভাঙবে, CDN নেই, virus scan নেই |

---

## 7. Deployment Checklist

### 🔴 Blocker — এগুলো ছাড়া deploy করবেন না (১৩টি)

1. `Payment.type` / expense payout direction ঠিক করুন; সব finance report-এ `expenseId: null` filter
2. `GET /pulse/uploads/:filename` বন্ধ করুন বা authenticated + scoped করুন
3. `NEXT_PUBLIC_API_URL` build-time-এ সেট করুন; unset হলে build fail করুন
4. `CONTROL_MODULES` ↔ guard keys মিলিয়ে দিন + existing role row migrate
5. WhatsApp/Telegram webhook secret বাধ্যতামূলক করুন (fail-closed)
6. IP allowlist-এ `TRUST_PROXY` respect করুন
7. JWT secret সব environment-এ বাধ্যতামূলক করুন (fallback সরান)
8. Finance/People endpoint-এ DTO validation (negative/absurd মান বন্ধ)
9. Missing index migration (৩.২ দেখুন)
10. `flow/projects`, `capital/invoices`, `tasks`, `accounts/clients`-এ pagination + `select`
11. Dashboard cold path query সংখ্যা কমান (৬৬ → <১৫)
12. Uncommitted `schema.prisma` + calendar migration commit করুন
13. Production-এ demo seed নয় — bootstrap script (roles + এক Owner, strong password, bcrypt 12)

### 🟠 প্রথম সপ্তাহে (High)

- jsPDF/Recharts/framer-motion dynamic import → ৩০০–৬০০ KB gz সাশ্রয়
- App shell spinner সরান, skeleton দিন + `middleware.ts`
- Capital context-এর ২৫ request per route ঠিক করুন
- `/accounts/clients` financial summary cache-এর ভেতরে আনুন + `groupBy`
- `tasks.updateStatus`-এ rescore যোগ করুন
- `convert()`/payroll finalize-এ transaction
- Health endpoint-এ DB/Redis probe
- Request logging + error tracking (Sentry)
- `TRUST_PROXY=1` reverse proxy-র পিছনে

### 🟡 দ্বিতীয়–চতুর্থ সপ্তাহ

- JS aggregation → SQL `groupBy`/`aggregate` (capital reports, insight reports)
- N+1 loop গুলো batch করা (attendance recompute, leave balances, CSV import)
- Mega-component ভাঙা + `React.memo` (pulse/flow/accounts/control)
- `next/image` + thumbnail
- Noto Sans Bengali self-host (`next/font`)
- Queue/worker আলাদা করা (cron + heavy jobs)
- `output: "standalone"` + ছোট Docker image

---

## 8. প্রত্যাশিত ফলাফল (fix করার পর)

| Metric | এখন | লক্ষ্য |
|---|---|---|
| Dashboard cold | ৫৪৩ ms / ৬৬ query | **< ১৫০ ms / < ১২ query** |
| Capital overview cold | ৯৩৪ ms | **< ২০০ ms** |
| Accounts list | ৩৯০ ms (warm!) | **< ১২০ ms** |
| Flow projects payload | ১,৪৩৭ KB | **< ১৫০ KB** (paginated) |
| Invoices payload | ৭১০ KB | **< ২০ KB** per page |
| p95 @ ১০ concurrent | ২,২৩৮ ms | **< ৫০০ ms** |
| Route JS (heaviest) | ৬২৭ KB gz | **< ২৫০ KB gz** |
| First contentful paint (4G) | ~২.৫–৩.৫ s | **< ১.২ s** |
| Login → dashboard | ~০.৭ s + ০.৫ s | **< ০.৪ s** |

---

## 9. QA artifacts (রিপ্রোডিউস করা যাবে)

এই রিপোর্টের সব সংখ্যা পুনরায় বের করার স্ক্রিপ্ট repo-তে আছে:

| ফাইল | কাজ |
|---|---|
| `qa/extract-routes.mjs` | ৬০০ route-এর তালিকা বের করে (`qa/routes.json`) |
| `qa/bench.mjs` | endpoint latency/payload benchmark |
| `qa/query-count.mjs` | প্রতি endpoint-এ SQL query সংখ্যা + DB সময় |
| `qa/loadtest.mjs` | concurrency test |
| `qa/bundle-size.mjs` | প্রতি route-এর gzip JS |
| `qa/load-data.mjs` | বাস্তব ভলিউম ডেটা জেনারেটর |
| `qa/explain.sql` | EXPLAIN প্রমাণ |

```bash
# পুনরায় চালাতে
node qa/extract-routes.mjs
node qa/bench.mjs http://127.0.0.1:4000/api
CONCURRENCY=10 DURATION=30 node qa/loadtest.mjs
node qa/bundle-size.mjs
```

---

## 10. চূড়ান্ত মন্তব্য

এই CRM-এর **ভিত্তি ভালো** — একটি এজেন্সি OS হিসেবে মডিউল কভারেজ, RBAC, double-entry accounting, portal isolation এবং error handling অনেক বাণিজ্যিক product-এর চেয়ে পরিপক্ক।

কিন্তু **তিনটি স্তরে কাজ বাকি:**

1. **বিশ্বাস (correctness):** finance-এ vendor payment income হিসেবে যাচ্ছে, permission editor কাজ করছে না, task status project progress আপডেট করছে না — এগুলো মেরামত না করে production-এ গেলে ব্যবহারকারী **ভুল সংখ্যার উপর সিদ্ধান্ত নেবেন**, আর সেটাই সবচেয়ে বড় ঝুঁকি।
2. **গতি (performance):** এখন এটি "ডেমো ডেটায় দ্রুত, বাস্তব ডেটায় ধীর" অবস্থায় আছে। ৩০ সেকেন্ডের cache লুকিয়ে রাখছে আসল সমস্যা। pagination + aggregate + index + bundle — এই চারটি ঠিক করলে ৪–৬× উন্নতি সম্ভব।
3. **নিরাপত্তা ও 운영:** public upload, webhook fail-open, health probe, logging — এগুলো ছাড়া production-এ অন্ধভাবে চলা হবে।

**প্রস্তাবিত পথ:** Blocker ১৩টি (আনুমানিক ৫–৭ কার্যদিবস) → deploy staging-এ → ১ সপ্তাহ soak test (আসল ডেটা ভলিউমে) → High list (১ সপ্তাহ) → production। সরাসরি production-এ যাওয়ার আগে অন্তত Blocker তালিকাটি সম্পূর্ণ করা অপরিহার্য।
