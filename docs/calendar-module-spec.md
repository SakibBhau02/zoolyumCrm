# Calendar Module — Feature & Functionality Spec

**Module:** `/calendar` (Zoolyum OS — Agency Operating System)
**Status:** Implemented — see `docs/calendar-module-implementation.md` for what shipped
**Date:** ১১ নভেম্বর ২০২৬
**Owner:** Product (Owner) · PM · Social Media Team
**Scope:** Content calendar, campaign/ad planning, unified agency work timeline, client-wise calendar, plan → report generation
**Out of scope (এই ডকে):** actual code, migration execution, third-party publisher API integration (শুধু ডিজাইন লেভেলে রাখা হয়েছে)

---

## 0. TL;DR — এক নজরে

আজকের `/calendar` একটা **পাতলা content-list + ২টা আলাদা গ্রিড**। এটাকে আমরা বানাবো এজেন্সির **"single source of truth timeline"**:

1. **একটাই ক্যালেন্ডার, সব কাজ** — meeting, task, content post, ad flight, deliverable, milestone, invoice due, report due, leave/holiday — সব একসাথে date-wise।
2. **প্রতিটা আইটেমের উৎস আলাদা** (Task মডিউল, Flow, Capital, People) — ক্যালেন্ডারে duplicate ডেটা এন্ট্রি নয়, read-time merge।
3. **Client-wise calendar** — এক ক্লায়েন্ট সিলেক্ট করলে শুধু তার কাজ; রঙ ও ফিল্টার client/project/campaign ভিত্তিক।
4. **দিনের হিসাব** — আজ কয়টা মিটিং হলো, কয়টা টাস্ক হলো/হলো না, কয়টা পোস্ট গেল, কী miss হলো — "Day close-out" ভিউ।
5. **Plan → Report engine** — মাস/সপ্তাহের শুরুতে "কোন দিন কোন পোস্ট, কোন প্ল্যাটফর্মে, কোন অ্যাড যাবে" প্ল্যান বানিয়ে **lock** করা যাবে, তারপর এক ক্লিকে **client-ready PDF/XLSX/share-link report**।
6. **Approval chain** — Draft → Internal review → Client approval → Scheduled → Published, সব ক্যালেন্ডার থেকেই।
7. **Drag-and-drop reschedule**, week/day/agenda/timeline/grid view, saved views, bulk CSV import।
8. **আজকের বাস্তবতা vs প্ল্যান** — planned vs executed comparison (on-time %, slip, missed)।
9. **Reminder + automation** — T-24h/T-1h, approval chase, content gap, plan lock নোটিশ (Telegram + bell)।
10. **Google Calendar / iCal** — বাইরের ক্যালেন্ডারের সাথে দুই-মুখী বা subscribe-only সিঙ্ক।

**সবচেয়ে বড় পরিবর্তন:** ক্যালেন্ডার আর "social post list" নয় — এটা **এজেন্সির execution ledger** আর **client-facing plan document**।

---

## 1. বর্তমান অবস্থা — কোড লেভেল অডিট

### 1.1 ফাইল ম্যাপ

| স্তর | ফাইল | লাইন | কী আছে |
|---|---|---|---|
| API controller | `apps/api/src/calendar/calendar.controller.ts` | 69 | ১২টা endpoint, পুরোটা `@RequirePermission("FLOW")` |
| API service | `apps/api/src/calendar/calendar.service.ts` | 165 | ContentPost + CalendarEvent + DailyTarget CRUD |
| Web page | `apps/web/src/app/(app)/calendar/page.tsx` | 839 | ৩টা ট্যাব, ২টা month-grid, ৩টা মডাল |
| Schema | `apps/api/prisma/schema.prisma` | 1800–1845 | `ContentPost`, `CalendarEvent`, `DailyTarget` |
| Sidebar | `apps/web/src/components/sidebar.tsx` | 45 | `/calendar` → perm `FLOW` |
| Dashboard | `apps/api/src/dashboard/dashboard.service.ts` | 71, 186, 213 | শুধু `CalendarEvent` next-7 feed |
| Tasks মডিউল | `apps/web/src/app/(app)/tasks/page.tsx` | — | **আলাদা** ক্যালেন্ডার ভিউ (ডুপ্লিকেট লজিক) |
| Search | `apps/api/src/search/search.service.ts` | 50 | calendar `FLOW` permission-নির্ভর |

### 1.2 এখন যা করা যায়

- **Content Calendar ট্যাব:** মাসিক গ্রিডে পোস্ট (দিনে সর্বোচ্চ ৩টা, `+N more`), পাশে সব পোস্টের টেবিল। পোস্টে: title, caption, platforms (fb/ig/tw/li/tt), date (string), time (string), status (DRAFT/SCHEDULED/PUBLISHED/FAILED), project, hasImage/hasVideo flag।
- **Monthly Planner ট্যাব:** দ্বিতীয় মাসিক গ্রিড + `CAMPAIGN/CONTENT/MEETING/DEADLINE/MILESTONE` টাইপের ইভেন্ট (শুধু date, time নেই) + upcoming 10।
- **Daily Targets ট্যাব:** মাসিক period-এ target/current/unit/category — এটা আসলে ক্যালেন্ডার ফিচার নয়।

### 1.3 সীমাবদ্ধতা (গুরুত্ব অনুযায়ী)

| # | সমস্যা | প্রভাব | সিভিয়ারিটি |
|---|---|---|---|
| 1 | Task/Milestone/Deliverable ক্যালেন্ডারে **নেই** | "আজ কী কী কাজ" প্রশ্নের উত্তর পাওয়া যায় না — অথচ এটাই প্রথম চাহিদা | 🔴 Critical |
| 2 | `ContentPost`-এ **clientId নেই** (শুধু projectId) | client-filter সম্ভব নয়; project ছাড়া পোস্ট = orphan, কোনো ক্লায়েন্টে দেখা যায় না | 🔴 Critical |
| 3 | `scheduledDate` **String** (`"2026-11-11"`), `scheduledTime` **String** (`"10:00"`) | sorting/range/span/timezone/conflict detection সব ম্যানুয়াল; `startsWith(month)` ফিল্টার | 🔴 Critical |
| 4 | **week/day view নেই**, শুধু month | ডেইলি ওয়ার্কিং ভিউ অসম্ভব | 🔴 Critical |
| 5 | **drag-and-drop নেই** | reschedule = মডাল খুলে তারিখ বদলানো (৩-৪ ক্লিক) | 🟠 High |
| 6 | **client-wise filter/route নেই** | "এই ক্লায়েন্টের নভেম্বরে কী" দেখার উপায় নেই | 🔴 Critical |
| 7 | **report generate নেই** | প্ল্যান → ক্লায়েন্ট রিপোর্ট শুধু হাতে (স্প্রেডশিট/Canva) | 🔴 Critical |
| 8 | **approval workflow নেই** (DRAFT→SCHEDULED→PUBLISHED→FAILED) | ক্লায়েন্ট অনুমোদন ট্র্যাক হয় না; `needs_revision` বোঝা যায় না | 🟠 High |
| 9 | ad planning মডেলই নেই (`AdCampaign`-এ start/end date নেই) | "কোন দিন কোন অ্যাড যাবে" প্ল্যান করা যায় না | 🟠 High |
| 10 | `CalendarEvent`-এ **time/duration/location/attendees নেই** | মিটিং ক্যালেন্ডার হিসেবে অপূর্ণ | 🟠 High |
| 11 | taskcreate-from-calendar নেই | প্ল্যান থেকে execution-এ যাওয়ার পথ নেই | 🟠 High |
| 12 | `< 3` আইটেম দেখিয়ে বাকিটা **ক্লিকযোগ্য নয়** (`+N more` dead end) | দিনের ভেতরে ঢোকা যায় না | 🟠 High |
| 13 | সব পোস্ট এক টেবিলে, **pagination নেই**, `max-h-[560px]` | ডেটা বাড়লে UI মরে | 🟡 Medium |
| 14 | `GET /calendar/posts` month ছাড়া ডাকলে **পুরো history** ক্যাশে করে (`cal:posts:all`) | perf + stale cache | 🟡 Medium |
| 15 | Task পোস্ট/ইভেন্ট বদলালে calendar cache invalidate হয় না | ভুল/পুরনো গ্রিড | 🟡 Medium |
| 16 | leading `null` cell, **trailing দিন নেই**; adjacent-month দিন নেই | "১ তারিখ" ghost bug-এর ঝুঁকি (tasks ক্যালেন্ডারে এটাই ঘটেছে, `docs/qa-tasks-audit.md:189`) | 🟡 Medium |
| 17 | `DailyTarget` নামেই "daily", বাস্তবে **monthly**, client-হীন | ভুল জায়গায় ভুল মডেল | 🟡 Medium |
| 18 | work calendar (ছুটি/অফ ডে) ওভারলে নেই | প্ল্যান করার সময় ছুটি দেখা যায় না | 🟡 Medium |
| 19 | `platform` শুধু string array; **account/handle নেই** | "কোন পেজে যাবে" স্পেসিফিক নয়, double-post conflict ধরা যায় না | 🟡 Medium |
| 20 | published proof নেই (external post URL/ID) | রিপোর্টে "লাইভ লিংক" দেওয়া যায় না | 🟡 Medium |
| 21 | ডুপ্লিকেট ক্যালেন্ডার লজিক (tasks page vs calendar page) | দুই জায়গায় বাগ, দুইবার ফিক্স | 🟡 Medium |
| 22 | recurring content নেই (weekly reel, monthly report) | প্রতিবার হাতে ৪-৮টা এন্ট্রি | 🟢 Nice |
| 23 | bulk import নেই | নতুন ক্লায়েন্ট onboard-এ ২০-৩০ পোস্ট হাতে | 🟢 Nice |
| 24 | delete = browser `confirm()`, undo নেই | ভুল ডিলিট হলে ডেটা হারায় | 🟢 Nice |

### 1.4 বর্তমান ডেটা মডেল (হুবহু)

```prisma
model ContentPost {
  id            String            @id @default(cuid())
  title         String
  content       String            @default("")
  platforms     Json              @default("[]")      // ["facebook","instagram"]
  scheduledDate String                                // "2026-11-11"  ← string!
  scheduledTime String            @default("10:00")   // "10:00"       ← string!
  status        ContentPostStatus @default(DRAFT)     // DRAFT|SCHEDULED|PUBLISHED|FAILED
  projectId     String?                               // ← client এর একমাত্র সূত্র
  hasImage      Boolean           @default(false)
  hasVideo      Boolean           @default(false)
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  project       Project?          @relation(fields: [projectId], references: [id])
  @@index([status]) @@index([scheduledDate])
}

model CalendarEvent {
  id        String            @id @default(cuid())
  title     String
  type      CalendarEventType @default(MEETING)  // CAMPAIGN|CONTENT|MEETING|DEADLINE|MILESTONE
  date      String                                // "2026-11-11"
  clientId  String?
  projectId String?
  createdAt DateTime          @default(now())
  @@index([date]) @@index([projectId])
}

model DailyTarget {
  id       String @id @default(cuid())
  title    String
  target   Float  @default(1)
  current  Float  @default(0)
  unit     String @default("")
  category String @default("sales")
  period   String                       // "2026-11"
  @@index([period])
}
```

