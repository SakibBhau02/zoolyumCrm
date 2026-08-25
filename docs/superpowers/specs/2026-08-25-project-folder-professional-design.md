# Project Folder Professional Upgrade — Design

**Date:** 2026-08-25
**Status:** Approved (A+B hybrid)
**Scope:** Flow module (Project) — professional Add New Project, amount & finance connected, one-time/recurring with auto invoice (start/finish/manual), table default with inline status, professional popup with deep PM details, task assign (bulk + portal sync), overview links (project/social/website), Reference & Research tab (file + drive link), Gantt, plus web-search extras (budget burn).

## 1. Context & Goals

Current `flow/page.tsx:103 ProjectModal` (1763 LOC) has basic 18 fields, `grid` default, no `description`, `projectLink/website/social` missing, `billingType` stringly-typed, manual invoice only, `table` no inline status, popup missing reference/research, `team String[]` fragile. Prisma `Project` L587 has `budgetAmount/spentAmount/currency` but no `description`, `projectLink`, `socialLinks`, `referenceLinks`; `billingType/paymentStatus` are String; `ProjectFile` only for files, not drive links.

Goal: Professional project folder where every data can be input, amount visible, one-time/recurring with finance connected, recurring auto DRAFT on start and on finish + manual, table default, status easily changeable, popup professionally designed for PM deep dive, reference/research with file + drive/national link, plus task assign linked to task module, plus best PM extras (budget burn, Gantt).

## 2. Data Model

**File:** `apps/api/prisma/schema.prisma`

```prisma
enum BillingCycle {
  ONE_TIME
  RECURRING
}

enum ReferenceType {
  DRIVE
  NOTION
  FIGMA
  OTHER
}

model Project {
  id                String           @id @default(cuid())
  uid               String?          @unique
  client            Client           @relation(fields: [clientId], references: [id])
  clientId          String
  name              String
  description       String?          @db.Text // NEW
  amount            Decimal?         @db.Decimal(14,2) // NEW alias, keep budgetAmount for compat, sync via service
  budgetAmount      Decimal?         @db.Decimal(14,2) // @deprecated alias to amount
  spentAmount       Decimal?         @db.Decimal(14,2)
  currency          String           @default("BDT")
  // ... existing
  billingType       BillingCycle     @default(ONE_TIME) // NEW enum, migrate String → enum
  recurringInterval String?
  nextBillingDate   DateTime?
  monthlyRate       Decimal?         @db.Decimal(14,2)
  totalBilled       Decimal?         @db.Decimal(14,2)
  paymentStatus     String           @default("PENDING")
  // links
  projectLink       String?          // NEW live project URL
  websiteUrl        String?          // NEW
  socialLinks       Json?            // NEW {facebook, linkedin, instagram, twitter}
  referenceLinks    Json?            // deprecated, keep for compat, new model preferred
  // ... existing brief/drive/researchLink keep
  // relations
  references        ProjectReference[]
  // ... existing
}

model ProjectReference {
  id          String        @id @default(cuid())
  project     Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String
  title       String
  url         String?       // drive/notion/figma/other link
  type        ReferenceType @default(OTHER)
  fileUrl     String?       // uploaded file
  uploadedBy  User?         @relation(fields: [uploadedById], references: [id])
  uploadedById String?
  createdAt   DateTime      @default(now())
  @@index([projectId])
}
```

Migration: `20260825_project_professional` — additive nullable, `Project.billingType` String → enum via `ALTER TYPE` with `USING billingType::text::"BillingCycle"`, default `ONE_TIME` for existing rows, `ProjectReference` table create, `Project.amount` copy from `budgetAmount` via `UPDATE Project SET amount = budgetAmount WHERE amount IS NULL`.

`Project.budgetAmount` kept for backward compat, service syncs `amount ↔ budgetAmount` on write/read.

`Gantt` no new model — uses existing `Milestone.dueDate/status` + `Task.dueDate`.

## 3. API

**Files:** `apps/api/src/flow/flow.service.ts`, `flow.controller.ts`, `flow/dto/create-project.dto.ts`, `flow/dto/create-reference.dto.ts`, `capital.service.ts`, `tasks.service.ts`

