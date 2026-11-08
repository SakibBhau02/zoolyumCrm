import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";
import { dateStrDhaka, eachDayStr, invalidatePeopleCache, leaveDays } from "./people-utils";
import { AttendanceService } from "./attendance.service";

const APPROVER_ROLES = ["Owner", "HR/Admin", "Admin", "Project Manager"];

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
    private readonly attendance: AttendanceService
  ) {}

  private async requireApprover(userId?: string) {
    if (!userId) throw new ForbiddenException("Login required");
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: { select: { name: true } } },
    });
    if (!u || !APPROVER_ROLES.includes(u.role?.name ?? "")) {
      throw new ForbiddenException("Only Owner, HR/Admin or Project Manager can decide leave requests");
    }
    return u;
  }

  // ── Leave quotas (yearly entitlement per type) ─────────────────────────
  async leavePolicies() {
    return this.prisma.leavePolicy.findMany({ orderBy: { leaveType: "asc" } });
  }

  /**
   * Replace the quota table. UNPAID is always unlimited (annualDays forced
   * null) — it never touches a balance row.
   */
  async upsertLeavePolicies(items: { leaveType: string; annualDays?: number | null; description?: string }[]) {
    const valid = ["CASUAL", "SICK", "EARNED", "UNPAID"];
    const out = [];
    for (const it of items ?? []) {
      if (!valid.includes(it.leaveType)) throw new BadRequestException(`Unknown leave type: ${it.leaveType}`);
      const annualDays = it.leaveType === "UNPAID" ? null : it.annualDays ?? null;
      if (annualDays != null && (Number.isNaN(Number(annualDays)) || Number(annualDays) < 0)) {
        throw new BadRequestException(`annualDays must be >= 0 for ${it.leaveType}`);
      }
      out.push(
        await this.prisma.leavePolicy.upsert({
          where: { leaveType: it.leaveType as any },
          create: { leaveType: it.leaveType as any, annualDays: annualDays ?? undefined, description: it.description ?? null },
          update: { annualDays, description: it.description ?? null },
        })
      );
    }
    return out;
  }

  /**
   * (Re)create balance rows for a year from the quota table. Existing rows
   * are left untouched unless `reset` — January reset deletes the period
   * first, so last year's leftovers never leak forward (no carryover policy).
   */
  async ensureBalances(period?: string, employeeId?: string, reset = false) {
    const year = period && /^\d{4}$/.test(period) ? period : `${new Date().getFullYear()}`;
    const [policies, employees] = await Promise.all([
      this.prisma.leavePolicy.findMany({ where: { annualDays: { not: null } } }),
      this.prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE", ...(employeeId ? { id: employeeId } : {}) },
        select: { id: true },
      }),
    ]);
    if (reset) {
      await this.prisma.leaveBalance.deleteMany({ where: { period: year, ...(employeeId ? { employeeId } : {}) } });
    }
    let created = 0;
    for (const emp of employees) {
      for (const p of policies) {
        const existing = await this.prisma.leaveBalance.findUnique({
          where: { employeeId_leaveType_period: { employeeId: emp.id, leaveType: p.leaveType, period: year } },
        });
        if (!existing) {
          await this.prisma.leaveBalance.create({
            data: { employeeId: emp.id, leaveType: p.leaveType, balanceDays: p.annualDays!, period: year },
          });
          created++;
        }
      }
    }
    return { period: year, created, employees: employees.length, types: policies.length };
  }

  async leaveRequests() {
    return this.prisma.leaveRequest.findMany({
      include: {
        employee: { select: { id: true, name: true, roleTitle: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { appliedAt: "desc" },
    });
  }

  /**
   * Full detail for the drawer: who/when/what + working-day breakdown +
   * balance impact + decision timeline. Everything the approver needs is
   * computed here so the UI never re-derives policy.
   */
  async leaveRequestDetail(id: string) {
    const r = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, roleTitle: true, department: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!r) throw new NotFoundException("Leave request not found");
    const from = dateStrDhaka(r.startDate);
    const to = dateStrDhaka(r.endDate);
    const calendarDays = leaveDays(r.startDate, r.endDate);
    const working = await this.attendance.countWorkingDays(r.employeeId, from, to);
    let balance: any = null;
    if (r.leaveType !== "UNPAID") {
      const period = `${r.startDate.getFullYear()}`;
      balance = await this.prisma.leaveBalance.findUnique({
        where: { employeeId_leaveType_period: { employeeId: r.employeeId, leaveType: r.leaveType, period } },
      });
    }
    return {
      ...r,
      from,
      to,
      calendarDays,
      workingDays: working.working,
      nonWorkingDays: working.total - working.working,
      balance: balance ? { days: Number(balance.balanceDays), period: balance.period } : null,
      timeline: [
        { at: r.appliedAt, by: r.employee?.name ?? "Employee", event: "applied", note: `${r.leaveType} · ${from} → ${to}` },
        ...(r.decidedAt
          ? [{ at: r.decidedAt, by: r.approvedBy?.name ?? "HR", event: r.status.toLowerCase(), note: r.decisionNote ?? null }]
          : []),
      ],
    };
  }

  async applyLeave(body: { employeeId: string; leaveType: string; startDate: string; endDate: string }, user?: any) {
    // Staff without HR rights may only apply for themselves — the form lists
    // every employee, so without this any user could book leave for a colleague.
    const role = user?.role ?? "";
    const isHr = /owner|hr|admin/i.test(role);
    if (user?.sub && !isHr) {
      const self = await this.prisma.employee.findFirst({ where: { user: { id: user.sub } }, select: { id: true } });
      if (self?.id) body = { ...body, employeeId: self.id };
    }
    const emp = await this.prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, name: true } });
    if (!emp) throw new NotFoundException("Employee not found");
    const valid = ["CASUAL", "SICK", "EARNED", "UNPAID"];
    if (!valid.includes(body.leaveType)) throw new BadRequestException(`Unknown leave type: ${body.leaveType}`);
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw new BadRequestException("Invalid date range");
    }
    // No double-booking: overlap with an undecided or approved request.
    const clash = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: body.employeeId,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { id: true, leaveType: true, startDate: true, endDate: true, status: true },
    });
    if (clash) {
      throw new BadRequestException(
        `Overlaps ${clash.status.toLowerCase()} ${clash.leaveType} request (${dateStrDhaka(clash.startDate)} → ${dateStrDhaka(clash.endDate)})`
      );
    }
    const from = dateStrDhaka(start);
    const to = dateStrDhaka(end);
    const working = await this.attendance.countWorkingDays(body.employeeId, from, to);
    const totalDays = leaveDays(start, end);
    const leave = await this.prisma.leaveRequest.create({
      data: {
        employeeId: body.employeeId,
        leaveType: body.leaveType as any,
        startDate: start,
        endDate: end,
        workingDays: working.working,
      },
      include: { employee: { select: { name: true } } },
    });
    try {
      await this.notifications.notifyRole(
        "HR",
        "LEAVE_REQUEST",
        "Leave request submitted",
        `${leave.employee?.name ?? "Someone"} requested ${body.leaveType} leave (${from} → ${to}, ${working.working} working day(s)).`,
        `/people/leave?request=${leave.id}`
      );
    } catch {}
    return { ...leave, totalDays, workingDays: working.working };
  }

  async approveLeave(id: string, approved: boolean, user?: { sub?: string }, note?: string) {
    const approver = await this.requireApprover(user?.sub);
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException("Leave request not found");
    if (leave.status !== "PENDING" && !(leave.status === "APPROVED" && !approved)) {
      throw new BadRequestException(`Request is already ${leave.status.toLowerCase()}`);
    }
    const now = new Date();
    const from = dateStrDhaka(leave.startDate);

    if (approved) {
      // Working-day deduction (weekends/holidays/closed days never consume quota).
      const working = await this.attendance.countWorkingDays(leave.employeeId, from, dateStrDhaka(leave.endDate));
      const period = `${leave.startDate.getFullYear()}`;
      let balanceBefore: number | null = null;
      let deducted = 0;
      if (leave.leaveType !== "UNPAID") {
        await this.ensureBalances(period, leave.employeeId);
        const balance = await this.prisma.leaveBalance.findUnique({
          where: { employeeId_leaveType_period: { employeeId: leave.employeeId, leaveType: leave.leaveType, period } },
        });
        balanceBefore = balance ? Number(balance.balanceDays) : 0;
        if (balanceBefore < working.working) {
          throw new BadRequestException(
            `Insufficient ${leave.leaveType} balance (${balanceBefore} day(s) left, needs ${working.working})`
          );
        }
        deducted = working.working;
        if (balance && deducted > 0) {
          await this.prisma.leaveBalance.update({
            where: { id: balance.id },
            data: { balanceDays: Math.max(0, balanceBefore - deducted) },
          });
        }
      }
      const updated = await this.prisma.leaveRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedById: approver.id,
          workingDays: working.working,
          deductedDays: deducted,
          balanceBefore,
          balanceAfter: balanceBefore != null ? Math.max(0, balanceBefore - deducted) : null,
          decidedAt: now,
          decisionNote: note ?? null,
        },
      });
      await this.afterDecision(leave);
      await this.notifyLeaveStatus(leave, true);
      return updated;
    }

    // Reject — and if it was approved before, put the days back.
    if (leave.status === "APPROVED" && leave.leaveType !== "UNPAID" && Number(leave.deductedDays ?? 0) > 0) {
      const period = `${leave.startDate.getFullYear()}`;
      const balance = await this.prisma.leaveBalance.findUnique({
        where: { employeeId_leaveType_period: { employeeId: leave.employeeId, leaveType: leave.leaveType, period } },
      });
      if (balance) {
        await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: { balanceDays: Number(balance.balanceDays) + Number(leave.deductedDays) },
        });
      }
    }
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedById: approver.id,
        deductedDays: 0,
        decidedAt: now,
        decisionNote: note ?? null,
      },
    });
    await this.afterDecision(leave);
    await this.notifyLeaveStatus(leave, false);
    return updated;
  }

  /** Attendance + caches must reflect the decision on the affected days. */
  private async afterDecision(leave: { employeeId: string; startDate: Date; endDate: Date }) {
    const from = dateStrDhaka(leave.startDate);
    const to = dateStrDhaka(leave.endDate);
    for (const d of eachDayStr(from, to)) {
      await this.attendance.recomputeDay(leave.employeeId, d).catch(() => {});
    }
    await invalidatePeopleCache(this.cache);
  }

  private async notifyLeaveStatus(leave: { id: string; employeeId: string; leaveType: string; startDate: Date; endDate: Date }, approved: boolean) {
    try {
      const userId = await this.notifications.userIdForEmployee(leave.employeeId);
      if (userId) {
        await this.notifications.create(
          userId,
          "LEAVE_STATUS",
          approved ? "Leave approved" : "Leave rejected",
          `Your ${leave.leaveType} leave (${dateStrDhaka(leave.startDate)} → ${dateStrDhaka(leave.endDate)}) was ${approved ? "approved" : "rejected"}.`,
          `/people/leave?request=${leave.id}`
        );
      }
    } catch {}
  }

  async leaveBalances(employeeId?: string) {
    return this.prisma.leaveBalance.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: [{ employee: { name: "asc" } }, { period: "desc" }],
    });
  }
}
