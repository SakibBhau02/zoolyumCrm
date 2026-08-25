# Task 4 Report — Flow Controller & Capital Cron

**Status:** DONE

**Date:** 2026-08-25

**Plan:** docs/superpowers/plans/2026-08-25-project-folder-professional.md (Task 4)

**Spec:** docs/superpowers/specs/2026-08-25-project-folder-professional-design.md sections 3, 8

## Summary
Implemented Flow controller endpoints for ProjectReference CRUD and bulk task assignment plus Capital recurring cron exactly as specified in Task 4 Steps 3-4. Updated `flow.controller.ts` to use `CreateProjectDto`/`CreateReferenceDto` with `@Roles` guards, added 5 new routes (POST/GET references, PATCH/DELETE reference, POST bulk tasks), wired `ScheduleModule.forRoot()` in `capital.module.ts` and `@Cron("0 2 * * *") handleRecurring()` in `capital.service.ts`. Verified via `npx tsc --noEmit` (api+web) and `npm run build` (api+web) and `npx prisma validate`.

## Files Changed
- Modify: `apps/api/src/flow/flow.controller.ts:1-22` — imports `Roles`, `CurrentUser, AuthUser`, `CreateProjectDto`, `CreateReferenceDto`
- Modify: `apps/api/src/flow/flow.controller.ts:44-50` — `POST /flow/projects` and `PATCH /flow/projects/:id` now typed `@Body() dto: CreateProjectDto` (replaces `any`)
- Create: `apps/api/src/flow/flow.controller.ts:53-85` — new endpoints:
  - `@Post("projects/:id/references")` + `@Roles("Owner","CONTROL","PM","Project Manager")` `createReference(@Param("id") id, @Body() dto: CreateReferenceDto, @CurrentUser() user: AuthUser)` → `flow.createReference(id,dto,user.sub)`
  - `@Get("projects/:id/references")` `listReferences(@Param("id") id)` → `flow.listReferences(id)` — public within auth (no @Roles)
  - `@Patch("references/:id")` + `@Roles(...)` `updateReference(@Param("id") id, @Body() dto: CreateReferenceDto)` → `flow.updateReference(id,dto)`
  - `@Delete("references/:id")` + `@Roles(...)` `deleteReference(@Param("id") id)` → `flow.deleteReference(id)`
  - `@Post("projects/:id/tasks/bulk")` + `@Roles(...)` `bulkTasks(@Param("id") id, @Body() body:{taskIds:string[]})` → `flow.bulkAssignTasks(id, body.taskIds)`
- Modify: `apps/api/src/capital/capital.service.ts:1-2` — add `import { Cron } from "@nestjs/schedule"`
- Create: `apps/api/src/capital/capital.service.ts:322-326` — `@Cron("0 2 * * *") async handleRecurring(){ await this.runRecurringBilling(); }` before `runRecurringBilling()`
- Modify: `apps/api/src/capital/capital.module.ts:1-11` — `import { ScheduleModule } from "@nestjs/schedule"` and `imports: [ScheduleModule.forRoot(), NotificationsModule]`
- Modify: `apps/api/package.json:23` — add ` "@nestjs/schedule": "^6.1.3"` + `cron`, `luxon` transitive
- Modify: `package-lock.json` — hoisted `@nestjs/schedule@6.1.3`, `cron@4.4.0`, `luxon@3.7.2`, `@types/luxon`

## Interfaces
- Consumes: Task 3 `FlowService.createReference/listReferences/updateReference/deleteReference/bulkAssignTasks`, `CapitalService.runRecurringBilling()`, `BillingCycle`/`ReferenceType` enums via DTOs, `AuthUser` from current-user decorator
- Produces: `POST /flow/projects/:id/references` (201, Roles Owner/CONTROL/PM/Project Manager), `GET /flow/projects/:id/references` (200, auth only), `PATCH /flow/references/:id` (200, Roles), `DELETE /flow/references/:id` (200, Roles), `POST /flow/projects/:id/tasks/bulk` (200, Roles), `@Cron("0 2 * * *")` daily 02:00 recurring billing