**DTOs:**
- `CreateProjectDto` with `class-validator`: `name @IsString @MaxLength(120)`, `clientId @IsUUID`, `description @IsOptional @IsString @MaxLength(2000)`, `amount @IsOptional @IsNumber @Min(0)`, `budgetAmount @IsOptional @IsNumber`, `currency @IsIn([BDT,USD,SAR,AED])`, `billingType @IsEnum(BillingCycle)`, `recurringInterval @IsIn([7-days,15-days,30-days,monthly]) @ValidateIf(billingType===RECURRING)`, `projectLink/websiteUrl @IsOptional @IsUrl({require_protocol:false})`, `socialLinks @IsOptional @IsObject`, `team @IsArray @IsString(each)`, `status @IsEnum(ProjectStatus)`, `priority @IsString`, `progress @IsInt @Min(0) @Max(100)`, `startDate/targetEndDate @IsDateString`, `assignedPmId @IsOptional @IsUUID`.

- `CreateReferenceDto`: `title @IsString @MaxLength(80)`, `url @IsOptional @IsUrl`, `type @IsEnum(ReferenceType)`, `fileUrl @IsOptional @IsString`.

**Endpoints:**
- `POST /flow/projects` — uses `CreateProjectDto`, sets `uid`, `amount/budgetAmount` sync, `projectLink/websiteUrl/socialLinks/description`, `nextBillingDate` auto via `computeNextBilling`, broadcasts.
- `PATCH /flow/projects/:id` — same DTO partial, handles `amount ↔ budgetAmount` sync, `socialLinks` merge, triggers auto invoice hooks (see below).
- `POST /flow/projects/:id/references` — `CreateReferenceDto` + `file` optional via `FileInterceptor` (reuse `POST /flow/upload` diskStorage), creates `ProjectReference`, returns list.
- `GET /flow/projects/:id/references` — list references.
- `PATCH /flow/references/:id` / `DELETE /flow/references/:id` — update/delete.
- `POST /flow/projects/:id/invoice` — manual invoice shortcut: `POST /capital/invoices` from project (_one-time `budgetAmount` or recurring `monthlyRate`).
- `PATCH /flow/projects/:id/status` alternative or reuse `PATCH /projects/:id` with `status` — for Kanban drag and table inline Select.
- `POST /flow/projects/:id/tasks/bulk` — body `{ taskIds: string[] }` or `{ titles: string[] }` for bulk assign (creates tasks with `projectId`).

**Auto Invoice Hooks (in `flow.service.ts`):**
- `update()` after `prisma.project.update`, check `prev.status` vs `next.status`:
  - `PLANNING|PAUSED → ACTIVE` (start) and `billingType===ONE_TIME|RECURRING` and `totalBilled==0_or_null` → `capitalService.createInvoice({ clientId, projectId, amount: amount ?? budgetAmount ?? monthlyRate, invoiceType: billingType===RECURRING?RECURRING:ONE_TIME, status:DRAFT, dueDate: +14d })` — DRAFT for finance review.
  - `* → COMPLETED` (finish) and `paymentStatus !== PAID` and `remaining = (amount ?? budgetAmount) - totalBilled > 0` → final `DRAFT` invoice for remaining.
- Manual: `ProjectInvoiceModal` already does `POST /capital/invoices` — keep, add button in popup Finance tab also.
- Recurring scheduler: `@nestjs/schedule` `@Cron('0 2 * * *')` in `capital.service.ts` or `flow.service.ts` calls `capitalService.runRecurringBilling()` daily 2am (currently manual `POST /capital/recurring/run` keep for manual trigger). `runRecurringBilling` finds `billingType=RECURRING && nextBillingDate<=now` → creates `RECURRING` invoice `monthlyRate`, advances `nextBillingDate` via `advanceBillingDate`, `syncProjectBilling`.

**Validation:** `billingType=RECURRING` requires `monthlyRate>0` else 400.

**Portal sync:** `GET /flow/projects/:id` already includes `client` — portal `GET /portal-client/projects/:id` will show same references (no new endpoint, just ensure `ProjectReference` included in `portal-client.service`).

## 4. Frontend — Add New Project Professional

**File:** `apps/web/src/app/(app)/flow/page.tsx` `ProjectModal`

**UI — Stepped professional form (single scroll, not wizard):**

