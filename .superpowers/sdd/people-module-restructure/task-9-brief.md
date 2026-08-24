# Task 9 Brief: Rewire module, controller, iclock controller; delete old service

Plan: docs/superpowers/plans/2026-08-20-people-module-restructure.md (Task 9)
Spec: docs/superpowers/specs/2026-08-20-people-module-restructure-design.md

## Files

- Modify: `apps/api/src/people/people.module.ts`
- Rewrite: `apps/api/src/people/people.controller.ts`
- Rewrite: `apps/api/src/people/iclock.controller.ts`
- Delete: `apps/api/src/people/people.service.ts`

## Global constraints

- TypeScript strict. API build: `npm run build` (workdir `apps/api`).
- API routes MUST NOT change: every route path, HTTP method, query/body shape, and @Roles
  guard stays identical. This is the last task that can be verified purely by compile; the
  route surface is the contract.
- No git repo — do not commit. Verify by running the build, then by restarting the API and
  hitting the smoke endpoints listed below.
- Do NOT dispatch subagents.

## Context

Tasks 1-8 created 7 services in `apps/api/src/people/`:
- `DirectoryService` (directory.service.ts): overview, employees, employeeDetail, createEmployee, updateEmployee, deleteEmployee, orgChart, skillsMatrix, utilizationTrend
- `AttendanceService` (attendance.service.ts): attendancePolicy, updateAttendancePolicy, importPunches, iclockGetRequest, iclockPushData, punches, mapPunch, kioskPunch, recomputeMonth, correctAttendance, attendanceReport, lateList, recordAttendance, attendanceMonth, attendanceSummary, holidays, createHoliday, deleteHoliday
- `LeaveService` (leave.service.ts): leaveRequests, applyLeave, approveLeave, leaveBalances
- `PayrollService` (payroll.service.ts): payroll, runPayroll, updatePayrollStatus, payslip
- `PerformanceService` (performance.service.ts): reviews, createReview, updateReview, okrs, createOkr, updateOkr, deleteOkr
- `TrainingService` (training.service.ts): courses, createCourse, deleteCourse, enrollments, createEnrollment, updateEnrollment
- `RecruitmentService` (recruitment.service.ts): candidates, createCandidate, updateCandidate, deleteCandidate

## Step 1: Rewrite `people.module.ts`

```ts
import { Module } from "@nestjs/common";
import { DirectoryService } from "./directory.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { PayrollService } from "./payroll.service";
import { PerformanceService } from "./performance.service";
import { TrainingService } from "./training.service";
import { RecruitmentService } from "./recruitment.service";
import { PeopleController } from "./people.controller";
import { IclockController } from "./iclock.controller";
import { CapitalModule } from "../capital/capital.module";

@Module({
  imports: [CapitalModule],
  controllers: [PeopleController, IclockController],
  providers: [DirectoryService, AttendanceService, LeaveService, PayrollService, PerformanceService, TrainingService, RecruitmentService],
})
export class PeopleModule {}
```

## Step 2: Rewrite `people.controller.ts`

Keep every route decorator and guard exactly as the current file has them (read it first —
`apps/api/src/people/people.controller.ts`, 265 lines). Only the constructor changes, plus
each handler body delegates to the right service property. Exact full content:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { DirectoryService } from "./directory.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { PayrollService } from "./payroll.service";
import { PerformanceService } from "./performance.service";
import { TrainingService } from "./training.service";
import { RecruitmentService } from "./recruitment.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";

const HR_ROLES = ["Owner", "HR/Admin"];