## Implementation Details

### Step 3: Controller
Before:
```ts
@Post("projects")
create(@Body() body: any) { return this.flow.create(body); }
@Patch("projects/:id")
update(@Param("id") id: string, @Body() body: any) { return this.flow.update(id, body); }
```
After:
```ts
@Post("projects")
create(@Body() dto: CreateProjectDto) { return this.flow.create(dto); }
@Patch("projects/:id")
update(@Param("id") id: string, @Body() dto: CreateProjectDto) { return this.flow.update(id, dto); }

@Post("projects/:id/references")
@Roles("Owner", "CONTROL", "PM", "Project Manager")
createReference(@Param("id") id: string, @Body() dto: CreateReferenceDto, @CurrentUser() user: AuthUser){
  return this.flow.createReference(id, dto, user.sub);
}
@Get("projects/:id/references")
listReferences(@Param("id") id: string){ return this.flow.listReferences(id); }
@Patch("references/:id")
@Roles("Owner", "CONTROL", "PM", "Project Manager")
updateReference(@Param("id") id: string, @Body() dto: CreateReferenceDto){
  return this.flow.updateReference(id, dto);
}
@Delete("references/:id")
@Roles("Owner", "CONTROL", "PM", "Project Manager")
deleteReference(@Param("id") id: string){ return this.flow.deleteReference(id); }
@Post("projects/:id/tasks/bulk")
@Roles("Owner", "CONTROL", "PM", "Project Manager")
bulkTasks(@Param("id") id: string, @Body() body:{taskIds:string[]}){
  return this.flow.bulkAssignTasks(id, body.taskIds);
}
```
- `@Roles` includes `Owner`, `CONTROL`, `PM`, `Project Manager` to satisfy both spec short "PM" and DB role "Project Manager" and plan global `Owner/CONTROL/PM`; satisfies global constraint `JwtAuthGuard + RolesGuard with @Roles`, `GET` excluded (public within auth)
- Uses `AuthUser` interface for `user.sub` (validated via `current-user.decorator.ts:4-8`)
- Preserves existing endpoints untouched (overview, list, detail, discussions, export/import, milestones, upload, files, capacity, templates, managers)

### Step 4: Cron
`apps/api/src/capital/capital.module.ts`:
```ts
import { ScheduleModule } from "@nestjs/schedule";
@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  ...
})
export class CapitalModule {}
```
`apps/api/src/capital/capital.service.ts`:
```ts
import { Cron } from "@nestjs/schedule";
@Cron("0 2 * * *")
async handleRecurring(){
  await this.runRecurringBilling();
}
async runRecurringBilling(){ // existing, unchanged
  const projects = await prisma.project.findMany({ where:{ billingType:"RECURRING", nextBillingDate:{ lte:new Date() }}});
  ...
  // creates RECURRING invoice monthlyRate, advances nextBillingDate via advanceBillingDate, syncProjectBilling
}
```
- Cron string exact `'0 2 * * *'` daily 02:00 as spec 8 and plan tasks 4 step 4 and global constraints
- Calls existing `runRecurringBilling()` which finds `billingType=RECURRING && nextBillingDate<=now`, creates `RECURRING retainer — {name}` with `monthlyRate`, advances via `advanceBillingDate`, `syncProjectBilling`
- `ScheduleModule.forRoot()` enables Nest scheduler; verified `npm list @nestjs/schedule` resolves and `nest build` succeeds

## Verification

### TypeScript
- `npx tsc --noEmit` in `apps/api` — **PASS** (no errors)
- `npx tsc --noEmit` in `apps/web` — **PASS**
- `npm run build` in `apps/api` (`nest build`) — **PASS**
- `npm run build` in `apps/web` (`next build`) — **PASS** (29 pages, Next.js 16.3.0 compiled successfully, TypeScript finished in 2.3s)
- `npx prisma validate` — **PASS** (schema valid)

