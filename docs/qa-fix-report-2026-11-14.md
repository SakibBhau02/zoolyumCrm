# Zoolyum OS — QA ফিক্স রিপোর্ট (P0 → P3)

**তারিখ:** ১৪ নভেম্বর ২০২৬
**ভিত্তি:** `docs/qa-full-audit-2026-11-14.md` (৭.৫/১০)
**বিস্তারিত ফিক্স-লগ:** `qa-evidence/audit-2026-11-14/fix-log.md` + `ui-fixes.md`

---

## ১. ফলাফল এক নজরে

| মেট্রিক | আগে | পরে |
|---|---:|---:|
| `npm audit` — critical | 3 | **0** |
| `npm audit` — মোট | 19 | **8** (সব dev/build-only) |
| axe-core violation (১১ পেজ) | 321 | **65** (−৮০%) |
| Unit test | 0 | **18/18** |
| `typecheck` (api+web) | পাস | **পাস** |
| `test:smoke` (authz gate) | 28/28 | **28/28** |
| `test:finance` (ledger invariants) | 14/14 | **14/14** |
| Playwright E2E | 20/20 (লোডে ৭টি ফ্লেকি) | **20/20** |
| Dashboard `dueToday` | 0 (ভুল) | **3 (সঠিক)** |
| Dashboard বনাম Pulse `staleLeads` | 5 vs 3 | **3 vs 3** |
| Dashboard বনাম Capital `expensesMonth` | 399,500 vs 339,500 | **339,500 vs 339,500** |
| DB index hole (`JournalEntryLine.entryId`) | নেই (206k seq read) | **আছে** |
| Prisma migration drift | ০ | **০ (৬৯ migration)** |

---

## ২. কী কী ঠিক হয়েছে (সংক্ষেপে)

### P0 — প্রোডাকশন ব্লকার
- **Next.js 16.3.0 → 16.4.6** — একাধিক unauthenticated RCE অ্যাডভাইজরি বন্ধ।
- **SEC-01:** HR/Admin আর টাস্ক এডিট করতে পারে না (`PATCH /tasks/:id`: 200 → **403**), PM আগের মতোই 200। permission matrix-ই এখন একমাত্র উৎস।
- **UX-01:** লগইনে পণ্যের নাম ("Welcome to Zoolyum OS") আবার দৃশ্যমান — ভাঙা gradient টোকেন ঠিক।
- **BUG-001:** ড্যাশবোর্ডের "due today" গণনা ঠিক (তারিখ উইন্ডো `[today, tomorrow)`).

### P1 — নিরাপত্তা ও নির্ভুলতা
- ড্যাশবোর্ড এখন **role অনুযায়ী block redact** করে — HR আর ক্লায়েন্ট-প্রতি revenue/pipeline দেখে না।
- JWT secret-এ production-এ entropy check; `FILE_URL_SECRET` বাধ্যতামূলক।
- Login lockout `(email, IP)`-ভিত্তিক → কেউ ইচ্ছা করে অ্যাকাউন্ট লক করতে পারবে না।
- `change-password` শুধু নিজের অ্যাকাউন্টে (Owner ছাড়া)।
- Web-এ **CSP + HSTS**, `X-Powered-By` বন্ধ।
- iClock ডিভাইস API fail-closed (শুধু explicit `ICLOCK_ALLOW_ANONYMOUS=1`-এ লোকাল ডেমো)।
- `/users` এখন শুধু Owner/PEOPLE/CONTROL-এ email দেয়।
- `2026-02-31`-এর মতো অসম্ভব তারিখ **400**, চুপচাপ rollover নয়।
- Calendar-এ `endDate < date`, `endTime <= startTime` — create ও update দুটোতেই **400**।
- Client নাম (≤200) ও expense description (≤2000)-এ length cap।
- ড্যাশবোর্ডের দুটো KPI এখন অন্য মডিউলের সাথে মেলে।
- Leave request এখন **cancel** করা যায় (`DELETE /people/leave-requests/:id`, status `CANCELLED`)।
- ব্র্যান্ড রঙ স্বয়ংক্রিয়ভাবে AA-সেফ শেডে নামে (`#FF5001` → ~`#D04101`)।
- Skip link, প্রতি route-এ আলাদা `<title>`, clickable row আর invalid `role="button"` নয়।

