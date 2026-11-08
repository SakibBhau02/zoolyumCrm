# People (HRM) — upgrade notes

চারটা ধাপে কাজটা করা হয়েছে: **সঠিকতা → UX → অটোমেশন → Telegram**। নিচে কী বদলেছে, কেন বদলেছে, আর কীভাবে চালাবেন।

---

## 1. ঠিক করা বাগ (correctness)

| # | আগে | এখন | ফাইল |
|---|---|---|---|
| 1 | Performance rating সবসময় "—" | API `managerScore/selfScore` (0–10) → `rating` (0–5) normalize করে; UI ৩.৮ / ৪.০ দেখায় | `performance.service.ts`, `people/performance/page.tsx` |
| 2 | "Add Review"-এ দেওয়া রেটিং হারিয়ে যেত | `overallRating` গ্রহণ করে `managerScore = rating × 2` সংরক্ষণ | `performance.service.ts` |
| 3 | Skills matrix-এর ৩টি কলাম খালি | আসল API shape ব্যবহার: coverage, departments, avg tenure, people chips | `people/skills/page.tsx` |
| 4 | Org chart ফ্ল্যাট, সবাই "Lead" | `reportingManagerId` থেকে সার্ভারে tree; cycle থাকলে root-এ promote | `directory.service.ts`, `people/org-chart/page.tsx` |
| 5 | হেডারে হার্ডকোড "Payroll: July finalized" | `/people/payroll/status` — আসল সর্বশেষ period + status | `payroll.service.ts`, `_components/payroll-status.tsx` |
| 6 | Utilization কখনো গণনা হতো না (শুধু seed) | `UtilizationService` — billable timeLog ÷ সাপ্তাহিক capacity, সোমবার ০৪:০০ + ম্যানুয়াল recompute | `utilization.service.ts` |
| 7 | Payroll ফাঁকা থাকলে কিছুই দেখাত না | Empty state + CTA + পুরনো period-এ auto-jump | `people/payroll/page.tsx` |
| 8 | Leave টেবিল calendar দিন গুনত | `workingDays` (weekend/holiday বাদ) | `people/leave/page.tsx` |
| 9 | Training progress ৪০% হলে select খালি | বর্তমান মান সবসময় option-এ যোগ | `people/training/page.tsx` |
| 10 | Team 360-এ "0 of 0" ফ্ল্যাশ | (আগের মতোই, কিন্তু skeleton count এখন consistent) | — |

## 2. সিকিউরিটি

`@Roles("Owner","HR/Admin")` যোগ করা হয়েছে:

- `GET /people/payroll`, `GET /people/payroll/:id/payslip` — আগে **যে কেউ** সবার বেতন দেখতে পারত
- `DELETE /people/employees/:id`
- `POST/PATCH` attendance record, correct, recompute, punch import/map
- holidays / reviews / courses / enrollments / candidates write endpoints
- `POST /people/leave-requests`: non-HR এখন শুধু **নিজের** নামে আবেদন করতে পারে (সার্ভারে force করা হয়)

## 3. নেভিগেশন (UX)

১৪টি সমান-ওজনের ট্যাব → **৫টি হাব** + সেটিংস গিয়ার:

```
Overview │ Team (360 · Directory · Org chart · Skills) │ Time (Attendance · Leave · Holidays · Policy)
         │ Pay    │ Grow (Reviews · OKRs · Training · Hiring)
```

- Deep link অপরিবর্তিত — শুধু `constants.ts`-এ `NAV` ম্যাপ
- Overview-তে নতুন **“Needs your attention”**: pending leave, missing check-in, payroll draft, work anniversary
- ভুয়া delta badge (+1, +2, +3.2%) সরানো
- Leave notification এখন `?request=<id>` deep link — ড্রয়ার সরাসরি খোলে

## 4. অটোমেশন (cron)

