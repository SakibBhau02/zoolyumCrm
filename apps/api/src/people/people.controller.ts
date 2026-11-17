import { Body, BadRequestException, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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
import { PeopleAnalyticsService } from "./analytics.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission, SkipPermission } from "../common/decorators/require-permission.decorator";
import { imageUploadOptions, optimizeUploadedImage } from "../common/image-pipeline";

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
    private readonly assets: AssetsService,
    private readonly analyticsService: PeopleAnalyticsService
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
  createEmployee(@Body() body: any, @CurrentUser() user: any) {
    return this.directory.createEmployee(body, user);
  }

  @Patch("employees/:id")
  updateEmployee(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.directory.updateEmployee(id, body, user);
  }

  // ── Staff photo (WebP + JPEG XL) ────────────────────────────────────
  @Post("employees/:id/photo")
  @UseInterceptors(FileInterceptor("file", imageUploadOptions("people")))
  async uploadPhoto(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    const image = await optimizeUploadedImage(file, { kind: "avatar", urlPrefix: "/api/media/people" });
    const saved = await this.directory.setPhoto(id, image.url, image.jxlUrl);
    return { ...saved, width: image.width, height: image.height, size: image.size };
  }

  @Delete("employees/:id/photo")
  removePhoto(@Param("id") id: string) {
    return this.directory.removePhoto(id);
  }

  @Delete("employees/:id")
  deleteEmployee(@Param("id") id: string) {
    return this.directory.deleteEmployee(id);
  }

  @Get("utilization")
  utilizationTrend() {
    return this.directory.utilizationTrend();
  }

  /** Rebuild utilization from time logs (normally the Monday 04:00 cron). */
  @Post("utilization/recompute")
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
  recordAttendance(@Body() body: any) {
    return this.attendance.recordAttendance(body);
  }

  @Post("attendance/kiosk")
  kioskPunch(@Body() body: { action?: string; mode?: string }, @CurrentUser() user: any) {
    return this.attendance.kioskPunch(user, body.action === "out" ? "out" : "in", body.mode === "self" ? "self" : "kiosk");
  }

  @Post("attendance/recompute")
  recomputeAttendance(@Body() body: { month: string; force?: boolean }) {
    return this.attendance.recomputeMonth(body?.month, { force: body?.force === true });
  }

  @Patch("attendance/:id/correct")
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
  @RequirePermission("PEOPLE", "approve")
  attendanceDevices() {
    return this.attendance.listDevices();
  }

  @Patch("attendance/devices/:id")
  @RequirePermission("PEOPLE", "approve")
  updateAttendanceDevice(@Param("id") id: string, @Body() body: { name?: string | null; location?: string | null; isActive?: boolean }) {
    return this.attendance.updateDevice(id, body);
  }

  @Delete("attendance/devices/:id")
  @RequirePermission("PEOPLE", "approve")
  deleteAttendanceDevice(@Param("id") id: string) {
    return this.attendance.deleteDevice(id);
  }

  @Get("attendance-policy")
  @RequirePermission("PEOPLE", "approve")
  attendancePolicy() {
    return this.attendance.attendancePolicy();
  }

  @Patch("attendance-policy")
  @RequirePermission("PEOPLE", "approve")
  updateAttendancePolicy(@Body() body: any) {
    return this.attendance.updateAttendancePolicy(body);
  }

  @Get("punches")
  punches(
    @Query("month") month?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("unmatched") unmatched?: string,
    @Query("limit") limit?: string
  ) {
    return this.attendance.punches({ month, days, from, to }, unmatched === "true", limit ? Number(limit) : undefined);
  }

  @Post("punches/import")
  importPunches(@Body() body: { rows: any[] }) {
    return this.attendance.importPunches(body.rows ?? []);
  }

  @Patch("punches/:id/map")
  mapPunch(@Param("id") id: string, @Body() body: { employeeId: string }) {
    return this.attendance.mapPunch(id, body.employeeId);
  }

  @Delete("punches/:id")
  deletePunch(@Param("id") id: string) {
    return this.attendance.deletePunch(id);
  }

  @Get("leave-requests")
  async leaveRequests(@CurrentUser() user: any) {
    return this.leave.leaveRequests(await this.leave.scopeEmployeeId(user));
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
  // Level `view` on purpose: LeaveService owns the approver rule (Owner, HR,
  // Project Manager) so a manager can still decide without PEOPLE edit.
  @RequirePermission("PEOPLE", "view")
  approveLeave(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leave.approveLeave(id, body.approved === true, user, body.note);
  }

  @Delete("leave-requests/:id")
  @RequirePermission("PEOPLE", "view")
  cancelLeave(@Param("id") id: string, @CurrentUser() user: any) {
    return this.leave.cancelLeave(id, user);
  }

  @SkipPermission()
  @Get("leave-balances")
  async leaveBalances(@Query("employeeId") employeeId: string | undefined, @CurrentUser() user: any) {
    return this.leave.leaveBalances(employeeId, await this.leave.scopeEmployeeId(user));
  }

  @Post("leave-balances/ensure")
  @RequirePermission("PEOPLE", "approve")
  ensureLeaveBalances(@Body() body: { period?: string; employeeId?: string; reset?: boolean }) {
    return this.leave.ensureBalances(body.period, body.employeeId, body.reset === true);
  }

  @Get("leave-policies")
  leavePolicies() {
    return this.leave.leavePolicies();
  }

  @Patch("leave-policies")
  @RequirePermission("PEOPLE", "approve")
  upsertLeavePolicies(@Body() body: { policies: { leaveType: string; annualDays?: number | null; description?: string }[] }) {
    return this.leave.upsertLeavePolicies(body.policies ?? []);
  }

  // ── Work calendar (monthly open/closed overrides) ──────────────────────
  @Get("work-calendar")
  workCalendar(@Query("month") month?: string) {
    return this.attendance.workCalendar(month);
  }

  @Post("work-calendar")
  @RequirePermission("PEOPLE", "approve")
  upsertOverride(@Body() body: { date: string; isOpen: boolean; note?: string }, @CurrentUser() user: any) {
    return this.attendance.upsertOverride(body, user?.sub);
  }

  @Delete("work-calendar/:id")
  @RequirePermission("PEOPLE", "approve")
  deleteOverride(@Param("id") id: string) {
    return this.attendance.deleteOverride(id);
  }

  @Get("payroll")
  @RequirePermission("PEOPLE", "approve")
  payroll(@Query("period") period?: string) {
    return this.payrollService.payroll(period);
  }

  /** Compact header badge: latest period that actually has records. */
  @Get("payroll/status")
  @RequirePermission("PEOPLE", "approve")
  payrollStatus() {
    return this.payrollService.status();
  }

  @Post("payroll/run")
  @RequirePermission("PEOPLE", "approve")
  runPayroll(@Body() body: { period: string }) {
    return this.payrollService.runPayroll(body.period);
  }

  /** Repair FINALIZED payroll records that never produced a salary expense. */
  @Post("payroll/heal-posted")
  @RequirePermission("PEOPLE", "approve")
  healPayroll(@CurrentUser("sub") actorId: string) {
    return this.payrollService.healFinalizedPayroll(actorId);
  }

  @Patch("payroll/:id")
  @RequirePermission("PEOPLE", "approve")
  updatePayroll(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    if (body.status !== undefined && Object.keys(body).every((k) => k === "status" || k === "bankAccountId")) {
      return this.payrollService.updatePayrollStatus(id, body.status as any, user?.sub, body.bankAccountId);
    }
    return this.payrollService.updatePayrollRecord(id, body, user?.sub);
  }

  @Post("payroll/:id/recompute")
  @RequirePermission("PEOPLE", "approve")
  recomputePayroll(@Param("id") id: string, @CurrentUser() user: any) {
    return this.payrollService.recomputePayrollRecord(id, user?.sub);
  }

  @Delete("payroll/:id")
  @RequirePermission("PEOPLE", "approve")
  deletePayroll(@Param("id") id: string) {
    return this.payrollService.deletePayrollRecord(id);
  }

  @Get("payroll/:id/payslip")
  @RequirePermission("PEOPLE", "approve")
  payslip(@Param("id") id: string, @CurrentUser() user: any) {
    return this.payrollService.payslip(id, user);
  }

  // ── Automation (cron entry points exposed for the Control panel) ───────
  @Post("automation/:action")
  @RequirePermission("PEOPLE", "approve")
  runAutomation(@Param("action") action: string) {
    return this.automation.runNow(action as any);
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

  @SkipPermission()
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
  startOnboarding(@Body() body: any) {
    return this.onboarding.start(body);
  }

  @Patch("onboarding/items/:itemId")
  toggleOnboardingItem(@Param("itemId") itemId: string, @Body() body: { done: boolean }, @CurrentUser() user: any) {
    return this.onboarding.toggleItem(itemId, body?.done === true, user?.sub);
  }

  @Delete("onboarding/items/:itemId")
  removeOnboardingItem(@Param("itemId") itemId: string) {
    return this.onboarding.removeItem(itemId);
  }

  @Post("onboarding/:id/items")
  addOnboardingItem(@Param("id") id: string, @Body() body: { label: string; owner?: string }) {
    return this.onboarding.addItem(id, body);
  }

  @Patch("onboarding/:id")
  setOnboardingStatus(@Param("id") id: string, @Body() body: { status: "IN_PROGRESS" | "COMPLETED" }) {
    return this.onboarding.setStatus(id, body.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS");
  }

  @Delete("onboarding/:id")
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
  createAsset(@Body() body: any) {
    return this.assets.create(body);
  }

  @Patch("assets/:id")
  updateAsset(@Param("id") id: string, @Body() body: any) {
    return this.assets.update(id, body);
  }

  @Delete("assets/:id")
  deleteAsset(@Param("id") id: string) {
    return this.assets.remove(id);
  }

  @Post("assets/:id/assign")
  assignAsset(@Param("id") id: string, @Body() body: { employeeId: string }) {
    return this.assets.assign(id, body.employeeId);
  }

  @Post("assets/:id/return")
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
    @CurrentUser() user: any,
    @Query("month") month?: string,
    @Query("days") days?: string
  ) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : undefined;
    return this.team.employee360(id, { month: m, days }, user);
  }

  @SkipPermission()
  @Get("task-type-rules")
  taskTypeRules() {
    return this.team.taskTypeRules();
  }

  @Patch("task-type-rules")
  @RequirePermission("PEOPLE", "approve")
  saveTaskTypeRules(@Body() body: { rules: { department: string; taskTypes: string[] }[] }) {
    return this.team.saveTaskTypeRules(body.rules ?? []);
  }

  // ── People analytics (per-employee × per-month management view) ────────
  @Get("analytics/monthly")
  analyticsMonthly(@Query("months") months?: string, @Query("department") department?: string) {
    return this.analyticsService.monthlyMatrix({
      months: months ? Number(months) : undefined,
      department: department || undefined,
    });
  }

  @Get("analytics/employee/:id")
  analyticsEmployee(@Param("id") id: string, @Query("months") months?: string) {
    return this.analyticsService.employeeTrend(id, months ? Number(months) : 12);
  }

  @Get("skills-matrix")
  skillsMatrix() {
    return this.directory.skillsMatrix();
  }
}
