# Plan — Project Shoot Sheet + Deliverable Intelligence + Campaign Reporting

**Date:** 2026-11-14
**Module:** Flow (projects) — new **Shoot** tab, upgraded **Deliverables**, upgraded **Reports**
**Status:** Plan for approval (no code written yet)

---

## 1. যা চাওয়া হয়েছে (as understood)

### 1.1 Shoot — প্রতিটা প্রজেক্টের ভেতরে একটা আলাদা জিনিস

প্রতিটা প্রজেক্টের ভেতরে **Shoot** নামে একটা sub-tab থাকবে। এটা Deliverable-এর সাথে **সম্পূর্ণ আলাদা** — কোনো লিংক নেই।

Shoot-এ যা যা থাকবে:

| ফিল্ড | ব্যাখ্যা |
|---|---|
| **Shoot date** | ফিক্স করা যাবে (ক্যালেন্ডার থেকে বেছে নেওয়া) |
| **Duration** | Half day / Full day |
| **কাল কে কে যাচ্ছে (Crew)** | ইমপ্লয়ি বা ভেন্ডর — role সহ সিলেক্ট |
| **DoP** | কে DoP হিসেবে যাচ্ছে — ইমপ্লয়ি / ভেন্ডর / বাইরের মানুষ |
| **Cameraman** | কে ক্যামেরাম্যান — একইভাবে সিলেক্ট |
| **Vendor** | কোন ভেন্ডর আসছে |
| **Location / call time / notes** | প্রফেশনাল শুট শিটের বাকি অংশ |
| **Equipment list** | ফ্রি-টেক্সট লিস্ট (মাস্টার ক্যাটালগ নেই) |

সব মিলিয়ে এটা একটা **প্রফেশনাল শুট কল-শিট** — যেটা প্রিন্ট করে ক্রু-কে দেওয়া যায়, আর ক্যালেন্ডারে SHOOT ইভেন্ট হিসেবে বসে যায়।

### 1.2 Deliverable — এখন শুধু নাম নয়, পুরো স্পেসিফিকেশন

এখন Deliverables tab-এ শুধু `title + description` যোগ করা যায়। এতে রিপোর্ট বানানো যায় না কারণ কোনটা গ্রাফিক্স আর কোনটা ভিডিও বোঝার উপায় নেই।

নতুন যা যোগ হবে (প্রতি ডেলিভারেবল = **১টা আইটেম**, এক row):

- **Type** — Graphic / Video / Photo / Copy / Other
- **Topic** — আইটেমটা কী (যেমন "Eid greeting post — peacock motif")
- **Objective** — উদ্দেশ্য কী (Awareness / Engagement / Launch / Conversion / Retention)
- **Campaign** — কোন ক্যাম্পেইনের জন্য (অপশনাল)
- **Due date / Start date** — ইতিমধ্যে DB-তে আছে, UI-তে দেখানো হবে
- **Owner** — কে করবে (ইমপ্লয়ি)
- **Client visible** — পোর্টালে দেখাবে কি না

ফলে "৮টা গ্রাফিক্স + ৪টা ভিডিও" মানে **১২টা row**, প্রতিটার নিজের type/topic/objective — আর রিপোর্টে ভাঙা যাবে: "Graphics 6/8 delivered, Video 2/4 delivered"।

### 1.3 Campaign

ক্যাম্পেইন মডেল আগে থেকেই আছে (`Campaign`: নাম, objective, status, start/end, budget, platforms)। নতুন যা লাগবে:

- Deliverable একটা ক্যাম্পেইনের সাথে যুক্ত হতে পারবে।
- রিপোর্ট **ক্যাম্পেইন ধরে** তৈরি করা যাবে (একটা নির্দিষ্ট ক্যাম্পেইন, বা সব ক্যাম্পেইন আলাদা সেকশনে)।

### 1.4 One-click Task assign

Deliverables ট্যাবে একাধিক ডেলিভারেবল সিলেক্ট করে **"Assign as tasks"** চাপলে শুধু **কাকে দিচ্ছি** সেটা বেছে নিতে হবে — বাকিটা অটো:

- প্রতি ডেলিভারেবলে **১টা task** (fixed decision)
- Task-এ যাবে: topic/title, objective + description, due date, project, priority, `deliverableId` লিংক, client-visible flag
- ইতিমধ্যে যেসব ডেলিভারেবলে task লিংক করা আছে সেগুলো **skip** হবে (ডুপ্লিকেট হবে না)

### 1.5 Report

- In-app (Flow → Reports) **+ PDF ডাউনলোড/প্রিন্ট**
- নতুন সেকশন: ক্যাম্পেইন-ভিত্তিক ভাঙা, type-ভিত্তিক ভাঙা (X graphics / Y videos), প্রতিটার topic+objective, পিরিয়ডের শুট সামারি (তারিখ, half/full day, location, crew, equipment), assignee-ভিত্তিক কাজের বণ্টন

---

## 2. লক করা সিদ্ধান্ত (Decision log)