| সময় | কাজ | ফাইল |
|---|---|---|
| ২৩:৪৫ | আজ + গতকালের attendance পুনর্গণনা (সব active employee) | `people-automation.service.ts` |
| ১২:১৫ | check-in নেই → employee + manager কে nudge | একই |
| ১৯:১৫ | check-out নেই → nudge | একই |
| ২৫ তারিখ ১০:০০ | payroll run হয়নি → Owner + HR | একই |
| শুক্র ১৭:০০ | weekly people digest (headcount, present, utilization, payroll cost, overdue) | একই |
| সোম ০৪:০০ | utilization recompute | `utilization.service.ts` |
| ০৮:৩০ | প্রত্যেক linked employee-কে ব্যক্তিগত agenda | `telegram-triggers.service.ts` |
| প্রতি ৫ মিনিট | meeting reminder (T-24h, T-60m) | একই |

সব notification `NotificationsService.create()` দিয়ে যায় → bell-এ দেখা যায়, আর linked হলে Telegram-এও।

## 5. Telegram

### সেটআপ

1. Telegram-এ **@BotFather** → `/newbot` → টোকেন কপি
2. Control → **Telegram** → Bot token পেস্ট → Bot username (যেমন `zoolyum_hr_bot`, `@` ছাড়া) → **Save**
3. **Mode** = `Live` (আগে `Mock` দিয়ে পুরো ফ্লো পরীক্ষা করা যায় — কিছুই পাঠায় না, শুধু log করে)
4. Transport:
   - **লোকাল / কোনো পাবলিক URL নেই** → `Sync polling` (long polling, ডিফল্ট)
   - **প্রোডাকশন** → `https://your-domain.com` দিয়ে `Register webhook`; `secret_token` স্বয়ংক্রিয়ভাবে হেডারে যাচাই হয়
5. Employee profile → **Telegram → Connect** → এক-বারের লিংক → ওই ব্যক্তি ট্যাপ করলেই chat bind হয়
6. **Test connection** / **Test send** দিয়ে যাচাই

### বট কমান্ড

| কমান্ড | কাজ |
|---|---|
| `/start <code>` | chat → employee/user bind |
| `/today` | আজকের meeting, due task, check-in অবস্থা |
| `/in`, `/out` | attendance punch (নিজের) |
| `/who` | এখন অফিসে কে কে |
| `/pause`, `/resume` | notification mute/unmute |
| `/help` | তালিকা |

Leave request মেসেজে **✅ Approve / ❌ Reject** inline বাটন — শুধু Owner/HR/Admin চাপতে পারে (role সার্ভারে যাচাই)।

### আর্কিটেকচার

```
NotificationsService.create()
        └── fanoutTelegram()  ── ModuleRef (lazy) ──> TelegramSenderService
                                                          ├── per-chat 1.1s pacing
                                                          ├── global 40ms pacing
                                                          ├── 429 → retry_after
                                                          └── 4096 char chunking + HTML escape
```

- **ModuleRef** ব্যবহার করা হয়েছে যাতে `Notifications → Telegram → People → Notifications` circular import না হয়
- **একটাই poller**: portal-এর পুরনো `getUpdates` লুপ সরানো হয়েছে (দুই poller একই bot-এ 409 দিত এবং একে অন্যের update খেয়ে ফেলত)। এখন TelegramModule মালিক; portal `/start` কোডও সে-ই consume করে
- **Dedupe**: `TelegramMessageLog.kind` কী দিয়ে (`meeting:<id>:24h`, `agenda:<date>`) — restart হলেও duplicate যাবে না
- **Token**: `Integration.credentialsEnc`-এ AES-256-GCM; কখনো browser-এ ফেরত যায় না। `TELEGRAM_BOT_TOKEN` env থাকলে fallback হিসেবে কাজ করে

### Bulletin: Telegram API সীমা

প্রতি চ্যাটে ~১ msg/সেকেন্ড, প্রতি গ্রুপে ২০/মিনিট, গ্লোবাল ~৩০/সেকেন্ড। 429 এলে `retry_after` মানতে হবে। এই সার্ভিস ঠিক এটাই করে।

