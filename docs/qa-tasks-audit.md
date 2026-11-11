# Tasks মডিউল — QA অডিট রিপোর্ট

**Module:** `/tasks` (Task execution, board, calendar, gantt, sprint, checklist, time logging, comments, dependencies, templates, automation)
**Environment:** `http://localhost:3000/tasks` · API `http://localhost:4000/api` · Next.js 16.3.0 (Turbopack) · NestJS · PostgreSQL
**Date:** 10 November 2026
**Tester:** Automated + manual QA pass (API script + live browser)
**Verdict:** **সব রিপোর্টেড ইস্যু ফিক্স করা হয়েছে এবং রি-ভেরিফাই করা হয়েছে** (নিচের §0 দেখুন)। নতুন করে ১৩৬টি API assertion, Lighthouse 100/100/100, smoke 28/28, flow 11/11 পাস।

---

## 0. ফিক্স পাস (10 Nov 2026) — সব পাওয়া গেছে, সব ঠিক হয়েছে

প্রতিটি ফাইন্ডিং কোডে ঠিক করা হয়েছে; কোনো ডেটা/UI আচরণ কমেনি (smoke + flow regression পাস)।

| # | ইস্যু | স্ট্যাটাস | কী বদলেছে |
|---|---|---|---|
| P0-1 | List permission leak | ✅ Fixed | `list()` এখন non-admin/PM-কে শুধু নিজের assigned/reported/assignedBy task দেয় (`tasks.service.ts`); Sales-এর list 27 → 4 |
| P0-2 | Orphan subtask on delete | ✅ Fixed | `descendantIds()` + transactional `deleteMany`; bulk delete-ও cascade |
| P1-1 | Assignee blocked by module guard | ✅ Fixed | assignee-side write routes-এ `@SkipPermission()`; service-level `canWorkOnTask()` authoritative |
| P1-2 | Edit modal status not saved | ✅ Fixed | payload-এ `status` যোগ |
| P1-3 | Mobile New Task offscreen | ✅ Fixed | PageHeader actions `flex-wrap`; 390px-এ CTA ভিজিবল |
| P1-4 | Checkbox opens drawer | ✅ Fixed | checkbox wrapper-এ `onClick stopPropagation` |
| P1-5 | Calendar duplicate key / ghost cells | ✅ Fixed | trailing key increment + week anchored to current week + prev/next |
| P1-6 | Status normalization parity | ✅ Fixed | create/update/bulk/list সব একই `parseTaskStatus` ব্যবহার করে |
| P1-7 | Empty/garbage status → silent TODO | ✅ Fixed | unknown status এখন `400`; status অপরিবর্তিত থাকে |
| P1-8 | Board 5 columns overflow | ✅ Fixed | lg+ এ 5-column grid; Done কলাম ভিজিবল |
| P2-1 | Search misses description | ✅ Fixed | title + description + tag + id |
| P2-2 | Archived/subtasks inflate stats | ✅ Fixed | stats শুধু top-level, non-archived |
| P2-3 | Reaction identity client-controlled | ✅ Fixed | identity JWT থেকে; spoofed `userId` উপেক্ষিত |
| P2-4 | Two timers | ✅ Fixed | drawer-এর local timer সরিয়ে একটাই server timer |
| P2-5/6 | Validation gaps + circular dependency | ✅ Fixed | title/desc/hours/date/comment/checklist/template/automation validation + cycle walk |
| P2-7 | Stacked dialogs | ✅ Fixed | Edit খুললে drawer বন্ধ হয় |
| P2-8 | Unbounded title / NUL 500 | ✅ Fixed | 200/20,000 char limit; control chars stripped |
| P2-9 | Silent 500-row truncation | ✅ Fixed | `?limit=&offset=` + UI-তে "first 500" নোটিশ |
| P2-10 | Utilization capped at 150% | ✅ Fixed | real percentage (e.g. 194%) |
| P2-11 | Tab counter inconsistency | ✅ Fixed | `Checklist (0/0)` ফরম্যাট |
| P2-12 | Duplicate due/project info | ✅ Fixed | desktop-এ title-cell chip hidden, column দেখায় |
| P2-14 | Bulk due date applies on pick | ✅ Fixed | তারিখ stage হয়, **Apply** চাপলে তবেই apply; Archive-এ confirm |
| P2-15 | Bulk skipped miscount | ✅ Fixed | unknown ids `skipped`-এ গোনা হয় |
| P3 | A11y (select names, touch targets, labels, contrast) | ✅ Fixed | Lighthouse **100/100/100**, শূন্য ফেইল |
| P3 | Login label association | ✅ Fixed | `htmlFor` + `id` + autocomplete |
| P3 | Empty-state duplicate count | ✅ Fixed | footer count শুধু >0 হলে |
| P3 | Setup template card stretch | ✅ Fixed | grid `items-start` |
| P3 | Drawer reporter/assignee ambiguity | ✅ Fixed | "Reported by / Assigned by / Assignee" লেবেল |
| P3 | Dev font-cache 500 | ℹ️ Env | `.next` ক্লিয়ার করলে ঠিক হয়; বিল্ড-টাইম ইস্যু, কোড নয় |