### 1.5 যেসব সোর্স ইতিমধ্যেই ডেটা রাখে (ক্যালেন্ডারে আনার যোগ্য)

| সোর্স | মডেল | তারিখ ফিল্ড | client পাওয়া যায়? | স্ট্যাটাস |
|---|---|---|---|---|
| Task | `Task` | `dueDate`, `startDate`, `completedAt` | `project.clientId` | `TaskStatus` |
| Milestone | `Milestone` | `dueDate`, `completedAt` | `project.clientId` | `MilestoneStatus` |
| Deliverable | `ProjectDeliverable` | ❌ **কোনো তারিখ নেই** | `project.clientId` | `DeliverableStatus` |
| Project | `Project` | `startDate`, `targetEndDate`, `nextReportDate` | ✅ | `ProjectStatus` |
| Invoice | `Invoice` | `issueDate`, `dueDate` | ✅ | `InvoiceStatus` |
| Client renewal | `Client` | `renewalDate`, `nextRetainerDate` | ✅ | — |
| Sprint | `Sprint` | `startDate`, `endDate` | `project.clientId` | `SprintStatus` |
| Leave | leave request | from/to | ❌ (employee) | pending/approved |
| Work calendar | override | date | ❌ | open/closed |
| Ad insight | `AdInsight` | `date` | ✅ | — |
| Ad campaign | `AdCampaign` | ❌ **flight date নেই** | `adAccount.clientId` | `status` string |
| Report | `ProjectReport` | `periodStart/periodEnd` | `project.clientId` | `ReportStatus` |

> **মূল উপলব্ধি:** ডেটা অনেক জায়গায় আছে, কিন্তু **কোথাও একসাথে দেখা যায় না**। তাই প্রথম কাজ — read-model, দ্বিতীয় কাজ — নতুন লেখার জায়গা (ad flight, approval, plan)।

---

## 2. ভিশন ও পারসোনা

### 2.1 এক লাইনে

> "সকালে ৯টায় PM ক্যালেন্ডার খুলে দেখবে আজ কোন ক্লায়েন্টের কী কাজ, কে করছে, কী আটকে আছে; মাসের ১ তারিখে এক ক্লিকে পুরো মাসের কনটেন্ট প্ল্যান ক্লায়েন্টকে পাঠাবে; মাস শেষে প্ল্যান vs বাস্তব রিপোর্ট বের করবে।"

### 2.2 পারসোনা ও তারা কী চায়

| পারসোনা | দৈনিক প্রশ্ন | ক্যালেন্ডারে যা চায় |
|---|---|---|
| **Owner / Founder** | "আজ কত কাজ চলছে, কোন ক্লায়েন্ট পিছিয়ে?" | সব client-এর heatmap, overload, at-risk |
| **Project Manager** | "এই ক্লায়েন্টের নভেম্বর প্ল্যান লক করি, টিম কে কী দেব?" | week/month plan, task+déliverable assign, lock, report |
| **Social Media Manager** | "কাল কী পোস্ট যাবে, কোন প্ল্যাটফর্মে, ক্যাপশন রেডি?" | content grid, platform slot, approval state, caption/media |
| **Designer / Content Writer** | "আমার কোন কাজ কবে দিতে হবে?" | "my work" filter, task + post asset due |
| **Account Manager** | "ক্লায়েন্ট কী অ্যাপ্রুভ করেছে, কী পেন্ডিং?" | client-filtered calendar + approval queue |
| **Client (portal)** | "এই মাসে আমার জন্য কী কী আসছে?" | read-only plan calendar, approve/reject |
| **HR / Finance** | "ছুটি/বিল কোন দিনে পড়ছে?" | leave + invoice overlay (optional layer) |

---

## 3. কোর কনসেপ্ট — Unified Calendar Item

### 3.1 একটাই DTO, বহু সোর্স

ক্যালেন্ডার কখনো ডেটার মালিক হবে না (পোস্ট/টাস্ক ছাড়া)। সে **projection** তৈরি করবে:

```ts
type CalendarItem = {
  // identity
  key: string;                 // "task:clx123" — composite, React key + move target
  source: CalendarSource;
  sourceId: string;

  // display
  title: string;
  subtitle?: string;           // client · project · platform
  icon: string;                // lucide name
  color: CalendarColor;        // client color বা source color

  // time
  date: string;                // "2026-11-11" (Asia/Dhaka দিন)
  startTime?: string;          // "14:30"
  endTime?: string;
  allDay: boolean;

  // relations (filter + grouping)
  clientId?: string; clientName?: string;
  projectId?: string; projectName?: string;
  campaignId?: string; campaignName?: string;
  platforms?: string[];
  assigneeIds?: string[]; assigneeNames?: string[];

  // state
  status: string;              // source-native status
  statusTone: "neutral"|"info"|"success"|"warning"|"danger";
  approval?: "none"|"internal_pending"|"client_pending"|"approved"|"rejected";
  clientVisible: boolean;
  overdue?: boolean;
  isDone?: boolean;

  // action
  href?: string;               // deep link (task drawer, post modal, project)
  editable: boolean;
  draggable: boolean;          // false for invoice/leave (read-only sources)
  meta?: Record<string, unknown>;
};

type CalendarSource =
  | "TASK" | "CONTENT_POST" | "EVENT" | "MILESTONE" | "DELIVERABLE"
  | "AD_FLIGHT" | "INVOICE" | "REPORT" | "SPRINT" | "LEAVE" | "HOLIDAY" | "RENEWAL";
```

### 3.2 সোর্স রেজিস্ট্রি (কোনটা পড়া হবে, কোনটা লেখা যাবে)

| Source | পড়া হবে | ক্যালেন্ডার থেকে এডিট | নোট |
|---|---|---|---|
| `TASK` | `Task.dueDate` (+ `startDate` span) | ✅ date/status/assignee (PATCH `/tasks/:id`) | canonical মালিক Tasks মডিউল |
| `CONTENT_POST` | `ContentPost.scheduledAt` | ✅ পুরো CRUD | canonical মালিক Calendar |
| `EVENT` | `CalendarEvent.startAt` | ✅ পুরো CRUD | meeting/campaign/deadline |
| `MILESTONE` | `Milestone.dueDate` | ✅ date (PATCH `/flow/.../milestones/:id`) | Phase 2 |
| `DELIVERABLE` | নতুন `dueDate` | ⚠️ শুধু date | schema-তে ফিল্ড যোগ করতে হবে |
| `AD_FLIGHT` | নতুন `AdFlight` | ✅ পুরো CRUD | নতুন মডেল |
| `INVOICE` | `Invoice.dueDate` | ❌ read-only | Capital-এ গিয়ে এডিট |
| `REPORT` | `Project.nextReportDate` | ❌ | — |
| `SPRINT` | `Sprint.start/end` | ❌ | span bar |
| `LEAVE` / `HOLIDAY` | People মডিউল | ❌ | overlay layer, default off |
| `RENEWAL` | `Client.renewalDate` | ❌ | hover-এ "৩০ দিন বাকি" |

### 3.3 "হলো / হলো না" — আউটকাম মডেল

প্রশ্নটা ছিল: *"কয়টা মিটিং হইলো, কয়টা টাস্ক হইলো, কী হইলো না"*। এটার জন্য প্রতিটা আইটেমে **outcome** দরকার, শুধু status নয়:

```ts
type Outcome = "DONE" | "PENDING" | "MISSED" | "RESCHEDULED" | "CANCELLED" | "NO_SHOW";
```

| Source | DONE কীভাবে নির্ধারিত হয় | MISSED কীভাবে |
|---|---|---|
| Task | `status = DONE` বা `completedAt` সেট | `dueDate < today` && not done → `overdue` (স্বয়ংক্রিয়) |
| Meeting | `CalendarEvent.outcome = DONE` (ম্যানুয়াল, বা end time পেরিয়ে auto-suggest) | outcome `NO_SHOW`/`CANCELLED` |
| Content post | `status = PUBLISHED` (বা ম্যানুয়াল "Published" + URL) | scheduled time পেরিয়ে DRAFT/SCHEDULED → `MISSED` badge |
| Ad flight | end date পেরিয়ে budget spend > 0 | spend = 0 → `NOT_DELIVERED` |
| Milestone | `status = COMPLETED` | dueDate past & not completed |

> **নিয়ম:** outcome **কখনো ডেটা মুছে দেয় না** — এটা computed + manual override। PM চাইলে কোনো আইটেমে "actually happened on 12th" বলে সরাতে পারবে, আর audit log থাকবে।

### 3.4 ক্লায়েন্টের রঙ (visual identity)

- `Client`-এ নতুন ফিল্ড: `calendarColor` (hex) + `calendarAccent` (optional)।
- ডিফল্ট palette (8টা), একই ক্লায়েন্ট সব ভিউতে একই রঙ → muscle memory।
- রঙ **শুধু client stripe/border**-এ, card background নয় (dark mode-এ contrast ঠিক রাখতে)।

---

## 4. ইনফরমেশন আর্কিটেকচার

### 4.1 নেভিগেশন — এক হাব, ৭টা ভিউ

```
Calendar (hub)
├── Overview            — আজ + এই সপ্তাহ + attention needed  (default)
├── Month               — মাসিক গ্রিড, client/post/ad/task সব
├── Week                — ৭ দিন × ঘণ্টা/স্লট, drag-drop
├── Day                 — agenda + day close-out ("কী হইলো / কী হইলো না")
├── Timeline            — client × date gantt (campaign span, ad flight)
├── Grid                — Instagram/LinkedIn feed preview (per client)
├── Plans & Reports     — plan lock, monthly/weekly report generator
└── Settings            — platforms per client, content pillars, templates, holidays
```

`Segmented` এর বদলে **sub-nav** (People মডিউলের মতো `_components/constants.ts` প্যাটার্ন), কারণ ভিউ ৩টার বেশি এবং deep-link দরকার (`/calendar?view=week&client=...` — URL state)।

### 4.2 URL state (shareable)

সব ভিউ URL-এ encode হবে — PM লিংক পাঠালেই ক্লায়েন্ট/সপ্তাহ/ফিল্টার একই খুলবে:

```
/calendar?view=month&date=2026-11&client=clx1&sources=TASK,CONTENT_POST&platforms=instagram&assignee=emp3
/calendar?view=day&date=2026-11-11
/calendar/clients/clx1?view=week&date=2026-W46
/calendar/plans/pln_123
```

### 4.3 মেনুতে নাম