| # | প্রশ্ন | সিদ্ধান্ত |
|---|---|---|
| 1 | Deliverable-এর গঠন | **প্রতি আইটেম এক row** — quantity ফিল্ড নেই |
| 2 | Shoot ↔ Deliverable | **কোনো সম্পর্ক নেই** — total separate |
| 3 | Equipment | **শুধু free-text list** — no master catalog |
| 4 | Task creation | **প্রতি ডেলিভারেবলে ১টা task** |
| 5 | Report | **In-app + PDF/print** |
| 6 | Shoot-এর জায়গা | **প্রজেক্টের ভেতরে tab + Calendar sync** |

---

## 3. ডেটা মডেল

### 3.1 নতুন: `Shoot`

```prisma
enum ShootDuration {
  HALF_DAY
  FULL_DAY
}

enum ShootStatus {
  PLANNED      // plan করা হয়েছে, কনফার্ম না
  CONFIRMED    // ক্রু + লোকেশন কনফার্ম
  IN_PROGRESS  // শুট চলছে
  WRAPPED      // শুট শেষ, ফুটেজ আছে
  CANCELLED
}

model Shoot {
  id               String        @id @default(cuid())
  projectId        String
  campaignId       String?       // অপশনাল — কোন ক্যাম্পেইনের শুট
  title            String        // "TVC Day 1 — Banani Studio"

  // কবে
  shootDate        DateTime      @db.Date
  endDate          DateTime?     @db.Date   // মাল্টি-ডে হলে
  durationType     ShootDuration @default(FULL_DAY)
  callTime         String?       // "09:30"
  wrapTime         String?       // "18:00"
  isDateLocked     Boolean       @default(false) // তারিখ ফিক্স → ক্যালেন্ডার থেকে সরানো যাবে না

  // কোথায়
  location         String?
  locationUrl      String?       // Google Maps লিংক
  locationNote     String?       // "Studio 4, ৩য় তলা"

  // কী শুট হচ্ছে
  description      String?       // concept / কী কী ফুটেজ
  notes            String?       // প্রোডাকশন নোট

  // কী কী যাচ্ছে (free-text)
  equipment        String[]      @default([])  // ["Sony FX3 ×2", "24-70mm", "Aputure 300D"]

  status           ShootStatus   @default(PLANNED)
  calendarEventId  String?       @unique       // Calendar sync anchor

  createdById      String?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  project          Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  campaign         Campaign?     @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  crew             ShootCrew[]
  createdBy        User?         @relation("ShootCreatedBy", fields: [createdById], references: [id])

  @@index([projectId, shootDate])
  @@index([campaignId])
  @@index([shootDate])
  @@index([status])
}
```

### 3.2 নতুন: `ShootCrew` (কে কে যাচ্ছে + DoP + ক্যামেরাম্যান + ভেন্ডর)

```prisma
enum ShootCrewRole {
  DOP              // Director of Photography
  CAMERAMAN
  ASSISTANT_CAMERA // AC / focus puller
  GAFFER           // লাইট
  GRIP
  SOUND
  ART_DIRECTOR
  STYLIST
  MAKEUP
  PRODUCER
  LINE_PRODUCER
  PHOTOGRAPHER
  DRONE_OPERATOR
  DRIVER
  TALENT           // মডেল / অভিনয়শিল্পী
  TEAM_MEMBER      // আমাদের নিজেদের টিম
  OTHER
}

enum ShootCrewSource {
  EMPLOYEE   // People মডিউল থেকে
  VENDOR     // Capital → Vendor থেকে
  EXTERNAL   // বাইরের মানুষ, শুধু নাম+ফোন
}

model ShootCrew {
  id           String           @id @default(cuid())
  shootId      String
  role         ShootCrewRole
  source       ShootCrewSource  @default(EMPLOYEE)

  employeeId   String?
  vendorId     String?
  name         String           // snapshot — employee/vendor মুছে গেলেও ইতিহাস থাকে
  phone        String?
  callTime     String?          // এই মানুষটার আলাদা কল টাইম
  isConfirmed  Boolean          @default(false)
  fee          Decimal?         @db.Decimal(12, 2) // ডে-রেট (ইতিহাসের জন্য, খরচ নয়)
  notes        String?

  shoot        Shoot            @relation(fields: [shootId], references: [id], onDelete: Cascade)
  employee     Employee?        @relation(fields: [employeeId], references: [id], onDelete: SetNull)
  vendor       Vendor?          @relation(fields: [vendorId], references: [id], onDelete: SetNull)

  @@index([shootId])
  @@index([employeeId])
  @@index([vendorId])
}
```

> **কেন `name` snapshot:** ইমপ্লয়ি চলে গেলে বা ভেন্ডর ডিলিট হলে পুরনো শুট শিটের নাম হারিয়ে যাবে না। রিপোর্টে সবসময় `crew.name` দেখাবে।

### 3.3 `ProjectDeliverable` — নতুন ফিল্ড

```prisma
enum DeliverableKind {
  GRAPHIC
  VIDEO
  PHOTO
  COPY
  OTHER
}

model ProjectDeliverable {
  // ... বিদ্যমান সব ফিল্ড অপরিবর্তিত ...
  kind        DeliverableKind?
  topic       String?          // "Eid greeting post — peacock motif"
  objective   String?          // "Awareness" / "Launch" / ...
  campaignId  String?
  campaign    Campaign?        @relation(fields: [campaignId], references: [id], onDelete: SetNull)

  @@index([campaignId])
  @@index([kind])
}
```

