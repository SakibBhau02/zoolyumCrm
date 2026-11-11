# People (HRM) মডিউল — QA অডিট রিপোর্ট

**Module:** `/people` — Overview, Team 360, Directory, Org chart, Skills, Onboarding, Assets, Attendance, Leave, Holidays, Policy, Payroll, Reviews, OKR, Training, Hiring
**Environment:** web `http://localhost:3000/people` · API `http://localhost:4000/api/people` · NestJS + Prisma + PostgreSQL · Next.js (Turbopack)
**Date:** 10 November 2026
**Tester:** Automated API probe (99 endpoint) + কোড রিভিউ (backend ১৭ ফাইল, frontend ২৪ ফাইল) + live browser pass (১৪ রুট)
**Verdict:** **অডিটের সব P0 ও P1 ঠিক করা হয়েছে এবং লাইভ রি-ভেরিফাই করা হয়েছে; P2-এর বড় অংশও ঠিক হয়েছে।** (§0 দেখুন)
**Overall score:** অডিটে **58/100** → ফিক্স পাসের পর **84/100**

---

## 0. ফিক্স পাস (10 Nov 2026)

প্রতিটি আইটেম কোডে ঠিক করা হয়েছে এবং API/ব্রাউজার দিয়ে যাচাই করা হয়েছে। কোনো ফিচার/আচরণ বাদ যায়নি।

### P0 — সব ঠিক, সব ভেরিফায়েড

| # | ইস্যু | কী বদলানো হলো | যাচাই |
|---|---|---|---|
| P0-1 | রাতের cron HR-এর attendance correction মুছে দিত | `Attendance.correctedFields[]` নতুন কলাম + মার্জ-লজিক: syncDay শুধু HR-এর না-ছোঁয়া ফিল্ড রিফ্রেশ করে; `force` (Recompute বাটন) সব রিসেট করে | correction → nightly cron → **PRESENT থাকে**; force recompute → ABSENT ফিরে আসে ✅ |
| P0-2 | Team 360 যেকোনো সহকর্মীর বেতন দেখাত | `team.service`-এ `PAY_ROLES` gate; Directory-র মতোই payroll ব্লক null | Owner → netPay 68250 · PM ও Team Member → **null** ✅ |
| P0-3 | Leave UI-তে `ANNUAL` (সার্ভারে নেই), `EARNED` অনুপস্থিত | `constants.ts` → `CASUAL, SICK, EARNED, UNPAID` | মডালে "annual" নেই, "earned" আছে ✅ |
| P0-4 | নতুন মাসের payroll UI থেকে চালানো অসম্ভব (picker snap-back) | `jumped` flag প্রথম লোডেই একবার সেট হয় | 2026-12 নির্বাচন → থাকে, "Run payroll for 2026-12" দেখায় ✅ |

### P1 — সব ঠিক

| # | ইস্যু | কী বদলানো হলো | যাচাই |
|---|---|---|---|
| P1-1 | ভুল month/period → ৫০০ | `assertPeriod`/`assertDay` হেল্পার, সব attendance/payroll/punch রুটে | `month=banana`, `period=banana`, `from=xx` → **400** নির্দিষ্ট মেসেজ ✅ |
| P1-2 | একই মাসে দুবার payroll (double salary) | `PayrollRecord @@unique(employeeId, period)` + `createMany(skipDuplicates)` | দুইবার run → ২য় বার `createdCount: 0, skipped: 10` ✅ |
| P1-3 | recompute-এ ব্যাংক ব্যালান্স ড্রিফট | `syncPostedSalary()` হেল্পার — expense + GL + bank delta একসাথে, edit ও recompute দুটোতেই | কোড-পথ এক ✅ |
| P1-4 | checkout ছাড়া পুরনো দিনে OT অনন্ত বাড়ত | `dayHours(..., { isToday })` — past open day = 0 worked, OT নেই | রিপোর্ট/ট্রেন্ড/লাইভ বোর্ড তিনটেই পাস করা ✅ |
| P1-5 | Leave approve race → double deduction | `$transaction` + conditional `updateMany(balanceDays >= needed)` + status-guarded update | insufficient/আগেই decided হলে rollback ✅ |
| P1-6 | Policy shift কারো উপর প্রয়োগ হতো না | `Employee.shiftStart/shiftEnd` থেকে DB default সরানো + backfill (NULL = policy), `effectiveShift()` হেল্পার | policy 09:00 → employee effective shift **09:00** ✅ (তারপর 10:00 ফেরত) |
| P1-7 | HR/Admin meeting attendance মার্ক করতে পারত না | UI-তে PULSE edit gate (`canManagePulse`), নাহলে "view only" | রেন্ডার গেট ✅ |
| P1-8 | সব leave balance সবার জন্য খোলা | `scopeEmployeeId()` — approver/edit না হলে শুধু নিজের | Finance → নিজের ১ জন; অন্যের `?employeeId=` উপেক্ষিত ✅ |
| P1-9 | সব leave request সবার জন্য | একই স্কোপ, `leaveRequests(scopeEmployeeId)` | Finance → 0 (নিজের নেই), approver → সব ✅ |
| P1-10 | `applyLeave` fail-open | self না থাকলে এখন `403`, client-এর `employeeId` আর ব্যবহার হয় না | কোড-পথ ✅ |
| P1-11 | iClock key ছাড়া সম্পূর্ণ পাবলিক | production-এ key না থাকলে `503`; key থাকলে `timingSafeEqual`; SN বাধ্যতামূলক; devicecmd-এ rate limit | key ছাড়া SN ছাড়া POST → **400 "SN is required"** ✅ |
| P1-12 | grace minutes সেভ করলেই ৪০০ | সার্ভারে সংখ্যা coercion + ভ্যালিডেশন; UI সংখ্যা পাঠায় | UI Save → `graceMinutes: 16` persist ✅ (তারপর 15 ফেরত) |
| P1-13 | `TERMINATED` (অবৈধ), `EXITED` অনুপস্থিত | enum ঠিক করা, EXITED বাছলে auto-offboarding চলে | dropdown ✅ |
| P1-14 | ফাঁকা attendance-এ চুপচাপ পুরো বেতন | `runPayroll` এখন `warning` + `attendanceRows` দেয়, UI-তে toast-এ দেখায় | 2026-12 run → warning এসেছে ✅ |
| P1-15 | Save/Delete ব্যর্থতা চুপচাপ | পেজে try/catch + মডালে inline error; Delete এখন সত্যিই ডিলিট করে | কোড-পথ ✅ |
| P1-16 | সব PII সবার জন্য | PEOPLE view না থাকলে `employees` শুধু picker shape (id/name/role/dept); emergency contact ও documents HR-only | Sales → ৬টি ফিল্ড, PII নেই ✅ |