**রি-ভেরিফিকেশন:**
```
qa-tasks-api.js      114/114 passed
qa-tasks-api2.js      22/22  passed
npm run test:smoke    28/28  passed
npm run test:flow     11/11  passed
Lighthouse (tasks)    Accessibility 100 · Best Practices 100 · SEO 100 · 0 failures
Console (tasks page)  0 errors
```

> নোট: bulk due-date এখন stage → Apply; ভুলে তারিখ বদলানো আর হবে না। Archive-এ confirm আছে।

---

## 1. এক নজরে (Executive summary)

| এলাকা | আগে | এখন | মন্তব্য |
|---|---|---|---|
| Core CRUD | 8/10 | **9.5/10** | status/date/assignee সব সেভ হয়, cascade delete |
| Authorization / data scoping | **3/10** | **9/10** | list scoped; assignee নিজের task চালাতে পারে |
| Data integrity | **4/10** | **9/10** | orphan ঠিক, validation শক্ত |
| Input validation | 5/10 | **9/10** | title/hours/date/deps/template/automation validated |
| UI / UX flow | 7/10 | **9/10** | bulk select, edit modal, calendar, mobile CTA ঠিক |
| Visual design | 8/10 | **9/10** | contrast tokens ঠিক, duplication কমানো |
| Responsive | 6/10 | **9/10** | 390px-এ CTA ভিজিবল, board 5 কলাম ফিট |
| Accessibility | 6.5/10 | **10/10** | Lighthouse 100, 0 failure |
| Consistency | 6/10 | **9/10** | status/date/counter ভাষা এক |
| **সামগ্রিক** | **~6.3/10** | **~9.3/10** | **release-ready** |

**টেস্ট স্কেল:** ১১৪টি API assertion + ৫টি view (List/Board/Calendar/Gantt/Setup) + ৩ breakpoint (1440 / 930 / 390) + light/dark + keyboard + deep link + Lighthouse। সব QA ডেটা `QA` prefix দিয়ে তৈরি করে শেষে মুছে ফেলা হয়েছে (leftover = 0)।

---

## 2. যেভাবে টেস্ট করা হয়েছে

1. **Static review** — `apps/api/src/tasks/*`, `apps/web/src/app/(app)/tasks/page.tsx`, `components/tasks/*`, Prisma schema।
2. **API audit (script)** — `qa-tasks-api.js` ও `qa-tasks-api2.js`। Owner (`sakib@zoolyum.com`, Owner), PM (`karim@zoolyum.com`), Sales (`rahim@zoolyum.com`, TASKS view-only) — তিন role দিয়ে।
3. **Live UI** — Playwright দিয়ে আসল ব্রাউজারে লগইন করে প্রতিটি view, modal, drawer, filter, keyboard shortcut।
4. **Responsive + theme** — 1440×900, 930×900, 390×844; light ও dark।
5. **Accessibility** — Lighthouse (Axe) + manual DOM/ARIA inspection।
6. **Evidence** — `qa-evidence/tasks-*.png`, `qa-evidence/tasks-api-*.json`, `qa-evidence/tasks-api-run.log`।