### P2 — পারফরম্যান্স, টেস্ট, UI
- `JournalEntryLine.entryId` index; Lead সার্চে **trigram GIN index** (schema-তে declared, drift-free)।
- Dashboard warm-up cron এখন নিষ্ক্রিয় থাকলে চলে না (আগে ৬০ সেকেন্ডে ৪১ query)।
- `/pulse/leads`, `/capital/invoices`, `/people/attendance/report` cache + write-side invalidation।
- সবচেয়ে খারাপ N+1 (`overdueReminders`) batch করা হয়েছে: প্রতি task-এ ৩ query → প্রতি রানে ২ query।
- ১৭টি UI/a11y আইটেম: calendar chip ২৪px, ৪টি select + icon button-এ label, sticky table header (Tasks/Accounts), `aria-sort`, Insight trend ক্রম (Sep→Oct→Nov), People/Portal-এ একটাই `h1`, Portal table clipping, মোবাইলে Tasks chrome ৬৪৫px → ৪২০px, in-app confirm, popover/modal focus, Control health flicker, 1024px topbar।

### P3 — হাইজিন
- **প্রথম unit test suite** (18 test, নতুন dependency ছাড়াই `tsx --test`): invoice money math, receivable rules, strict dates।
- CI-তে `test:unit` + ব্যর্থতায় Playwright artifact upload।
- **recursive `node_modules/zoolyum-os`** (repo-র নিজের দিকে junction, ৮+ স্তর) সরানো — `apps/web`-এ ভুল self-dependency ছিল।
- রুটের ৩৫টি stray log/probe/screenshot → `artifacts/local-qa/`।
- README-তে production env চেকলিস্ট আপডেট।

---

## ৩. যাচাই কীভাবে হয়েছে

```bash
npm run typecheck        # api + web clean
npm run test:unit        # 18/18
npm run test:smoke       # 28/28
npm run test:finance     # 14/14
npm run test:e2e         # 20/20
npm audit                # 8 findings, 0 critical
cd apps/api && npx prisma migrate status   # 69 migrations, up to date
```

উপরন্তু একটি custom verification script (২০টি চেক) চালানো হয়েছে: HR-এর task PATCH 403, PM-এর 200, dashboard redaction (HR/BizDev/Finance আলাদা), dueToday, অসম্ভব তারিখ, inverted calendar, users email, cross-user password, device key এবং cleanup (disposable record delete verified)।

### axe-core (WCAG 2.2 AA) — পেজভিত্তিক

| পেজ | আগে | পরে |
|---|---:|---:|
| Dashboard | ~40 | 7 |
| Pulse | — | 4 |
| Accounts | 17 | 5 |
| Flow | 18 | 16 |
| Tasks | 23 | 15 |
| People | 5 | **0** |
| Capital | 3 | 1 |
| Insight | 3 | 1 |
| Calendar | 51 | 13 |
| Control | 5 | 3 |
| Portal | 9 | **0** |
| **মোট** | **321** | **65** |

---

## ৪. যা এখনো বাকি (সৎ তালিকা)

| আইটেম | কেন বাকি | পরবর্তী ধাপ |
|---|---|---|
| Calendar-এর ১৩টি contrast node | month-grid-এর ৮.৫px মাইক্রো-লেবেল রঙিন tint-এর উপর; আলাদা ডিজাইন সিদ্ধান্ত দরকার | chip-কে solid tint + গাঢ় টেক্সটে রূপান্তর |
| Tasks ৫টি `label-content-name-mismatch`, Flow ১৬টি contrast | பொது component-এর ভিজুয়াল সিদ্ধান্ত | আলাদা পাস |
| `/capital/invoices` পুরো invoice book মেমরিতে পড়ে | chips/totals SQL-এ সরানো finance-math rewrite | আলাদা চেঞ্জ উইন্ডো (এখন ২০s cache) |
| `prisma` 6.19 → 7.x (dev-only advisory) | major upgrade | আলাদা টাস্ক |
| E2E dev-server-এ চলে | ২০ worker একসাথে compile করলে মাঝে মাঝে ১৫s wait ফেল করে | CI-তে production build দিয়ে চালানো |
| `docker-compose` ডেমো পাসওয়ার্ড, ০-byte response ২টি | ইচ্ছাকৃত/accepted risk | — |

---

## ৫. ব্যবহারকারীর জন্য

- সার্ভার রিস্টার্ট লাগবে না — API (watch) ও web (Next dev) ইতিমধ্যেই নতুন কোডে চলছে।
- production-এ যাওয়ার আগে `.env`-এ **আলাদা `FILE_URL_SECRET`** এবং র‍্যান্ডম `JWT_SECRET` দিতে হবে (dev-এর phrase এখন production-এ reject হবে)।