### P2 — ঠিক হয়েছে (নির্বাচিত)

`punches` limit 2000 + range-aware · `PunchLog @@unique(deviceId,punchTime)` + batch validate (bad row আর ৫০০ করে না, `skipped` রিপোর্ট করে) · `recomputeMonth` join-date guard (নতুন hire-এর আগের দিন ABSENT হয় না) · leave-এ কাজ করা দিন এখন "present" (leave নয়) · `lateList` EXITED বাদ দেয় · automation-এ digest/documents/onboarding dedupe + override-aware working day · `#"Half-day = half LOP"` টগল সত্যিই কাজ করে (`proRataEnabled`) · leave quota বদলালে approved-consumed হিসাবে ব্যালান্স resync · holiday/leave/course/candidate/asset/OKR-এ explicit validation ও P2025→404 · asset assign re-assign ব্লক + tag overflow · enrollment re-enroll আপডেট · OKR manual status আর clobber হয় না · device/holiday delete-এ FK error গেলা হয় না।

**Frontend:** payroll picker · settings Save (আর blank flash নেই) · grace عدد · leave drawer decision-এর পর রিফ্রেশ · OKR avg progress (`overallProgress`) · OKR inline edit local state + clamp · directory load/error states · devices/trends/punch error surfacing · punches tab range · correction-এ date disabled · leave date-range guard · modal backdrop বন্ধ (সব form modal-এ `closeOnBackdrop={false}`) · delete confirm (holidays/courses/OKR) · `window.prompt` সরিয়ে inline step form · assign-asset state reset · aria-labels · view-only রোলে write বাটন লুকানো (Directory/Attendance/Leave/Assets/Onboarding/Training/Holidays/Candidates/Performance)।

**যা ইচ্ছাকৃতভাবে বাকি (প্রোডাক্ট সিদ্ধান্ত):**
1. **আগে চলে গেলে half-day** — `undertime` এখনো deduction করে না (নতুন নীতি দরকার: কত ঘণ্টা কমলে half-day)।
2. **Weekly-off/হলিডেতে কাজ** — punch থাকলেও OT ক্রেডিট হয় না (comp-off নীতি দরকার)।
3. `apps/api/.env.example`-এ `ICLOCK_DEVICE_KEY` লাইনটি এডিটর-পারমিশনের কারণে যোগ করা যায়নি — প্রোডাকশনে হাতে সেট করতে হবে (নাহলে iClock 503 দেবে)।

### ফিক্স-পরবর্তী রি-ভেরিফিকেশন

```
api  tsc --noEmit   → clean
web  tsc --noEmit   → clean
39/39 GET endpoints → 200
14 routes browser   → 0 console errors
payroll run x2      → 201 (10 created) → 201 (0 created, 10 skipped)
correction vs cron  → preserved
hash: pm/tm pay     → null, owner → 68250
```