> `startDate`, `dueDate`, `clientVisible`, `ownerId` আগেই আছে — শুধু UI-তে expose হবে, DB change নেই।

### 3.4 `Campaign` — reverse relations

```prisma
model Campaign {
  // ... বিদ্যমান ...
  deliverables ProjectDeliverable[]
  shoots       Shoot[]
}
```

### 3.5 `ProjectReport` — রিপোর্ট স্ন্যাপশট

```prisma
enum ReportGrouping {
  CAMPAIGN
  KIND
  OWNER
  NONE
}

model ProjectReport {
  // ... বিদ্যমান completed / pending / billing / pmNotes ...
  groupBy      ReportGrouping @default(CAMPAIGN)
  campaignId   String?        // একটা ক্যাম্পেইনের রিপোর্ট হলে
  summary      Json?          // numeric snapshot (নিচে দেখুন)
  shoots       Json?          // পিরিয়ডের শুট স্ন্যাপশট
  campaignLabel String?       // export-এ ক্যাম্পেইনের নাম ধরে রাখতে
}
```

`summary` shape:

```json
{
  "delivered": 9,
  "pending": 3,
  "byKind": {
    "GRAPHIC": { "delivered": 6, "pending": 2, "total": 8 },
    "VIDEO":   { "delivered": 2, "pending": 1, "total": 3 }
  },
  "byCampaign": [ { "campaignId": "...", "name": "Eid 2026", "delivered": 6, "pending": 2 } ],
  "byOwner":    [ { "employeeId": "...", "name": "Rafi", "delivered": 4, "pending": 1 } ],
  "shoots": { "count": 2, "fullDays": 1, "halfDays": 1, "crewCount": 9 },
  "tasksFromDeliverables": { "total": 12, "done": 9 }
}
```

`shoots` (snapshot) shape:

```json
[
  {
    "id": "sh_...",
    "title": "TVC Day 1",
    "date": "2026-11-18",
    "duration": "FULL_DAY",
    "location": "Studio 4, Banani",
    "status": "WRAPPED",
    "crew": [ { "role": "DOP", "name": "Imran", "source": "VENDOR", "confirmed": true } ],
    "equipment": ["Sony FX3 ×2", "Aputure 300D"]
  }
]
```

> রিপোর্ট **immutable snapshot** — পরে শুট এডিট করলে পুরনো রিপোর্ট বদলাবে না। এটাই ক্লায়েন্ট-ফেসিং ডকুমেন্টের জন্য সঠিক।

---

## 4. API (NestJS — সব `flow` controller-এর ভেতরে)

### 4.1 Shoot

| Method | Route | কাজ |
|---|---|---|
| `GET` | `/flow/projects/:id/shoots` | প্রজেক্টের সব শুট (crew সহ), তারিখ অনুযায়ী |
| `POST` | `/flow/projects/:id/shoots` | নতুন শুট (+ অটো Calendar event) |
| `PATCH` | `/flow/shoots/:id` | শুট এডিট (+ Calendar event sync) |
| `DELETE` | `/flow/shoots/:id` | শুট ডিলিট (+ Calendar event ডিলিট) |
| `POST` | `/flow/shoots/:id/crew` | ক্রু যোগ (role + source + employee/vendor/external) |
| `PATCH` | `/flow/shoots/:id/crew/:crewId` | ক্রু এডিট / confirm toggle |
| `DELETE` | `/flow/shoots/:id/crew/:crewId` | ক্রু বাদ |
| `GET` | `/flow/shoots/:id/print` | (optional, phase 3) প্রিন্টেবল call-sheet ডেটা |

**Validation:**
- `campaignId` দিলে ক্যাম্পেইনটা একই client-এর কিনা চেক (`campaign.clientId === project.clientId`), নাহলে 400।
- `endDate < shootDate` → 400।
- `durationType` না দিলে `FULL_DAY`।
- `shootDate` **required** — শুটের তারিখ ছাড়া শুট নেই।
- একই দিনে ৩টার বেশি শুট হলে warn (block নয়) — UI-তে badge।

### 4.2 Deliverable (বিদ্যমান ৩টা endpoint-এ ফিল্ড যোগ)

| Method | Route | পরিবর্তন |
|---|---|---|
| `POST` | `/flow/projects/:id/deliverables` | `kind, topic, objective, campaignId, dueDate, startDate, ownerId, clientVisible` গ্রহণ করবে |
| `PATCH` | `/flow/deliverables/:id` | একই ফিল্ড |
| `POST` | `/flow/projects/:id/deliverables/bulk` | **নতুন** — একসাথে অনেক row (paste mode) |
| `POST` | `/flow/projects/:id/deliverables/assign-tasks` | **নতুন** — one-click task assign (নিচে) |

**Bulk add body:**
```json
{ "items": [ { "title": "Eid post 1", "kind": "GRAPHIC", "topic": "...", "objective": "Awareness", "campaignId": "..." } ] }
```

