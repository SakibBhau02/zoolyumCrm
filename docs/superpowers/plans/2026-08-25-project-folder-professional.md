# Project Folder Professional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Project folder professional — all data input, amount & recurring finance with auto invoice (start/finish/manual + cron), table default with inline status, professional popup with PM deep details, task assign (bulk), overview links (project/website/social), Reference & Research tab (file + drive link), plus budget burn & Gantt.

**Architecture:** Additive Prisma fields + new ProjectReference model, DTO-validated Flow service with status-transition hooks that create DRAFT invoices via Capital, @Cron recurring daily, Flow controller new reference/bulk endpoints, frontend Flow page refactored to table-default + inline Select, ProjectModal stepped sections, detail Modal with 7 tabs (References & Research hybrid), TaskFormModal bulk, and Overview links — all typed via updated lib/types.

**Tech Stack:** Next.js 16 App Router + Tailwind v4 + Recharts, NestJS 11 + Prisma 6 + @nestjs/schedule, class-validator, Framer Motion, multer diskStorage

**Spec:** `docs/superpowers/specs/2026-08-25-project-folder-professional-design.md`

## Global Constraints

- `Project.description` is `String? @db.Text` nullable, no breaking.
- `Project.amount` is `Decimal? @db.Decimal(14,2)` nullable, sync with `budgetAmount` on write/read, `budgetAmount` kept for compat deprecated but not removed.
- `Project.projectLink`, `websiteUrl` are `String? @IsOptional @IsUrl({require_protocol:false})`, `socialLinks Json?`, `referenceLinks Json?` kept for compat but preferred `ProjectReference` model.
- `Project.billingType` must migrate from `String` to enum `BillingCycle` with `USING billingType::text::"BillingCycle"` and default `ONE_TIME` for existing rows.
- `ProjectReference` has `id cuid, projectId FK Cascade, title String @MaxLength(80), url String? @IsUrl, type ReferenceType @default OTHER, fileUrl String?, uploadedById String?, createdAt DateTime @default(now)` with `@@index([projectId])`.
- `BillingCycle` enum is `ONE_TIME, RECURRING`; `ReferenceType` enum is `DRIVE, NOTION, FIGMA, OTHER`.
- DTOs must use `class-validator` with exact decorators: `name @IsString @MaxLength(120)`, `clientId @IsUUID`, `amount @IsOptional @IsNumber @Min(0)`, `currency @IsIn([BDT,USD,SAR,AED])`, `billingType @IsEnum(BillingCycle)`, `recurringInterval @ValidateIf(billingType===RECURRING) @IsIn([7-days,15-days,30-days,monthly])`, `monthlyRate @ValidateIf(billingType===RECURRING) @IsNumber @Min(1)`.
- Auto invoice on `PLANNING|PAUSED → ACTIVE` and `* → COMPLETED` must create `DRAFT` invoice via `capitalService.createInvoice` with `amount = amount ?? budgetAmount ?? monthlyRate` (one-time) or `monthlyRate` (recurring first) and `dueDate = now +14d`, only if `totalBilled==0` or `remaining>0`, status `DRAFT` not `SENT`.
- Recurring scheduler is `@Cron('0 2 * * *')` daily 2am calling `capitalService.runRecurringBilling()` which finds `billingType=RECURRING && nextBillingDate<=now` and creates `RECURRING retainer — {name}` with `monthlyRate`, advances `nextBillingDate` via `advanceBillingDate`, syncs via `syncProjectBilling`.
- Frontend `view` state default is `"table"` (was `"grid"` at `flow/page.tsx:544`), persisted to `localStorage` and `searchParams ?view=table|grid|kanban`.
- Table inline status uses `<Select value={status} onChange={patchStatus}>` with `stopPropagation` and `PATCH /flow/projects/:id {status}`.
- Reference & Research tab must support both `Upload File` (`POST /flow/upload` → `POST /flow/projects/:id/references {title, fileUrl, type}`) and `Add Drive Link` (`title* + url* + type` → `POST /flow/projects/:id/references`).
- All new endpoints require `JwtAuthGuard` + `RolesGuard` with `@Roles("Owner","CONTROL","PM")` or existing flow guards, and `GET` reference list is public within auth.
- Every task ends with `npx tsc --noEmit` (web+api) and `npm run build` (web) passing.