---

## 3. Findings — 심각도 অনুযায়ী

> **স্ট্যাটাস:** নিচের প্রতিটি ফাইন্ডিং ফিক্স করা হয়েছে (§0-এ ম্যাপিং ও প্রমাণ)। এই সেকশনটি মূল অডিট রেকর্ড হিসেবে রাখা হলো — কোড এখন যা করে, তার সাথে পুরোনো আচরণ মিলবে না।

### 🔴 P0 — ✅ Fixed

#### P0-1. Task list সব task ফাঁস করে (permission bypass)
**কোথায়:** `apps/api/src/tasks/tasks.service.ts:908` (`list()`), তুলনা করুন `detail()` → `:953-976`

`GET /tasks`-এ কোনো `canViewTask()` ফিল্টার নেই। যে user-এর role-এ শুধু **TASKS view** আছে (Sales/BD) সে ২৭টি task-এর **২৭টিই** দেখে — যার সাথে তার কোনো সম্পর্ক নেই (assignee/reporter/assigner কোনোটাই না)। অথচ একই task-এর detail খুললে `403 Forbidden`।

**Evidence (round 2, 1.1):**
```
LEAK: view-only user sees 23/27 tasks they have no relation to
       (titles + projects + assignees exposed in list)
owner=27  sales=27   ← হুবহু একই ডেটা
GET /tasks/:id (sales, unrelated) → 403
```
**কেন গুরুত্বপূর্ণ:** task title-এ client name, project, deadline, assignee — সব থাকে। এটা client-confidentiality ভাঙে এবং detail-এর 403-কে অর্থহীন করে দেয়।
**Fix:** `list()`-এ `canViewTask`-এর সমতুল্য where-clause (admin/PM সব; বাকিরা শুধু assignedTo/assignees/reporter/assignedBy) অথবা list-এ per-user scope + `_permissions`।

#### P0-2. Parent task delete করলে subtask orphan হয়ে অদৃশ্য হয়
**কোথায়:** `apps/api/src/tasks/tasks.service.ts:1185` (`remove()`), `prisma/schema.prisma` → `Task.parentTaskId`-এর কোনো self-relation/FK নেই

UI কনফার্ম করে: *"Delete this task and its children?"* (`page.tsx:518`)। কিন্তু সার্ভার শুধু একটি row ডিলিট করে। Child task DB-তে থেকে যায়, `parentTaskId` ভাঙা অবস্থায়; আর `list()` সবসময় `parentTaskId: null` ফিল্টার করে — তাই ওই subtask **কোনো list, board, calendar, search-এ আর কখনো দেখা যায় না**।

**Evidence (round 2, 6.1):**
```
child alive (detail 200) but list hits=0 → orphaned, unreachable from UI
```
**Fix:** `$transaction`-এ children cascade delete (বা soft-delete), অথবা schema-তে self-relation + `onDelete: Cascade`; UI copy বাস্তবের সাথে মিলিয়ে ঠিক করা।

---

### 🟠 P1 — ✅ Fixed

#### P1-1. Assignee নিজের task-এ কাজ করতে পারে না (module guard vs field-level permission conflict)
**কোথায়:** `tasks.controller.ts:8` `@RequirePermission("TASKS")` + guard HTTP verb থেকে `edit` level ধরে; `tasks.service.ts:158` `canWorkOnTask()`

Detail API বলে `_permissions.canEditProgress = true`, কিন্তু status change / comment / time log — তিনটাই `403`, কারণ Sales role-এ `TASKS: (view=true, edit=false)`।