**Assign-tasks body:**
```json
{
  "deliverableIds": ["dv_1", "dv_2"],
  "assigneeId": "emp_1",
  "coAssigneeIds": ["emp_2"],
  "priority": "MEDIUM",
  "dueDateOverride": "2026-11-25",
  "clientVisible": false
}
```

**Assign-tasks response:**
```json
{ "created": 2, "skipped": 1, "skippedReasons": [{ "deliverableId": "dv_3", "reason": "already assigned" }] }
```

**Assign-tasks behavior (গুরুত্বপূর্ণ):**
1. ট্রানজেকশন নয় — প্রতি ডেলিভারেবলে আলাদা `TasksService.create()` কল, যাতে department task-type rule, notification, WhatsApp, audit সব কাজ করে।
2. `deliverableId` না দেওয়া হলে ৫০০+ টাস্ক স্ক্যান — বরং `task.count({ where: { deliverableId: { in: ids } } })` একবার।
3. `taskType` ম্যাপিং: `GRAPHIC → "design"`, `VIDEO → "video"`, `COPY → "copy"`, `PHOTO → "photo"`, বাকি `"general"` — কিন্তু department rule আটকালে **task তৈরি হবে না**, রেসপন্সে কারণ দেখাবে (`"Rafi's department only allows: design, video"`)। UI-তে সেই মেসেজ দেখাবে।
4. `title` = `topic?.trim() || title`; `description` = `objective` + newline + `description`.
5. `isClientVisible` = deliverable.clientVisible || request flag।

### 4.3 Report

| Method | Route | পরিবর্তন |
|---|---|---|
| `POST` | `/flow/projects/:id/reports/generate` | `campaignId`, `groupBy` গ্রহণ করবে; `summary` + `shoots` স্ন্যাপশট তৈরি করবে |
| `GET` | `/flow/projects/:id/reports` | অপরিবর্তিত (নতুন ফিল্ড include) |

**generate body:**
```json
{ "periodStart": "2026-11-01", "periodEnd": "2026-11-30", "campaignId": null, "groupBy": "CAMPAIGN", "pmNotes": "..." }
```

**জেনারেশন লজিক:**
- Deliverable স্ট্যাটাস derivation আগের মতোই (task-completion থেকে), তবে এখন `kind`, `topic`, `objective`, `campaign`, `owner` সহ।
- `completed` / `pending` অ্যারে-তে নতুন ফিল্ড যোগ: `kind, topic, objective, campaignId, campaignName, ownerName, dueDate`.
- পিরিয়ডের শুট: `shootDate` পিরিয়ডের ভেতরে → `shoots` স্ন্যাপশট।
- `campaignId` দিলে শুধু ওই ক্যাম্পেইনের ডেলিভারেবল + শুট + বিলিং (invoice-এ campaignId নেই তাই বিলিং পুরো প্রজেক্টের, কিন্তু লেবেল থাকবে "Campaign scope — billing is project-wide")।
- `groupBy = KIND` হলে `byKind` প্রধান, etc. — সেকশন অর্ডার বদলাবে (ডেটা সবসময় সব থাকবে)।

---

## 5. Calendar sync (Shoot → Calendar)

**One-way sync** (Shoot সবসময় source of truth):

| Shoot action | Calendar |
|---|---|
| Create | `SHOOT` event তৈরি — `title`, `date = shootDate`, `endDate`, `startTime = callTime`, `endTime = wrapTime`, `location`, `notes = description`, `attendeeIds = crew.employeeId[]`, `projectId`, `campaignId`, `visibility = INTERNAL` |
| Update | একই `calendarEventId` upsert |
| Delete | event ডিলিট |
| `isDateLocked = true` | ক্যালেন্ডারে event ড্র্যাগ করলে API ของ calendar action নেবে না — শুট-এর তারিখ বদলাতে হবে (UI-তে "locked" ব্যাজ) |

**Technical note:** `apps/api/src/calendar/calendar.utils.ts`-এর `dayKey()` / `dhakaInstant()` রিসাইকেল হবে। `CalendarEvent` সরাসরি Prisma দিয়ে লেখা হবে (CalendarModule import করলে cycle ঝুঁকি; flow→calendar একমুখী ডিপেন্ডেন্সি এড়াতে direct write)।

---

## 6. UI — Flow workspace

### 6.1 Rail-এ নতুন tab

```
Overview
Proposal          (1)
Deliverables      (12)
Shoot             (2)   ← নতুন, Camera আইকন
Tasks             (14)
Milestones        (3)
Files             (8)
Finance
Reports           (4)
Discussion
Docs & Links
```

### 6.2 Shoot tab — লিস্ট ভিউ

```
┌────────────────────────────────────────────────────────────┐
│ [+ New shoot]                    [All ▾] [This month ▾]  │
│ 2 shoots · 1 full day · 1 half day · next: 18 Nov         │
├────────────────────────────────────────────────────────────┤
│ ● 18 Nov 2026 · FULL DAY · CONFIRMED        2 days away  │
│   TVC Day 1 — Banani Studio                               │
│   Studio 4, Banani · call 09:30 → wrap 18:00              │
│   👤 DoP: Imran (vendor) · 🎥 Cameraman: Rafi (team)      │
│   Crew 5 · Equipment 9 items            [Edit] [⋯]       │
├────────────────────────────────────────────────────────────┤
│ ● 24 Nov 2026 · HALF DAY · PLANNED                         │
│   Product stills — GlowSkin                               │
└────────────────────────────────────────────────────────────┘
```