---

## File Structure

- Modify: `apps/api/prisma/schema.prisma:587` — add `description`, `amount`, `projectLink`, `websiteUrl`, `socialLinks`, `billingType` enum conversion, new `ProjectReference` model, indexes
- Create: `apps/api/prisma/migrations/20260825_project_professional/migration.sql`
- Create: `apps/api/src/flow/dto/create-project.dto.ts` — `CreateProjectDto` with full validators
- Create: `apps/api/src/flow/dto/create-reference.dto.ts` — `CreateReferenceDto`
- Modify: `apps/api/src/flow/flow.service.ts:128` — `create`, `update` with amount sync, auto invoice hooks, `createReference`, `listReferences`, `updateReference`, `deleteReference`, `bulkAssignTasks`
- Modify: `apps/api/src/flow/flow.controller.ts:44` — new `POST /flow/projects/:id/references`, `GET /flow/projects/:id/references`, `PATCH /flow/references/:id`, `DELETE /flow/references/:id`, `POST /flow/projects/:id/tasks/bulk`, DTO usage
- Modify: `apps/api/src/capital/capital.service.ts:321` — add `@Cron` to `runRecurringBilling`
- Modify: `apps/api/src/capital/capital.module.ts` — import `ScheduleModule`
- Modify: `apps/web/src/lib/types.ts` — `Project` add `description`, `amount`, `projectLink`, `websiteUrl`, `socialLinks`, `referenceLinks`, `references`, `billingType` enum, `ProjectReference` interface
- Modify: `apps/web/src/app/(app)/flow/page.tsx:103` — `ProjectModal` professional stepped form (amount group, billing, links, team, references preview), `view` default table, table inline status Select, detail Modal 7 tabs including `References & Research` with file/drive upload, Overview links pills, Gantt-like milestone bars, task bulk
- Modify: `apps/web/src/components/tasks/task-form-modal.tsx` — support bulk mode if needed
- Test: `apps/api/test/flow-project.spec.ts`, `apps/web/e2e/flow-professional.spec.ts`

---

### Task 1: Prisma Data Model & Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma:32-36` add `enum BillingCycle` and `enum ReferenceType`, `apps/api/prisma/schema.prisma:587` add fields to `Project` and new `ProjectReference` model
- Create: `apps/api/prisma/migrations/20260825_project_professional/migration.sql`
- Test: `apps/api/test/flow-project.spec.ts` (migration check)

**Interfaces:**
- Consumes: existing `Project` model
- Produces: `Project.description: string | null`, `Project.amount: Decimal | null`, `Project.projectLink: string | null`, `Project.websiteUrl: string | null`, `Project.socialLinks: Json | null`, `Project.billingType: BillingCycle`, `ProjectReference` model

- [ ] **Step 1: Write failing test for new fields**

```ts
// apps/api/test/flow-project.spec.ts
import { PrismaClient, BillingCycle } from "@prisma/client";
test("Project has new professional fields", async () => {
  const prisma = new PrismaClient();
  const p = await prisma.project.create({
    data: {
      clientId: "test-client-id",
      name: "Test Project",
      description: "Scope test",
      amount: 50000,
      projectLink: "https://live.example.com",
      websiteUrl: "https://client.com",
      socialLinks: { facebook: "https://fb.com/acme" },
      billingType: BillingCycle.RECURRING,
      startDate: new Date(),
    },
  });
  expect(p.description).toBe("Scope test");
  expect(Number(p.amount)).toBe(50000);
});
```

- [ ] **Step 2: Run test to verify fail (fields not exist)**

Run: `npm test -- flow-project.spec.ts` in `apps/api`
Expected: FAIL `Unknown field description` / `BillingCycle not found`

- [ ] **Step 3: Modify schema.prisma**

