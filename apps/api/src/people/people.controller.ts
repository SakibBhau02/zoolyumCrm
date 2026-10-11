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
    private readonly payrollService: PayrollService,
    private readonly performance: PerformanceService,
    private readonly training: TrainingService,
    private readonly recruitment: RecruitmentService
  ) {}

  @Get("overview")
  overview() {
    return this.directory.overview();
  }

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

  @Get("attendance/today")
  attendanceToday(@CurrentUser() user: any) {
    return this.attendance.todayStatus(user);
  }

  @Get("attendance/employee/:id")
  employeeAttendance(@Param("id") id: string, @Query("month") month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    return this.attendance.employeeAttendance(id, m);
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
  importPunches(@Body() body: { rows: any[] }) {
    return this.attendance.importPunches(body.rows ?? []);
  }

  @Patch("punches/:id/map")
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
    return this.payrollService.payroll(period);
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
  payslip(@Param("id") id: string) {
    return this.payrollService.payslip(id);
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
