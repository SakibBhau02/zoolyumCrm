# Calendar Module — Implementation Notes

**Status:** shipped (Phases 0–4, with manual publishing)
**Spec:** `docs/calendar-module-spec.md`
**QA audit:** `docs/qa-calendar-audit.md`
**Migration:** `20261111104717_calendar_full_module`
**Demo data:** `apps/api/prisma/seed-calendar.ts`

---

## 1. কী বদলেছে — এক নজরে

আগে `/calendar` ছিল ৩টা ট্যাব (Content list, Planner grid, Daily targets)। এখন এটা একটা **workspace** — ৮টা ভিউ, unified feed, approval, ads planning, client calendar, plan → report।

| আগে | এখন |
|---|---|
| শুধু content post + event | Task, post, meeting, milestone, deliverable, ad flight, invoice (+ leave/holiday optional) |
| client filter নেই | client/project/campaign/platform/approval/assignee/search filter, URL-এ persist |
| month grid একটাই | Overview · Month · Week · Day (close-out) · Timeline · Grid · Plans · Settings |
| drag-drop নেই | month/week-এ drag-drop reschedule + undo-less but confirm-free move + drawer reschedule |
| approval নেই | NONE → INTERNAL_REVIEW → APPROVED / REJECTED, review chase automation |
| report নেই | Plan snapshot → PDF (EN/BN) · CSV · share link · portal publish · plan-vs-actual |
| ad planning নেই | Campaign + AdFlight, timeline bars, planned vs actual spend |
| Daily Targets ক্যালেন্ডারে | Pulse-এ সরানো (`/pulse/targets`) |

---

## 2. ডেটা মডেল (নতুন/পরিবর্তিত)

**নতুন:** `Campaign`, `AdFlight`, `ClientPlatformAccount`, `ContentPillar`, `ContentMetric`, `CalendarPlan`, `CalendarComment`, `CalendarAuditLog`, `DailyLog`, `SavedCalendarView`, `CalendarShareLink`।

**ContentPost:** `clientId`, `campaignId`, `pillarId`, `scheduledAt` (queryable), `publishStatus`, `approvalStatus`, `assignee/reviewer`, approvals, `externalUrl`, `format`, `hashtags`, `assetUrls`, `isRecurring`, `archivedAt`…

**CalendarEvent:** `startTime/endTime`, `endDate`, `allDay`, `attendeeIds`, `outcome`, `visibility`, `location`, `meetingUrl`, `reminderMinutes`।

**ProjectDeliverable:** `startDate`, `dueDate`, `clientVisible`, `ownerId` (আগে কোনো তারিখই ছিল না)।

**DailyTarget:** `clientId`, `periodType` — এখন Pulse-এর CRUD।

> `ContentPost.scheduledDate/scheduledTime` (string) backward-compat mirror হিসেবে রাখা হয়েছে; সব query `scheduledAt` ব্যবহার করে। Migration-এ পুরনো row backfill করা হয়েছে।

---

## 3. API — `/api/calendar`

### Reads
```
GET  /feed?from&to&clientId&projectId&campaignId&sources&platforms&status&approval&assigneeId&q&mine
GET  /summary?from&to&clientId
GET  /day/:date
GET  /gaps?from&to&clientId
GET  /workload?from&to
GET  /conflicts?from&to&clientId
GET  /timeline?from&to&clientId
GET  /clients | /people
```
`feed` response-এ `items`, per-day `days` (counts/done/overdue/pendingApproval/holiday), `totals`, `truncated`।

### Writes
```
POST   /posts            PATCH /posts/:id          DELETE /posts/:id (soft archive)
POST   /posts/:id/submit-review | approve | reject | publish | restore
POST   /quick-add        (CONTENT_POST | EVENT | TASK | DELIVERABLE | NOTE)
PATCH  /move             { source, id, date, time }
POST   /bulk/move | /bulk/status
POST   /posts/import     { rows: [...] }
POST   /events           PATCH/DELETE /events/:id
```