প্রতিটা row expand করলে: full crew list (role → name → confirmed), equipment chips, notes।

### 6.3 Shoot editor (modal/drawer, 2 column)

| বাম কলাম | ডান কলাম |
|---|---|
| Title | Date (+ end date) |
| Duration (Half / Full chips) | Date locked toggle |
| Call time / Wrap time | Status |
| Location + Maps link | Campaign (optional) |
| Description (concept) | Equipment (multi-line add) |
| **Crew** — role select + source tabs (Team / Vendor / External) + person picker + fee + confirm | Notes |

**Crew picker UX:**
- Role dropdown (১৭ role, icon সহ)
- Source segmented: `Team` / `Vendor` / `External`
- Team → People employee search; Vendor → Capital vendor search; External → name + phone ফ্রি-টেক্সট
- "Copy from last shoot" বাটন — আগের শুটের ক্রু লিস্ট ক্লোন (খুব সময় বাঁচাবে)
- প্রতিটা ক্রু row-তে confirm checkbox (কল-শিটে টিক থাকবে)

**Equipment UX:** এক লাইনে এক আইটেম + Enter → নতুন লাইন; drag করে অর্ডার; আগের শুটের equipment থেকে suggestion chips (এটা ক্যাটালগ নয়, শুধু সাজেশন)।

### 6.4 Deliverables tab — redesign

উপরে: `[+ Add]` `[Bulk paste]` `[Assign as tasks (3)]` · ফিল্টার: Type chips · Campaign select · Status

প্রতি row:

```
☐  ●  GRAPHIC   Eid greeting post — peacock motif       6/6 tasks   [delivered]
      Objective: Awareness · Campaign: Eid 2026 · Due 20 Nov · Owner: Rafi
      ▸ expand → Type / Topic / Objective / Campaign / Owner / Dates / Client-visible / Description
```

- **Inline expand editor** (modal নয় — দ্রুত টাইপ করার জন্য)
- Type chip রঙ: Graphic = sky, Video = violet, Photo = amber, Copy = emerald, Other = muted
- Selection bar (sticky) → "3 selected · Assign as tasks · Delete"

**Bulk paste modal:** textarea, প্রতি লাইনে একটা ডেলিভারেবল; উপরে একটা default Type + Campaign সেট করা যাবে (যেমন ৮ লাইন পেস্ট করে "GRAPHIC" সিলেক্ট → ৮টা গ্রাফিক্স)।

### 6.5 Assign-as-tasks modal

```
Assign 3 deliverables as tasks
─────────────────────────────
Assignee *        [ Select person ▾ ]   ← একমাত্র বাধ্যতামূলক ফিল্ড
Also assign to    [ + add ]              (optional)
Due date          ○ use deliverable dates   ○ override [date]
Priority          [MEDIUM ▾]
☑ Client-visible tasks
─────────────────────────────
3 tasks will be created · 0 already linked
                              [Cancel]  [Assign]
```

Fail হলে (department rule) → modal-এ লাল লাইন: "Rafi can only take design/video tasks"।

### 6.6 Reports tab — নতুন report card

```
Progress report — November 2026            [DRAFT]  [PDF] [send] [⋯]
01 Nov – 30 Nov · generated 2 hours ago by Nadia

Graphics  6/8 ████████░░   Video 2/4 ██████░░░░   Photo 0/1
Campaigns: Eid 2026 (6/8) · Winter (2/4)
Shoots: 2 (1 full day, 1 half day) · 9 crew · 14 equipment items

Delivered (9)                         Pending (3)
 ✓ Eid post 1 — Graphic              ○ Winter reel 2 — Video
   Awareness · Eid 2026                due 24 Nov · Rafi
 ...
Billing — invoiced ৳1,20,000 · collected ৳80,000 · outstanding ৳40,000
PM notes: ...
```

---

## 7. PDF রিপোর্ট

**নতুন ফাইল:** `apps/web/src/lib/project-report-pdf.ts` → `buildProjectReportPdf(report, project, opts)` (jsPDF, `portal-report-pdf.ts`-এর স্টাইল অনুসরণ)

**পেজ স্ট্রাকচার:**

1. **Header** — প্রজেক্ট নাম, ক্লায়েন্ট, পিরিয়ড, PM, ক্যাম্পেইন (যদি scope করা)
2. **Executive summary** — "৯ delivered / ৩ pending · Graphics 6/8 · Video 2/4 · 2 shoots"
3. **Deliverables delivered** — গ্রুপিং অনুযায়ী (ক্যাম্পেইন → type), প্রতিটার topic + objective + completion date
4. **Pending deliverables** — due date, owner, type (overdue লাল)
5. **Shoots in this period** — তারিখ, half/full, location, duration, crew টেবিল (role → name → confirmed), equipment
6. **Billing** — invoiced / collected / outstanding
7. **PM notes** — client-facing text