- **Header:** `Avatar` + `Zoolyum OS` + `Project` + `Category` badge
- **Section: Company & Category** — `name*` + `clientId*` (Searchable Select), `category` (datalist), `type: FIXED|RETAINER|CAMPAIGN`, `priority` (URGENT/HIGH/MEDIUM/LOW), `description` textarea (NEW, 3 rows, placeholder "Scope, deliverables, out of scope…")
- **Section: Amount & Finance** — grouped cards: `amount` (NEW, label "Project Amount (BDT)" syncs to `budgetAmount` for compat) + `spentAmount` + `currency` (BDT/USD/SAR/AED) + `progress` slider 0-100, `totalBilled` read-only if exists. `billingType` `Segmented ONE_TIME|RECURRING`, if RECURRING → `interval 7/15/30/m` + `monthlyRate*` + `nextBillingDate` + `paymentStatus` + hint "Auto DRAFT on start (ACTIVE) and on finish (COMPLETED) — also manual via Finance tab"
- **Section: Links — Project Overview** — `projectLink` (live URL, NEW), `websiteUrl` (NEW), `socialLinks` 3 inputs (facebook/linkedin/instagram) with Link icons, `briefLink/driveLink/researchLink` keep for compat (deprecate but keep)
- **Section: Team** — multi-toggle `employees` (store `id` not name, fix `team String[]` to store `employeeId` display name) + `assignedPmId` Select (managers)
- **Section: References (preview)** — if editing, show `Reference & Research` mini list (title/url/type) with `Add Drive Link` inline (title+url+type) → `POST /flow/projects/:id/references`
- **Validation:** `name+clientId` required, `RECURRING` → `monthlyRate>0`, `amount>=0`, dates `startDate <= targetEndDate`
- **Payload:** `POST /flow/projects` with all new fields, `amount` ↔ `budgetAmount` both sent for compat.

Files: `flow/page.tsx:103`, `flow/dto`, `prisma`.

## 5. Views — Table Default with Status Inline

**File:** `apps/web/src/app/(app)/flow/page.tsx`

- `const [view, setView] = useState<"table"|"grid"|"kanban">("table")` — **table by default** (was grid), `useEffect` sync to `localStorage` + `searchParams ?view=` for URL deep-link
- `Segmented` `table|grid|kanban` (icons `Table`, `LayoutGrid`, `Columns`) keep
- **Table** (`TableShell hideScrollbar` + `min-w-[900px]` inside `overflow-x-auto [scrollbar-width:none]`) — columns `Project (name+client+category) | Status (inline Select) | Priority | Progress | Amount/Budget | Spent | Due | PM | Actions` — `Status` column uses `<Select value={status} onChange={patchStatus}>` with `stopPropagation` → `PATCH /flow/projects/:id {status}` + `notify` — easily visible inline change
- **Grid** keep existing `ProjectCard` (category badge, priority, progress, budget/spent, team avatars)
- **Kanban** keep `PROJECT_STATUSES` columns, drag → `patchStatus`
- All views respect `category`, `clientId`, `health` filters (already) + `q`

## 6. Popup — Professional Deep Dive

**File:** `apps/web/src/app/(app)/flow/page.tsx` Modal `!!selectedId` size `xl`

**Header:** `Avatar + name + company · uid` + `priority` + `category` + `paymentStatus` + link pills `projectLink/website/social` (NEW) + `brief/drive/research` (compat) — copyable

**Controls:** `Status` Segmented + `Health` Segmented + `PM` Select (as before) — all inline, plus `Progress` slider

**Stats:** 4 cards `Budget (amount)`, `Progress`, `Invoiced (finance?.totalInvoiced)`, `Outstanding` + `Finance` sparkline (budget burn `spent/budget %`) from `finance` — web-search extra `budget burn visibility`

**Facts:** 12-field grid + NEW rows `projectLink`, `websiteUrl`, `socialLinks` (facebook/linkedin/instagram icons with href), keep `Category, Priority, Billing, Next billing, Payment`

**Tabs:** `Overview | Milestones | Files | Discussions | Tasks | Finance` + **NEW `References & Research`** (7th tab)