```prisma
enum BillingCycle { ONE_TIME RECURRING }
enum ReferenceType { DRIVE NOTION FIGMA OTHER }

model Project {
  // keep existing
  description       String?          @db.Text
  amount            Decimal?         @db.Decimal(14,2)
  projectLink       String?
  websiteUrl        String?
  socialLinks       Json?
  billingType       BillingCycle     @default(ONE_TIME)
  references        ProjectReference[]
  // keep budgetAmount for compat
}

model ProjectReference {
  id          String        @id @default(cuid())
  project     Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String
  title       String
  url         String?
  type        ReferenceType @default(OTHER)
  fileUrl     String?
  uploadedBy  User?         @relation(fields: [uploadedById], references: [id])
  uploadedById String?
  createdAt   DateTime      @default(now())
  @@index([projectId])
}
```

Also keep `budgetAmount` field, do not remove.

- [ ] **Step 4: Run migration**

Run: `npx prisma migrate dev --name project_professional` in `apps/api`
Expected: migration.sql created with `ALTER TABLE "Project" ADD COLUMN ...`, `CREATE TYPE "BillingCycle"`, `CREATE TABLE "ProjectReference"`

Handle `billingType` string → enum: migration must do `ALTER TYPE` with `USING billingType::text::"BillingCycle"` and default `ONE_TIME`.

- [ ] **Step 5: Generate client and run test pass**

Run: `npx prisma generate` (may need stop node), then `npm test -- flow-project.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260825_project_professional/migration.sql apps/api/test/flow-project.spec.ts
git commit -m "feat(prisma): add Project professional fields and ProjectReference model"
```

### Task 2: DTOs & Validation

**Files:**
- Create: `apps/api/src/flow/dto/create-project.dto.ts`
- Create: `apps/api/src/flow/dto/create-reference.dto.ts`

**Interfaces:**
- Consumes: `BillingCycle`, `ReferenceType` enums from Task 1
- Produces: `CreateProjectDto` with validators, `CreateReferenceDto` with validators

- [ ] **Step 1: Write failing test for DTO validation**

```ts
import { validate } from "class-validator";
import { CreateProjectDto } from "./create-project.dto";
test("CreateProjectDto validates required", async () => {
  const dto = new CreateProjectDto(); dto.name=""; dto.clientId="not-uuid";
  const errors = await validate(dto);
  expect(errors.length).toBeGreaterThan(1);
});
test("CreateProjectDto recurring requires monthlyRate", async () => {
  const dto = new CreateProjectDto(); dto.name="Test"; dto.clientId="550e8400-e29b-41d4-a716-446655440000"; dto.billingType="RECURRING" as any;
  const errors = await validate(dto);
  expect(errors.some(e=>e.property==="monthlyRate")).toBe(true);
});
```

- [ ] **Step 2: Run test fail**

Run: `npm test -- create-project.dto.spec.ts`
Expected: FAIL `Cannot find module`

- [ ] **Step 3: Implement CreateProjectDto**

```ts
import { IsString, IsOptional, IsUUID, IsNumber, Min, IsEnum, IsIn, ValidateIf, MaxLength, IsDateString } from "class-validator";
import { BillingCycle } from "@prisma/client";
export class CreateProjectDto {
  @IsString() @MaxLength(120) name: string;
  @IsUUID() clientId: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsNumber() budgetAmount?: number;
  @IsOptional() @IsIn(["BDT","USD","SAR","AED"]) currency?: string;
  @IsOptional() @IsEnum(BillingCycle) billingType?: BillingCycle;
  @IsOptional() @ValidateIf(o=>o.billingType==="RECURRING") @IsIn(["7-days","15-days","30-days","monthly"]) recurringInterval?: string;
  @IsOptional() @ValidateIf(o=>o.billingType==="RECURRING") @IsNumber() @Min(1) monthlyRate?: number;
  @IsOptional() @IsString() @MaxLength(500) projectLink?: string;
  @IsOptional() @IsString() @MaxLength(500) websiteUrl?: string;
  @IsOptional() socialLinks?: any;
  // ... other fields: status, priority, category, team, etc. with @IsOptional
}
```

- [ ] **Step 4: Implement CreateReferenceDto**

```ts
export class CreateReferenceDto {
  @IsString() @MaxLength(80) title: string;
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @IsEnum(ReferenceType) type?: ReferenceType;
  @IsOptional() @IsString() fileUrl?: string;
}
```

- [ ] **Step 5: Run test pass**