**নিয়ম:** রিপোর্টের স্ন্যাপশট থেকে PDF তৈরি হবে — লাইভ ডেটা থেকে নয় (রিপোর্ট যা দেখিয়েছে, PDF-ও তাই)।

---

## 8. Permissions, audit, limits

| কাজ | কে পারবে |
|---|---|
| Shoot create/edit/delete | PM (assigned PM), Admin, বা project-এ edit permission থাকা user |
| Crew edit | একই |
| Deliverable edit | একই (আগের মতোই) |
| Assign tasks | যার task create করার অনুমতি আছে (TasksService নিজেই চেক করবে) |
| Report generate | একই |

- প্রতিটা mutation → `writeSystemAudit()`: `flow.shoot.create`, `flow.shoot.update`, `flow.shoot.delete`, `flow.shoot.crew.add`, `flow.deliverable.assign_tasks`, `flow.report.generate`
- Cache invalidation: `invalidateProjects()` + shoot-এ `invalidateTasks()` লাগবে না (shoot→task নেই)
- Limits: শুটে সর্বোচ্চ ৫০ ক্রু, ১০০ equipment item, প্রতি প্রজেক্টে unlimited shoot (practical limit UI-তে paginate)

---

## 9. Edge cases

| কেস | আচরণ |
|---|---|
| ক্যাম্পেইন অন্য ক্লায়েন্টের | 400 — "This campaign belongs to a different client" |
| শুট ডিলিট হলে calendar event | সাথে ডিলিট |
| ইমপ্লয়ি ডিলিট → ক্রুতে ছিল | `employeeId = null`, `name` snapshot থেকে যায়, শুটে "(left)" ব্যাজ |
| ভেন্ডর ডিলিট → ক্রুতে ছিল | একই আচরণ |
| multi-day shoot + half-day | durationType পুরো শুটে এক — মাল্টি-ডে হলে সাধারণত FULL_DAY; UI-তে hint |
| Deliverable-এর campaign ডিলিট | `campaignId = null`, deliverables অক্ষত |
| Assign করার সময় employee inactive | task তৈরি হবে কিন্তু UI warn: "inactive employee" |
| একই ডেলিভারেবলে দুবার assign | second time skip + message |
| Task থেকে deliverable unlink | deliverable status manual-এ ফিরবে (আগের লজিক) |
| রিপোর্ট পিরিয়ডে কোনো শুট নেই | সেকশন দেখাবে না (কিন্তু summary-তে "0 shoots") |
| PDF-এ বাংলা ফন্ট | বিদ্যমান `portal-report-pdf.ts` যে ফন্ট লোড করে সেটাই; বাংলা টেক্সট হলে টেস্ট করতে হবে (risk R3) |

---

## 10. ফাইল-বাই-ফাইল ইমপ্লিমেন্টেশন চেকলিস্ট

### Phase 1 — DB + API (core)

- [ ] `apps/api/prisma/schema.prisma` — `Shoot`, `ShootCrew`, enums, `ProjectDeliverable` ফিল্ড, `ProjectReport` ফিল্ড, `Campaign` reverse relations, `Employee`/`Vendor`/`User` reverse relations
- [ ] `apps/api/prisma/migrations/<ts>_project_shoots_deliverable_kind/migration.sql` — `prisma migrate dev`
- [ ] `apps/api/src/flow/dto/flow-mutations.dto.ts` — `CreateShootDto`, `UpdateShootDto`, `ShootCrewDto`, `UpdateDeliverableDto` এক্সটেন্ড, `BulkDeliverablesDto`, `AssignDeliverableTasksDto`, `GenerateReportDto` এক্সটেন্ড
- [ ] `apps/api/src/flow/flow.service.ts` —
  - `listShoots(projectId)`, `createShoot`, `updateShoot`, `removeShoot`
  - `addShootCrew`, `updateShootCrew`, `removeShootCrew`
  - `syncShootCalendarEvent()` (private)
  - `addDeliverable` / `updateDeliverable` নতুন ফিল্ড
  - `bulkAddDeliverables`
  - `assignDeliverableTasks`
  - `generateReport` — summary + shoots + grouping
  - `detail()` — `shoots` include
- [ ] `apps/api/src/flow/flow.controller.ts` — ৮টা নতুন route
- [ ] `apps/api/src/flow/flow.module.ts` — `TasksModule` import (assign-tasks এর জন্য)
- [ ] `apps/api/prisma/seed.ts` — ২টা উদাহরণ শুট (crew + equipment), ১২টা ডেলিভারেবল (৮ graphic + ৪ video, campaign সহ)

### Phase 2 — Web: Shoot tab