- Sidebar: **Calendar** (একই থাকে), badge = আজকের pending approval সংখ্যা (optional)।
- Permission: নতুন `CALENDAR` module (নিচে ১৭ নম্বর সেকশন)।

---

## 5. ভিউ স্পেসিফিকেশন

### 5.1 Overview (ডিফল্ট) — "আজ কী হইলো"

উদ্দেশ্য: সকালে ১ স্ক্রিনে দিনের ছবি।

**লেআউট (ডেস্কটপ):**

```
┌──────────────────────────────────────────────────────────────┐
│ Today · Wed 11 Nov        [Today] [<] [>]   [Client ▾] [+ New]│
├──────────┬───────────────────────────────────────────────────┤
│ KPI row  │ 4 stat cards                                     │
│          │ Meetings 3 · Tasks due 7 (2 done) · Posts 4 · Ad 2│
├──────────┴───────────────────────────────────────────────────┤
│ Timeline (hour rows)                    │ Attention needed   │
│ 09:00 ● Client call — Acme (MEETING)    │ • 2 posts pending  │
│ 10:00 ● Post: Eid teaser — IG (PUBLISH) │   client approval  │
│ 11:00 ● Task due: Ad copy (DESIGN)      │ • 3 tasks overdue  │
│ 14:30 ● Photo shoot — Glow (MEETING)    │ • 1 missing asset  │
│                                         │ • Plan not locked  │
├─────────────────────────────────────────┴───────────────────┤
│ This week — 7 দিনের মিনি গ্রিড, প্রতিদিনে count chips        │
├──────────────────────────────────────────────────────────────┤
│ Day close-out (গতকাল): 5 done · 2 missed · 1 rescheduled      │
└──────────────────────────────────────────────────────────────┘
```

**KPI কার্ড (ক্লিকযোগ্য → filtered list):**
| কার্ড | গণনা | ক্লিক |
|---|---|---|
| Meetings | আজ `EVENT` (type=MEETING), reminder ছাড়া | Day view, event filter |
| Tasks due | আজ due + overdue carried | Task-filtered agenda |
| Tasks done | আজ completed | Done list |
| Posts planned | আজ `CONTENT_POST` (সব status) | Grid view |
| Posts published | আজ PUBLISHED | Published list |
| Ad flights live | আজ start≤date≤end | Ad list |
| Approvals pending | internal+client pending | Approval queue |

**Empty state:** "আজ কোনো কাজ নেই" + দুটো CTA — `Add event` / `Open plan`।

### 5.2 Month view

- ৭ কলাম, **leading + trailing adjacent-month দিন** (dimmed, ক্লিকযোগ্য) — ghost-cell bug স্থায়ী সমাধান।
- প্রতিদিনে সর্বোচ্চ **৪টা chip** + `+N more` → ক্লিক করলে **Day drawer** (dead-end নয়)।
- Chip: `● time  title` — বাম দিকে client color bar, ডান দিকে status dot।
- চিপ **drag-and-drop**: অন্য দিনে ফেলে reschedule (optimistic update + toast undo)।
- Cell hover → `+` বাটন (quick add, ওই তারিখ pre-filled)।
- Today = ring, weekend = হালকা bg, holiday = hatched + টুলটিপ।
- "Show weekends" toggle, "Compact / Comfortable" density toggle।
- Cell footer-এ mini progress: `3/5 done` (ঐ দিনের টাস্ক)।

### 5.3 Week view

- ৭ কলাম × সময় (০৮:০০–২০:০০), ৩০ মিনিট স্লট; **all-day row** উপরে (posts, ad flight start/end, invoice due)।
- Event = block (start–end); সময়হীন আইটেম = all-day chip।
- ওভারল্যাপ হলে পাশাপাশি ভাগ (Google Calendar-এর মতো)।
- Drag: ব্লক সরানো (সময় + তারিখ), নিচে টেনে duration বদল (events-এর জন্য; posts-এ শুধু সময়)।
- "Now" লাইন (লাল)।
- সপ্তাহের header-এ দিন-ভিত্তিক count: `Mon 9 · 3 done`।
- মোবাইলে week → ৩-দিন (agenda hybrid)।

### 5.4 Day / Agenda + Close-out

দুই কলাম: বাম = টাইমলাইন, ডান = **Day summary / close-out panel**।

```
Day summary — Wed 11 Nov
─────────────────────────
Meetings      3 planned · 2 done · 1 no-show
Tasks         7 due · 5 done · 2 open (1 overdue)
Content       4 planned · 3 published · 1 missed
Ads           2 live · spent ৳4,200 / ৳6,000
Approvals     2 pending client
Notes         [Add day note…]   ← DailyLog
```

- PM দিনশেষে এক লাইনে লিখতে পারবে: *"Acme এর ২টা পোস্ট ক্লায়েন্ট অ্যাপ্রুভ করেনি"* → `DailyLog` (client-scoped হলে ক্লায়েন্ট calendar-এ invisible)।
- "Carry over" বাটন: আজকের বাকি টাস্কগুলো কালকে সরানো (bulk move)।
- "Mark day as reviewed" → close-out locked (audit)।

### 5.5 Timeline (Gantt) view

- Row = client (বা project / campaign — toggle)। X = date।
- Bar = campaign span, ad flight, sprint, project (`startDate → targetEndDate`)।
- Diamond = milestone/deliverable/invoice due।
- Zoom: week / month / quarter।
- Drag bar → shift dates (campaign/ad flight)।
- ব্যবহার: "কোন ক্লায়েন্টে কোন সপ্তাহে ফাঁক আছে" এক নজরে।

### 5.6 Grid view (feed preview)

- Per client, per platform: Instagram 3×3, LinkedIn 1-col, Facebook feed।
- প্রতিটা সেল: thumbnail/placeholder, caption excerpt, status ring (draft/review/approved)।
- ক্লিক → post drawer (caption, hashtags, media, approval, comments)।
- **Content gap** halo: ফাঁকা স্লটে "—" + "plan something"।
- প্ল্যাটফর্ম ট্যাব: FB · IG · LinkedIn · TikTok · X · YouTube · Google Business (extensible list)।

### 5.7 Plans & Reports view

নিচের ১১ নম্বর সেকশনে বিস্তারিত।

### 5.8 Client calendar (`/calendar/clients/[clientId]`)

- উপরে ক্লায়েন্ট হেডার (health, owner, retainer, renewal)।
- ডিফল্ট week, কিন্তু সব ভিউ।
- শুধু ওই ক্লায়েন্টের আইটেম; প্ল্যাটফর্ম-ভিত্তিক কলাম (IG/FB/LI) toggle।
- "Share with client" → read-only token link + portal publish।
- ক্লায়েন্টের ট্যাব পেজ (Accounts → client detail) থেকেও deep link।

### 5.9 Mobile

| ভিউ | মোবাইল আচরণ |
|---|---|
| Month | ৭ কলাম নয় → **৩ দিনের agenda carousel** + মাসিক mini-heatmap |
| Week | day-by-day swipe (৩ দিন) |
| Day | full-width agenda, sticky date header |
| Grid | ২ কলাম, tap → bottom sheet |
| Quick add | bottom sheet + FAB |

---

## 6. ফিল্টার, সার্চ, Saved Views

### 6.1 ফিল্টার (সব ভিউতে শেয়ারড, URL-এ persist)

| ফিল্টার | টাইপ | ডিফল্ট |
|---|---|---|
| Client | multi-select (searchable) | all |
| Project | multi-select (client এক হলে filtered) | all |
| Campaign | multi-select | all |
| Source/type | chips: Task, Post, Meeting, Ad, Milestone, Deliverable, Invoice, Leave | Task, Post, Meeting, Ad (P0) |
| Platform | chips | all |
| Status | chips (source-aware) | all except CANCELLED |
| Assignee ("My work") | multi employee | all / `me` |
| Approval | none / internal pending / client pending / approved / rejected | all |
| Client visibility | all / client-visible only | all |
| "Only mine" | toggle | off |
| Weekend/holiday layer | toggle | weekends on, holidays off |

Active filter count badge + "Clear all"। ৫টার বেশি ফিল্টার হলে "More filters" popover।

### 6.2 সার্চ

- ক্যালেন্ডার-স্কোপড সার্চ (title, caption, client, project, platform, assignee)।
- `/` কীবোর্ড → সার্চ focus।
- ফলাফল ক্লিক → item drawer + তারিখে jump।

### 6.3 Saved Views

- `SavedCalendarView` মডেল (Tasks-এর `SavedTaskView` প্যাটার্ন)।
- উদাহরণ প্রিসেট (seed): "My week", "Client approvals", "Publishing queue", "Ads this month", "Unscheduled backlog"।
- Shared view (team) vs personal view।

### 6.4 Unscheduled backlog

খুব দরকারি: `scheduledDate` নেই এমন সব আইটেমের **ডান-পাশে ড্রয়ার** (posts without date, tasks without due)। এখান থেকে গ্রিডে **drag** করা যাবে। এটা "কী বাকি আছে" প্রশ্নের সরাসরি উত্তর।

---

## 7. আইটেম ইন্টার‍্যাকশন

### 7.1 Detail drawer (সব সোর্সের একই খোলস)

```
┌─────────────────────────────────────────────┐
│ [POST]  Eid campaign — teaser      ✕        │
│ Acme Ltd · Eid Campaign 2026 · Instagram    │
├─────────────────────────────────────────────┤
│ Status   [Draft ▾]   Approval  [Client ⏳]  │
│ When     Thu 12 Nov · 10:00 (Asia/Dhaka)    │
│ Owner    Lamia (SM Manager)                  │
│ Media    2 images ▸  preview                │
│ Caption  "…" [Copy]                         │
│ Hashtags #eid #acme                         │
├─────────────────────────────────────────────┤
│ Approval trail   Draft → Internal ✓ → Client ⏳│
├─────────────────────────────────────────────┤
│ 💬 2 comments       Activity log ▸          │
├─────────────────────────────────────────────┤
│ [Open full editor] [Duplicate] [Delete]     │
└─────────────────────────────────────────────┘
```

- Drawer **inline edit** (status, date, time, assignee) — মডাল খোলার দরকার নেই।
- `Esc` বন্ধ, `←/→` আগের/পরের আইটেম, `E` edit, `D` duplicate।
- Read-only sources (invoice) → "Open in Capital" বাটন।
- Task → drawer-এর ভেতরে checkbox দিয়ে done করা যায় (API PATCH)।

### 7.2 Quick add

`N` বা `+ New` → এক ড্রপডাউন:

| অপশন | যা করে |
|---|---|
| Post | পোস্ট মডাল (তারিখ pre-filled) |
| Event / Meeting | ইভেন্ট মডাল (start/end, attendee) |
| Task | Task create (`/tasks`) — project+dueDate pre-filled |
| Ad flight | Ad schedule মডাল |
| Deliverable | নতুন deliverable + due date |
| Note | `DailyLog` entry |