@Controller("people")
export class PeopleController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly payroll: PayrollService,
    private readonly performance: PerformanceService,
    private readonly training: TrainingService,
    private readonly recruitment: RecruitmentService
  ) {}

  @Get("overview")
  overview() {
    return this.directory.overview();
  }

  @Get("employees")
  employees() {
    return this.directory.employees();
  }

  @Get("employees/:id")
  employeeDetail(@Param("id") id: string) {
    return this.directory.employeeDetail(id);
  }

  @Post("employees")
  createEmployee(@Body() body: any, @CurrentUser() user: any) {
    return this.directory.createEmployee(body, user);
  }

  @Patch("employees/:id")
  updateEmployee(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.directory.updateEmployee(id, body, user);
  }

  @Delete("employees/:id")
  deleteEmployee(@Param("id") id: string) {
    return this.directory.deleteEmployee(id);
  }

  @Get("utilization")
  utilizationTrend() {
    return this.directory.utilizationTrend();
  }

  @Get("attendance")
  attendanceMonth(@Query("month") month: string) {
    return this.attendance.attendanceMonth(month);
  }

  @Get("attendance/summary")
  attendanceSummary(@Query("month") month: string) {
    return this.attendance.attendanceSummary(month);
  }

  @Post("attendance")
  recordAttendance(@Body() body: any) {
    return this.attendance.recordAttendance(body);
  }

  @Post("attendance/kiosk")
  kioskPunch(@Body() body: { action?: string }, @CurrentUser() user: any) {
    return this.attendance.kioskPunch(user, body.action === "out" ? "out" : "in");
  }

  @Post("attendance/recompute")
  recomputeAttendance(@Body() body: { month: string }) {
    return this.attendance.recomputeMonth(body.month);
  }

  @Patch("attendance/:id/correct")
  correctAttendance(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.attendance.correctAttendance(id, body, user);
  }

  @Get("attendance/report")
  attendanceReport(@Query("month") month: string) {
    return this.attendance.attendanceReport(month);
  }

  @Get("attendance/late-list")
  lateList(@Query("month") month: string) {
    return this.attendance.lateList(month);
  }

  @Get("attendance-policy")
  @Roles(...HR_ROLES)
  attendancePolicy() {
    return this.attendance.attendancePolicy();
  }

  @Patch("attendance-policy")
  @Roles(...HR_ROLES)
  updateAttendancePolicy(@Body() body: any) {
    return this.attendance.updateAttendancePolicy(body);
  }

  @Get("punches")
  punches(@Query("month") month: string, @Query("unmatched") unmatched: string) {
    return this.attendance.punches(month, unmatched === "true");
  }

  @Post("punches/import")
  importPunches(@Body() body: { rows: any[] }) {
    return this.attendance.importPunches(body.rows ?? []);
  }

  @Patch("punches/:id/map")
  mapPunch(@Param("id") id: string, @Body() body: { employeeId: string }) {
    return this.attendance.mapPunch(id, body.employeeId);
  }

  @Get("leave-requests")
  leaveRequests() {
    return this.leave.leaveRequests();
  }

  @Post("leave-requests")
  applyLeave(@Body() body: any) {
    return this.leave.applyLeave(body);
  }

  @Patch("leave-requests/:id")
  approveLeave(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leave.approveLeave(id, body.approved, user?.sub);
  }

  @Get("leave-balances")
  leaveBalances(@Query("employeeId") employeeId?: string) {
    return this.leave.leaveBalances(employeeId);
  }

  @Get("payroll")
  payroll(@Query("period") period?: string) {
    return this.payroll.payroll(period);
  }

  @Post("payroll/run")
  @Roles(...HR_ROLES)
  runPayroll(@Body() body: { period: string }) {
    return this.payroll.runPayroll(body.period);
  }

  @Patch("payroll/:id")
  @Roles(...HR_ROLES)
  updatePayrollStatus(@Param("id") id: string, @Body() body: { status: string }) {
    return this.payroll.updatePayrollStatus(id, body.status as any);
  }

  @Get("payroll/:id/payslip")
  payslip(@Param("id") id: string) {
    return this.payroll.payslip(id);
  }

  @Get("reviews")
  reviews() {
    return this.performance.reviews();
  }

  @Post("reviews")
  createReview(@Body() body: any, @CurrentUser() user: any) {
    return this.performance.createReview({ ...body, reviewedById: user?.sub });
  }

  @Patch("reviews/:id")
  updateReview(@Param("id") id: string, @Body() body: any) {
    return this.performance.updateReview(id, body);
  }

  @Get("okrs")
  okrs(@Query("employeeId") employeeId?: string) {
    return this.performance.okrs(employeeId);
  }

  @Post("okrs")
  createOkr(@Body() body: any) {
    return this.performance.createOkr(body);
  }

  @Patch("okrs/:id")
  updateOkr(@Param("id") id: string, @Body() body: any) {
    return this.performance.updateOkr(id, body);
  }

  @Delete("okrs/:id")
  deleteOkr(@Param("id") id: string) {
    return this.performance.deleteOkr(id);
  }

  @Get("courses")
  courses() {
    return this.training.courses();
  }

  @Post("courses")
  createCourse(@Body() body: any) {
    return this.training.createCourse(body);
  }

  @Delete("courses/:id")
  deleteCourse(@Param("id") id: string) {
    return this.training.deleteCourse(id);
  }

  @Get("enrollments")
  enrollments() {
    return this.training.enrollments();
  }

  @Post("enrollments")
  createEnrollment(@Body() body: any) {
    return this.training.createEnrollment(body);
  }

  @Patch("enrollments/:id")
  updateEnrollment(@Param("id") id: string, @Body() body: any) {
    return this.training.updateEnrollment(id, body);
  }

  @Get("candidates")
  candidates() {
    return this.recruitment.candidates();
  }

  @Post("candidates")
  createCandidate(@Body() body: any) {
    return this.recruitment.createCandidate(body);
  }

  @Patch("candidates/:id")
  updateCandidate(@Param("id") id: string, @Body() body: any) {
    return this.recruitment.updateCandidate(id, body);
  }

  @Delete("candidates/:id")
  deleteCandidate(@Param("id") id: string) {
    return this.recruitment.deleteCandidate(id);
  }

  @Get("holidays")
  holidays() {
    return this.attendance.holidays();
  }

  @Post("holidays")
  createHoliday(@Body() body: any) {
    return this.attendance.createHoliday(body);
  }

  @Delete("holidays/:id")
  deleteHoliday(@Param("id") id: string) {
    return this.attendance.deleteHoliday(id);
  }

  @Get("org-chart")
  orgChart() {
    return this.directory.orgChart();
  }

  @Get("skills-matrix")
  skillsMatrix() {
    return this.directory.skillsMatrix();
  }
}
```

Note the route decorators and guards are IDENTICAL to the current controller — only handler
delegation changed. Compare against the current file to be sure.

## Step 3: Rewrite `iclock.controller.ts`

```ts
import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { Public } from "../common/decorators/public.decorator";