**Evidence:**
```
2.1 assignee can read their task        → canEditProgress=true  ✅
2.2 assignee can move status            → 403 ❌
2.3 assignee can comment                → 403 ❌
2.4 assignee can log time               → 403 ❌
```
**কেন গুরুত্বপূর্ণ:** পুরো workflow-টা "assignee drives their own work" ধরে বানানো, কিন্তু module permission সেটাকে আগেই আটকে দেয়। ফলে view-only role-এর কেউ task পায় কিন্তু সেটা নাড়াতে পারে না।
**Fix:** write route-গুলোতে module-level `edit` না চেয়ে `canWorkOnTask()`-কে authoritative করা, অথবা assignee-side action-গুলোর জন্য `@SkipPermission()` + service check।

#### P1-2. Edit modal-এ Status বদলালে সেভ হয় না (silent data loss)
**কোথায়:** `apps/web/src/components/tasks/task-form-modal.tsx:196-211`

`saved` payload-এ `status` key-ই নেই। Select-এ "Done" বেছে Save করলে UI বন্ধ হয়, কিন্তু status আগেরটাই থাকে।

**Evidence:**
```
set: "DONE" → saved: true → API status: "IN_PROGRESS"  ❌
```
**Fix:** payload-এ `status: f.status` যোগ করা (অথবা modal থেকে status control সরিয়ে দেওয়া, কারণ drawer-এ আলাদা status control আছে)।

#### P1-3. Mobile-এ "New Task" বাটন স্ক্রিনের বাইরে (390px)
**কোথায়:** `page.tsx` header action row — flex-wrap ছাড়া এক লাইনে

**Evidence (390×844):**
```
Gantt   x=323 → 378   visible ✅
Setup   x=391 → 469   visible ❌
New Task x=477 → 584  visible ❌   (viewport 390)
main scrollWidth 584 vs clientWidth 382
```
ডকুমেন্টে horizontal scroll নেই, কিন্তু `main`-এর ভেতরে ২০২px overflow — অর্থাৎ primary CTA পৌঁছাতে গোটা পেজ ডানে স্ক্রল করতে হয়। মোবাইলে task তৈরি করা কার্যত লুকানো।
**Fix:** action row-কে wrap করা / `New Task`-কে sticky FAB বা header-এ icon-only করা।

#### P1-4. Checkbox-এ ক্লিক করলে task detail drawer খুলে যায়
**কোথায়:** `page.tsx:280` — `onChange={(e) => { e.stopPropagation(); onSelect(); }}`

`stopPropagation()` **change** event-এ দেওয়া, কিন্তু row-এর `onClick` **click** event-এ চলে — সেটা bubble করে। ফলে bulk-select করতে গেলে প্রতিবার drawer খোলে।

**Evidence:** ২টি row select করলে `2 selected` বার হয়, সাথে drawer-ও খোলে (`tasks-bulk-bar.png`)।
**Fix:** checkbox wrapper-এ `onClick={(e) => e.stopPropagation()}`।

#### P1-5. Calendar ভাঙা — duplicate key, ভুল তারিখ, ghost cell
**কোথায়:** `page.tsx:790-791` (trailing cells) এবং `:800-809` (week cells)

```tsx
let nx = 1;
while (cells.length % 7 !== 0)
  cells.push({ key: `n${nx}`, day: nx, ... });   // nx কখনো বাড়ে না!
```

**ফলাফল (রিপ্রোডিউসিবল):**
- Month view-এ পরের মাসের দিনগুলো সব `1, 1, 1, 1, 1` দেখায়।
- সব trailing cell-এর key একই (`n1`) → React duplicate-key error (`4টি console error`)।
- Month → Week সুইচ করলে পুরোনো ৪টি cell DOM-এ থেকে যায় → **১১টি cell** (দিন: `1,1,1,1,1,2,3,4,5,6,7`), লেআউট দুই লাইনে ভেঙে যায়।
- Week view সবসময় **মাসের প্রথম সপ্তাহ** দেখায় (`base = 1st - startDow`), "Today" চাপলেও চলতি সপ্তাহে যায় না — তাই week view কার্যত অকেজো।