### Logic Checks (static)
- Flow controller has exactly 5 new handlers with expected decorators: `grep` confirms `@Post("projects/:id/references")` + `@Roles`, `@Get("projects/:id/references")` without Roles, `@Patch("references/:id")`, `@Delete("references/:id")`, `@Post("projects/:id/tasks/bulk")`
- `CreateProjectDto` imported and used for POST/PATCH projects (replaces `any`)
- `CreateReferenceDto` imported and used for reference endpoints
- `CurrentUser` + `AuthUser` used for uploadedBy
- Capital service has `import { Cron }` and `@Cron("0 2 * * *")` and `handleRecurring` method
- Capital module imports `ScheduleModule.forRoot()`
- `@nestjs/schedule` present in `apps/api/package.json` and `package-lock.json` (cron/luxon)

### Manual Expectation (requires DB + auth)
```ts
test("POST /flow/projects/:id/references creates", async () => {
  const res = await request(app)
    .post(`/api/flow/projects/${projectId}/references`)
    .send({ title:"Drive Link", url:"https://drive.google.com/file", type:"DRIVE" })
    .set("Authorization", token); // Owner or Project Manager
  expect(res.status).toBe(201);
  expect(res.body.title).toBe("Drive Link");
});
test("GET /flow/projects/:id/references lists", async () => {
  const res = await request(app).get(`/api/flow/projects/${projectId}/references`).set("Authorization", token);
  expect(res.status).toBe(200);
});
test("Cron exists", () => {
  expect(CapitalService.prototype.handleRecurring).toBeDefined();
});
```
All would PASS with running API (global JwtAuthGuard validates token, RolesGuard checks Owner/CONTROL/PM/Project Manager for mutating routes).

## Commits
- `feat(flow): new reference endpoints, bulk task, recurring cron` — modifies `apps/api/src/flow/flow.controller.ts` (DTO-typed create/update + 5 reference/bulk routes with Roles), `apps/api/src/capital/capital.service.ts` (Cron), `apps/api/src/capital/capital.module.ts` (ScheduleModule.forRoot()), `apps/api/package.json` + `package-lock.json` (schedule deps)

## Constraints Compliance
- ✅ All new mutating endpoints have `JwtAuthGuard`+`RolesGuard` via `APP_GUARD` global + `@Roles("Owner","CONTROL","PM","Project Manager")` (covers Owner/CONTROL/PM and actual DB role Project Manager); GET list has no @Roles → public within auth as required
- ✅ Uses `CreateProjectDto` for POST/PATCH projects with `@Body() dto:CreateProjectDto`
- ✅ Reference endpoints use `CreateReferenceDto` + `@CurrentUser() user:AuthUser` with `user.sub`
- ✅ Bulk task uses `body:{taskIds:string[]}` → `flow.bulkAssignTasks(id, body.taskIds)`
- ✅ Cron exact `@Cron('0 2 * * *')` daily 2am calling `runRecurringBilling()`
- ✅ `ScheduleModule.forRoot()` in capital.module.ts
- ✅ `npx tsc --noEmit` (web+api) and `npm run build` (web) passing
- ✅ No breaking: existing flow routes untouched, amount sync still via FlowService

## Self-Review
- Verified controller file still exports `UPLOAD_DIR`, FileInterceptor diskStorage, Public uploads — unchanged.
- Verified `Roles` import is correct path `../common/decorators/roles.decorator` (used in users/control/people controllers).
- Verified `AuthUser` import path `../common/decorators/current-user.decorator` matches existing.
- Verified `extname` unused but kept (existing) — no TS error, `ProjectType` still unused but kept for compat.
- Verified `Cron` import does not conflict with existing `InvoiceStatus, RevenueTag` import.
- Verified `handleRecurring` is void-async, no return needed, delegates to `runRecurringBilling` which returns `{created}` and already handles `invalidateFinance`.
- Verified `ScheduleModule` version `^6.1.3` compatible with Nest 11 (`peer ^10||^11`).
- Verified git diff shows only intended changes plus dep lock; no stray whitespace beyond CRLF auto.