// ZKTeco Push SDK protocol endpoints — the fingerprint device polls
// GET /api/iclock/getrequest?SN=xxx and POSTs punch logs to
// /api/iclock/cdata?SN=xxx&table=ATTLOG as tab-separated rows:
//   <PIN>\t<YYYY-MM-DD HH:MM:SS>\t<verify>\t<workcode>
// The device has no JWT, so these routes are @Public.
@Controller("iclock")
export class IclockController {
  constructor(private readonly attendance: AttendanceService) {}

  @Public()
  @Get("getrequest")
  getRequest(@Query("SN") sn: string) {
    return this.attendance.iclockGetRequest(sn);
  }

  @Public()
  @Get("devicecmd")
  deviceCmd(@Query("SN") sn: string) {
    return "OK";
  }

  @Public()
  @Post("cdata")
  async cdata(@Query("SN") sn: string, @Query("table") table: string, @Body() body: any) {
    let raw = typeof body === "string" ? body : "";
    if (!raw && body && typeof body === "object") {
      raw = Object.keys(body)
        .filter((k) => k.includes("\t") || k.includes("-"))
        .join("\n");
    }
    const reply = await this.attendance.iclockPushData(sn, table, raw);
    return reply;
  }
}
```

## Step 4: Delete `apps/api/src/people/people.service.ts`

After steps 1-3 compile, delete the old service file.

## Step 5: Verify compile

Run `npm run build` (workdir `apps/api`). Expected: succeeds with no errors.

## Step 6: Smoke-test the running API

The API server may be running already (watch mode) or not. Check if something is listening on
port 4000 (`http://localhost:4000/api`). If not, start it from the repo root:
`npm run dev` in a background process (log to `%TEMP%\dev-api.log`), wait until it responds.

Then verify these endpoints (use `curl` or `Invoke-RestMethod`):
1. Login as `sakib@zoolyum.com` / `zoolyum123` via `POST http://localhost:4000/api/auth/login`
   with JSON body `{"email":"sakib@zoolyum.com","password":"zoolyum123"}` — capture the
   access token from the response.
2. `GET http://localhost:4000/api/people/employees` with `Authorization: Bearer <token>` — 200, array of 10 employees.
3. `GET http://localhost:4000/api/people/attendance-policy` with token — 200, policy object with weeklyOffDays.
4. `POST http://localhost:4000/api/people/attendance/recompute` with token, body `{"month":"2026-08"}` — 200, `{"month":"2026-08","processed":<number>}`.
5. `GET http://localhost:4000/api/people/payroll?period=2026-08` with token — 200, array (records from the demo run).
6. `GET http://localhost:4000/api/iclock/getrequest?SN=x` — 200, body `OK` (no auth).
7. `GET http://localhost:4000/api/people/attendance/report?month=2026-08` with token — 200, array of report rows.

If the API was already running in watch mode, the code changes should hot-reload; if the
smoke fails with a stale-process error, restart it.

## Report

Write your full report to `.superpowers/sdd/people-module-restructure/task-9-report.md` then reply with:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Verification summary (one line per smoke endpoint, status codes)
- Concerns, if any
- The report file path