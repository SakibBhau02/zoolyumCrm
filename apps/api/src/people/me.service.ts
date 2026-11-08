import { Injectable, NotFoundException } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { dateStrDhaka, dhakaDayRange } from "./people-utils";

/**
 * Employee self-service ("My space").
 *
 * Every other People screen is company-wide and assumes an HR viewer. That is
 * the wrong default for the nine people who just want to know "am I marked
 * present?", "how much leave do I have left?" and "where is my payslip?".
 *
 * One request returns everything the personal dashboard needs, resolved from
 * the JWT — a user can never ask for someone else's numbers because the
 * employee id is never taken from the URL.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly moduleRef: ModuleRef
  ) {}

  /** The employee behind a staff account, or a clear error. */
  async employeeForUser(user: any) {
    const userId = user?.sub;
    if (!userId) throw new NotFoundException("Not signed in");
    let emp = await this.prisma.employee.findFirst({
      where: { user: { id: userId } },
      select: { id: true, name: true },
    });
    // Some installs set User.employeeId without the reverse relation.
    if (!emp) {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
      if (u?.employeeId) emp = await this.prisma.employee.findUnique({ where: { id: u.employeeId }, select: { id: true, name: true } });
    }
    if (!emp) throw new NotFoundException("No employee record is linked to your account — ask HR to link it in Directory.");
    return emp;
  }

  private async workingDay(dateStr: string) {
    const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const [policy, holiday] = await Promise.all([
      this.prisma.attendancePolicy.findUnique({ where: { id: "default" } }),
      this.prisma.holiday.findFirst({ where: { date: dateStr }, select: { id: true, name: true } }),
    ]);
    const dow = DAY_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
    return { isWorking: !holiday && !(policy?.weeklyOffDays ?? []).includes(dow), holiday };
  }

  async dashboard(user: any, opts: { month?: string; days?: number } = {}) {    const emp = await this.employeeForUser(user);
    const today = dateStrDhaka(new Date());
    const todayCol = new Date(`${today}T00:00:00.000Z`);
    const dayStart = dhakaDayRange(today).start;
    const dayEnd = dhakaDayRange(today).end;

    const [employee, att, todaysPunch, leaveBalances, leaveRequests, payroll, okrs, tasks, meetings, upcoming, telegram, workday] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: emp.id },
        select: {
          id: true, name: true, roleTitle: true, department: true, email: true, phone: true,
          workLocation: true, employmentType: true, employmentStatus: true, joinDate: true,
          shiftStart: true, shiftEnd: true, graceMinutes: true, weeklyOffDays: true, skillTags: true,
          reportingManager: { select: { id: true, name: true } },
          user: { select: { id: true } },
        },
      }),
      this.attendance.employeeAttendance(emp.id, opts.month ? { month: opts.month } : { days: String(opts.days ?? 30) }),
      this.prisma.punchLog.findMany({ where: { employeeId: emp.id, punchTime: { gte: dayStart, lt: dayEnd } }, orderBy: { punchTime: "asc" }, select: { punchTime: true, source: true } }),
      this.prisma.leaveBalance.findMany({ where: { employeeId: emp.id }, orderBy: { leaveType: "asc" } }),
      this.prisma.leaveRequest.findMany({ where: { employeeId: emp.id }, orderBy: { appliedAt: "desc" }, take: 6 }),
      this.prisma.payrollRecord.findMany({ where: { employeeId: emp.id }, orderBy: { period: "desc" }, take: 6 }),
      this.prisma.okr.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" }, take: 4 }),
      this.prisma.task.findMany({
        where: { assignedToId: emp.id, archivedAt: null, status: { not: "DONE" } },
        orderBy: [{ dueDate: "asc" }],
        select: { id: true, title: true, priority: true, status: true, dueDate: true, project: { select: { name: true } } },
        take: 15,
      }),
      this.prisma.leadMeetingAttendee.findMany({
        where: { employeeId: emp.id, meeting: { scheduledAt: { gte: dayStart, lt: dayEnd } } },
        include: { meeting: { select: { id: true, title: true, scheduledAt: true, durationMins: true, status: true, meetingLink: true, lead: { select: { company: true } } } } },
        orderBy: { meeting: { scheduledAt: "asc" } },
      }),
      this.prisma.leadMeetingAttendee.findMany({
        where: { employeeId: emp.id, meeting: { scheduledAt: { gte: new Date() }, status: "SCHEDULED" } },
        include: { meeting: { select: { id: true, title: true, scheduledAt: true, durationMins: true, meetingLink: true, lead: { select: { company: true } } } } },
        orderBy: { meeting: { scheduledAt: "asc" } },
        take: 5,
      }),
      this.prisma.telegramLink.findFirst({ where: { employeeId: emp.id }, select: { isActive: true, username: true } }),
      this.workingDay(today),
    ]);

    const summary = (att as any)?.summary ?? {};
    const days = (att as any)?.days ?? [];
    const measured = Math.max(0, (summary.working ?? 0) - (summary.unrecorded ?? 0));
    const attendanceRate = measured > 0 ? Math.round(((summary.present + summary.late + summary.halfDay) / measured) * 100) : null;

    const now = Date.now();
    const todayTasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString());
    const overdue = tasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now && new Date(t.dueDate).toDateString() !== new Date().toDateString());

    const attToday = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: todayCol } },
      select: { status: true, checkInTime: true, checkOutTime: true },
    });

    return {
      employee,
      today: {
        date: today,
        isWorkingDay: workday.isWorking,
        holiday: workday.holiday?.name ?? null,
        status: attToday?.status ?? null,
        checkIn: attToday?.checkInTime ?? null,
        checkOut: attToday?.checkOutTime ?? null,
        punches: todaysPunch.length,
        inside: !!attToday?.checkInTime && !attToday?.checkOutTime,
      },
      attendance: {
        range: (att as any)?.range ?? null,
        summary: {
          working: summary.working ?? 0,
          present: summary.present ?? 0,
          late: summary.late ?? 0,
          halfDay: summary.halfDay ?? 0,
          absent: summary.absent ?? 0,
          leave: summary.leave ?? 0,
          unrecorded: summary.unrecorded ?? 0,
          workedMinutes: summary.workedMinutes ?? 0,
          overtimeMinutes: summary.overtimeMinutes ?? 0,
          lateMinutes: summary.lateMinutes ?? 0,
        },
        attendanceRate,
        days,
      },
      leave: {
        balances: leaveBalances.map((b) => ({ leaveType: b.leaveType, balanceDays: Number(b.balanceDays), period: b.period })),
        requests: leaveRequests.map((l) => ({
          id: l.id, leaveType: l.leaveType, status: l.status, startDate: l.startDate, endDate: l.endDate,
          workingDays: l.workingDays, decisionNote: (l as any).decisionNote ?? null,
        })),
      },
      payroll: {
        latest: payroll[0]
          ? { id: payroll[0].id, period: payroll[0].period, status: payroll[0].status, netPay: Number(payroll[0].netPay) }
          : null,
        history: payroll.map((p) => ({ id: p.id, period: p.period, status: p.status, netPay: Number(p.netPay) })),
      },
      okrs: okrs.map((o) => ({ id: o.id, title: o.title, quarter: o.quarter, progress: o.overallProgress, status: o.status })),
      tasks: {
        open: tasks.length,
        overdue: overdue.length,
        dueToday: todayTasks.length,
        list: tasks.slice(0, 6).map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, dueDate: t.dueDate, project: t.project?.name ?? null })),
      },
      meetings: {
        today: meetings.map((m) => ({
          id: m.meeting.id, title: m.meeting.title, at: m.meeting.scheduledAt, mins: m.meeting.durationMins,
          link: m.meeting.meetingLink, company: m.meeting.lead?.company ?? null, myStatus: m.status,
        })),
        upcoming: upcoming.map((m) => ({
          id: m.meeting.id, title: m.meeting.title, at: m.meeting.scheduledAt, mins: m.meeting.durationMins,
          link: m.meeting.meetingLink, company: m.meeting.lead?.company ?? null,
        })),
      },
      telegram: { linked: !!telegram?.isActive, username: telegram?.username ?? null },
    };
  }

  /**
   * Self-service Telegram linking: any signed-in employee can mint a code for
   * *their own* employee row. The link module lives in TelegramModule, which
   * imports this one, so it is resolved lazily instead of injected.
   */
  async createTelegramLink(user: any) {
    const emp = await this.employeeForUser(user);
    const { TelegramLinkService } = await import("../telegram/telegram-link.service");
    const { TelegramConfigService } = await import("../telegram/telegram-config.service");
    const links = this.moduleRef.get(TelegramLinkService, { strict: false });
    const config = this.moduleRef.get(TelegramConfigService, { strict: false });
    const code = await links.createCode({ employeeId: emp.id });
    const cfg = await config.getConfig();
    const bot = cfg.botName?.replace(/^@/, "") ?? "";
    return {
      code: code.code,
      expiresAt: code.expiresAt,
      ttlMinutes: code.ttlMinutes,
      botName: bot || null,
      deepLink: bot ? `https://t.me/${bot}?start=${code.code}` : null,
    };
  }

  async disconnectTelegram(user: any) {
    const emp = await this.employeeForUser(user);
    await this.prisma.telegramLink.deleteMany({ where: { OR: [{ employeeId: emp.id }, { userId: user?.sub }] } });
    return { ok: true };
  }

  /** Leave application locked to the signed-in employee — no employeeId in the body. */
  async applyOwnLeave(user: any, body: { leaveType: string; startDate: string; endDate: string }) {
    const emp = await this.employeeForUser(user);
    return this.leave.applyLeave(
      { employeeId: emp.id, leaveType: body.leaveType, startDate: body.startDate, endDate: body.endDate },
      user
    );
  }
}