- [ ] `apps/web/src/lib/types.ts` — `Shoot`, `ShootCrew`, `ShootDuration`, `ShootStatus`, `DeliverableKind`, `ReportGrouping`, `ProjectDeliverable`/`ProjectReport` এক্সটেন্ড
- [ ] `apps/web/src/components/flow/shoot-tab.tsx` (নতুন) — লিস্ট + empty state + summary strip
- [ ] `apps/web/src/components/flow/shoot-editor.tsx` (নতুন) — modal, ২ কলাম, crew picker, equipment editor
- [ ] `apps/web/src/components/flow/crew-picker.tsx` (নতুন) — role + source tabs + employee/vendor/external search
- [ ] `apps/web/src/components/flow/flow-workspace.tsx` — rail-এ Shoot tab, state + handlers, tab type union
- [ ] Calendar UI-তে SHOOT event-এ "Open shoot" লিংক (optional, phase 4)

### Phase 3 — Web: Deliverables redesign + one-click assign

- [ ] `apps/web/src/components/flow/deliverables-tab.tsx` (নতুন — `flow-workspace.tsx` থেকে এক্সট্রাক্ট, ২৬২৮–২৭২৫ লাইন এখন ~৩০০ লাইনের কম্পোনেন্ট)
- [ ] `apps/web/src/components/flow/deliverable-editor.tsx` (নতুন) — inline expand, type chips, campaign select, owner select
- [ ] `apps/web/src/components/flow/bulk-deliverables-modal.tsx` (নতুন) — paste mode
- [ ] `apps/web/src/components/flow/assign-tasks-modal.tsx` (নতুন) — assignee select (একমাত্র বাধ্যতামূলক)
- [ ] `apps/web/src/components/flow/flow-workspace.tsx` — নতুন কম্পোনেন্ট wired, selection state

### Phase 4 — Reports + PDF

- [ ] `apps/web/src/lib/project-report-pdf.ts` (নতুন)
- [ ] `apps/web/src/components/flow/reports-tab.tsx` (নতুন — ২৭২৬–২৮৪৯ লাইন এক্সট্রাক্ট)
- [ ] `apps/web/src/components/flow/report-card.tsx` (নতুন) — summary strip + grouped sections + PDF/print button
- [ ] `apps/web/prisma`-এর বাইরে কোনো ডেটা নেই — টাইপ sync

### Phase 5 — Polish

- [ ] Calendar sync edge cases (date lock, delete)
- [ ] Empty states, loading skeletons, error toasts
- [ ] Responsive: 1366/1440, mobile stack
- [ ] `docs/design-system.md` অনুযায়ী typography/icon audit (`scripts/ui-audit*.mjs` স্ক্রিপ্ট)

### Phase 6 — QA + docs

- [ ] `docs/project-shoot-deliverables-reporting.md` — feature doc (নতুন)
- [ ] QA matrix (নিচে) এক্সিকিউট
- [ ] `apps/web/e2e/` — shoot create → calendar event; deliverable bulk → assign → report
- [ ] Seed verify

---

## 11. Acceptance criteria

### Shoot
1. প্রতিটা প্রজেক্টের rail-এ Shoot tab আছে, count badge কাজ করে।
2. শুট তৈরি করা যায়: date (required), half/full day, call/wrap, location, campaign (optional), description, equipment (free-text multi), crew।
3. DoP, Cameraman, Vendor আলাদা role হিসেবে সিলেক্ট করা যায় — Team / Vendor / External তিন source থেকেই।
4. শুট সেভ করলে Calendar-এ `SHOOT` event তৈরি হয় সঠিক তারিখ/সময়/লোকেশনে, attendee = team crew।
5. শুট এডিট → event আপডেট; শুট ডিলিট → event ডিলিট; duplicate event হয় না।
6. Date lock দিলে শুটের তারিখ শুধু শুট এডিটর থেকেই বদলানো যায়।
7. "Copy from last shoot" ক্রু ক্লোন করে।
8. রিপোর্টে পিরিয়ডের শুটের snapshot আসে (crew + equipment সহ)।

### Deliverable
9. ডেলিভারেবলে type (Graphic/Video/Photo/Copy/Other), topic, objective, campaign, due date, owner, client-visible সেট করা যায়।
10. একইসাথে একাধিক ডেলিভারেবল পেস্ট করে তৈরি করা যায় (default type সহ)।
11. Type অনুযায়ী ফিল্টার + count "Graphics 6/8" দেখায়।

### Assign
12. ৩টা ডেলিভারেবল সিলেক্ট → assignee বেছে → এক ক্লিকে ৩টা task তৈরি (deliverableId লিংক সহ)।
13. ইতিমধ্যে লিংকড ডেলিভারেবল skip হয়, UI-তে "1 already assigned" দেখায়।
14. Department task-type rule ভাঙলে task তৈরি হয় না, নির্দিষ্ট এরর মেসেজ দেখায়, বাকিগুলো তৈরি হয়।
15. Task complete করলে deliverable status অটো আপডেট হয় (আগের আচরণ অটুট)।

### Report
16. রিপোর্টে type breakup, campaign grouping, প্রতিটার topic/objective, owner দেখায়।
17. শুধু একটা ক্যাম্পেইনের রিপোর্ট তৈরি করা যায়।
18. PDF ডাউনলোড হয়, স্ন্যাপশটের ডেটাই থাকে (পরে এডিট করলে বদলায় না)।
19. বাংলা/ইংরেজি মিশ্র টেক্সট PDF-এ ঠিকভাবে রেন্ডার হয় (অথবা ফন্ট ফলব্যাক নিশ্চিত)।