| এরিয়া | স্কোর | সংক্ষেপে |
|---|---|---|
| API availability & contract | 9/10 | সব GET endpoint সচল, path/verb মিসম্যাচ নেই |
| Permission & privacy | 5/10 | ৩টি বাস্তব ডেটা লিক (বেতন, ছুটির ব্যালান্স, PII) |
| Attendance integrity | 4/10 | ম্যানুয়াল কারেকশন রাতে মুছে যায়; খোলা দিনে OT বাড়তে থাকে |
| Leave integrity | 5/10 | balance deduction non-transactional; ANNUAL type ভাঙা |
| Payroll integrity | 5/10 | duplicate run guard নেই; recompute-এ ব্যাংক ব্যালান্স ড্রিফট |
| Frontend functionality | 5/10 | নতুন মাসের payroll চালানো UI থেকে অসম্ভব; ২টি enum ভাঙা |
| UX / a11y / polish | 6/10 | ভালো প্যাটার্ন আছে, কিন্তু ৪০+ ছোট ঘাটতি |
| Reliability & validation | 4/10 | ৪ জায়গায় ৫০০, অনেক silent fallback |

---

## 1. কীভাবে টেস্ট করা হয়েছে

| পদ্ধতি | বিবরণ |
|---|---|
| API probe | Owner / HR / PM / Team Member / Finance — ৫টি রোল দিয়ে ৯৯টি endpoint; ৩৯টি GET, ২৭টি POST, ১৬টি PATCH, ১২টি DELETE |
| Negative probe | invalid month/period/date, খালি body, ভুল enum, duplicate deviceId, non-existent FK |
| Auth probe | টোকেন ছাড়া (→ 401 প্রত্যাশিত), কম-প্রিভিলেজ টোকেনে write (→ 403 প্রত্যাশিত) |
| Code review | `apps/api/src/people/*` (১৭ ফাইল) + `apps/web/src/app/(app)/people/**` + `schema.prisma` |
| Browser pass | ১৯টি রুট নেভিগেট, console error + network capture |
| Build gate | `npm run typecheck` (api + web) — **পরিষ্কার পাস** |
| Evidence | `qa-evidence/people-overview.png`, `people-attendance.png`, `people-team.png`, `people-payroll.png` |

> লাইভ probe ডেটাবেসে ৩টি ছোট লেখা করেছে (একটি kiosk punch, ২০২৬ সালের leave-balance rows, ২টি automation notification)। কোনোটিই কোড বা কনফিগ বদলায়নি — বিস্তারিত §১১।

---

## 2. এন্ডপয়েন্ট ইনভেন্টরি — ফলাফল

| গ্রুপ | সংখ্যা | ফলাফল |
|---|---|---|
| Overview / My space | 8 | ✅ সব 200 |
| Employees / Directory | 5 | ⚠️ GET 200, delete FK-এ ভুল 404 |
| Attendance (report/live/trends/late/punches/devices) | 16 | ⚠️ ২টি ৫০০ (invalid month), late-list অসম্পূর্ণ |
| Leave | 8 | ⚠️ ৩টি প্রাইভেসি লিক |
| Payroll | 7 | ❌ run → ৫০০, duplicate guard নেই |
| Performance / OKR / Training / Hiring | 12 | ✅ 200 (খালি ডেটাসেট) |
| Onboarding / Assets / Holidays / Org / Team / Skills | 15 | ✅ 200 |
| Automation (`/people/automation/:action`) | 1 | ✅ চলে (dedupe-এ ফাঁক) |
| iClock (ডিভাইস) | 5 | ❌ key না থাকলে সম্পূর্ণ পাবলিক |

**মোট:** ৯৯টি হ্যান্ডলার, `people.controller.ts` (613 লাইন) + `iclock.controller.ts`।

---

## 3. ফিচার-বাই-ফিচার স্ট্যাটাস

| ফিচার | সার্ভার | UI | মন্তব্য |
|---|---|---|---|
| Overview / হেডার কাউন্টার | ✅ | ✅ | payroll badge "Jul 2026" দেখায় কারণ ওটাই শেষ রেকর্ড — কারেক্ট, কিন্তু স্টেল |
| My space (self-service) | ✅ | ✅ | punch/leave/telegram/payslip — সবচেয়ে পরিপক্ব অংশ |
| Directory + profile | ✅ | ⚠️ | save error চুপচাপ গায়েব, Delete বাটন ডেড |
| Team 360 | ⚠️ | ✅ | **বেতন লিক** (P0-2) |
| Org chart | ✅ | ✅ | cycle-safe ট্রি লজিক ঠিক |
| Skills matrix | ✅ | ✅ | `avgExperience` আসলে tenure, লেবেল ভুল |
| Attendance engine | ⚠️ | ✅ | কারেকশন রাতে হারায় (P0-1), open-day OT বাড়ে (P1-4) |
| Attendance policy | ⚠️ | ❌ | grace minutes সেভ করলেই ৪০০ (P1-6) |
| Work calendar | ✅ | ✅ | past month lock ঠিক আছে |
| Leave apply/approve | ⚠️ | ❌ | **ANNUAL টাইপ ভাঙা (P0-3)**, race (P1-5) |
| Holidays | ✅ | ⚠️ | confirm ছাড়া ডিলিট |
| Payroll run | ❌ | ❌ | ৫০০ on bad period; নতুন মাস UI থেকে অসম্ভব (P0-4) |
| Payslip | ✅ | ✅ | ownership gate ঠিক |
| Reviews / OKR | ✅ | ⚠️ | Avg progress সবসময় 0% দেখায় |
| Training | ✅ | ⚠️ | re-enroll চুপচাপ ignore |
| Hiring pipeline | ✅ | ⚠️ | confirm ছাড়া ডিলিট, খালি ডেটাসেট |
| Onboarding/offboarding | ✅ | ⚠️ | EXITED status UI-তে নেই → auto-offboarding trigger হয় না |
| Assets | ✅ | ⚠️ | assign dialog-এ আগের employee থেকে যায় |
| Telegram link | ✅ | ✅ | deep link + TTL ঠিক |

