import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";
import { canSeePay, dateStrDhaka, dhakaDayRange } from "./people-utils";

/**
 * Employee 360 — one screen that answers "what does this person's month look
 * like": attendance (days by kind, late minutes), tasks completed, meetings
 * attended, leave and the latest payroll line.
 *
 * The attendance half is delegated to AttendanceService.employeeAttendance so
 * there is exactly one implementation of the work-hours / late-minute rules.
 * Tasks and meetings are computed here because nothing aggregated them per
 * employee before.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService
  ) {}

  /** Roster for the master-detail view: lightweight, with today's state. */
  async roster() {
    const today = new Date(`${dateStrDhaka(new Date())}T00:00:00.000Z`);
    const [employees, todayAttendance] = await Promise.all([
      this.prisma.employee.findMany({
        where: { employmentStatus: { not: "EXITED" } },
        select: {
          id: true,
          name: true,
          roleTitle: true,
          department: true,
          employmentStatus: true,
          email: true,
          workLocation: true,
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.attendance.findMany({
        where: { date: today },
        select: { employeeId: true, status: true, checkInTime: true },
      }),
    ]);
    const byEmp = new Map(todayAttendance.map((a) => [a.employeeId, a]));
    const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))] as string[];
    return {
      departments: departments.sort(),
      rows: employees.map((e) => {
        const a = byEmp.get(e.id);
        return {
          ...e,
          todayStatus: a?.status ?? null,
          todayCheckIn: a?.checkInTime?.toISOString() ?? null,
        };
      }),
    };
  }

  async employee360(employeeId: string, query: { month?: string; days?: string } = {}, user?: any) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        roleTitle: true,
        department: true,
        employmentStatus: true,
        email: true,
        phone: true,
        workLocation: true,
        employmentType: true,
        joinDate: true,
        shiftStart: true,
        shiftEnd: true,
        graceMinutes: true,
        weeklyOffDays: true,
        reportingManager: { select: { id: true, name: true, roleTitle: true } },
        user: { select: { id: true } },
      },
    });
    if (!employee) throw new NotFoundException("Employee not found");

    const attendance = await this.attendance.employeeAttendance(employeeId, query);
    const range = attendance.range as { from?: string; to?: string; count?: number } | undefined;
    if (!range?.from || !range?.to) {
      return { employee, attendance, tasks: null, meetings: null, leave: null, payroll: null };
    }

    const start = dhakaDayRange(range.from).start;
    const end = dhakaDayRange(range.to).end;

    const [tasks, loggedRaw, meetingRows, leaveBalances, leaveRequests, payroll, shootRows] = await Promise.all([
      this.prisma.task.findMany({
        where: { assignedToId: employeeId },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          taskType: true,
          dueDate: true,
          completedAt: true,
          estimatedHours: true,
          actualHours: true,
          archivedAt: true,
          project: { select: { id: true, name: true } },
        },
      }),
      this.prisma.timeLog.groupBy({
        by: ["taskId"],
        where: { employeeId, date: { gte: start, lt: end } },
        _sum: { hours: true },
      }),
      this.prisma.leadMeetingAttendee.findMany({
        where: { employeeId, meeting: { scheduledAt: { gte: start, lt: end } } },
        select: {
          status: true,
          meeting: {
            select: {
              id: true,
              title: true,
              scheduledAt: true,
              durationMins: true,
              status: true,
              type: true,
              lead: { select: { id: true, name: true, company: true } },
            },
          },
        },
        orderBy: { meeting: { scheduledAt: "desc" } },
      }),
      this.prisma.leaveBalance.findMany({ where: { employeeId }, orderBy: { leaveType: "asc" } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId, startDate: { lte: end }, endDate: { gte: start } },
        orderBy: { startDate: "desc" },
      }),
      this.prisma.payrollRecord.findFirst({ where: { employeeId }, orderBy: { period: "desc" } }),
      this.prisma.shootCrew.findMany({
        where: {
          employeeId,
          shoot: { shootDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
        },
        select: {
          id: true,
          role: true,
          isConfirmed: true,
          shoot: {
            select: {
              id: true,
              title: true,
              shootDate: true,
              status: true,
              location: true,
              project: { select: { name: true } },
            },
          },
        },
        orderBy: { shoot: { shootDate: "desc" } },
      }),
    ]);

    // ── Tasks ────────────────────────────────────────────────────────────
    const inRange = (d: Date | null) => !!d && d.getTime() >= start.getTime() && d.getTime() < end.getTime();
    const live = tasks.filter((t) => !t.archivedAt);
    const doneInRange = live.filter((t) => t.status === "DONE" && inRange(t.completedAt));
    const open = live.filter((t) => t.status !== "DONE");
    const now = Date.now();
    const overdue = open.filter((t) => t.dueDate && t.dueDate.getTime() < now);
    const onTime = doneInRange.filter((t) => !t.dueDate || (t.completedAt && t.completedAt.getTime() <= t.dueDate.getTime()));

    const groupBy = <K extends string>(rows: typeof live, key: (t: (typeof live)[number]) => K) => {
      const m = new Map<K, number>();
      for (const t of rows) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
      return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
    };

    const loggedMinutes = Math.round(Number(loggedRaw.reduce((s, r) => s + Number(r._sum.hours ?? 0), 0)) * 60);

    const tasksOut = {
      total: live.length,
      open: open.length,
      doneInRange: doneInRange.length,
      doneAllTime: live.filter((t) => t.status === "DONE").length,
      overdue: overdue.length,
      onTimeRate: doneInRange.length ? Math.round((onTime.length / doneInRange.length) * 100) : null,
      onTime: onTime.length,
      loggedMinutes,
      estimatedHours: Math.round(Number(live.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0)) * 10) / 10,
      actualHours: Math.round(Number(live.reduce((s, t) => s + Number(t.actualHours ?? 0), 0)) * 10) / 10,
      byType: groupBy(live, (t) => t.taskType ?? "general"),
      byStatus: groupBy(live, (t) => t.status),
      byProject: [...live.reduce((m, t) => {
        const name = t.project?.name ?? "No project";
        m.set(name, (m.get(name) ?? 0) + 1);
        return m;
      }, new Map<string, number>()).entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      recentDone: doneInRange
        .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
        .slice(0, 6)
        .map((t) => ({
          id: t.id,
          title: t.title,
          completedAt: t.completedAt?.toISOString() ?? null,
          project: t.project?.name ?? null,
        })),
      openList: open
        .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
        .slice(0, 8)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate?.toISOString() ?? null,
          project: t.project?.name ?? null,
        })),
    };

    // ── Meetings ─────────────────────────────────────────────────────────
    const attended = meetingRows.filter((m) => m.status === "ATTENDED");
    const noShow = meetingRows.filter((m) => m.status === "NO_SHOW");
    const happened = meetingRows.filter((m) => m.meeting.status === "COMPLETED" || m.meeting.scheduledAt.getTime() < now);
    const meetingsOut = {
      invited: meetingRows.length,
      attended: attended.length,
      noShow: noShow.length,
      unmarked: meetingRows.filter((m) => m.status === "INVITED").length,
      upcoming: meetingRows.filter((m) => m.meeting.scheduledAt.getTime() >= now && m.meeting.status === "SCHEDULED").length,
      // Attendance rate only counts meetings that have actually happened —
      // counting future ones would punish people for not time-travelling.
      attendanceRate: happened.length
        ? Math.round((attended.length / happened.length) * 100)
        : null,
      hours: Math.round(meetingRows.reduce((s, m) => s + (m.meeting.durationMins ?? 30), 0) / 6) / 10,
      recent: meetingRows.slice(0, 8).map((m) => ({
        meetingId: m.meeting.id,
        title: m.meeting.title,
        scheduledAt: m.meeting.scheduledAt.toISOString(),
        durationMins: m.meeting.durationMins,
        meetingStatus: m.meeting.status,
        myStatus: m.status,
        lead: m.meeting.lead?.name ?? null,
        company: m.meeting.lead?.company ?? null,
      })),
      hasLogin: !!employee.user,
    };

    return {
      employee,
      attendance,
      tasks: tasksOut,
      meetings: meetingsOut,
      shoots: {
        total: shootRows.length,
        confirmed: shootRows.filter((s) => s.isConfirmed).length,
        // Shoots crews are booked per production day, so "days on set" is the
        // number the manager cares about — not the number of projects.
        days: new Set(shootRows.map((s) => s.shoot.shootDate.toISOString().slice(0, 10))).size,
        recent: shootRows.slice(0, 8).map((s) => ({
          id: s.id,
          role: s.role,
          isConfirmed: s.isConfirmed,
          shootId: s.shoot.id,
          title: s.shoot.title,
          shootDate: s.shoot.shootDate.toISOString(),
          status: s.shoot.status,
          location: s.shoot.location,
          project: s.shoot.project?.name ?? null,
        })),
      },
      leave: {
        balances: leaveBalances.map((b) => ({ leaveType: b.leaveType, balanceDays: Number(b.balanceDays), period: b.period })),
        requests: leaveRequests.map((l) => ({
          id: l.id,
          leaveType: l.leaveType,
          status: l.status,
          startDate: l.startDate.toISOString(),
          endDate: l.endDate.toISOString(),
          workingDays: l.workingDays,
        })),
      },
      // Compensation is HR-only. Directory already masked this; Team 360 used to
      // hand every PEOPLE viewer (including Team Member) a colleague's net pay.
      payroll: payroll && canSeePay(user)
        ? {
            id: payroll.id,
            period: payroll.period,
            status: payroll.status,
            netPay: Number(payroll.netPay),
            deductions: Number(payroll.deductions),
            lateDeduction: Number(payroll.lateDeduction ?? 0),
            absentDeduction: Number(payroll.absentDeduction ?? 0),
          }
        : null,
    };
  }

  // ── Department → allowed task types ────────────────────────────────────
  async taskTypeRules() {
    const s = await this.prisma.settings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
      select: { departmentTaskTypes: true },
    });
    return (s.departmentTaskTypes as any[]) ?? [];
  }

  /** Replace the whole rule set. Shape: `[{ department, taskTypes: string[] }]`. */
  async saveTaskTypeRules(rules: { department: string; taskTypes: string[] }[]) {
    if (!Array.isArray(rules)) throw new BadRequestException("rules must be an array");
    const clean = rules
      .filter((r) => r?.department?.trim())
      .map((r) => ({
        department: r.department.trim(),
        taskTypes: Array.isArray(r.taskTypes) ? [...new Set(r.taskTypes.map((t) => String(t).toLowerCase()))] : [],
      }));
    await this.prisma.settings.upsert({
      where: { id: "default" },
      update: { departmentTaskTypes: clean },
      create: { id: "default", departmentTaskTypes: clean },
    });
    return clean;
  }

  /**
   * Task types a given department is allowed to file. Empty array = no
   * restriction, so an unconfigured install keeps working unchanged.
   */
  async allowedTaskTypesFor(department?: string | null): Promise<string[]> {
    if (!department) return [];
    const rules = await this.taskTypeRules();
    const hit = rules.find((r: any) => String(r.department).toLowerCase() === department.toLowerCase());
    return hit?.taskTypes ?? [];
  }
}
