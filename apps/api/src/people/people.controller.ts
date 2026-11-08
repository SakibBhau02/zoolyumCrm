import { Body, BadRequestException, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { DirectoryService } from "./directory.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { PayrollService } from "./payroll.service";
import { PerformanceService } from "./performance.service";
import { TrainingService } from "./training.service";
import { RecruitmentService } from "./recruitment.service";
import { TeamService } from "./team.service";
import { PeopleAutomationService } from "./people-automation.service";
import { UtilizationService } from "./utilization.service";
import { MeService } from "./me.service";
import { OnboardingService } from "./onboarding.service";
import { AssetsService } from "./assets.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission, SkipPermission } from "../common/decorators/require-permission.decorator";

const HR_ROLES = ["Owner", "HR/Admin"];

@RequirePermission("PEOPLE")
@Controller("people")
export class PeopleController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly payrollService: PayrollService,
    private readonly performance: PerformanceService,
    private readonly training: TrainingService,
    private readonly recruitment: RecruitmentService,
    private readonly team: TeamService,
    private readonly automation: PeopleAutomationService,
    private readonly utilization: UtilizationService,
    private readonly me: MeService,
    private readonly onboarding: OnboardingService,
    private readonly assets: AssetsService
  ) {}

  @Get("overview")
  overview() {
    return this.directory.overview();
  }

  // ── My space (employee self-service, scoped to the token) ──────────────
  @SkipPermission()
  @Get("me")
  meDashboard(@CurrentUser() user: any, @Query("month") month?: string, @Query("days") days?: string) {
    return this.me.dashboard(user, { month: month && /^\d{4}-\d{2}$/.test(month) ? month : undefined, days: days ? Number(days) : undefined });
  }

  @SkipPermission()
  @Post("me/punch")
  mePunch(@Body() body: { action?: string }, @CurrentUser() user: any) {
    return this.attendance.kioskPunch(user, body.action === "out" ? "out" : "in", "self");
  }

  @SkipPermission()
  @Post("me/leave")
  meLeave(@Body() body: any, @CurrentUser() user: any) {
    return this.me.applyOwnLeave(user, body);
  }

  @SkipPermission()
  @Post("me/telegram")
  meTelegram(@CurrentUser() user: any) {
    return this.me.createTelegramLink(user);
  }

  @SkipPermission()
  @Delete("me/telegram")
  meTelegramOff(@CurrentUser() user: any) {
    return this.me.disconnectTelegram(user);
  }

  @SkipPermission()
  @Get("employees")
  employees(@CurrentUser() user: any) {
    return this.directory.employees(user);
  }

  @Get("employees/:id")
  employeeDetail(@Param("id") id: string, @CurrentUser() user: any) {
    return this.directory.employeeDetail(id, user);
  }

  @Post("employees")
  @Roles(...HR_ROLES)
  createEmployee(@Body() body: any, @CurrentUser() user: any) {
    return this.directory.createEmployee(body, user);
  }

  @Patch("employees/:id")
  updateEmployee(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.directory.updateEmployee(id, body, user);
  }

  @Delete("employees/:id")
  @Roles(...HR_ROLES)
  deleteEmployee(@Param("id") id: string) {
    return this.directory.deleteEmployee(id);
  }

  @Get("utilization")
  utilizationTrend() {
    return this.directory.utilizationTrend();
  }

  /** Rebuild utilization from time logs (normally the Monday 04:00 cron). */
  @Post("utilization/recompute")
  @Roles(...HR_ROLES)
  recomputeUtilization(@Query("weeks") weeks?: string) {
    return this.utilization.recompute(Math.min(Math.max(Number(weeks) || 8, 1), 26));
  }

  @Get("attendance")
  attendanceMonth(
    @Query("month") month?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.attendance.attendanceMonth({ month, days, from, to });
  }

  @Get("attendance/summary")
  attendanceSummary(@Query("month") month: string) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException("month is required in YYYY-MM format");
    }
    return this.attendance.attendanceSummary(month);
  }

  @SkipPermission()
  @Get("attendance/today")
  attendanceToday(@CurrentUser() user: any) {
    return this.attendance.todayStatus(user);
  }

  @Get("attendance/employee/:id")
  employeeAttendance(
    @Param("id") id: string,
    @Query("month") month?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : undefined;
    return this.attendance.employeeAttendance(id, { month: m, days, from, to });
  }

  @Post("attendance")
  @Roles(...HR_ROLES)
  recordAttendance(@Body() body: any) {
    return this.attendance.recordAttendance(body);
  }

  @Post("attendance/kiosk")
  kioskPunch(@Body() body: { action?: string; mode?: string }, @CurrentUser() user: any) {
    return this.attendance.kioskPunch(user, body.action === "out" ? "out" : "in", body.mode === "self" ? "self" : "kiosk");
  }

  @Post("attendance/recompute")
  @Roles(...HR_ROLES)
  recomputeAttendance(@Body() body: { month: string }) {
    return this.attendance.recomputeMonth(body.month);
  }

  @Patch("attendance/:id/correct")
  @Roles(...HR_ROLES)
  correctAttendance(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.attendance.correctAttendance(id, body, user);
  }

  @Get("attendance/report")
  attendanceReport(
    @Query("month") month?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.attendance.attendanceReport({ month, days, from, to });
  }

  @Get("attendance/live")
  attendanceLive() {
    return this.attendance.liveBoard();
  }

  @Get("attendance/trends")
  attendanceTrends(
    @Query("month") month?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.attendance.attendanceTrends({ month, days, from, to });
  }

  @Get("attendance/late-list")
  lateList(
    @Query("month") month?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.attendance.lateList({ month, days, from, to });
  }

  @Get("attendance/devices")
  @Roles(...HR_ROLES)
  attendanceDevices() {
    return this.attendance.listDevices();
  }

  @Patch("attendance/devices/:id")
  @Roles(...HR_ROLES)
  updateAttendanceDevice(@Param("id") id: string, @Body() body: { name?: string | null; location?: string | null; isActive?: boolean }) {
    return this.attendance.updateDevice(id, body);
  }

  @Delete("attendance/devices/:id")
  @Roles(...HR_ROLES)
  deleteAttendanceDevice(@Param("id") id: string) {
    return this.attendance.deleteDevice(id);
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
  @Roles(...HR_ROLES)
  importPunches(@Body() body: { rows: any[] }) {
    return this.attendance.importPunches(body.rows ?? []);
  }

  @Patch("punches/:id/map")
  @Roles(...HR_ROLES)
  mapPunch(@Param("id") id: string, @Body() body: { employeeId: string }) {
    return this.attendance.mapPunch(id, body.employeeId);
  }

  @Delete("punches/:id")
  @Roles(...HR_ROLES)
  deletePunch(@Param("id") id: string) {
    return this.attendance.deletePunch(id);
  }

  @Get("leave-requests")
  leaveRequests() {
    return this.leave.leaveRequests();
  }

  @Get("leave-requests/:id")
  leaveRequestDetail(@Param("id") id: string) {
    return this.leave.leaveRequestDetail(id);
  }

  @Post("leave-requests")
  applyLeave(@Body() body: any, @CurrentUser() user: any) {
    return this.leave.applyLeave(body, user);
  }

  @Patch("leave-requests/:id")
  approveLeave(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leave.approveLeave(id, body.approved === true, user, body.note);
  }

  @SkipPermission()
  @Get("leave-balances")
  leaveBalances(@Query("employeeId") employeeId?: string) {
    return this.leave.leaveBalances(employeeId);
  }

  @Post("leave-balances/ensure")
  @Roles(...HR_ROLES)
  ensureLeaveBalances(@Body() body: { period?: string; employeeId?: string; reset?: boolean }) {
    return this.leave.ensureBalances(body.period, body.employeeId, body.reset === true);
  }

  @Get("leave-policies")
  leavePolicies() {
    return this.leave.leavePolicies();
  }

  @Patch("leave-policies")
  @Roles(...HR_ROLES)
  upsertLeavePolicies(@Body() body: { policies: { leaveType: string; annualDays?: number | null; description?: string }[] }) {
    return this.leave.upsertLeavePolicies(body.policies ?? []);
  }

  // ── Work calendar (monthly open/closed overrides) ──────────────────────
  @Get("work-calendar")
  workCalendar(@Query("month") month?: string) {
    return this.attendance.workCalendar(month);
  }

  @Post("work-calendar")
  @Roles(...HR_ROLES)
  upsertOverride(@Body() body: { date: string; isOpen: boolean; note?: string }, @CurrentUser() user: any) {
    return this.attendance.upsertOverride(body, user?.sub);
  }

  @Delete("work-calendar/:id")
  @Roles(...HR_ROLES)
  deleteOverride(@Param("id") id: string) {
    return this.attendance.deleteOverride(id);
  }

  @Get("payroll")
  @Roles(...HR_ROLES)
  payroll(@Query("period") period?: string) {
    return this.payrollService.payroll(period);
  }

  /** Compact header badge: latest period that actually has records. */
  @Get("payroll/status")
  payrollStatus() {
    return this.payrollService.status();
  }

  @Post("payroll/run")
  @Roles(...HR_ROLES)
  runPayroll(@Body() body: { period: string }) {
    return this.payrollService.runPayroll(body.period);
  }

  @Patch("payroll/:id")
  @Roles(...HR_ROLES)
  updatePayroll(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    if (body.status !== undefined && Object.keys(body).every((k) => k === "status")) {
      return this.payrollService.updatePayrollStatus(id, body.status as any, user?.sub);
    }
    return this.payrollService.updatePayrollRecord(id, body, user?.sub);
  }

  @Post("payroll/:id/recompute")
  @Roles(...HR_ROLES)
  recomputePayroll(@Param("id") id: string, @CurrentUser() user: any) {
    return this.payrollService.recomputePayrollRecord(id, user?.sub);
  }

  @Delete("payroll/:id")
  @Roles(...HR_ROLES)
  deletePayroll(@Param("id") id: string) {
    return this.payrollService.deletePayrollRecord(id);
  }

  @Get("payroll/:id/payslip")
  payslip(@Param("id") id: string, @CurrentUser() user: any) {
    return this.payrollService.payslip(id, user);
  }

  // ── Automation (cron entry points exposed for the Control panel) ───────
  @Post("automation/:action")
  @Roles(...HR_ROLES)
  runAutomation(@Param("action") action: string) {
    return this.automation.runNow(action as any);
  }

  @Get("reviews")
  reviews() {
    return this.performance.reviews();
  }

  @Post("reviews")
  @Roles(...HR_ROLES)
  createReview(@Body() body: any, @CurrentUser() user: any) {
    return this.performance.createReview({ ...body, reviewedById: user?.sub });
  }

  @Patch("reviews/:id")
  @Roles(...HR_ROLES)
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
  @Roles(...HR_ROLES)
  createCourse(@Body() body: any) {
    return this.training.createCourse(body);
  }

  @Delete("courses/:id")
  @Roles(...HR_ROLES)
  deleteCourse(@Param("id") id: string) {
    return this.training.deleteCourse(id);
  }

  @Get("enrollments")
  enrollments() {
    return this.training.enrollments();
  }

  @Post("enrollments")
  @Roles(...HR_ROLES)
  createEnrollment(@Body() body: any) {
    return this.training.createEnrollment(body);
  }

  @Patch("enrollments/:id")
  @Roles(...HR_ROLES)
  updateEnrollment(@Param("id") id: string, @Body() body: any) {
    return this.training.updateEnrollment(id, body);
  }

  @Get("candidates")
  @Roles(...HR_ROLES)
  candidates() {
    return this.recruitment.candidates();
  }

  @Post("candidates")
  @Roles(...HR_ROLES)
  createCandidate(@Body() body: any) {
    return this.recruitment.createCandidate(body);
  }

  @Patch("candidates/:id")
  @Roles(...HR_ROLES)
  updateCandidate(@Param("id") id: string, @Body() body: any) {
    return this.recruitment.updateCandidate(id, body);
  }

  @Delete("candidates/:id")
  @Roles(...HR_ROLES)
  deleteCandidate(@Param("id") id: string) {
    return this.recruitment.deleteCandidate(id);
  }

  @SkipPermission()
  @Get("holidays")
  holidays() {
    return this.attendance.holidays();
  }

  @Post("holidays")
  @Roles(...HR_ROLES)
  createHoliday(@Body() body: any) {
    return this.attendance.createHoliday(body);
  }

  @Delete("holidays/:id")
  @Roles(...HR_ROLES)
  deleteHoliday(@Param("id") id: string) {
    return this.attendance.deleteHoliday(id);
  }

  // ── Onboarding / offboarding ───────────────────────────────────────────
  @Get("onboarding")
  onboardingList(@Query("kind") kind?: string) {
    return this.onboarding.list(kind === "OFFBOARDING" ? "OFFBOARDING" : kind === "ONBOARDING" ? "ONBOARDING" : undefined);
  }

  @Get("onboarding/summary")
  onboardingSummary() {
    return this.onboarding.summary();
  }

  @Post("onboarding")
  @Roles(...HR_ROLES)
  startOnboarding(@Body() body: any) {
    return this.onboarding.start(body);
  }

  @Patch("onboarding/items/:itemId")
  @Roles(...HR_ROLES)
  toggleOnboardingItem(@Param("itemId") itemId: string, @Body() body: { done: boolean }, @CurrentUser() user: any) {
    return this.onboarding.toggleItem(itemId, body?.done === true, user?.sub);
  }

  @Delete("onboarding/items/:itemId")
  @Roles(...HR_ROLES)
  removeOnboardingItem(@Param("itemId") itemId: string) {
    return this.onboarding.removeItem(itemId);
  }

  @Post("onboarding/:id/items")
  @Roles(...HR_ROLES)
  addOnboardingItem(@Param("id") id: string, @Body() body: { label: string; owner?: string }) {
    return this.onboarding.addItem(id, body);
  }

  @Patch("onboarding/:id")
  @Roles(...HR_ROLES)
  setOnboardingStatus(@Param("id") id: string, @Body() body: { status: "IN_PROGRESS" | "COMPLETED" }) {
    return this.onboarding.setStatus(id, body.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS");
  }

  @Delete("onboarding/:id")
  @Roles(...HR_ROLES)
  removeOnboarding(@Param("id") id: string) {
    return this.onboarding.remove(id);
  }

  // ── Asset register ─────────────────────────────────────────────────────
  @Get("assets")
  assetsList() {
    return this.assets.list();
  }

  @Get("assets/summary")
  assetsSummary() {
    return this.assets.summary();
  }

  @Post("assets")
  @Roles(...HR_ROLES)
  createAsset(@Body() body: any) {
    return this.assets.create(body);
  }

  @Patch("assets/:id")
  @Roles(...HR_ROLES)
  updateAsset(@Param("id") id: string, @Body() body: any) {
    return this.assets.update(id, body);
  }

  @Delete("assets/:id")
  @Roles(...HR_ROLES)
  deleteAsset(@Param("id") id: string) {
    return this.assets.remove(id);
  }

  @Post("assets/:id/assign")
  @Roles(...HR_ROLES)
  assignAsset(@Param("id") id: string, @Body() body: { employeeId: string }) {
    return this.assets.assign(id, body.employeeId);
  }

  @Post("assets/:id/return")
  @Roles(...HR_ROLES)
  returnAsset(@Param("id") id: string) {
    return this.assets.returnAsset(id);
  }

  @Get("org-chart")
  orgChart() {
    return this.directory.orgChart();
  }

  // ── Employee 360 (master-detail team view) ─────────────────────────────
  @Get("team")
  teamRoster() {
    return this.team.roster();
  }

  @Get("team/:id")
  employee360(
    @Param("id") id: string,
    @Query("month") month?: string,
    @Query("days") days?: string
  ) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : undefined;
    return this.team.employee360(id, { month: m, days });
  }

  @SkipPermission()
  @Get("task-type-rules")
  taskTypeRules() {
    return this.team.taskTypeRules();
  }

  @Patch("task-type-rules")
  @Roles(...HR_ROLES)
  saveTaskTypeRules(@Body() body: { rules: { department: string; taskTypes: string[] }[] }) {
    return this.team.saveTaskTypeRules(body.rules ?? []);
  }

  @Get("skills-matrix")
  skillsMatrix() {
    return this.directory.skillsMatrix();
  }
}