### Plans & reports
```
GET/POST  /plans                 GET/PATCH/DELETE /plans/:id
POST      /plans/:id/lock | unlock {reason} | publish | share
GET       /plans/:id/variance
GET       /plans/versions?clientId&periodStart
```
Plan `payload` immutable snapshot; lock বাড়ায় `version`; unlock-এ কারণ বাধ্যতামূলক (audit log)।

### Ads & settings
```
GET/POST/PATCH/DELETE  /campaigns, /flights
GET/POST/DELETE        /settings/platform-accounts
GET/POST/DELETE        /settings/pillars
PATCH                  /clients/:clientId/appearance   (colour + monthly targets)
GET/POST/DELETE        /views                          (saved filters)
```

### Exports / public
```
GET  /export/csv   → { filename, mime, content }
GET  /export/ics   → iCal (VEVENT per item)
GET  /api/public/calendar/:token            (login-free)
POST /calendar/plans/:id/share  → { url: "/share/calendar/<token>" }
```

### Portal
```
GET /api/portal-client/calendar?month=YYYY-MM
```
শুধু **approved** post (SCHEDULED/PUBLISHED), **client-visible** meeting/milestone।

---

## 4. Permissions

- নতুন `Module.CALENDAR`; controller-level `@RequirePermission("CALENDAR")`।
- Migration সব role-এ `CALENDAR` = পুরনো `FLOW` কপি করে।
- পুরনো JWT (যাতে শুধু FLOW আছে) ভাঙবে না — guard-এ یکیবার fallback রাখা হয়েছে।
- Control → Roles-এ `CALENDAR` এখন এডিটযোগ্য; role save করলে অজানা module key আর মুছে যায় না (আগের bug ফিক্স)।
- Plan lock/publish/approve করতে `approve` level দরকার (write verb → edit, approve verb → approve)।

---

## 5. অটোমেশন

`CalendarAutomationService` (`@nestjs/schedule`):

| সময় | কাজ |
|---|---|
| ০৯:০০ daily | SCHEDULED post-এর সময় পেরিয়ে গেলে `MISSED`, assignee + PM-কে notification |
| ১০:০০ daily | ২৪ ঘণ্টার বেশি `INTERNAL_REVIEW` → reviewer + PM chase (dedupe per day) |
| রবি ১৮:০০ | পরের সপ্তাহের locked plan না থাকলে PM-দের নোটিশ |
| ২৫ তারিখ ১০:০০ | পরের মাসের plan lock reminder |

সবই `NotificationsService.create()` দিয়ে যায় → bell + Telegram (linked হলে)।

---

## 6. Frontend

```
apps/web/src/components/calendar/
  workspace.tsx      state + URL + data loading + modals
  month-view.tsx     adjacent-month cells, 4 chips + "+N more" → day
  week-view.tsx      all-day strip + 30-min grid, drag/drop with time snap
  day-view.tsx       agenda + day summary + close-out note
  overview.tsx       KPI, today timeline, attention, week strip, client rollup
  timeline-view.tsx  campaign/flight span bars (cross-month clamped)
  grid-view.tsx      platform feed preview
  plans-panel.tsx    generate → lock → publish → share → PDF/CSV → variance
  settings-panel.tsx accounts, pillars, targets, ads, CSV import, saved views
  item-drawer.tsx    one drawer for every source (inline actions)
  forms.tsx          Post (weekly repeat), Event, Flight, Campaign
  filter-bar.tsx     shared filters + CSV/iCal export
  parts.tsx          chips, drag helpers, badges
apps/web/src/app/(app)/calendar/page.tsx
apps/web/src/app/(app)/calendar/clients/[clientId]/page.tsx
apps/web/src/app/share/calendar/[token]/page.tsx
apps/web/src/lib/calendar-date.ts
apps/web/src/lib/calendar-plan-pdf.ts   A4 plan + variance, EN/BN
```