ব্রেইন-ডেড্প ফাস্ট পাথ: গ্রিডের দিনে `+` চাপলে ওই তারিখ সেট থাকে।

### 7.3 Drag & drop নিয়ম

| Action | ফল |
|---|---|
| Chip/bock অন্য দিনে | `date` update + optimistic UI + "Undo" toast (৫ সেকেন্ড) |
| Week view-এ সময় বদল | `startTime` update (15-মিনিট snap) |
| Drag করে duration | শুধু `EVENT`/`AD_FLIGHT` (post-এর duration নেই) |
| Read-only source | drag disabled + tooltip "Invoice due — edit in Capital" |
| Locked plan period | drag disabled, "Unlock plan to edit" prompt (reason সহ) |
| Conflict তৈরি হলে | save আগে warning: "Same client+platform, 15 min apart" → "Keep anyway" |

### 7.4 Bulk action

- Multi-select (checkbox mode) → **Move to date**, **Change status**, **Assign**, **Duplicate week**, **Delete**।
- "Duplicate last week" — সব পোস্টের কপি পরের সপ্তাহে (recurring client-দের জন্য lifesaver)।

### 7.5 Recurring

- `recurrenceRule` (RRULE string) posts/events-এ।
- UI: "Repeats — None / Weekly / Every 2 weeks / Monthly (nth weekday)"।
- রেন্ডার: virtual instance (master + exception list); edit-এ "this / this & future / all"।
- Post-এর ক্ষেত্রে: master template থেকে child posts তৈরি (আলাদা row, আলাদা স্ট্যাটাস) — approval ও publish tracking সহজ।

### 7.6 Bulk import (CSV)

কলাম: `date, time, platform(s), client, project, title, caption, type, owner, status, link`
- Preview table + row-level validation (unknown client/platform → blocked)।
- "Create missing content types/pillars" optional।
- ব্যবহার: নতুন ক্লায়েন্ট onboard, মাসিক প্ল্যান স্প্রেডশিট থেকে।

### 7.7 Undo

- সব destructive action (delete, bulk move, status change) → ৮ সেকেন্ড undo toast।
- Hard delete নয়: `archivedAt` (soft) + "Recently deleted" (৩০ দিন)।

---

## 8. Content Calendar — ডিপ স্পেসিফিকেশন

### 8.1 ক্লায়েন্টের সোশ্যাল অ্যাকাউন্ট (নতুন)

```prisma
model ClientPlatformAccount {
  id            String   @id @default(cuid())
  clientId      String
  platform      Platform
  handle        String            // "@acmebd"
  profileUrl    String?
  isActive      Boolean  @default(true)
  isPrimary     Boolean  @default(false)
  followers     Int?              // last known
  followersAt   DateTime?
  timezone      String   @default("Asia/Dhaka")
  createdAt     DateTime @default(now())
  client        Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  posts         ContentPost[]
  @@unique([clientId, platform, handle])
  @@index([clientId])
}

enum Platform { FACEBOOK INSTAGRAM LINKEDIN TIKTOK X YOUTUBE GOOGLE_BUSINESS PINTEREST THREADS }
```

> এখন `platforms` একটা Json string array — কোন পেজে যাবে বোঝা যায় না। প্ল্যাটফর্ম অ্যাকাউন্ট থাকলে conflict detection, grid preview, per-platform analytics সব সম্ভব।

### 8.2 পোস্টে যা থাকবে (এক্সটেন্ডেড)

| ফিল্ড | কেন |
|---|---|
| `clientId` (denormalized) | client filter/index — project ছাড়া পোস্টও countable |
| `campaignId` | campaign rollup, report grouping |
| `scheduledAt` (`DateTime`) + `timeZone` | sorting, range, conflict, iCal |
| `accountIds` (`ClientPlatformAccount[]`) | কোন পেজে যাবে |
| `format` (STATIC/CAROUSEL/REEL/STORY/VIDEO/TEXT/ARTICLE) | plan vs execution, platform rules |
| `pillarId` / `contentType` (EDUCATIONAL/PROMO/ENGAGEMENT/UGC/ANNOUNCEMENT) | content mix report ("৪০% promo" সতর্কতা) |
| `assigneeId`, `reviewerId` | কে বানাচ্ছে, কে দেখবে |
| `approvalStatus`, `approvedById`, `approvedAt`, `rejectionReason` | approval chain |
| `publishStatus` (separate), `publishedAt`, `externalUrl`, `externalPostId` | proof of publish |
| `assetUrls Json` / `ProjectFile` link | আসল ছবি/ভিডিও |
| `caption`, `firstComment`, `hashtags`, `linkUrl`, `altText` | কপি পূর্ণতা |
| `notesInternal` | ক্লায়েন্ট-অদৃশ্য নোট |
| `requiresClientApproval` | client sign-off লাগবে কি |
| `archivedAt` | soft delete |

**দুই status আলাদা করা জরুরি** (এখন একটাই):
```
approvalStatus:  NONE → INTERNAL_REVIEW → CLIENT_REVIEW → APPROVED → REJECTED
publishStatus:   DRAFT → SCHEDULED → PUBLISHING → PUBLISHED → FAILED → MISSED
```
রিপোর্টে "কতগুলো অ্যাপ্রুভড কিন্তু পাবলিশ হয়নি" — এই দুটো মিশালেই আসল bottleneck বের হয়।

### 8.3 Approval chain

```
Designer creates (DRAFT)
   → Internal review (SM Lead)         [EDIT/APPROVE permission]
      → Client review (portal)          [portal user, notification]
         → Approved → can SCHEDULE
         → Rejected + reason → back to DRAFT (needs_revision)
   → Publish → PUBLISHED + URL
```

- প্রতি ধাপে `Notification` + Telegram (linked হলে)।
- SLA timer: internal 24h, client 48h → "pending too long" queue।
- Approval history immutable (audit)।

### 8.4 Content pillars & mix

- `ContentPillar { clientId, name, color, targetPct }` (যেমন Educational 40%, Promo 30%, Engagement 30%)।
- Monthly report-এ **actual mix vs target** bar — "এই মাসে ৬০% promo, ব্র্যান্ড guideline ভাঙছে"।
- Planner-এ pillar অনুযায়ী রঙ/আইকন, যাতে ব্যালেন্স চোখে পড়ে।

### 8.5 Conflict rules (save-এর আগে)

| Conflict | Severity | আচরণ |
|---|---|---|
| একই client + platform + account, ৩০ মিনিটের মধ্যে ২ পোস্ট | warning | confirm dialog |
| একই client, একই দিনে ৪+ পোস্ট | info | subtle badge |
| অ্যাপ্রুভড নয় এমন পোস্ট SCHEDULED | block (configurable) | "needs approval" |
| ছুটির দিনে পোস্ট | info | tooltip |
| পাবলিশ টাইম গতকাল, status DRAFT | warning | "mark missed or reschedule" |
| Campaign deadline-এর পরে পোস্ট | warning | — |
| Ad flight client-এর monthly budget ছাড়াচ্ছে | warning | budget bar |

### 8.6 প্ল্যাটফর্ম-নির্দিষ্ট নিয়ম (soft validation)

- Instagram: caption ≤ 2,200 char, ৩০ hashtag, media বাধ্যতামূলক (post type), aspect ratio hint।
- X: 280 char (কিন্তু thread হলে N/A)।
- LinkedIn: 3,000 char।
- TikTok/Reels: video বাধ্যতামূলক।
- এগুলো **warning**, hard block নয় (API বদলায়)। char counter সবসময় দেখাবে।

### 8.7 Publishing (ফেজিং)

- **P0:** শুধু "Mark as published" + URL (ম্যানুয়াল) — আজকের বাস্তবতা।
- **P1:** `.ics` / CSV export so team publishes manually from native apps.
- **P2:** Meta (FB + IG Graph API) direct publish, তারপর LinkedIn।
- **P3:** TikTok/YouTube/X।
- পাবলিশিং ট্রাই হলে `FAILED` + error message + retry বাটন।

---

## 9. Ads / Campaign planning

### 9.1 সমস্যা

`AdCampaign` শুধু `externalId/name/status/budget` রাখে — **কোন দিন শুরু, কোন দিন শেষ, কোন creative, কোন objective** রাখে না। ফলে "কোন দিন কোন ad যাবে" প্ল্যান করা যায় না, শুধু past spend দেখা যায়।

### 9.2 নতুন মডেল

```prisma
model Campaign {
  id          String        @id @default(cuid())
  clientId    String
  projectId   String?
  name        String
  objective   String?       // awareness|traffic|leads|sales|engagement
  status      CampaignStatus @default(PLAN)  // PLAN|ACTIVE|PAUSED|COMPLETED|ARCHIVED
  startDate   DateTime      @db.Date
  endDate     DateTime      @db.Date
  totalBudget Decimal?      @db.Decimal(14, 2)
  currency    String        @default("BDT")
  briefLink   String?
  ownerId     String?       // User
  color       String?
  platforms   Platform[]
  posts       ContentPost[]
  flights     AdFlight[]
  client      Client        @relation(fields: [clientId], references: [id], onDelete: Cascade)
  @@index([clientId, startDate])
}

model AdFlight {              // "এই তারিখে এই ad সেট চলবে"
  id            String   @id @default(cuid())
  clientId      String
  campaignId    String?
  projectId     String?
  name          String
  platform      Platform
  objective     String?
  startDate     DateTime @db.Date
  endDate       DateTime @db.Date
  dailyBudget   Decimal? @db.Decimal(12, 2)
  totalBudget   Decimal? @db.Decimal(14, 2)
  status        AdFlightStatus @default(PLANNED) // PLANNED|LIVE|PAUSED|ENDED|CANCELLED
  creativeNote  String?
  adAccountId   String?
  externalCampaignId String?    // AdCampaign.externalId link (optional)
  ownerId       String?
  createdAt     DateTime @default(now())
  @@index([clientId, startDate])
  @@index([campaignId])
}
```

### 9.3 ক্যালেন্ডারে আচরণ

- Month/Week-এ ad flight = **span bar** (start→end), প্রতিদিনে ছোট টিক (spend dot)।
- Day view-এ ad flight live থাকলে "₹ spent today / daily budget" (AdInsight যোগ করে)।
- Timeline-এ ad flight bar → drag করলে পুরো flight shift।
- **Planned vs actual:** `dailyBudget × days` vs `sum(AdInsight.spend)` → report-এ "under-delivered ৳12,000" বা "over-spent 18%"।
- Ad creative-ও ক্যালেন্ডারে আসতে পারে (future): "creative due 2 days before flight" — `EVENT` type=DEADLINE হিসেবেও মডেল করা যায়, পরে `AdCreative` মডেল।

---

## 10. Client-wise calendar ও Portal

### 10.1 ইন্টারনাল ক্লায়েন্ট ক্যালেন্ডার