## 6. API যোগ হয়েছে

```
GET    /people/payroll/status
POST   /people/utilization/recompute?weeks=8
POST   /people/automation/:action      (recompute | nudge-in | nudge-out | payroll | digest)

GET    /control/telegram/config
PATCH  /control/telegram/config
POST   /control/telegram/test-connection
POST   /control/telegram/test-send
POST   /control/telegram/webhook            (register)
DELETE /control/telegram/webhook
GET    /control/telegram/webhook-info
POST   /control/telegram/polling/sync
POST   /control/telegram/link-code
GET    /control/telegram/link?employeeId=
GET    /control/telegram/links
DELETE /control/telegram/links/:id
GET    /control/telegram/logs

POST   /telegram/webhook                    (public, secret-token verified)
```

## 7. ডেটাবেস

Migration: `20261104134816_telegram_channel`

```prisma
TelegramLink      // chatId ↔ userId / employeeId (এক chat, এক ব্যক্তি)
TelegramLinkCode  // single-use, 30 min TTL
TelegramMessageLog// delivery audit (kind/status/error)
```

## 8. যাচাই

```bash
npx tsc --noEmit            # apps/api
npx tsc --noEmit            # apps/web
npm run build               # api + web  → PASS
npx playwright test e2e/people-payroll-pro.spec.ts
```

Smoke (Owner token):
`payroll/status` → `{period:"2026-07", status:"FINALIZED", count:10}` ·
`reviews[0].rating` → `3.8` · `org-chart` → nested `directReports` ·
`payroll` as non-HR → **403** · notification → `TelegramMessageLog kind=notification`

## 9. সীমাবদ্ধতা / পরের ধাপ

- **Utilization** এখন সত্যিকারের time log থেকে আসে। যেসব সপ্তাহে কেউ billable time log করেনি সেগুলো লেখা হয় না (0% দিয়ে trend নষ্ট না করতে)। দল time log না করলে utilization কম দেখাবে — এটা ডেটার সত্যতা, বাগ নয়।
- Attendance table-এ এখনো server-side pagination নেই (মাসে ~২০০-১০০০ রো)। পরের ধাপ।
- Employee self-service (নিজের payslip/leave/attendance) এখনো বাকি — Telegram `/today` আপাতত সেই ফাঁক কিছুটা ভরাট করে।
- Onboarding/asset register/document expiry ইত্যাদি প্রস্তাবিত, এখনো তৈরি হয়নি।

---

# Phase 5 — Self-service, table tooling, documents

## 10. My space (`/people/me`)

প্রতিটা People স্ক্রিন company-wide ছিল — ১০ জনের টিমে ৯ জনকে HR-এর স্ক্রিনে ঢুকে নিজের তথ্য খুঁজতে হতো। এখন প্রত্যেকের নিজের ড্যাশবোর্ড:

- আজকের অবস্থা + **Check in / Check out** (নিজের punch, `SELF` source)
- মাসের KPI: attendance %, present/late/absent, worked, overtime
- ৩০ দিনের heatmap + শেষ ৮ দিনের check-in/out
- **আমার ছুটি**: ব্যালান্স চিপ (≤2 দিন হলে amber), নিজের আবেদন, নতুন আবেদন (employeeId সার্ভারে force — অন্যের নামে দেওয়া অসম্ভব)
- **Payslip**: সর্বশেষ net pay + পুরনো payslip লিংক
- আমার OKR, আমার টাস্ক (overdue লাল), আজকের ও আসন্ন মিটিং
- **Telegram নিজেই কানেক্ট** (`POST /people/me/telegram`) — HR-এর হস্তক্ষেপ ছাড়া

API: `GET /people/me` (এক কলেই পুরো পেজ), `POST /people/me/punch`, `POST /people/me/leave`, `POST|DELETE /people/me/telegram`