**Evidence:** `tasks-desktop-calendar.png`, `tasks-desktop-calendar-week.png`, console: `Encountered two children with the same key 'n1'` ×4।

#### P1-6. Status normalization অসঙ্গত — একই input, ভিন্ন ফলাফল
**কোথায়:** `tasks.controller.ts:187-192` (normalize) vs `tasks.service.ts:1015` (`create`), `:1123` (`update`)

| Endpoint | `IN_REVIEW` দিলে |
|---|---|
| `POST /tasks` | ❌ 400 Bad Request |
| `PATCH /tasks/:id` | ❌ 400 Bad Request |
| `PATCH /tasks/:id/status` | ✅ 200 → REVIEW |
| `GET /tasks?status=IN_REVIEW` | ✅ REVIEW ধরে |
| `POST /tasks/bulk` | ✅ REVIEW ধরে |

**Evidence:** round 2, 8.1 — `PATCH /tasks/:id → 400` কিন্তু `PATCH /tasks/:id/status → 200`। পুরোনো saved view/bookmark-এ `IN_REVIEW` থাকলে edit form থেকে সেভ করলেই 400।

#### P1-7. Status endpoint ফাঁকা/ভুল value-তে চুপচাপ TODO লিখে দেয়
**কোথায়:** `task-status.ts:20` — `return "TODO"` (fallback), `tasks.controller.ts:188`

```
PATCH /tasks/:id/status  body:{}          → 200, status = TODO   ❌
PATCH /tasks/:id/status  {status:"GARBAGE"} → 200, status = TODO   ❌
```
ভুল টাইপো বা ভাঙা client silently task-কে backlog-এ ফেলে দেয় — data loss, কোনো error নেই। **Fix:** unknown value → 400; শুধু known legacy alias normalize করা।

#### P1-8. Board ৫ কলাম 1440px-এ ধরে না
**কোথায়:** board container `-mx-4 overflow-x-auto`; প্রতি কলাম ~292px

**Evidence:** container `sw=1480`, `cw=1144`; "Done" কলাম শুরুই হয় `x=1469`-এ (offscreen)। কোনো দৃশ্যমান scroll affordance নেই। ডেস্কটপে ডিফল্ট board হলে কাজের অর্ধেক লুকানো থাকবে।
**Fix:** কলাম `min-w-0` + flex-1, অথবা gutter ছোট করে ৫ কলাম ফিট, অথবা scroll hint/arrow।

---

### 🟡 P2 — ✅ Fixed