- Route: `/calendar/clients/[clientId]`
- Accounts → client detail থেকে "Calendar" ট্যাব/bাটন।
- সব সোর্স, কিন্তু client scoped; project/campaign sub-filter।
- হেডারে: client health, PM, retainer, renewal countdown, "this month: 18 planned / 12 published"।
- **Client health ↔ calendar**: পোস্ট কমে গেলে/pending বেশি হলে health driver-এ signal (scoring engine-এ hook — P2)।

### 10.2 Portal (ক্লায়েন্ট যা দেখবে)

- Portal-এ নতুন **"Content Calendar"** সেকশন:
  - read-only month/grid ভিউ (planned + approved; draft অদৃশ্য)।
  - **Approve / Request changes** বাটন প্রতিটা client-review পোস্টে, comment সহ।
  - মিডিয়া প্রিভিউ (post দেখতে কেমন হবে)।
  - "Download plan (PDF)" — মাসিক প্ল্যান।
- শুধু `clientVisible = true` এবং `requiresClientApproval` আইটেম।
- Portal user-এর `Notification` (client inbox) আগেই আছে (`Notification.portalUserId`) — সেটাই ব্যবহার।

### 10.3 Share link (login ছাড়া)

- `CalendarShareLink { id, clientId, token, scope, expiresAt, createdById }`
- Invoice-এর `shareToken` প্যাটার্ন অনুসরণ (ইতিমধ্যে কোডবেসে আছে)।
- `/share/calendar/[token]` — read-only, branded, PDF download।
- Scope: `PLAN` (শুধু approved) | `FULL` (সব non-draft)।

---

## 11. Plan → Report engine (সবচেয়ে গুরুত্বপূর্ণ অংশ)

### 11.1 কনসেপ্ট: Plan একটা "versioned document"

প্ল্যান = নির্দিষ্ট সময়ের (সপ্তাহ/মাস) সব আইটেমের **snapshot + intent**। এটা living calendar নয় — lock করার পর immutable version।

```prisma
model CalendarPlan {
  id           String        @id @default(cuid())
  clientId     String?       // null = agency-wide
  projectId    String?
  scope        PlanScope     @default(MONTH)  // WEEK | MONTH | CUSTOM
  periodStart  DateTime      @db.Date
  periodEnd    DateTime      @db.Date
  title        String        // "Acme — November 2026 content plan"
  status       PlanStatus    @default(DRAFT)  // DRAFT|IN_REVIEW|LOCKED|PUBLISHED|ARCHIVED
  version      Int           @default(1)
  payload      Json          // immutable snapshot (items, grouped, totals)
  totals       Json          // counts per source/platform/status
  notes        String?
  createdById  String?
  lockedAt     DateTime?
  publishedAt  DateTime?
  shareToken   String?       @unique
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  @@index([clientId, periodStart])
  @@index([status])
}
```

### 11.2 Workflow

```
1. Draft plan     PM "New plan" → period + client select → auto-fill from calendar
2. Review         টিম এডিট করে (unlocked); "coverage" panel দেখায় ফাঁক
3. Lock           PM lock করে → স্ন্যাপশট (payload) + version++
4. Publish        client-কে share/portal → PDF/লিংক + notification
5. Execute        ক্যালেন্ডারে কাজ চলতে থাকে (plan অপরিবর্তিত)
6. Report         "Plan vs actual" — snapshot বনাম আজকের সত্য
7. Re-plan        mid-month বদল হলে নতুন version (v2) — পুরনো সংরক্ষিত
```

**Lock-এর নিয়ম:** locked period-এ date/status বদলাতে unlock লাগবে; unlock-এ কারণ (`reason`) বাধ্যতামূলক → audit log। (People-এর payroll past-month lock প্যাটার্নের মতোই — কোডবেসে নজির আছে।)

### 11.3 Plan builder UI

```
┌────────────────────────────────────────────────────────────────┐
│ New plan — Acme Ltd · November 2026        [Month ▾] [Generate]│
├────────────────────────────────────────────────────────────────┤
│ Include:  ☑ Posts  ☑ Meetings  ☑ Tasks  ☑ Ads  ☐ Invoices      │
│ Group by: [Day ▾]   Platforms: ☑IG ☑FB ☑LI                     │
├────────────────────────────────────────────────────────────────┤
│ Coverage check                                                 │
│  • 30 দিনের মধ্যে 6 দিনে কোনো কনটেন্ট নেই                       │
│  • IG: 12 planned (target 16)  FB: 8 (target 8)  LI: 4 (2)     │
│  • 3 পোস্টে media নেই · 2 পোস্ট অ্যাপ্রুভড নয়                   │
├────────────────────────────────────────────────────────────────┤
│ Preview (report যেভাবে দেখাবে)                                  │
│  [table/grid preview]                                          │
├────────────────────────────────────────────────────────────────┤
│ [Save draft]  [Lock plan]  [Publish to client]                 │
└────────────────────────────────────────────────────────────────┘
```

### 11.4 রিপোর্ট টেমপ্লেট (৩টা কোর)

#### A. Weekly Content Plan (client-facing, PM বানায়)

**হেডার:** client logo, period, prepared by, version, generated date.

**সেকশন:**
1. **Week at a glance** — ৭ কলাম grid, প্রতিদিনে platform badges + count।
2. **Day-by-day table** — Date · Platform · Type · Title · Time · Owner · Status · Asset ✓
3. **Ad schedule** — Platform · Flight dates · Daily budget · Objective · Status
4. **Deliverables & tasks due** — কী কী deliver হবে, কে দেবে, কবে
5. **Approvals status** — কতগুলো pending, deadlines
6. **Notes / dependencies** — "creative 2 days আগে লাগবে"
7. **Sign-off block** — client name, date, "Approved by" (printable)

```
| Date   | Platform | Type     | Title                    | Time  | Owner  | Status    |
|--------|----------|----------|--------------------------|-------|--------|-----------|
| Nov 12 | IG       | Reel     | Eid teaser — 15s cut     | 10:00 | Lamia  | Approved  |
| Nov 12 | FB       | Static   | Eid teaser — carousel    | 12:00 | Lamia  | Client ⏳ |
| Nov 13 | LinkedIn | Article  | Industry insight #12     | 09:00 | Rifat  | Draft     |
| Nov 14 | IG       | Story    | Poll — new flavour       | 18:00 | Lamia  | Approved  |
```

#### B. Monthly Plan (plan document)

- Cover page (branded), executive summary (৩ লাইন), full month grid, platform mix, pillar mix, campaign map, ad calendar, deliverables, budget note, approval checklist।

#### C. Monthly Performance / Plan-vs-Actual (month শেষে)

| Metric | Planned | Actual | Delta |
|---|---|---|---|
| Posts | 24 | 21 | −3 |
| Published on time | — | 17 (81%) | — |
| Missed / slipped | — | 3 | reasons |
| Meetings held | 4 | 3 | 1 rescheduled |
| Tasks due/done | 36 | 31 | 5 carried |
| Ad spend | ৳60,000 | ৳52,400 | −13% |
| Avg approval time | — | 31h | — |
| Pillar mix | 40/30/30 | 55/25/20 | off-target |

+ **Slipped items table** (title, planned date, actual, reason) — accountability + learning.
+ **Top performing posts** (P2: metrics থাকলে) — reach/engagement।
+ **Next month preview** (draft plan থাকলে)।

### 11.5 Export চ্যানেল

| ফরম্যাট | কীভাবে | কখন |
|---|---|---|
| **PDF** | jsPDF + embedded Bengali font (আগেই `reports-pdf.ts`/`invoice-pdf.ts`-এ আছে) | client delivery, print |
| **XLSX** | নতুন `exceljs` dependency API-তে; ৩ শিট (Plan / Ads / Summary) | টিম এডিট, ক্লায়েন্ট স্প্রেডশিট চাইলে |
| **CSV** | সহজ, শিট ছাড়া | bulk import, migration |
| **Share link** | token ভিত্তিক, branded read-only পেজ | WhatsApp-এ পাঠানোর জন্য সেরা |
| **Portal publish** | client inbox notification + calendar tab | retainer client |
| **Image (PNG)** | month grid-এর screenshot/`html2canvas` (আগেই dependency আছে) | Instagram/slack-এ শেয়ার |

### 11.6 Versioning & audit

- প্রতি lock/publish-এ `CalendarPlan.version++`, `payload` immutable।
- Diff view: v1 vs v2 (কী সরেছে/যোগ হয়েছে)।
- কে, কখন, কী বদলেছে → `CalendarAuditLog` (source, id, action, before, after, actor, reason)।
- RBAC: report generate/lock/publish আলাদা permission (PM পাবে, designer পাবে না)।

### 11.7 এজেন্সি-ওয়াইড rollup report

- "All clients — November" — প্রতিটা ক্লায়েন্টের row, planned/published/pending/ad spend।
- Owner-এর জন্য: কোন ক্লায়েন্টে delivery risk (pending approval > 48h, missed > 20%)।
- Export একই।

---

## 12. দৈনিক অপারেশন — "আজ কী হইলো"

### 12.1 Morning briefing (auto)

প্রতিদিন ০৮:৩০ (আগের Telegram agenda trigger আছে — সেটাই এক্সটেন্ড):

```
☀️ আজ — বুধ, ১১ নভে
মিটিং ৩: ১১:০০ Acme call · ১৪:৩০ Glow shoot · ১৭:০০ internal
পোস্ট ৪: IG 10:00 Eid teaser (approved) · FB 12:00 · …
টাস্ক due ৭ (২ done) · overdue ৩
Ad: Acme Eid flight live (day ৩/১০, ৳৪,২০০/৬,০০০)
⚠️ Approval pending: ২টা পোস্ট ৪৮ ঘণ্টার বেশি
```

### 12.2 Evening close-out (PM, ১ মিনিট)

- "Day summary" panel → এক ক্লিকে **"Mark day reviewed"**।
- Auto-detected gaps দেখায়: "2 posts scheduled today but not published", "1 meeting без outcome"।
- PM নোট লিখে রাখে → `DailyLog` (client-wise) → পরে মাসিক রিপোর্টে খুঁজে পাওয়া যায়।
- **"কী হইলো না" কেন** — কারণ ট্যাগ: `client_delay | asset_missing | approval_pending | capacity | external` → পরে analytics।

### 12.3 Weekly review

- সপ্তাহের শেষে: planned 18 → published 15 (83%), missed 3, carry-over 5।
- "Next week" plan draft suggestion: গত ৪ সপ্তাহের প্যাটার্ন থেকে slot auto-fill (P2)।

### 12.4 Assignment / workload

- Week view-এ **workload bar** (per employee): billable hours (TimeLog) + task count + posts owned।
- Overload (>110% capacity) → লাল; drag করে অন্যকে দিতে পারবে।
- People মডিউলের `UtilizationService` ডেটা reuse।

---

## 13. Notification ও Automation ম্যাট্রিক্স