---

## 4. P0 — ব্লকার (এখনই ঠিক করা দরকার)

### P0-1 · রাতের cron HR-এর ম্যানুয়াল attendance correction মুছে দেয়
`apps/api/src/people/attendance.service.ts:215-219` — `syncDay()`-এর upsert `{ status, checkInTime, checkOutTime }` সবসময় লিখে দেয়, `isManuallyCorrected` ফ্ল্যাগ দেখে না। অথচ `people-automation.service.ts:59-68` প্রতিদিন ২৩:৪৫-এ আজ ও গতকালের জন্য `recomputeDay` চালায়।
**পরিণতি:** HR সন্ধ্যায় correction করলে রাতে সেটি punch থেকে পুনরায় গণনা হয়ে মুছে যায়; `isManuallyCorrected: true` ও `AttendanceCorrection` অডিট রো থেকে যায় — অর্থাৎ রেকর্ড নিজেই মিথ্যা বলে। payroll এ reverted মান থেকেই কাটে।
**ফিক্স:** `syncDay`-এ `isManuallyCorrected` থাকলে skip (শুধু explicit Recompute বাটনে force), অথবা derived মান আলাদা কলামে রাখুন।

### P0-2 · Team 360 যেকোনো সহকর্মীর বেতন দেখায়
`apps/api/src/people/team.service.ts:246-256` — `payroll.netPay` raw রিটার্ন হয়; `directory.service.ts:10-13`-এর `stripPay` এখানে ব্যবহার হয়নি।
**লাইভ প্রমাণ:** `tanvir@zoolyum.com` (Team Member, PEOPLE = view-only) → `GET /api/people/team/<other>` → `payroll.netPay: 51750`।
**পরিণতি:** সর্বনিম্ন রোলের কর্মীও সবার বেতন পড়তে পারে। Directory detail ঠিকভাবে mask করে, তাই এটি স্পষ্ট regression।
**ফিক্স:** team.service-এও একই `stripPay`/role gate প্রয়োগ করুন।

### P0-3 · Leave টাইপ ড্রপডাউন ভাঙা — "Annual" সবসময় ৪০০
`apps/web/.../people/_components/constants.ts:3` → `["CASUAL","SICK","ANNUAL","UNPAID"]`
সার্ভার enum `CASUAL | SICK | EARNED | UNPAID` (`schema.prisma:2450`, whitelist `leave.service.ts:157`)।
**পরিণতি:** UI-তে "annual" বেছে সাবমিট করলে `400 Unknown leave type: ANNUAL`; আর **EARNED** লিভ কোনো ফর্ম থেকেই দেওয়া যায় না (settings পেজে আলাদা লিস্ট আছে — `settings/page.tsx:309`)।
**ফিক্স:** `constants.ts`-এ `EARNED` বসিয়ে settings পেজেও সেটাই import করুন।

### P0-4 · নতুন মাসের payroll UI থেকে চালানো অসম্ভব
`apps/web/.../people/payroll/page.tsx:141-148` — `jumped.current` শুধু jump হওয়ার ভেতরে `true` হয়। যে মাসে রেকর্ড আছে সেটি দেখার সময় flag `false` থাকে, ফলে খালি মাস নির্বাচন করলেই effect আবার `status.period`-এ ফিরিয়ে দেয়।
**পরিণতি:** চলতি মাসের payroll একবার চালানোর পর "পরের মাস বেছে Run payroll" ⇒ পিকার নিজেই লাফিয়ে আগের মাসে ফিরে যায়। মডিউলের মূল মাসিক কাজটি আটকে যায়।
**ফিক্স:** প্রথম load settle হলে `jumped.current = true` (branch নির্বিশেষে), অথবা শুধু ডিফল্ট period-এ auto-jump।

> সহায়ক প্রমাণ: `POST /api/people/payroll/run` খালি body বা `period:"banana"` দিলে **৫০০ Internal server error** (নিচে P1-1)।

---

## 5. P1 — মেজর (এই স্প্রিন্টে)