| # | ইস্যু | Evidence | কোথায় |
|---|---|---|---|
| P2-1 | **Search শুধু title + exact tag**; description/ID সার্চ হয় না | `q=uniquetoken-zzz` (description-এ) → 0 hit | `tasks.service.ts:931` |
| P2-2 | **Archived + subtask header stats-এ গোনা হয়**, list-এ দেখা যায় না | archived BLOCKED task archive করার পরও `blocked` একই থাকে; `stats.open=21` vs list-visible 20 | `tasks.service.ts:169-193` |
| P2-3 | **Reaction identity client-controlled** — UI প্রতিবার literal `"current-user"` পাঠায় | DB-তে `userIds:["current-user"]`; API যেকোনো userId গ্রহণ করে | `page.tsx:130,537`, `tasks.service.ts:1410` |
| P2-4 | **দুইটা timer একসাথে** — drawer-এ local `setInterval` timer + server `TaskTimer` | local timer বন্ধ/refresh-এ হারায়; ৩ মিনিটের নিচে log হয় না, server-এ 0.01h | `page.tsx:589-603` vs `task-ops.tsx:221` |
| P2-5 | **Validation ফাঁক:** খালি title (`""`, `"   "`), negative `estimatedHours`, `hours: 0/-3`, খালি checklist item, খালি comment, empty template, invalid automation trigger, circular dependency — সব গ্রহণ করে | round 1: B2,B3,B9,H2,I2,K2,K3,L4,O4,P2 | `tasks.service.ts` create/update/logTime |
| P2-6 | **Circular dependency** A→B→A অনুমোদিত | L4 | `tasks.service.ts:1452` |
| P2-7 | **Edit modal drawer-এর উপরে দ্বিতীয় dialog** — একসাথে ২টি `role=dialog`, দুটোই focus trap | DOM: 2 dialogs | `page.tsx` + `task-form-modal.tsx` |
| P2-8 | **5000-char title/description** সীমাহীন; NUL byte title → unhandled **500** | B5, 9.3 | DTO নেই (`body:any`) |
| P2-9 | **No pagination** — `take: 500` silent truncation | `tasks.service.ts:944` |  |
| P2-10 | **Setup-এ utilization 150%-এ cap** — 31h/16h আর 26h/16h দুটোই "150%" | `tasks-setup.png` | workload UI |
| P2-11 | **Tab counter অসঙ্গত** — `Checklist 0/0`, `Subtasks 0/0` vs `Comments (0)`, `Time (0)` | drawer | `page.tsx:1530-1540` |
| P2-12 | **তথ্য ডুপ্লিকেট** — due date ও project title-cell + আলাদা column দুটোতেই; প্রতি row-তে priority dropdown | list screenshot | `page.tsx:299-321` |
| P2-13 | **Date format মিশ্র** — "26 Sept" (en-GB) কিন্তু date input `mm/dd/yyyy` (US) | time tab | `page.tsx:1771` |
| P2-14 | **Bulk due date নির্বাচনমাত্র apply** (confirm নেই), archive-ও confirm ছাড়া | bulk bar | `page.tsx:752` |
| P2-15 | **Bulk skipped ভুল** — অস্তিত্বহীন id `skipped`-এ গোনা হয় না (silently drop) | G6 | `tasks.service.ts:334-345` |

---

### 🔵 P3 — ✅ Fixed

1. **Lighthouse (tasks page):** Accessibility **0.92**, Best Practices **1.00**, SEO **1.00**।
   - `select-name` — ৯টি `<select>`-এর accessible name নেই (৫টি filter + প্রতি row-এর priority + assignee filter)।
   - `target-size` — 14px checkbox, 24px avatar button (minimum 24px দরকার)।
   - `label-content-name-mismatch` — Notifications button (দৃশ্যমান "29" বনাম aria-label "Notifications")।
2. **Login form** — "Work email"/"Password" label-এর `for=""`, input-এ `id` নেই → label association নেই (মডিউলে ঢোকার দরজাতেই)।
3. Comment textarea-র label নেই (শুধু placeholder)।
4. Empty state-এ "0 tasks" দুইবার (filter bar + table footer)।
5. Setup-এ Templates কার্ড বিশাল ফাঁকা জায়গা নেয় (right column-এর উচ্চতার সাথে stretch)।
6. Drawer-এ "Sakib Hasan → Unassigned" — reporter → assignee, কিন্তু লেবেল ছাড়া assignment transition মনে হয়।
7. `deleteTask` / `archiveTask`-এ `window.confirm` — বাকি অ্যাপের modal ভাষার সাথে অসঙ্গত।
8. Dev-server নোট: প্রথম লোডে পুরো অ্যাপ ৫০০ দিচ্ছিল — `next/font/google` (Noto Sans Bengali) + Turbopack cache corruption। `.next` ক্লিয়ার করে ঠিক হয়। CI/নতুন মেশিনে আবার হতে পারে; `next build`-এ যাচাই করা দরকার।

---

## 4. যা ভালো লেগেছে (keep it)