URL shareable: `/calendar?view=day&date=2026-11-11&client=<id>`। History write শুধু user action-এ (effect-এ নয়) — নাহলে Next router পুরনো query নিয়ে remount করছিল।

PDF: jsPDF + embedded Hind Siliguri (invoice pipeline-এর মতো); report language plan-এ save হয়, share page-এ switch করা যায়।

---

## 7. চালানোর ধাপ

```powershell
# 1) migration + client (একবার)
cd apps/api
npx prisma migrate dev
npx prisma generate

# 2) permission + demo data (non-destructive, existing DB-তে চলে)
npx tsx prisma/seed-calendar.ts

# 3) API + web
cd ..\..
npm run dev
```

> `seed.ts` (full reset) চালালে সব মুছে যাবে — এটাই প্রত্যাশিত। শুধু ক্যালেন্ডার ডেমো দরকার হলে `seed-calendar.ts`।

---

## 8. সিদ্ধান্ত (আপনার উত্তর অনুযায়ী)

| প্রশ্ন | সিদ্ধান্ত | কোডে কী হলো |
|---|---|---|
| Approval | **শুধু internal** | `approvalStatus`-এ client step নেই; দেশে portal শুধু approved দেখে |
| Plan lock | **Soft** | status LOCKED + snapshot, এডিট ব্লক নয়, unlock-এ কারণ |
| Daily Targets | **Pulse-এ** | `/pulse/targets` + Pulse UI hook (API প্রস্তুত) |
| Publishing | **Manual + URL** | `publishPost` = status + publishedAt + externalUrl |
| Report ভাষা | **EN + BN switch** | plan.language + PDF label map |
| Google Calendar | **iCal + CSV** | `/export/ics`, `/export/csv` |

---

## 9. যাচাই করা হয়েছে

- API smoke: feed (৩০ items), summary, day, ICS, plan create → lock → variance → share → public view, post create → review → approve → publish → move, event outcome, flight create, gaps/workload/conflicts, `/pulse/targets`।
- Browser (Playwright): month/week/day/overview/timeline/grid/plans/settings render; drawer ওপেন; quick-add; PDF download (EN + BN) — Bengali glyph embed সহ; share page public load; console errors: 0।
- `tsc --noEmit` — API ও web দুটোই clean।

---

## 10. এখনো বাকি (সচেতন সীমা)

1. **Direct social publishing** — Meta/LinkedIn API নেই (আপনার সিদ্ধান্ত অনুযায়ী)। `externalUrl` + "Mark published" ম্যানুয়াল ফ্লো।
2. **Two-way Google sync** — শুধু iCal subscribe + CSV export।
3. **Content metrics** — `ContentMetric` টেবিল আছে, UI/ইনপুট এখনো নেই (রিপোর্টে reach/engagement দেখাতে চাইলে পরের ধাপ)।
4. **Recurring events** — post-এ weekly repeat আছে; event recurrence UI বাকি।
5. **Portal approval buttons** — portal এখন read-only calendar; approved work দেখায়, কিন্তু client-side approve/reject বাটন আসবে portal approval ধাপে।
6. **Month drag-drop-এ multi-day bar** — ad flight/month-এ chip হিসেবেই দেখায়; timeline-এ span।

---

## 11. দ্রুত টেস্ট চেকলিস্ট

- [ ] `/calendar` → Month → পোস্টে ক্লিক → drawer → Approve → status বদলায়
- [ ] Month-এ chip টেনে অন্য দিনে → "Rescheduled"
- [ ] Day → close-out note লিখে Save → note নিচে দেখা যায়
- [ ] Plans → Generate → Lock → PDF (EN) → ভাষা বাংলা → PDF (BN)
- [ ] Share link → incognito → শুধু approved/client-visible আইটেম
- [ ] Client filter → URL-এ `client=` → reload → একই ভিউ
- [ ] Settings → pillar/account add → Grid-এ প্রতিফলিত