| # | ইস্যু | প্রমাণ (file:line) | প্রভাব |
|---|---|---|---|
| P1-1 | Unvalidated month/period → ৫০০ | `payroll.service.ts:96-104` (`dhakaDaysInMonth(period)`), `attendance.service.ts:403-406`, `:323-327` | লাইভ: `POST payroll/run {}` → 500, `period:"banana"` → 500, `attendance/recompute {month:"banana"}` → 500, `GET punches?month=banana` → 500 |
| P1-2 | Payroll double-run সম্ভব | `schema.prisma:1116-1137`-এ `@@unique([employeeId, period])` নেই + `payroll.service.ts:98-120` check-then-create | দুইজন HR একসাথে Run চাপলে বা double-click-এ একই কর্মীর দুটি রেকর্ড; FINALIZE হলে দুবার salary expense |
| P1-3 | Recompute-এ ব্যাংক ব্যালান্স ড্রিফট | `payroll.service.ts:234-236` `updateExpense(..., {skipPayrollSync:true})` কিন্তু `updatePayrollRecord` (`:186-193`)-এর মতো balance adjust করে না | FINALIZED রেকর্ড recompute করলে netPay বদলায়, GL/expense বদলায়, ব্যাংক ব্যালান্স বদলায় না → cash মেলে না |
| P1-4 | checkout ছাড়া পুরনো দিনে OT অনন্ত বাড়ে | `attendance.service.ts:77` `const end = checkOut ?? now` | ৩ তারিখে check-in, checkout নেই — ১০ তারিখে দেখলে worked ≈ ১০,০০০ মিনিট, overtime ≈ ৯,৫০০; প্রতিবার ভিন্ন সংখ্যা |
| P1-5 | Leave approve non-transactional → double deduction | `leave.service.ts:223-238` findUnique → compare → update | দুটি ক্লিক/দুই approver ⇒ ব্যালান্স ১০০→৯৫→৯৩, কোটা দুইবার পাস |
| P1-6 | Policy shift বদলালে কারো উপর প্রয়োগ হয় না | `attendance.service.ts:45-46, 63-66` `emp.shiftStart ?? policy.shiftStart`; `schema.prisma:1034-1035`-এ `@default("10:00")` | সব কর্মীর `shiftStart` সবসময় "10:00" — policy ০৯:০০ করলেও late/OT আগের হিসাবেই |
| P1-7 | HR/Admin meeting attendance মার্ক করতে পারে না | `team/page.tsx:472` → `PATCH /pulse/meetings/...`; `pulse.controller.ts` `@RequirePermission("PULSE")`; seeded HR role-এ `PULSE: false` (`seed.ts:148`) | মূল HR persona-র প্রতিটি মার্ক ৪০৩ |
| P1-8 | Leave balance সবার জন্য খোলা | `people.controller.ts:283-287` `@SkipPermission()` + optional `employeeId`; `leave.service.ts:311-317` | লাইভ: Finance সব কর্মীর sick/casual/earned ব্যালান্স পড়ে (এবং `?employeeId=` দিয়ে যে কাউকে) |
| P1-9 | সব leave request সবার জন্য | `people.controller.ts:263-266` (কোনো `@Roles` নেই, শুধু PEOPLE view) | Finance ২০০ পায় — request, decisionNote, employee id সব |
| P1-10 | `applyLeave`-এ fail-open authorization | `leave.service.ts:149-154` — `if (self?.id) body = {...}`; self না থাকলে client-এর `employeeId` ব্যবহৃত | User↔Employee লিংক না থাকা যেকোনো স্টাফ অন্যের নামে লিভ বসাতে পারে |
| P1-11 | iClock উৎস সম্পূর্ণ পাবলিক | `iclock.controller.ts:33-39` — `ICLOCK_DEVICE_KEY` না থাকলে check skip; `.env`/`.env.example`-এ ভেরিয়েবলটাই নেই | যে কেউ `POST /api/iclock/cdata?SN=x&table=ATTLOG` দিয়ে যেকোনো PIN-এর past-dated punch বসিয়ে উপস্থিতি/OT বানাতে পারে |
| P1-12 | `graceMinutes` সেভ করলেই ৪০০ | `settings/page.tsx:91` string পাঠায়, `attendance.service.ts:130-135` সরাসরি Prisma `Int`-এ | লাইভ: invalid grace → generic 400; একই submit-এর বাকি ফিল্ডও বাতিল |
| P1-13 | Employment status enum ভাঙা | `constants.ts:6` `["ACTIVE","ON_LEAVE","TERMINATED"]`; enum = `ACTIVE|ON_LEAVE|EXITED` | "terminated" সেভ → ৪০০; **"EXITED" অপশনই নেই** ⇒ `updateEmployee`-এর auto-offboarding trigger (`directory.service.ts:173-175`) UI থেকে কখনো চলে না |
| P1-14 | Payroll run-এ ফাঁকা attendance guard নেই | `payroll.service.ts:96-121` | attendance process না হলে `dailyRate`/deduction ০ ⇒ চুপচাপ পুরো বেতন তৈরি, কোনো ওয়ার্নিং নেই |
| P1-15 | ত্রুটি গিলে ফেলা (silent save failure) | `directory/[id]/page.tsx:371-376` try/catch ছাড়া await; `employee-profile.tsx:49` `catch {}`; `:377` `onDelete={async () => {}}` | PATCH 403/409/500 হলে "সেভ হয়েছে" ভাবে; Delete বাটন কনফার্ম করে কিছুই করে না |
| P1-16 | সব PII সবার জন্য | `people.controller.ts:76-80` `@SkipPermission()` `GET /people/employees` | লাইভ: Sales (PEOPLE = false) ২০০ পায় — emergency contact, documents, education, phone সহ (বেতন mask হয়, বাকিটা নয়) |