- **Overview:** `sourceLead` card, `Team` avatars, `Budget bar`, `Risks`, plus `projectLink/website/social` pills
- **References & Research:** `max-h-[360px]` scroll — table of `ProjectReference` (`title | url (drive.google.com…) | type badge DRIVE/NOTION/FIGMA/OTHER | fileUrl download | uploadedBy | delete`) + top bar `Add Reference` (two modes: **Upload File** → `POST /flow/upload` + `POST /flow/projects/:id/references {title, fileUrl, type: OTHER}` and **Add Drive Link** → form `title* + url* + type` → `POST /flow/projects/:id/references`) — supports `tribal link, national link, drive link` all as `url` with `type`
- Existing tabs keep: Milestones (add/edit), Files (upload + approval), Discussions, Tasks (New task → `TaskFormModal` `projectId` lock), Finance (`ProjectFinancePanel` + `Create Invoice` manual + `Expenses`)

**Task assign:** `Tasks` tab `New task` → `TaskFormModal` `projectId={detail.id}` (already) + **Bulk assign** button `Select tasks from backlog` → `POST /flow/projects/:id/tasks/bulk` (NEW)

**Gantt:** Not new view — reuse `Milestone.dueDate` + `Task.dueDate` as simple `Gantt` bar in `Overview` (optional, YAGNI: show `Milestone` timeline as Gantt-like `height 4` bars)

**Portal sync:** `ProjectReference` included in `portal-client.service` `GET /portal-client/projects/:id` so client portal sees same references (no new UI).

## 7. Links — Project Overview

- `projectLink` (live environment), `websiteUrl` (client site), `socialLinks` (facebook/linkedin/instagram) — all stored in `Project.socialLinks Json` and displayed as pills in header + fact grid + Overview — clickable, copyable, with icons `Globe, Link2, Facebook` etc.

## 8. Finance Integration

- `Project.amount` is source of truth for "কত টাকার project" — `budgetAmount` kept for compat, service syncs both.
- `billingType` `ONE_TIME` vs `RECURRING` + `recurringInterval` + `monthlyRate` + `nextBillingDate` — Finance Panel shows `totalBilled`, `outstanding`, `nextBillingDate`, `paymentStatus`.
- Auto invoice on start/finish as DRAFT (finance review → SEND), recurring daily cron, manual via `ProjectInvoiceModal` → `POST /capital/invoices` (already) + `POST /flow/projects/:id/invoice` shortcut.

## 9. Extra — Web Search Best Features (YAGNI filtered)

- **Budget burn visibility** (Scoro/BigTime): `ProjectFinancePanel` progress bar `spent/budget %` + `profit/margin` already, add `burn` label.
- **Time tracking**: not added (requires `TimeLog` integration, out of scope).
- **Gantt**: simple milestone Gantt in Overview (bars), not full draggable Gantt.
- **Client portal**: already `portal-client` sees references via API include.
- **Recurring automation**: via cron, as above.

## 10. Files Touched

- `apps/api/prisma/schema.prisma` — Project new fields + ProjectReference + BillingCycle enum + indexes
- `apps/api/prisma/migrations/*` — migration
- `apps/api/src/flow/dto/*` — DTOs
- `apps/api/src/flow/flow.service.ts` — auto hooks, reference CRUD, bulk task, amount sync
- `apps/api/src/flow/flow.controller.ts` — new endpoints
- `apps/api/src/capital/capital.service.ts` — cron
- `apps/web/src/app/(app)/flow/page.tsx` — modal, views, popup, tabs, finance
- `apps/web/src/components/tasks/task-form-modal.tsx` — bulk (if needed)
- `apps/web/src/lib/types.ts` — Project types update

## 11. Testing

- `npx tsc --noEmit` (web+api), `npm run build` (web), `npx prisma validate`
- Manual: Add New Project with all data (amount, recurring, links, social, team, references) → create → check DB `amount/budgetAmount` sync, `referenceLinks` + `ProjectReference` rows; set `status ACTIVE` → check `capital/invoices` DRAFT auto created; set `COMPLETED` → final DRAFT; `POST /capital/recurring/run` or wait cron → recurring invoice; table default → inline status `Select` change → `PATCH` + notify; popup `References & Research` → Upload File + Add Drive Link (drive, notion, figma) → list; Task assign → `TaskFormModal` + bulk → check `tasks` linked; Overview links clickable; `projectLink/website/social` pills.
- E2E: `flow.spec.ts` table default, status change, reference add, invoice auto.