---

## 12. QA matrix (সংক্ষিপ্ত)

| # | সিনারিও | প্রত্যাশা |
|---|---|---|
| 1 | শুট date খালি রেখে save | 400 validation |
| 2 | endDate < shootDate | 400 |
| 3 | অন্য ক্লায়েন্টের campaign | 400 |
| 4 | শুট এডিটে তারিখ বদল | calendar event একটাই, আপডেটেড |
| 5 | শুট ডিলিট | event নেই |
| 6 | ক্রু employee ডিলিট (People থেকে) | শুটে নাম থাকে, link null |
| 7 | ৮টা graphic + ৪টা video bulk paste | ১২টা row, type সঠিক |
| 8 | ৩টা select → assign (এক assignee) | ৩টা task, correct due dates |
| 9 | আবার assign | ৩টা skip |
| 10 | department rule conflict | partial success + message |
| 11 | task complete | deliverable DELIVERED (সব task done হলে) |
| 12 | report generate (campaign scope) | শুধু ওই campaign-এর আইটেম |
| 13 | report generate → পরে শুট এডিট | পুরনো report অপরিবর্তিত |
| 14 | PDF download | ৭ সেকশন, সংখ্যা মেলে |
| 15 | 1366px viewport | horizontal scroll নেই |

---

## 13. ঝুঁকি (risks)

| ID | ঝুঁকি | প্রশমন |
|---|---|---|
| R1 | `flow.service.ts` ইতিমধ্যে ৬৭KB — আরও বাড়লে রক্ষণাবেক্ষণ কঠিন | Shoot লজিক আলাদা `flow-shoot.service.ts`-এ রাখা (flow.service inject করবে) |
| R2 | Calendar one-way sync → ক্যালেন্ডারে event সরালে শুটের তারিখ বদলায় না | `isDateLocked` + event-এ "managed by shoot" ব্যাজ; দুই-মুখী sync ভবিষ্যতে |
| R3 | jsPDF-এ বাংলা গ্লিফ | ফন্ট এমবেড টেস্ট; না হলে রিপোর্টের লেবেল ইংরেজি + ইউজার-টেক্সট যেভাবে আছে |
| R4 | assign-tasks-এ partial failure | প্রতি আইটেম আলাদা try/catch, response-এ per-item result |
| R5 | পুরনো রিপোর্টে `summary`/`shoots` null | UI null-safe (পুরনো রিপোর্ট আগের লেআউটে দেখাবে) |
| R6 | `ProjectDeliverable.kind` nullable → পুরনো ডেটা | UI "Unclassified" chip, রিপোর্টে "Unclassified" bucket |
| R7 | huge project (১০০+ deliverable) → assign modal slow | server-side batch insert + single count query |

---

## 14. যেগুলো এখনো কনফার্ম করতে হবে (ডিফল্ট ধরে এগোচ্ছি)

| # | প্রশ্ন | আমার ডিফল্ট |
|---|---|---|
| A | Deliverable type লিস্ট | `GRAPHIC, VIDEO, PHOTO, COPY, OTHER` |
| B | Multi-day shoot-এ half/full | পুরো শুটে একটাই durationType |
| C | Crew role লিস্ট | উপরের ১৭টা (DOP, Cameraman, AC, Gaffer, Grip, Sound, Art, Stylist, Makeup, Producer, Line Producer, Photographer, Drone, Driver, Talent, Team member, Other) |
| D | DoP/Cameraman আলাদা ফিল্ড নাকি role? | **role** হিসেবেই (`ShootCrewRole.DOP`, `CAMERAMAN`) — আলাদা কলাম নয়, কারণ একই শুটে ২ জন cameraman থাকতে পারে |
| E | Assignee এক না একাধিক | এক বাধ্যতামূলক + co-assignee অপশনাল |
| F | Task-এর title | `topic` থাকলে topic, নাহলে deliverable title |
| G | রিপোর্টে ছবি/লোগো | প্রজেক্ট লোগো হেডারে (আছে), কোনো thumbnail নেই |
| H | Shoot-এর fee/rate কি খরচে (Expense) যাবে? | **না** — শুধু ইতিহাস; ভবিষ্যতে VendorEngagement লিংক (ফেজ ২) |
| I | ক্যাম্পেইন ছাড়া শুট | অনুমোদিত (projectId বাধ্যতামূলক, campaignId অপশনাল) |

> এই ৯টার মধ্যে কোনোটা বদলাতে চাইলে বলো — শুরুর আগেই ঠিক করে নেব।

---

## 15. বাস্তবায়নের ক্রম (suggested)

```
Phase 1 (DB + API)  →  Phase 2 (Shoot UI)  →  Phase 3 (Deliverable UI + assign)
                    →  Phase 4 (Reports + PDF)  →  Phase 5 (Polish)  →  Phase 6 (QA)
```

Phase 1 শেষ হলে API curl করে যাচাই, তারপর UI। প্রতিটা ফেজের শেষে ডেমোযোগ্য অবস্থা থাকবে।