> Payslip এখন ownership-চেক করে: HR সব দেখে, employee শুধু নিজের (`403` অন্যদের জন্য)।

## 11. Table kit — search + pagination

`_components/table-kit.tsx`: `useTable()` · `<TableToolbar>` · `<Pager>` · `<RowCheck>`

| টেবিল | আগে | এখন |
|---|---|---|
| Attendance · Daily records | একসাথে ~২০০-১০০০ রো | ১২/পেজ + সার্চ + range |
| Attendance · Raw punches | সব | ১০/পেজ + সার্চ |
| Payroll | সব | ১০/পেজ + সার্চ |
| Leave requests | সব | ১০/পেজ + সার্চ + bulk |
| Directory | সব | ১২/পেজ |

API অপরিবর্তিত — শুধু রেন্ডার লেয়ার যোগ হয়েছে, তাই কোনো ফিল্টার ভাঙেনি।

## 12. Bulk actions

- **Payroll**: সারি সিলেক্ট → *Finalize selected* / *Mark paid* (paid-এ confirm, কারণ finance-এ expense post হয়)
- **Leave**: একাধিক pending সিলেক্ট → এক ক্লিকে Approve / Reject; প্রতিটার ফল আলাদা গণনা হয়ে toast-এ (`3/4 approved`)

## 13. Document vault (expiry-aware)

Employee profile-এ নতুন কার্ড — `Employee.documents` JSON কলাম ব্যবহার করে, তাই **কোনো মাইগ্রেশন লাগেনি**:

- Contract / NID / Visa / NDA / Certificate যোগ (নাম, ধরন, লিংক, expiry)
- Expiry অনুযায়ী সাজানো + ব্যাজ: **>30 দিন সবুজ, ≤30 amber, ≤7/expired লাল**
- `POST /people/automation/documents` + সোমবার ০৯:০০ cron → HR-কে notification (+ Telegram)

## 14. নতুন cron

| সময় | কাজ |
|---|---|
| সোম ০৯:০০ | ৩০ দিনের মধ্যে মেয়াদ শেষ / ইতিমধ্যে expired documents → HR |

## 15. যাচাই (Phase 5)

```
apps/api  tsc --noEmit  → 0
apps/web  tsc --noEmit  → 0
npm run build           → PASS
/people/me        → greeting, punch, KPI, days, leave, payslip, OKR, tasks, meetings, Telegram
/people/payroll   → 10 records · search · checkbox column · bulk bar · pager
/people/leave     → 4 requests · search · multi-select approve/reject · pager
/people/attendance→ 50 records · 12/page · search
/profile          → Documents (1) · "1 expiring within 30 days · 21d left"
cron documents    → {"sent":1} → Notification(DOCUMENT_EXPIRY) to HR ✓
```

## 16. এখনো বাকি (সৎ তালিকা)

- Onboarding / offboarding checklist (নতুন মডেল দরকার)
- Asset register (ল্যাপটপ, ক্যামেরা)
- Shift roster (video shoot / night shift)
- Timesheet approval + billable vs non-billable split UI
- Attrition risk dashboard (`AttritionRiskFlag` মডেল আছে, UI নেই)
- Bangladesh payroll: provident fund, tax, gratuity
- Server-side pagination + saved views (এখন client-side)

---

# Phase 6 — Onboarding / offboarding + Asset register

## 17. নতুন ডেটা মডেল

Migration: `20261104142730_onboarding_assets`

```prisma
EmployeeChecklist      // one run per employee per kind (@@unique employeeId+kind)
EmployeeChecklistItem  // steps as rows: label, owner, done, doneBy, sortOrder
Asset                  // tag, category, serial, status, value, assignedTo
```

কেন JSON নয়: progress, "কে টিক দিল" (`doneBy`) আর "৭ দিনের বেশি ঝুলে আছে" — এগুলো query করতে হয়; JSON blob-এ পারা যায় না।

## 18. Onboarding / Offboarding — `/people/onboarding`