| ট্রিগার | সময় | কাকে | চ্যানেল |
|---|---|---|---|
| Daily agenda | ০৮:৩০ | assigned staff | bell + Telegram |
| Meeting reminder | T-24h, T-60m | attendees | bell + Telegram |
| Post publish reminder | T-2h (asset missing হলে T-24h) | assignee + SM lead | bell |
| Client approval pending | ৪৮h | account owner + PM | bell + Telegram |
| Internal review pending | ২৪h | reviewer | bell |
| Task overdue | ০৯:০০ daily | assignee + PM | bell + digest |
| Post missed | scheduled + ৩০m | assignee + PM | bell + Telegram |
| Ad flight starts tomorrow | T-1d | owner | bell |
| Ad flight ends, underspend > 20% | end + ১d | owner + PM | bell |
| Week plan not locked | রবি ১৮:০০ | PMs | bell |
| Month plan not locked | ২৫ তারিখ ১০:০০ | PMs + Owner | bell |
| Content gap (client platform, ৭ দিন ফাঁকা) | সোম ০৯:০০ | SM manager | bell |
| Conflict on save | instant | creator | toast |
| Plan published | instant | client portal user | portal inbox + email |
| Renewal < ৩০ দিন | daily | account owner | bell |
| Leave/holiday affects plan | instant | PM | bell |

**সব notification** `NotificationsService.create()` দিয়ে যাবে (bell + Telegram fanout আগেই আছে) — নতুন চ্যানেল বানাতে হবে না।

**Cron owner:** `CalendarAutomationService` (@nestjs/schedule), People-এর `people-automation.service.ts` প্যাটার্ন।

---

## 14. Collaboration

- **Comments** per item (`CalendarComment` or reuse `TaskComment` pattern): threaded, mentions।
- **Approval thread** — reject-এ structured reason + comment বাধ্যতামূলক।
- **Activity log** per item: created/updated/status/approval/moved (who, when, before→after)।
- **@mention** → notification।
- **Presence** (P3): কে এখন কোন ভিউতে আছে — skip, unnecessary.
- **Client-facing comment** vs **internal note** আলাদা (`isInternal`)।

---

## 15. ডেটা মডেল — প্রস্তাবিত diff

### 15.1 নতুন মডেল

| মডেল | কাজ |
|---|---|
| `Campaign` | ক্যাম্পেইন rollup (client, dates, budget, objective) |
| `AdFlight` | কোন তারিখে কোন ad set চলবে |
| `ClientPlatformAccount` | client × platform × handle |
| `ContentPillar` | content mix target |
| `CalendarPlan` | versioned plan snapshot + share |
| `CalendarComment` | item-level thread |
| `CalendarAuditLog` | immutable change trail |
| `DailyLog` | দিনের নোট + miss reason |
| `SavedCalendarView` | saved filters (Tasks-এর নজির) |
| `CalendarShareLink` | login-ছাড়া read-only |
| `ContentMetric` (P2) | reach/likes/saves per post (manual বা API) |

### 15.2 পরিবর্তিত মডেল

**ContentPost** — নতুন ফিল্ড:
```prisma
clientId          String?         // denormalized, project থেকে derive
campaignId        String?
scheduledAt       DateTime        // scheduledDate+Time একত্র (Asia/Dhaka → UTC)
timeZone          String  @default("Asia/Dhaka")
accountIds        String[]        @default([])
format            ContentFormat   @default(STATIC)
pillarId          String?
contentType       String?
assigneeId        String?
reviewerId        String?
approvalStatus    ApprovalStatus  @default(NONE)
approvedById      String?
approvedAt        DateTime?
rejectionReason   String?
publishStatus     PublishStatus   @default(DRAFT)
publishedAt       DateTime?
externalUrl       String?
externalPostId    String?
caption           String  @default("")   // content rename বা alias
firstComment      String?
hashtags          String[] @default([])
linkUrl           String?
altText           String?
notesInternal     String?
assetUrls         Json    @default("[]")
isRecurring       Boolean @default(false)
recurrenceRule    String?
archivedAt        DateTime?
@@index([clientId, scheduledAt])
@@index([scheduledAt, publishStatus])
```

**CalendarEvent** — নতুন ফিল্ড:
```prisma
startAt        DateTime?       // null হলে all-day (date ব্যবহার)
endAt          DateTime?
allDay         Boolean @default(false)
timeZone       String  @default("Asia/Dhaka")
location       String?
meetingUrl     String?
attendeeIds    String[] @default([])
clientContactIds String[] @default([])
notes          String?
outcome        EventOutcome @default(PENDING)  // PENDING|DONE|NO_SHOW|CANCELLED|RESCHEDULED
reminderMinutes Int[] @default([1440, 60])
visibility     EventVisibility @default(INTERNAL)
createdById    String?
taskId         String?          // meeting → follow-up task
@@index([clientId, startAt])
```

**ProjectDeliverable** — `startDate`, `dueDate`, `clientVisible`, `ownerId` যোগ (এখন তারিখই নেই)।

**Client** — `calendarColor`, `calendarAccent`, `postingTargets Json` (platform → মাসে কত)।

**DailyTarget** — rename/relocate → `PeriodTarget` + optional `clientId` + `periodType` (DAY/WEEK/MONTH)। অথবা সম্পূর্ণ Pulse মডিউলে সরানো (সিদ্ধান্ত দরকার — ২৪ নম্বর সেকশন)।

### 15.3 Enum যোগ

```prisma
enum ContentFormat { STATIC CAROUSEL REEL STORY VIDEO TEXT ARTICLE }
enum ApprovalStatus { NONE INTERNAL_REVIEW CLIENT_REVIEW APPROVED REJECTED }
enum PublishStatus { DRAFT SCHEDULED PUBLISHING PUBLISHED FAILED MISSED }
enum EventOutcome { PENDING DONE NO_SHOW CANCELLED RESCHEDULED }
enum EventVisibility { INTERNAL CLIENT }
enum PlanScope { WEEK MONTH CUSTOM }
enum PlanStatus { DRAFT IN_REVIEW LOCKED PUBLISHED ARCHIVED }
enum AdFlightStatus { PLANNED LIVE PAUSED ENDED CANCELLED }
enum CampaignStatus { PLAN ACTIVE PAUSED COMPLETED ARCHIVED }
enum CalendarSource { TASK CONTENT_POST EVENT MILESTONE DELIVERABLE AD_FLIGHT INVOICE REPORT SPRINT LEAVE HOLIDAY RENEWAL }
enum Module { … CALENDAR }   // permission matrix-এ নতুন entry
```

### 15.4 মাইগ্রেশন নোট (গুরুত্বপূর্ণ)

1. `ContentPost.scheduledDate` (String) + `scheduledTime` (String) → `scheduledAt` (DateTime)।
   - Script: `new Date("${scheduledDate}T${scheduledTime||'10:00'}:00+06:00")` → UTC।
   - পুরনো ফিল্ড ১ রিলিজ deprecated রাখা (read fallback), তারপর drop।
   - `calendar.service.ts`-এর `startsWith(month)` কোয়েরি বদলাবে — সব কল-site revisé করতে হবে।
2. `CalendarEvent.date` (String) → `startAt`; all-day হলে `startAt = local midnight`, `allDay=true`।
3. Backfill `ContentPost.clientId` = `project.clientId`; project ছাড়া পোস্ট → null (Unscheduled/orphan list-এ দেখাবে)।
4. Backfill `publishStatus` from পুরনো `status`; `approvalStatus = APPROVED` যেখানে already PUBLISHED।
5. `DailyTarget` ডেটা সরানো/rename — seed ও dashboard চেক করতে হবে (dashboard-এ target ব্যবহার আছে কিনা যাচাই)।

---

## 16. API ডিজাইন

### 16.1 ফিড (মূল endpoint)

```
GET /calendar/feed
  ?from=2026-11-01&to=2026-11-30
  &clientId=&projectId=&campaignId=
  &sources=TASK,CONTENT_POST,EVENT,AD_FLIGHT
  &platforms=INSTAGRAM,FACEBOOK
  &status=&approval=&assigneeId=&mine=true
  &q=&includeUnscheduled=false
  &limit=500&cursor=
```

**Response:**
```json
{
  "range": { "from": "2026-11-01", "to": "2026-11-30", "timeZone": "Asia/Dhaka" },
  "items": [ { "key": "content:clx1", "source": "CONTENT_POST", "...": "..." } ],
  "days": {
    "2026-11-11": {
      "counts": { "TASK": 7, "CONTENT_POST": 4, "EVENT": 3, "AD_FLIGHT": 2 },
      "done": 5, "overdue": 2, "approvalsPending": 2,
      "hasHoliday": false
    }
  },
  "totals": { "planned": 42, "done": 31, "missed": 3, "pendingApproval": 5 },
  "truncated": false
}
```

> `days` map ইচ্ছাকৃত — গ্রিডে প্রতিদিনের count/heatmap একই payload-এ, আলাদা কোয়েরি লাগে না।

### 16.2 বাকি endpoint

| Method | Path | কাজ |
|---|---|---|
| GET | `/calendar/summary?from&to&clientId` | KPI + outcome হিসাব (Day close-out) |
| GET | `/calendar/day/:date` | agenda (hour-grouped) |
| GET | `/calendar/clients/:id?from&to` | client-scoped feed + header stats |
| POST | `/calendar/quick-add` | `{source, …}` polymorphic create |
| PATCH | `/calendar/move` | `{source,id,date,startTime,duration?}` (drag-drop) |
| POST | `/calendar/bulk/move` | multi-select move |
| POST | `/calendar/bulk/status` | bulk status/assign |
| GET | `/calendar/conflicts?from&to&clientId` | conflict list |
| GET | `/calendar/gaps?from&to&clientId` | content gap analysis |
| GET | `/calendar/workload?from&to` | per-employee load |
| POST | `/calendar/posts/bulk-import` | CSV rows |
| POST | `/calendar/posts/:id/approve` | internal/client approve |
| POST | `/calendar/posts/:id/reject` | reason সহ |
| POST | `/calendar/posts/:id/publish` | manual publish + URL |
| GET/POST | `/calendar/plans` | list / create plan |
| GET | `/calendar/plans/:id` | plan + payload |
| POST | `/calendar/plans/:id/lock` \| `/unlock` \| `/publish` | lifecycle |
| GET | `/calendar/plans/:id/pdf` \| `.xlsx` \| `.csv` | export |
| GET | `/calendar/reports/plan-vs-actual?planId` | variance |
| POST | `/calendar/plans/:id/share` | token তৈরি |
| GET | `/calendar/feed.ics?token=` | subscribe feed |
| GET/POST | `/calendar/views` | saved views |
| POST | `/calendar/day-log` | দিনের নোট |
| GET/POST | `/calendar/campaigns` \| `/calendar/flights` | ads planning |
| GET/PATCH | `/calendar/settings/platform-accounts` | client accounts |
| GET/PATCH | `/calendar/settings/pillars` | pillars |