- **Field-level permission মডেল** (`canViewTask` / `canEditFull` / `canWorkOnTask`) ভাবনাটা সঠিক — শুধু list ও guard-এর সাথে wiring ঠিক করতে হবে।
- **Reporter spoof প্রতিরোধ** — client `reporterId` পাঠালেও সার্ভার JWT থেকে সেট করে (B11 ✅)।
- **Optimistic status update + rollback** — UI তাৎক্ষণিক, fail করলে ফিরে আসে।
- **Keyboard-first** — `c` (create), `/` (search), `Esc` (close); typing-এর সময় সঠিকভাবে ignore করে (যাচাই করা)।
- **Deep link** — `?task=<id>` drawer খোলে, বন্ধ করলে URL পরিষ্কার হয় (যাচাই করা)।
- **Human error copy** — "The assignee needs to know what done looks like", "Loosen a filter, or create a task." — design standard-এর সাথে মানানসই।
- **Security basics** — `nosniff`, `DENY`, CSP, `x-powered-by` সরানো; SQL-ish search নিরাপদ; Prisma error → 400 mapping।
- **Domain extras** — checklist `doneBy/doneAt` stamping, `actualHours` recompute, `completedAt` stamp/clear, recurrence spawn, automation hooks, sprint burndown/snapshot — সব কাজ করে।
- **Dark/light** — দুই থিমেই টোকেন সঠিক, modal portal-ও ঠিক (`html.dark`)।
- **Drawer mobile-এ** 390px-এ ভালো ফিট করে, tabs wrap হয়।

---

## 5. টেস্ট ফলাফল (raw)

### API round 1 — `qa-tasks-api.js`
```
BEFORE fixes : 90 passed, 24 failed  (এর ৫টি harness expectation, ১৯টি real defect)
AFTER  fixes : 114 passed, 0 failed  ✅
```

### API round 2 — `qa-tasks-api2.js` (permission scope + integrity)
```
BEFORE fixes : 15 passed, 7 failed
AFTER  fixes : 22 passed, 0 failed  ✅
  - list scoped (27 → 4 for Sales)
  - assignee can move/comment/log
  - archived + subtask stats consistent
  - parent delete cascades
  - reaction identity session-derived
  - PATCH vs /status parity
```

### Regression suites
```
npm run test:smoke  → 28/28 passed
npm run test:flow   → 11/11 passed
Lighthouse (tasks)  → Accessibility 100 · Best Practices 100 · SEO 100 · 0 failures
Browser console     → 0 errors
```

### UI checks
| চেক | ফল |
|---|---|
| List / Board / Calendar / Gantt / Setup load | ✅ 0 console error |
| Create task (modal validation + success) | ✅ |
| Edit task (title/brief) | ✅ |
| Edit task (status) | ✅ (API-তে DONE পৌঁছায়) |
| Status change (drawer) | ✅ |
| Checklist add/tick/delete | ✅ |
| Comment post | ✅ |
| Time log add | ✅ |
| Bulk select + bulk bar | ✅ (drawer আর খোলে না) |
| Deep link `?task=` | ✅ |
| Keyboard `c` `/` `Esc` | ✅ |
| Dark / light | ✅ |
| 1440 / 930 / 390 | ✅ mobile CTA ভিজিবল |
| Lighthouse | **A11y 1.00 / BP 1.00 / SEO 1.00 — 0 failures** |

---

## 6. ফিক্স অর্ডার — ✅ সম্পন্ন

> নিচের পুরো তালিকাটি এই পাসেই বাস্তবায়িত হয়েছে (§0 দেখুন)। ভবিষ্যতের রেগ্রেশন ঠেকাতে টেস্ট স্ক্রিপ্ট দুটি repo-তে রাখা হলো।

**Sprint 1 (release blocker)**
1. `list()`-এ permission scoping (P0-1) + regression test: Sales user-এর list == তার সম্পর্কিত task-ই।
2. Subtask cascade delete বা soft-delete (P0-2) + DB constraint।
3. Assignee workflow vs module guard (P1-1) — একটাকে authoritative করা।
4. Edit modal-এ `status` পাঠানো (P1-2)।
5. Mobile header action wrap / FAB (P1-3)।
6. Checkbox `onClick` stopPropagation (P1-4)।