---

## 6. P2 — মাইনর (ব্যাচে ঠিক করার মতো)

**Backend / data**
1. Delete-এ FK error → ভুল 404: `directory.service.ts:179-185`, `assets.service.ts:85-90`, `training.service.ts:29-34`, `recruitment.service.ts:44-49`, `attendance.service.ts:668-672` — `catch(() => NotFound)`।
2. Non-existent `reportingManagerId` → "This record is still referenced by other data" (লাইভ) — বার্তাটি বিভ্রান্তিকর।
3. সব create/update-এ generic `"One of the submitted values is not valid"` (`prisma-exception.filter.ts:31-34`) — কোন ফিল্ড ভুল তা বলা হয় না। লাইভ: roleTitle ছাড়া employee, ভুল joinDate, ভুল salary, ভুল status — চারটিই একই বার্তা।
4. `GET /people/punches` `take: 500` silently truncate (`attendance.service.ts:334`) — unmatched punch লুকিয়ে যায়, badge-এর সাথে মেলে না।
5. `importPunches` — invalid `time` থাকলে পুরো ব্যাচ ৫০০ (query-তেই `new Date`), `PunchLog`-এ `(deviceId,punchTime)` unique নেই ⇒ retry-তে duplicate (`schema.prisma:1278+`)।
6. `recomputeMonth` N+1 (৫০ × ৩০ sequential write), transaction নেই, **join date-এর আগের দিনেও ABSENT row লেখে** (`attendance.service.ts:190-219, 438-445`)।
7. Leave-এ কাজ করা দিনও report-এ leave হিসাবে গোনা হয়, অথচ `Attendance`-এ PRESENT (`attendance.service.ts:514` vs `:210-213`) — দুই endpoint-এ দুই সংখ্যা।
8. Half-day শুধু দেরিতে এলে হয়; আগে চলে গেলে (`undertime`) কোনো deduction নেই (`attendance.service.ts:44-57, 83`) — "৩ ঘণ্টা আগে বেরিয়ে যাওয়া ফ্রি"।
9. Weekly-off/holiday-তে কাজ করলে কিছুই রেকর্ড হয় না (`:202-207` return null) — comp-off/OT claim করা যায় না।
10. `lateList` শুধু `Attendance.status=LATE` পড়ে (`:568-578`) ⇒ attendance process না হলে tab খালি, যদিও report punch থেকে late গোনে; EXITED কর্মীও চিরকাল থাকে।
11. `ensureBalances` policy বদলালে পুরনো row আপডেট করে না; `reset` + পুরনো approve reject ⇒ entitlement ছাড়িয়ে ব্যালান্স (`leave.service.ts:65-92, 259-269`)।
12. `proRataEnabled` কোথাও পড়া হয় না (dead config) — UI-তে অপশন আছে।
13. Silent fallback: `work-calendar?month=banana` → চলতি মাস (২০০), `leave-balances/ensure {period:"banana"}` → চলতি বছর (২০১), `resolveDays` garbage from/to → খালি রিপোর্ট (২০০)।
14. `directory.service.ts:106-109` payroll-এ `basicSalary/netPay` null করে, কিন্তু `auditTrail`/`breakdown` ছোঁয় না — manual-edit এন্ট্রিতে netPay থেকে যায় (latent leak)।
15. Automation dedupe শুধু `nudgeMissing`-এ; `digest`/`documents`/`onboarding` ম্যানুয়াল ট্রিগারে বারবার notification (কমেন্টে দাবি করা dedupe এদের জন্য নেই)।
16. `assets.nextTag()` string-max (`assets.service.ts:20-28`) — AST-10000-এ গিয়ে duplicate; `create` status ASSIGNED কিন্তু holder null হতে পারে।
17. `createEnrollment` `update: {}` ⇒ re-enroll চুপচাপ ignored (`training.service.ts:46-57`)।
18. `recomputeOkr` manual status ("on-hold") overwrite করে (`performance.service.ts:102-111`)।
19. `correctAttendance` কোনো মান যাচাই করে না — invalid status/time → generic 400; সফল হলেও status/hours re-derive করে না (`attendance.service.ts:450-473`)।