### 16.3 Existing endpoint মাইগ্রেশন

| পুরনো | নতুন | নোট |
|---|---|---|
| `GET /calendar/posts?month=` | `GET /calendar/feed?sources=CONTENT_POST&from&to` | পুরনোটা ১ রিলিজ রাখা (deprecated) |
| `GET /calendar/stats` | `GET /calendar/summary` (range+client aware) | global stat বাদ |
| `GET /calendar/events?month=` | feed | — |
| `/calendar/targets/*` | সরানো বা `/pulse/targets` | সিদ্ধান্ত দরকার |
| `@RequirePermission("FLOW")` | `@RequirePermission("CALENDAR")` | migration-এ FLOW→CALENDAR view map |

### 16.4 Performance budget

- Feed (৩১ দিন, ~৫০০ আইটেম): **p95 < 400ms**।
- Day view: **< 150ms**।
- Feed query গুলো parallel `Promise.all` (বর্তমান প্যাটার্ন), প্রতিটা indexed range query।
- `limit` ছাড়ালে `truncated: true` + "narrow your range" UI।

### 16.5 Cache কৌশল

- বর্তমান: `cache.wrap('cal:posts:{month}', 30s)` — ভালো, কিন্তু invalidation অসম্পূর্ণ।
- প্রস্তাব: `calendarVersion` counter (Redis/DB) — যেকোনো write-এ bump; key = `cal:v{n}:feed:{hash(params)}`।
- Task/Milestone/Invoice write থেকেও bump (hook বা service call)।
- TTL ২০–৩০ সেকেন্ড safety net।
- `cal:posts:all` (পুরো history) ক্যাশ **নিষিদ্ধ**।

---

## 17. Permission ও RBAC

বর্তমান: পুরো calendar `FLOW` module-এ, level verb থেকে derive। ফলে designer-কে Flow-এর সব access না দিয়ে শুধু calendar দেওয়া যায় না।

### 17.1 নতুন `CALENDAR` module (Module enum-এ যোগ)

`Role.modulePermissions` = `{ "CALENDAR": "VIEW" | "EDIT" | "APPROVE" | "NONE" }` (AccessLevel আগেই আছে)।

| Role | CALENDAR | অতিরিক্ত নিয়ম |
|---|---|---|
| Owner | APPROVE | সব |
| Admin | APPROVE | সব |
| Project Manager | APPROVE | নিজের client/project-এ lock+publish; অন্য সবার view |
| Social Media Manager | EDIT | approval request করতে পারে, approve করতে পারে না (configurable) |
| Content Writer / Designer | EDIT (scoped) | শুধু assigned আইটেম এডিট |
| Account Manager | VIEW + approve (client-side proxy) | client approval proxy |
| HR/Finance | VIEW (optional) | শুধু leave/invoice layer |
| Portal user (client) | আলাদা গার্ড | শুধু নিজের client, approved/plan items |

### 17.2 Row-level scoping (গুরুত্বপূর্ণ)

- `assignedToId`/`assigneeId` = current employee → "my work" সবসময় allowed (`@SkipPermission` নয়, কিন্তু scoped)।
- Client portal: `clientId` force (server-side), client-এর বাইরে কিছুই ফেরত নয়।
- Share link: token + scope + expiry; staff permission bypass নয়, আলাদা গার্ড।

### 17.3 Sensitive action guard

| Action | যাচাই |
|---|---|
| Plan lock/unlock | `CALENDAR:APPROVE` + reason (unlock) |
| Plan publish (client) | `CALENDAR:APPROVE` + client permission |
| Post client-approve (proxy) | `CALENDAR:APPROVE` + audit |
| Bulk delete | `CALENDAR:APPROVE` + confirm + undo |
| Ad budget > client monthly budget | warning + owner confirm |

---

## 18. UI/UX ও ডিজাইন সিস্টেম

- **Shared components reuse:** `CardShell`, `PageHeader`, `Segmented`, `TableShell`, `Btn`, `Modal`, `Field`, `EmptyState`, `SkeletonBlock`, `StatCard` (সব `@/components`-এ আছে)।
- নতুন প্রিমিটিভ দরকার: `SubNav` (People প্যাটার্ন), `Drawer` (right sheet), `DatePicker` (range), `Chip`, `Avatar stack`, `ProgressRing`, `TimelineRow`।
- **রঙ:** semantic token ব্যবহার (primary/emerald/amber/rose/sky) — hardcoded নয়; dark mode বাধ্যতামূলক টেস্ট।
- **Typography:** বিদ্যমান `font-heading` / ট্যাবুলার নম্বর date-এ (`tabular-nums`)।
- **Density:** compact (৮px) vs comfortable (১২px) — ক্যালেন্ডারে জরুরি।
- **Keyboard:** `←/→` navigate, `T` today, `M/W/D` view switch, `N` new, `/` search, `Esc` close, `Del` delete (confirm)।
- **A11y:** সব drag action-এর keyboard/button বিকল্প (move dialog), `aria-label` on chips, focus ring, contrast ≥ 4.5:1, live region for toast।
- **Loading:** skeleton grid (current pattern); optimistic updates on drag/status।
- **Error:** per-view retry (বর্তমান `ErrorBlock` প্যাটার্ন) — পুরো পেজ blank নয়।
- **Empty:** প্রতিটা ভিউতে আলাদা CTA (আজ খালি → "Add event"; প্ল্যান খালি → "Generate from calendar"; filter খালি → "Clear filters")।

---

## 19. ডেটা কারেক্টনেস

### 19.1 তারিখ ও সময়

- সব "দিন" হিসাব **Asia/Dhaka (UTC+6)**-এ; কোডবেসে `dateStrDhaka()` helper আগেই আছে (`people/people-utils.ts`) — reuse।
- DB-তে `DateTime` (UTC instant), UI-তে local।
- All-day আইটেমের জন্য `date` (local দিন) আলাদা রাখা ভালো — নাহলে DST-less Dhaka-তেও UTC shift-এ দিন সরে যেতে পারে। সুপারিশ: `scheduledAt` + `allDay` + `localDate` (computed)।
- Month range: `from = month start 00:00 Dhaka`, `to = month end 23:59:59 Dhaka` → UTC।
- Grid-এ adjacent month দিন আসবে, কিন্তু ফিল্টার range-এর বাইরের আইটেম `muted`।

### 19.2 Index

```prisma
@@index([clientId, scheduledAt])
@@index([projectId, scheduledAt])
@@index([campaignId])
@@index([scheduledAt, publishStatus])
@@index([approvalStatus])
// CalendarEvent
@@index([clientId, startAt])
@@index([startAt])
// AdFlight
@@index([clientId, startDate, endDate])
```

### 19.3 Consistency

- ContentPost-এ `clientId` আর `project.clientId` diverge হলে → server derive করে overwrite (project বদলালে clientId update)।
- `publishStatus = PUBLISHED` হলে `publishedAt` বাধ্যতামূলক।
- `approvalStatus = APPROVED` ছাড়া `publishStatus = SCHEDULED` → configurable block।
- Soft delete: `archivedAt`; feed-এ default বাদ।
- Delete guard: project/client delete করলে calendar items orphan হয় (`docs/control-qa-report.md:48`-এ ঠিক এই FK issue রেকর্ড করা আছে) → cascade/soft-delete নীতি স্পষ্ট করতে হবে।

---

## 20. Edge cases ও বিজনেস রুল

| কেস | আচরণ |
|---|---|
| Project ছাড়া পোস্ট | `clientId` সরাসরি সেট করতে হবে; না হলে "Unassigned" bucket-এ (report-এ বাদ, warning) |
| Client ডিলিটেড | পোস্ট soft archive, report-এ "archived client" |
| পোস্ট scheduled time past, status DRAFT | `MISSED` badge + "reschedule / mark published" prompt |
| মিটিং outcome না দেওয়া, ২৪ ঘণ্টা past | `outcome = PENDING` → close-out-এ জিজ্ঞেস |
| দুটো event একই সময় | side-by-side, warning নয় (double-booking স্বাভাবিক) |
| একই পোস্ট দুবার publish | `externalUrl` unique-ish check + warning |
| Locked plan-এ নতুন পোস্ট | calendar-এ যোগ হবে, plan-এ নয় (v2 দরকার) → banner "plan outdated" |
| Plan period-এ client বদল | অনুমোদিত নয় (plan client-scoped) |
| Timezone-এ client ভিন্ন দেশে | `ClientPlatformAccount.timezone` respect, UI-তে "10:00 (GMT+4)" |
| রমজান/ঈদ-এর মতো season | `HOLIDAY`/`SEASON` layer + content theme tag (P2) |
| ১০০০+ আইটেম | truncate + range narrowing; never unbounded |
| Duplicate client name | id-based, name শুধু display |

---

## 21. ফেজড রোডম্যাপ

> Estimate = একজন dev-এর focused working day (একই কোডবেসে পরিচিত)।

### Phase 0 — Foundation (৫–৭ দিন)

| # | কাজ | Est |
|---|---|---|
| 1 | `CALENDAR` module permission + migration (FLOW→view map) | 0.5 |
| 2 | `CalendarFeedService` — TASK + CONTENT_POST + EVENT merge, range/client/filter | 1.5 |
| 3 | `GET /calendar/feed` + `summary` + `day` | 1 |
| 4 | ContentPost `clientId` backfill + index; `scheduledAt` migration prep | 1 |
| 5 | Calendar hub shell: sub-nav + URL state + overview/day view | 1.5 |
| 6 | Month view rewrite (adjacent days, +N → drawer, client color, 4 chips) | 1.5 |

**Phase 0 শেষে:** "আজ কী কী কাজ" প্রশ্নের উত্তর আসবে; client filter কাজ করবে (post-এ clientId থাকলে)।

### Phase 1 — Usable Calendar (৮–১০ দিন)

| # | কাজ | Est |
|---|---|---|
| 7 | Week view (time grid, all-day row, now line) | 2 |
| 8 | Day close-out panel + outcome + DailyLog | 1.5 |
| 9 | Detail drawer (unified, inline edit) + quick add | 1.5 |
| 10 | Drag & drop reschedule + undo + conflict warning | 2 |
| 11 | Filters + saved views + unscheduled backlog rail | 1.5 |
| 12 | `Event` time/end/attendees/outcome + meeting reminders | 1 |
| 13 | Client calendar route + Accounts deep link | 1 |

**Phase 1 শেষে:** PM/SM দিনক্ষণ ধরে আসল কাজ করতে পারবে — এটাই "professional" থ্রেশহোল্ড।

### Phase 2 — Plan & Report (১০–১২ দিন) ← **user-এর মূল চাহিদা**