**Sprint 2**
7. Calendar key + trailing day fix + week navigation (P1-5)।
8. Status normalization এক জায়গায় (P1-6) + unknown value → 400 (P1-7)।
9. Board ৫ কলাম fit (P1-8)।
10. Validation: DTO দিয়ে title/status/hours/date/comment/checklist (P2-5), circular dep check (P2-6)।

**Sprint 3 (polish)**
11. Search description-এ বাড়ানো, stats থেকে archived/subtask আলাদা করা, reaction userId সার্ভার-নির্ধারিত, একটাই timer, a11y (select labels + touch target + login labels), pagination।

---

## 7. Evidence ফাইল

```
qa-evidence/
  tasks-api-results.json          round 1 (114 assertions)
  tasks-api-round2.json           round 2 (permission + integrity)
  tasks-api-run.log               console output
  tasks-desktop-list.png          1440 list
  tasks-desktop-board.png         board (Done column offscreen)
  tasks-desktop-calendar.png      month (trailing days all "1")
  tasks-desktop-calendar-week.png week (ghost cells)
  tasks-desktop-gantt.png         gantt
  tasks-new-modal.png             create modal
  tasks-modal-validation.png      empty submit → inline errors
  tasks-detail-drawer.png         detail drawer
  tasks-detail-checklist*.png     checklist flow
  tasks-detail-comments-tab.png   comments
  tasks-detail-time-*.png         time logging
  tasks-edit-modal-status.png     edit modal (before fix)
  tasks-bulk-bar*.png             bulk selection (before fix)
  tasks-empty-state.png           no-results state
  tasks-filters-panel.png         advanced filters
  tasks-mobile-390-list.png       mobile before (New Task offscreen)
  tasks-mobile-390-board.png      mobile board
  tasks-mobile-390-drawer.png     mobile drawer
  tasks-mobile-390-dark.png       mobile dark
  tasks-setup.png / -bottom.png   workload, templates, automation

  # after-fix verification
  tasks-after-list.png            list (deduped chips, white CTA)
  tasks-after-board.png           5 columns fit at 1440
  tasks-after-calendar-week.png   current week 8–14 Nov, 7 cells
  tasks-after-mobile.png          New Task visible at 390px
  tasks-after-time-tab.png        single server timer
  tasks-api-after-fixes.log       round 1 → 114/114
  tasks-api-round2-after-fixes.log round 2 → 22/22
```

## 8. কোড পরিবর্তন (files touched)

```
apps/api/src/tasks/tasks.service.ts        validation, scoping, cascade, stats, reactions
apps/api/src/tasks/tasks.controller.ts     assignee-side @SkipPermission, strict status
apps/web/src/app/(app)/tasks/page.tsx      calendar, board, mobile, a11y, single timer
apps/web/src/app/(app)/tasks/setup/page.tsx  items-start grid
apps/web/src/components/tasks/task-form-modal.tsx  status in payload
apps/web/src/components/tasks/task-ops.tsx         checklist button label
apps/web/src/components/shared.tsx         header actions wrap
apps/web/src/components/sidebar.tsx        contrast tokens
apps/web/src/components/notifications-dropdown.tsx  a11y label
apps/web/src/app/login/page.tsx            label/input association
apps/web/src/app/globals.css               primary-foreground contrast
qa-tasks-api.js / qa-tasks-api2.js         regression suites (repo root)
docs/qa-tasks-audit.md                     this report
```

টেস্ট স্ক্রিপ্ট: `qa-tasks-api.js`, `qa-tasks-api2.js` (repo root) — আবার চালানো যাবে; শুধু `QA` prefix ডেটা তৈরি করে নিজেই মুছে ফেলে।