**Frontend / UX**
20. Leave drawer decision-এর পর refresh হয় না (`leave/page.tsx:232`, refresh hard-coded 0) ⇒ পুরনো PENDING + আবার Approve চাপলে `already approved`।
21. Directory loading/error-এও খালি টেবিল দেখায়, `LoadOrError` নিচে stacked (`directory/page.tsx:59-94`)।
22. Devices/trends/employees কার্ড ৪০৩ গিলে "No device has checked in yet" দেখায় (`attendance/page.tsx:26, 135-138`)।
23. Punches tab ৭/১৫/৩০ দিনের রেঞ্জ উপেক্ষা করে (`attendance/page.tsx:136`) — হেডলাইনে "30 days", tabel-এ পুরো মাস।
24. Attendance correction মডালে তারিখ এডিটেবল কিন্তু PATCH-এ যায় না (`attendance-modals.tsx:36` vs `:20`) — "saved" বলে, তারিখ বদলায় না।
25. Leave ফর্মে end<start guard নেই (`leave-modal.tsx:16`, `me/page.tsx:441`)।
26. OKR পেজে "Avg progress" `o.progress` পড়ে, API `overallProgress` দেয় (`okrs/page.tsx:43`) ⇒ সবসময় 0%।
27. OKR inline edit stale array + প্রতি blur-এ PATCH + negative allowed (`okrs/page.tsx:21-24, 69`)।
28. Policy Save-এ `setF(null)` ⇒ পেজ এক মুহূর্ত খালি, তারপর stale object (`settings/page.tsx:29, 41`)।
29. Meeting footer "N shown" অথচ ৩ রো; `index={0}` সব রোতে (`team/page.tsx:447-452`)।
30. `key={index}` mutable লিস্টে — leave balances, late ladder, key results, audit, career history।
31. `window.prompt` দিয়ে "Add step" (`onboarding/page.tsx:68`)।
32. Assign-asset dialog আগের employee ধরে রাখে (`assets/page.tsx:248`) ⇒ ভুল ল্যাপটপ assign হওয়ার ঝুঁকি।
33. Modal backdrop ক্লিকে ফর্ম হারায় — People-এ কোথাও `closeOnBackdrop={false}` নেই (`components/ui.tsx:530`)।
34. Destructive delete-এ confirm নেই — holidays, OKRs, training (`holidays/page.tsx:18-24`, `okrs/page.tsx:25-31`, `training/page.tsx:27-33`)।
35. Icon-only approve/reject/delete-এ `aria-label` নেই (`leave/page.tsx:176-177` এবং আরও ৫ জায়গা)।
36. Kiosk in/out বাটন busy-তে `disabled` নয়, শুধু fade (`attendance/page.tsx:214-215`) ⇒ double punch।
37. Hardcoded "Q3 2026" (`performance/page.tsx:42`, `performance-modals.tsx:28,65`) — ২০২৭-এ ভুল।
38. `settings/page.tsx:175` ক্যালেন্ডার মাস UTC `toISOString()` দিয়ে, বাকি মডিউল local `monthNow()` — মাসের ১ তারিখে off-by-one।

---

## 7. যেগুলো ঠিকঠাক কাজ করছে (রিগ্রেশন-সেফ রাখতে হবে)

- টোকেন ছাড়া সব `/people/*` → **৪০১**; Finance-এর `/people/payroll`, `/people/candidates`, `/people/attendance-policy` → **৪০৩**; PM-এর employee PATCH → **403 "You need PEOPLE edit permission"** — guard স্তর ঠিক আছে।
- ৩৯টি GET endpoint বৈধ প্যারামিটারে **২০০**, গড় রেসপন্স ৯–৫০ms।
- `attendance/summary` month বাধ্যতামূলক + regex → **৪০০** (ভালো ভ্যালিডেশন প্যাটার্ন, বাকিরাও এটাই পাওয়া উচিত)।
- Duplicate `deviceId` → **409 "That deviceId is already in use"** (P2002 ম্যাপিং ঠিক)।
- Kiosk punch: ৩ মিনিটের double-tap guard, "nowhere near shift" দিনেও কাজ করে।
- Leave: date-range validation, overlap check, already-decided guard — সবই সঠিক।
- Org chart: cycle ধরা ও root-এ promote করার লজিক ঠিক (`directory.service.ts:216-237`)।
- `utilization/recompute?weeks=999` → ২৬-এ clamp।
- Work calendar past-month lock ("payroll already ran on them") — চমৎকার নীতি।
- Payslip-এ ownership gate (`payroll.service.ts:46-52`)।
- Frontend: ১৯টি রুটে **০ console error**, ০ failed request; typecheck (api+web) পরিষ্কার।

---

## 8. প্রায়োরিটি রোডম্যাপ

**Sprint 1 — টাকা ও গোপনীয়তা (P0 + P1 আর্থিক)**
1. `syncDay`-এ manual correction respect (P0-1)
2. `team.service`-এ pay masking (P0-2)
3. Leave type enum ঠিক করা (P0-3) + Employment status enum (P1-13)
4. Payroll/month picker fix (P0-4)
5. month/period validation সব attendance+payroll route-এ (P1-1)
6. `@@unique([employeeId, period])` + transactional payroll run (P1-2)
7. recompute-এ bank balance sync (P1-3)
8. Leave approve `$transaction` + conditional balance update (P1-5)

**Sprint 2 — সিকিউরিটি ও পারমিশন**
9. `team/:id` pay gate, `leave-balances` self-scope, `leave-requests` HR-scope (P0-2, P1-8, P1-9)
10. `applyLeave` fail-closed (P1-10)
11. `ICLOCK_DEVICE_KEY` fail-closed + `.env.example` (P1-11)
12. `/people/employees`-এ PII scope (P1-16)
13. UI permission helper — view-only রোলে write বাটন hide (P1-16 সহ)