| # | কাজ | Est |
|---|---|---|
| 14 | `Campaign` + `AdFlight` model + ads planning UI | 2 |
| 15 | `ClientPlatformAccount` + settings + per-platform slots | 1.5 |
| 16 | Approval chain (internal/client) + queue + SLA timer | 2 |
| 17 | `CalendarPlan` model + builder UI + lock/publish/unlock | 2 |
| 18 | Weekly plan report (PDF) — jsPDF, branding, Bengali font | 1.5 |
| 19 | Monthly plan + plan-vs-actual report (PDF/XLSX/CSV) | 2 |
| 20 | Share link + portal calendar (read-only + approve) | 1.5 |

**Phase 2 শেষে:** "প্ল্যান বানাও → ক্লায়েন্টকে পাঠাও → মাস শেষে রিপোর্ট" পুরো লুপ বন্ধ।

### Phase 3 — Delight & Scale (৮–১০ দিন)

| # | কাজ | Est |
|---|---|---|
| 21 | Recurring posts/events + "duplicate week" | 1.5 |
| 22 | CSV bulk import + template download | 1 |
| 23 | Grid view (IG/LI feed preview) | 1.5 |
| 24 | Timeline/gantt view + workload overlay | 2 |
| 25 | Google Calendar two-way / `.ics` feed | 2 |
| 26 | Automation pack (gaps, chase, missed, plan-not-locked) | 1.5 |
| 27 | Content pillars + mix analysis + ContentMetric | 2 |

### Phase 4 — Publishing (আলাদা ট্র্যাক, ৫–৮ দিন)

Meta Graph publish (FB+IG) → LinkedIn → retry/error UI। **শুধু Phase 2-3 স্থিতিশীল হওয়ার পর।**

### Dependency graph

```
P0 feed ──► P1 views/dnd ──► P2 plan/report ──► P3 integrations
                    │                │
                    └──► approval ◄──┘
```

---

## 22. Acceptance Criteria / QA চেকলিস্ট

### Feed & ডেটা
- [ ] ৩১ দিনের range-এ Task + Post + Event + Ad সব আসে; count মেলে
- [ ] client filter দিলে শুধু ওই client; project filter nested
- [ ] project ছাড়া পোস্ট "Unassigned"-এ আসে, crash করে না
- [ ] month boundary (Oct 31 / Nov 1), year boundary (Dec 31 → Jan 1) ঠিক
- [ ] Asia/Dhaka-তে ২৩:৫৯-এর আইটেম সঠিক দিনে
- [ ] ৫০০+ আইটেমে `truncated` + UI warning
- [ ] Task status বদলালে calendar cache invalidate হয়

### ভিউ
- [ ] Month-এ leading+trailing দিন ক্লিকযোগ্য, ghost "1" নেই
- [ ] `+N more` → Day drawer খোলে
- [ ] Week-এ ৩০-মিনিট snap, overlap side-by-side
- [ ] Now line সঠিক সময়ে
- [ ] Client color consistent সব ভিউতে
- [ ] Empty/loading/error state প্রতিটা ভিউতে

### Drag & drop
- [ ] দিন বদলালে API-তে date update
- [ ] Undo ৮ সেকেন্ড কাজ করে
- [ ] Read-only item drag হয় না (tooltip দেখায়)
- [ ] Locked plan-এ drag blocked + unlock prompt
- [ ] Conflict warning দেখায় কিন্তু override করা যায়

### Approval
- [ ] DRAFT → internal approve → client approve → SCHEDULED
- [ ] Reject-এ reason ছাড়া save হয় না
- [ ] Approve ছাড়া schedule করলে block (config অনুযায়ী)
- [ ] Approval trail immutable, কে কখন দেখায়
- [ ] Client portal-এ শুধু approved/client-visible আইটেম

### Plan & Report
- [ ] Plan generate → coverage report সঠিক (gap count মেলে)
- [ ] Lock → payload snapshot; পরে calendar বদলালে plan অপরিবর্তিত
- [ ] Unlock-এ reason বাধ্যতামূলক, audit log
- [ ] PDF-এ বাংলা ফন্ট ঠিক (embedded), ব্র্যান্ড লোগো/রঙ ঠিক
- [ ] XLSX ৩ শিট, সংখ্যা মেলে
- [ ] Plan-vs-actual delta গণনা সঠিক (missed/slipped reason সহ)
- [ ] Share link expiry কাজ করে, invalid token 404
- [ ] Portal-এ plan PDF ডাউনলোড হয়

### Permission
- [ ] Designer CALENDAR VIEW হলে post এডিট করতে পারে না
- [ ] PM নিজের client-এর plan lock করতে পারে, অন্য client-এর পারে না
- [ ] Portal client অন্য client-এর ডেটা কোন response-এ পায় না
- [ ] Share link staff endpoint-এ access দেয় না

### Performance
- [ ] Feed p95 < 400ms (৩১ দিন, ~৫০০ items)
- [ ] Day view < 150ms
- [ ] Month view প্রথম রেন্ডার < 1s (cache hit)

---

## 23. সাকসেস মেট্রিক

| মেট্রিক | এখন | লক্ষ্য (৩ মাস) |
|---|---|---|
| প্ল্যান ক্যালেন্ডার থেকে তৈরি | ০% (হাতে) | ≥ ৯০% client |
| Content on-time publish rate | অজানা | ≥ ৮৫% |
| গড় client approval turn-around | অজানা | < ৩৬ ঘণ্টা |
| Missed post / মাস | অজানা | < ৫% |
| রিপোর্ট বানাতে সময় | ২–৪ ঘণ্টা/client | < ১০ মিনিট |
| ক্যালেন্ডারে duplicate entry | হ্যাঁ (3 জায়গা) | ১ সোর্স |
| PM সপ্তাহে ক্যালেন্ডার ব্যবহার | ? | দৈনিক ≥ ১ বার |

---

## 24. সিদ্ধান্ত দরকার (Open questions)

1. **`DailyTarget` কোথায় থাকবে?** ক্যালেন্ডারে রাখা হবে, নাকি Pulse/Insight-এ সরানো হবে? (এটা ক্যালেন্ডার ফিচার নয় — আমার সুপারিশ: সরানো)
2. **Publishing:** শুধু manual "mark published" দিয়ে শুরু করব, নাকি Phase 2-তেই Meta API? (আমার সুপারিশ: manual + URL, API Phase 4)
3. **Approval কে approve করবে?** SM Lead, নাকি PM, নাকি দুজনেই (two-step)? ক্লায়েন্ট approval কি সব পোস্টে বাধ্যতামূলক, নাকি per-client toggle?
4. **Plan lock কি সত্যিই hard lock?** নাকি soft (warning + audit)? ছোট এজেন্সিতে hard lock friction তৈরি করতে পারে।
5. **Client portal-এ draft দেখাবে কি?** (সুপারিশ: না — শুধু approved; কিন্তু কিছু ক্লায়েন্ট "আগে দেখতে চায়" — `requiresClientApproval` দিয়ে নিয়ন্ত্রণ)
6. **Ad planning:** শুধু planning (AdFlight) নাকি actual `AdCampaign`-এর সাথে auto-link? (সুপারিশ: Phase 2 planning, Phase 3 link)
7. **Multi-platform post:** এক পোস্ট → এক row (platforms array) নাকি platform-per-row (আলাদা ক্যাপশন/স্ট্যাটাস)? (সুপারিশ: master + child variant — প্ল্যাটফর্ম-ভিত্তিক ক্যাপশন দরকার হলে)
8. **Content pillars** কি client-ভিত্তিক কনফিগারযোগ্য হবে, নাকি গ্লোবাল? (সুপারিশ: client-ভিত্তিক)
9. **Timezone:** সব client বাংলাদেশে? ভিন্ন টাইমজোন সাপোর্ট এখনই লাগবে?
10. **Google Calendar:** দুই-মুখী sync (edit conflict) নাকি one-way push? (সুপারিশ: one-way push + `.ics` subscribe, দুই-মুখী P3)
11. **"Deliverable" date:** Flow-এর deliverable-এ dueDate যোগ করলে অন্য কোথাও ভাঙবে কি? (Flow QA চেক দরকার)
12. **PDF ভাষা:** রিপোর্ট বাংলা, ইংরেজি, নাকি দুটোই (bilingual)? ক্লায়েন্ট ফেসিং রিপোর্ট সাধারণত ইংরেজি।

---

## 25. রেফারেন্স ও অনুপ্রেরণা

| সোর্স | কী নেওয়া হয়েছে |
|---|---|
| Planable (agency content calendar) | multi-level approval, in-context comments, guest/share link, calendar+grid+list view, label filter |
| Sprout Social / Hootsuite | unified calendar, bulk schedule, approval workflow, best-time-to-post, multi-brand governance |
| CoSchedule Marketing Calendar | multi-channel single calendar, drag-drop reschedule, campaign vs content separation, ReQueue |
| Later / Metricool | visual feed preview, media library, per-platform scheduling |
| Social Calendar (agency tool) | 5-stage workflow: Brief → Creative → Client review → Publish → Report |
| Senly (agency guide 2026) | client approval bottleneck, white-label portal, brand asset isolation |
| Buffer / SocialPilot | simple queue UX, bulk CSV, per-channel pricing model (irrelevant here) |
| Hootsuite feature checklist | ৮টা core feature axis: visual planning, scheduling, optimal timing, approvals, multi-brand, governance, asset mgmt, analytics |
| Google Calendar | week grid, drag-resize, now line, all-day row, recurring exceptions |
| Linear / Height (project tools) | keyboard-first, command palette, optimistic drag, undo toast |
| বর্তমান কোডবেস | People payroll past-month lock, `SavedTaskView`, `shareToken` (invoice), `NotificationsService`, `reports-pdf.ts` (Bengali font PDF), `UtilizationService` |

---

## 26. এক প্যারাে সারমর্ম

এজেন্সির আসল প্রশ্ন তিনটা: **"আজ কী হচ্ছে?"**, **"এই মাসে এই ক্লায়েন্টের জন্য কী কী যাচ্ছে, আর কে অনুমোদন দেবে?"**, **"যা প্ল্যান করেছিলাম, তা হলো কি?"** — আজকের ক্যালেন্ডার এই তিনটার একটারও পূর্ণ উত্তর দেয় না। এই স্পেক সেই তিনটাকে এক জায়গায় আনে: একটা merged timeline (feed), একটা client-scoped view, একটা approval chain, আর একটা plan→report ইঞ্জিন। মডেল বদলাতে হবে সামান্য (`scheduledAt`, `clientId`, `AdFlight`, `CalendarPlan`), বাকিটা বেশিরভাগ **read-model + UI** — অর্থাৎ ঝুঁকি কম, কিন্তু এজেন্সির দৈনন্দিন কাজের অনুভূতি সম্পূর্ণ বদলে যাবে।

---

*পরবর্তী ধাপ: ২৪ নম্বর সেকশনের ১২টা প্রশ্নের উত্তর দিলে Phase 0-এর টিকিট স্লাইস করা যাবে (`docs/superpowers/plans/` প্যাটার্নে), তারপর schema migration + feed service।*