- **রেডিমেড রানবুক** কোডে: Onboarding ৮ ধাপ (contract, NID, email, laptop, Slack/Telegram, bank, intro meeting, 30-day check-in), Offboarding ৭ ধাপ (letter, handover, gear return, access revoke, settlement, exit interview, experience letter)
- **অটো-স্টার্ট**: নতুন employee যোগ হলে onboarding নিজে থেকে শুরু; `employmentStatus = EXITED` করলে offboarding শুরু
- কার্ডে প্রতি স্টেপের checkbox + owner চিপ (HR/IT/Finance/Manager) + কে টিক দিল
- progress bar, due date, **Mark complete / Reopen**, স্টেপ যোগ/মুছা, পুরো রান ডিলিট
- ফিল্টার: All / Onboarding / Offboarding / In progress / Completed
- স্ট্যাট: active runs · onboarding · offboarding · **stale (৭+ দিন খোলা)**

API: `GET /people/onboarding`, `GET /people/onboarding/summary`, `POST /people/onboarding`, `PATCH /people/onboarding/:id`, `POST /people/onboarding/:id/items`, `PATCH|DELETE /people/onboarding/items/:itemId`, `DELETE /people/onboarding/:id`

## 19. Asset register — `/people/assets`

- ট্যাগ অটো-নম্বরিং `AST-0001` (max থেকে, count থেকে নয় — ডিলিটে collision হয় না)
- ধরন: Laptop / Camera / Lens / Phone / Tablet / Audio / Licence / Furniture…
- স্ট্যাটাস: **Available · Assigned · Repair · Retired** — assign/return করলে `status` ও `assignedToId` একসাথে বদলায়, কখনো অসঙ্গত থাকে না
- টেবিল: tag, নাম, holder (প্রোফাইল লিংক), status, value, purchase date
- সার্চ + স্ট্যাটাস ফিল্টার + পেজিনেশন; স্ট্যাট: total, assigned, available, repair, **book value**
- Employee profile-এ "Gear & onboarding" কার্ড — যে কে কী ধরে আছে + checklist progress

API: `GET /people/assets`, `GET /people/assets/summary`, `POST/PATCH/DELETE /people/assets/:id`, `POST /people/assets/:id/assign`, `POST /people/assets/:id/return`

## 20. নতুন automation

| সময় | কাজ |
|---|---|
| সোম ১০:০০ | ৭ দিনের বেশি খোলা checklist → HR-কে notification (+ Telegram) |

একটা অফবোর্ডিং অর্ধেক শেষ হওয়া মানে ল্যাপটপ বা ক্লায়েন্ট অ্যাক্সেস হারিয়ে যাওয়া — এটা এখন শুধু মনে থাকার উপর নির্ভর করে না।

## 21. ডেমো ডেটা (যাচাইয়ের জন্য)

- ৩টি onboarding रান: Lamia 8/8 (DONE), Mitu 3/8 (38%), Sohan 0/8
- ৬টি অ্যাসেট: ৳10.37L book value · ৪টি assigned, ১টি available, ১টি repair

## 22. যাচাই (Phase 6)

```
apps/api tsc --noEmit → 0    apps/web tsc --noEmit → 0
npm run build        → PASS (44 pages)
/people/onboarding   → stats(2/3/0/0) · cards · per-item tick · owner chips · who-ticked
/people/assets       → 6 items · filters · assign/return · ৳10.4L book value
/profile             → "Gear & onboarding · 2 asset(s)" · AST-0001 Laptop · AST-0003 Camera
add asset modal      → all fields render
console errors       → 0
```

## 23. পরের ধাপ (আপডেট করা তালিকা)

- Shift roster (শুট / নাইট শিফট) — attendance-এর সাথে যুক্ত
- Timesheet approval + billable vs non-billable split
- Attrition risk dashboard
- Bangladesh payroll: provident fund, tax, gratuity
- Server-side pagination + saved views
- Asset maintenance history (কখন কার কাছে ছিল, কতবার মেরামত)