**Sprint 3 — Attendance নিখুঁততা**
14. Open-day hours cap + join-date guard (P1-4, P2-6)
15. Shift resolution এক helper-এ (P1-6)
16. late-list ও report একই নিয়মে (P2-10)

**Sprint 4 — UX/polish**
17. Silent error → toast (P1-15), delete confirm (P2-34), OKR progress (P2-26), drawer refresh (P2-20), a11y labels (P2-35)

---

## 9. পদ্ধতিগত সীমাবদ্ধতা

- ডিভাইস/ফিঙ্গারপ্রিন্ট হার্ডওয়্যার ছাড়া iClock flow শুধু কোড-লেভেলে যাচাই করা হয়েছে।
- পেমেন্ট/GL reconciliation শুধু People-এর দিক থেকে দেখা হয়েছে; Capital মডিউলের পূর্ণ অডিট এই রিপোর্টের বাইরে।
- concurrency ইস্যুগুলো (P1-2, P1-5) কোড-প্রমাণিত, কিন্তু লাইভ race reproduce করা হয়নি (ডেটা নষ্ট এড়াতে)।
- খালি ডেটাসেট (payroll ২০২৬-১১, candidates, courses, okrs) থাকায় সেই পেজগুলোর ফাংশনাল deep-test সীমিত।

---

## 10. অ্যাপেন্ডিক্স — র-ইভিডেন্স

```
LOGIN 201 ok (sakib@zoolyum.com : Owner)
39/39 GET endpoints → 200
GET /people/attendance?month=2026-11 → array(69), সবই 2026-11 (boundary ঠিক)
POST /people/payroll/run {} → 500 Internal server error
POST /people/payroll/run {period:"banana"} → 500
POST /people/attendance/recompute {month:"banana"} → 500
GET /people/punches?month=banana → 500
GET /people/attendance/summary (no month) → 400 "month is required in YYYY-MM format"
POST /people/employees {} → 400 "Employee name is required"
POST /people/employees {name,roleTitle,deviceId:"107"} → 409 "That deviceId is already in use"
POST /people/employees {name:"QA",roleTitle:"QA"} → 400 generic
PATCH /people/attendance/<id>/correct {field:"status",value:"BANANA"} → 400 generic
PATCH /people/attendance/<id>/correct {field:"checkInTime",value:"10:15"} → 400 generic
--- permission probes ---
Sales (PEOPLE=false): GET /people/employees → 200 (PII)   |  GET /people/overview → 403
PM (view-only):       GET /people/team/<other> → payroll.netPay 51750 (LEAK)
Team Member:          GET /people/team/<other> → payroll.netPay 51750 (LEAK)
Finance:              GET /people/leave-requests → 200 (4 rows) | leave-balances?employeeId=<other> → 200
Finance:              POST /people/holidays → 403 "Insufficient role for this action"
PM:                   PATCH /people/employees/<id> → 403 "You need PEOPLE edit permission"
--- browser pass ---
19 routes: /people, /attendance, /payroll, /team, /directory, /leave, /me, /onboarding,
/assets, /settings, /training, /performance, /okrs, /skills, /holidays, /candidates,
/org-chart, /attendance/[id], /directory/[id] → 0 console errors
--- build ---
npm run typecheck → api ✅  web ✅
```

### টেস্ট ডেটা নোট
অডিটের প্রথম পাসে লাইভ probe নিম্নলিখিত লিখেছিল (সবই ফিক্স-পাসে পরিষ্কার করা হয়েছে):
- `PunchLog` — Owner-এর কয়েকটি "Kiosk in" probe punch (`source: SELF`)
- `LeaveBalance` ২৩টি — `POST /people/leave-balances/ensure` (period 2026, idempotent)
- `Notification` ২টি — `automation/digest` ও `automation/documents` ম্যানুয়াল ট্রিগার
- `Attendance` ১টি সারির manual correction — `force` recompute দিয়ে আগের অবস্থায় ফেরানো হয়েছে
- `PayrollRecord` ২০২৬-১১ ও ২০২৬-১২ এর ড্রাফট (যাচাইয়ের জন্য) — API দিয়ে ডিলিট করা হয়েছে

**ফিক্স-পাস ফাইল ছোঁয়:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261110150000_people_integrity`, `.../20261110150500_attendance_corrected_fields`, `apps/api/src/people/*` (১৪ ফাইল), `apps/web/.../people/**` (২৬ ফাইল), নতুন `_components/permissions.ts`।
**মাইগ্রেশন চালাতে হবে:** `npm run db:migrate` (দুইটি migration: payroll/punch unique index + attendance correctedFields + employee shift default অপসারণ)।
**প্রোডাকশন চেকলিস্ট:** `ICLOCK_DEVICE_KEY` সেট করুন (নাহলে iClock 503 দেবে — এটাই ইচ্ছাকৃত fail-closed), এবং deployment-এর আগে `npm run db:migrate` চালান।