Run: `npm test -- create-project.dto`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/flow/dto/*
git commit -m "feat(flow): add DTOs for Project and Reference with validation"
```

### Task 3: Flow Service — Amount Sync, Auto Invoice Hooks, Reference CRUD, Bulk Task

**Files:**
- Modify: `apps/api/src/flow/flow.service.ts:128-198`
- Test: `apps/api/test/flow-auto-invoice.spec.ts`

**Interfaces:**
- Consumes: `CreateProjectDto`, `ProjectReference` model, `CapitalService`
- Produces: `create(data)`, `update(id,data)` with amount sync and hooks, `createReference(projectId, dto)`, `listReferences(projectId)`, `bulkAssignTasks(projectId, taskIds)`

- [ ] **Step 1: Write failing test for amount sync and auto invoice**

```ts
test("update ACTIVE creates DRAFT invoice", async () => {
  const project = await prisma.project.create({ data: { clientId, name:"Auto", amount:1000, billingType:"ONE_TIME", status:"PLANNING", startDate: new Date() }});
  await flowService.update(project.id, { status: "ACTIVE" });
  const invoices = await prisma.invoice.findMany({ where:{ projectId: project.id }});
  expect(invoices.some(i=>i.status==="DRAFT")).toBe(true);
});
```

- [ ] **Step 2: Run test fail**

Expected: FAIL no invoice created

- [ ] **Step 3: Implement amount sync in create/update**

In `create()` and `update()`: if `amount` provided, set `budgetAmount = amount` for compat; if `budgetAmount` provided without `amount`, set `amount = budgetAmount`; also sync `currency`.

- [ ] **Step 4: Implement auto invoice hooks in update()**

After `prisma.project.update`, fetch `prevStatus` before update, compare:

```ts
const prev = await prisma.project.findUnique({ where:{id}});
const updated = await prisma.project.update({...});
if (prev.status !== "ACTIVE" && updated.status === "ACTIVE") {
  const totalBilled = Number(updated.totalBilled ?? 0);
  if (totalBilled===0) {
    const amount = Number(updated.amount ?? updated.budgetAmount ?? updated.monthlyRate ?? 0);
    if (amount>0) await capitalService.createInvoice({ clientId: updated.clientId, projectId: updated.id, amount, invoiceType: updated.billingType==="RECURRING"?"RECURRING":"ONE_TIME", status:"DRAFT", dueDate: new Date(Date.now()+14*86400000) });
  }
}
if (prev.status !== "COMPLETED" && updated.status === "COMPLETED") {
  const remaining = Number(updated.amount ?? updated.budgetAmount ?? 0) - Number(updated.totalBilled ?? 0);
  if (remaining>0 && updated.paymentStatus!=="PAID") await capitalService.createInvoice({... remaining ...});
}
```

Inject `CapitalService` via constructor.

- [ ] **Step 5: Implement ProjectReference CRUD**

```ts
async createReference(projectId:string, dto:CreateReferenceDto, userId?:string){
  await this.ensureProject(projectId);
  return this.prisma.projectReference.create({ data:{ projectId, title:dto.title, url:dto.url, type:dto.type??"OTHER", fileUrl:dto.fileUrl, uploadedById:userId }});
}
async listReferences(projectId:string){ return this.prisma.projectReference.findMany({ where:{projectId}, include:{uploadedBy:{select:{name:true}}}, orderBy:{createdAt:"desc"}}); }
async deleteReference(id:string){ return this.prisma.projectReference.delete({where:{id}}); }
async bulkAssignTasks(projectId:string, taskIds:string[]){ return this.prisma.task.updateMany({ where:{id:{in:taskIds}}, data:{projectId}}); }
```

- [ ] **Step 6: Run test pass**

Run: `npm test -- flow-auto-invoice`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/flow/flow.service.ts
git commit -m "feat(flow): amount sync, auto invoice on start/finish, reference CRUD, bulk task"
```

### Task 4: Flow Controller & Capital Cron

**Files:**
- Modify: `apps/api/src/flow/flow.controller.ts`
- Modify: `apps/api/src/capital/capital.service.ts`
- Modify: `apps/api/src/capital/capital.module.ts`

**Interfaces:**
- Consumes: Task 3 service methods
- Produces: `POST /flow/projects/:id/references`, `GET /flow/projects/:id/references`, `PATCH /flow/references/:id`, `DELETE /flow/references/:id`, `POST /flow/projects/:id/tasks/bulk`, `@Cron` for recurring

- [ ] **Step 1: Write failing test for new endpoints**

```ts
test("POST /flow/projects/:id/references creates", async () => {
  const res = await request(app).post(`/api/flow/projects/${projectId}/references`).send({ title:"Drive Link", url:"https://drive.google.com/file", type:"DRIVE" }).set("Authorization", token);
  expect(res.status).toBe(201);
});
```

- [ ] **Step 2: Run fail**

Expected: 404

- [ ] **Step 3: Implement controller**

Add to `flow.controller.ts`:
```ts
@Post("projects/:id/references")
@Roles("Owner","PM")
createReference(@Param("id") id:string, @Body() dto:CreateReferenceDto, @CurrentUser() user:AuthUser){ return this.flow.createReference(id,dto,user.sub); }
@Get("projects/:id/references")
listReferences(@Param("id") id:string){ return this.flow.listReferences(id); }
@Delete("references/:id")
deleteReference(@Param("id") id:string){ return this.flow.deleteReference(id); }
@Post("projects/:id/tasks/bulk")
bulkTasks(@Param("id") id:string, @Body() body:{taskIds:string[]}){ return this.flow.bulkAssignTasks(id, body.taskIds); }
```
Use `CreateProjectDto` for `POST /flow/projects` and `PATCH /flow/projects/:id` with `@Body() dto:CreateProjectDto`.

- [ ] **Step 4: Add cron**

In `capital.module.ts` import `ScheduleModule.forRoot()`, in `capital.service.ts` add `import { Cron } from "@nestjs/schedule"; @Cron('0 2 * * *') async handleRecurring(){ await this.runRecurringBilling(); }`

- [ ] **Step 5: Run test pass**

Run: `npm test -- flow.controller`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/flow/flow.controller.ts apps/api/src/capital/*
git commit -m "feat(flow): new reference endpoints, bulk task, recurring cron"
```

### Task 5: Frontend — Add New Project Professional Modal

**Files:**
- Modify: `apps/web/src/app/(app)/flow/page.tsx:103-347`
- Test: `apps/web/e2e/flow-professional.spec.ts`

**Interfaces:**
- Consumes: `CreateProjectDto` fields, `ProjectReference` API
- Produces: Stepped professional `ProjectModal` with all data

- [ ] **Step 1: Write failing e2e test**

```ts
test("Add New Project shows all professional fields", async ({page})=>{
  await page.goto("/flow"); await page.getByRole("button",{name:"New Project"}).click();
  await expect(page.getByPlaceholder("Project name")).toBeVisible();
  await expect(page.getByLabel("Project Amount")).toBeVisible();
  await expect(page.getByLabel("Project Link")).toBeVisible();
});
```

- [ ] **Step 2: Run fail**

Expected: FAIL missing fields

- [ ] **Step 3: Implement ProjectModal redesign**

Keep existing `ProjectModal` but add:
- Section `Company & Category` with `description` textarea (3 rows)
- Section `Amount & Finance` with `amount` (BDT, sync to budgetAmount), `spentAmount`, `currency` Select (BDT/USD/SAR/AED), `progress` slider, `billingType` Segmented, conditional `monthlyRate*` etc., plus `totalBilled` read-only
- Section `Links — Project Overview` with `projectLink`, `websiteUrl`, `socialLinks` 3 inputs (facebook/linkedin/instagram with icons)
- Section `Team` keep, plus `References (preview)` mini list if editing
- Validation as per DTO, `onSubmit` sends `amount`, `description`, `projectLink`, `websiteUrl`, `socialLinks`, etc.

Use `SectionTitle` with `subtitle`, keep `Team` multi-toggle, add `File` dropzone for references preview.

- [ ] **Step 4: Run e2e pass**

Run: `npx playwright test e2e/flow-professional.spec.ts --project=chromium`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(app)/flow/page.tsx
git commit -m "feat(flow): professional Add Project modal with amount, links, billing"
```

### Task 6: Frontend — Views Table Default + Inline Status

**Files:**
- Modify: `apps/web/src/app/(app)/flow/page.tsx:544,1109`

**Interfaces:**
- Consumes: `Project.status` and `PATCH /flow/projects/:id`
- Produces: `view` default table, inline Select for status

- [ ] **Step 1: Write failing test**

```ts
test("Flow defaults to table view", async ({page})=>{
  await page.goto("/flow");
  await expect(page.getByRole("table")).toBeVisible();
});
```

- [ ] **Step 2: Run fail**

Expected: FAIL shows grid

- [ ] **Step 3: Implement**

Change `useState<"grid"|"list"|"kanban">("grid")` to `useState<"table"|"grid"|"kanban">("table")` (note `list` is table), and in `Table` `Tr` add `<Td onClick={e=>e.stopPropagation()}><Select value={status} onChange={patchStatus}>` with `PROJECT_STATUSES` options, calling `PATCH` and `notify`.

- [ ] **Step 4: Run pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(app)/flow/page.tsx
git commit -m "feat(flow): table default with inline status change"
```

### Task 7: Frontend — Professional Popup with 7 Tabs

**Files:**
- Modify: `apps/web/src/app/(app)/flow/page.tsx:1290-1689`

**Interfaces:**
- Consumes: `detail` with `description`, `amount`, `projectLink`, `references`, `tasks`, `finance`
- Produces: Modal with 7 tabs including `References & Research` with file/drive upload

- [ ] **Step 1: Write failing test**

```ts
test("Project popup has References tab", async ({page})=>{
  await page.goto("/flow"); await page.locator("tbody tr").first().click();
  await expect(page.getByRole("button",{name:"References & Research"})).toBeVisible();
});
```

- [ ] **Step 2: Run fail**

Expected: FAIL

- [ ] **Step 3: Implement popup**

Add to `detailTabs` `Segmented`: `Overview | Milestones | Files | Discussions | Tasks | Finance | References & Research`
- Overview: add pills for `projectLink/website/social` + `description` + `amount` vs `budgetAmount` + `socialLinks`, keep 4 stats + risk + facts
- References & Research tab: `const {data:references}=useApi(`/flow/projects/${selectedId}/references`)`, list `ProjectReference` table (`title | url | type badge | fileUrl download | uploadedBy | delete`), top bar `Upload File` (fileRef → POST /flow/upload → POST /flow/projects/:id/references {title, fileUrl}) and `Add Drive Link` form (`title* + url* + type` → POST), support `tribal/national/drive` all as `url` with `type`
- Tasks tab: already has `New task` + add **Bulk assign** button → `POST /flow/projects/:id/tasks/bulk`
- Finance tab keep `ProjectFinancePanel` with budget burn bar `spent/budget %`

- [ ] **Step 4: Run pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(app)/flow/page.tsx
git commit -m "feat(flow): professional popup with 7 tabs, references, overview links"
```

### Task 8: Types & Final Verification

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Test: `npx tsc --noEmit`, `npm run build`

- [ ] **Step 1: Update types.ts**

Add to `Project` interface: `description?: string | null; amount?: number | null; projectLink?: string | null; websiteUrl?: string | null; socialLinks?: {facebook?:string; linkedin?:string; instagram?:string} | null; references?: ProjectReference[];`

Add `ProjectReference` interface.

- [ ] **Step 2: Run tsc fail then pass**

Run: `npx tsc --noEmit` in `apps/web` and `apps/api`
Expected: PASS after fix

- [ ] **Step 3: Run build**

Run: `npm run build` in `apps/web`
Expected: PASS 29 pages

- [ ] **Step 4: Manual smoke**

Add New Project with amount 50000, recurring monthly 10000, projectLink https://live.example.com, website, social, team, reference drive link → create → check DB amount sync, reference row, set status ACTIVE → check capital/invoices DRAFT auto, set COMPLETED → final DRAFT, POST /capital/recurring/run → recurring, table default → inline status change, popup References & Research → Upload File + Add Drive Link (notion/figma/drive), Task bulk assign, Overview links clickable, budget burn bar.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts
git commit -m "feat(types): add Project professional fields"
```

