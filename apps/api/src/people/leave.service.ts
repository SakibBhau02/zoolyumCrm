import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";
import { assertDay, dateStrDhaka, eachDayStr, invalidatePeopleCache, leaveDays } from "./people-utils";
import { AttendanceService } from "./attendance.service";

const APPROVER_ROLES = ["Owner", "HR/Admin", "Admin", "Project Manager"];

@Injectable()
export class LeaveService {
  private readonly logger = new Logger("Leave");

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
    // A changed quota must reach the people who already have a balance row.
    // Without this, raising casual leave 10 → 15 days did nothing that year.
    await this.ensureBalances(undefined, undefined, false, true);
    return out;
  }

  /**
   * (Re)create balance rows for a year from the quota table. Existing rows are
   * left untouched unless `reset` (delete + recreate) or `resync` (set balance
   * = annualDays − approved days already taken) is requested.
   */
  async ensureBalances(period?: string, employeeId?: string, reset = false, resync = false) {
    const year = period && /^\d{4}$/.test(period) ? period : dateStrDhaka(new Date()).slice(0, 4);
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
    // Approved days already consumed this year, so a resync starts from facts
    // instead of assuming nothing was taken.
    const used = new Map<string, number>();
    if (resync) {
      const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
      const yearEnd = new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`);
      const approved = await this.prisma.leaveRequest.findMany({
        where: {
          status: "APPROVED",
          startDate: { gte: yearStart, lt: yearEnd },
          ...(employeeId ? { employeeId } : {}),
        },
        select: { employeeId: true, leaveType: true, deductedDays: true },
      });
      for (const l of approved) {
        const key = `${l.employeeId}|${l.leaveType}`;
        used.set(key, (used.get(key) ?? 0) + Number(l.deductedDays ?? 0));
      }
    }
    let created = 0;
    let updated = 0;
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
        } else if (resync) {
          const target = Math.max(0, Number(p.annualDays) - (used.get(`${emp.id}|${p.leaveType}`) ?? 0));
          if (Math.abs(Number(existing.balanceDays) - target) > 0.001) {
            await this.prisma.leaveBalance.update({ where: { id: existing.id }, data: { balanceDays: target } });
            updated++;
          }
        }
      }
    }
    return { period: year, created, updated, employees: employees.length, types: policies.length };
  }

  async leaveRequests(scopeEmployeeId?: string | null) {
    return this.prisma.leaveRequest.findMany({
      where: scopeEmployeeId ? { employeeId: scopeEmployeeId } : undefined,
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
      const period = dateStrDhaka(r.startDate).slice(0, 4);
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
    if (!body?.employeeId) throw new BadRequestException("employeeId is required");
    // Staff without HR rights may only apply for themselves. This used to fall
    // back to the client-supplied employeeId when the account had no linked
    // employee row — an authorization check that degraded to "allow".
    const role = user?.role ?? "";
    const isHr = /owner|hr|admin/i.test(role);
    if (!isHr) {
      if (!user?.sub) throw new ForbiddenException("Login required");
      const self = await this.prisma.employee.findFirst({ where: { user: { id: user.sub } }, select: { id: true } });
      if (!self) throw new ForbiddenException("No employee record is linked to your account — ask HR to link it in Directory.");
      body = { ...body, employeeId: self.id };
    }
    const emp = await this.prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, name: true } });
    if (!emp) throw new NotFoundException("Employee not found");
    const valid = ["CASUAL", "SICK", "EARNED", "UNPAID"];
    if (!valid.includes(body.leaveType)) throw new BadRequestException(`Unknown leave type: ${body.leaveType}`);
    const start = new Date(`${assertDay(body.startDate, "startDate")}T00:00:00.000Z`);
    const end = new Date(`${assertDay(body.endDate, "endDate")}T00:00:00.000Z`);
    if (end < start) {
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
      const period = dateStrDhaka(leave.startDate).slice(0, 4);
      await this.ensureBalances(period, leave.employeeId);
      // Balance check + decrement + status flip happen in one transaction and
      // the decrement is conditional (balanceDays >= needed). Two approvers
      // clicking at once used to both pass the read and both deduct.
      const updated = await this.prisma.$transaction(async (tx) => {
        let balanceBefore: number | null = null;
        let deducted = 0;
        if (leave.leaveType !== "UNPAID") {
          const balance = await tx.leaveBalance.findUnique({
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
            const dec = await tx.leaveBalance.updateMany({
              where: { id: balance.id, balanceDays: { gte: deducted } },
              data: { balanceDays: { decrement: deducted } },
            });
            if (dec.count === 0) throw new BadRequestException("Balance changed while approving — refresh and retry");
          }
        }
        const moved = await tx.leaveRequest.updateMany({
          where: { id, status: "PENDING" },
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
        if (moved.count === 0) throw new BadRequestException("Request was already decided — refresh and retry");
        return tx.leaveRequest.findUnique({ where: { id } });
      });
      await this.afterDecision(leave);
      await this.notifyLeaveStatus(leave, true);
      return updated;
    }

    // Reject — and if it was approved before, put the days back (never above
    // the yearly entitlement, otherwise a reject after a reset inflates it).
    const period = dateStrDhaka(leave.startDate).slice(0, 4);
    const refund = leave.status === "APPROVED" && leave.leaveType !== "UNPAID" ? Number(leave.deductedDays ?? 0) : 0;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (refund > 0) {
        const [balance, policy] = await Promise.all([
          tx.leaveBalance.findUnique({
            where: { employeeId_leaveType_period: { employeeId: leave.employeeId, leaveType: leave.leaveType, period } },
          }),
          tx.leavePolicy.findUnique({ where: { leaveType: leave.leaveType } }),
        ]);
        if (balance) {
          const cap = policy?.annualDays != null ? Number(policy.annualDays) : null;
          const next = Number(balance.balanceDays) + refund;
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { balanceDays: cap != null ? Math.min(cap, next) : next },
          });
        }
      }
      const moved = await tx.leaveRequest.updateMany({
        where: { id, status: { in: ["PENDING", "APPROVED"] } },
        data: {
          status: "REJECTED",
          approvedById: approver.id,
          deductedDays: 0,
          decidedAt: now,
          decisionNote: note ?? null,
        },
      });
      if (moved.count === 0) throw new BadRequestException("Request was already decided — refresh and retry");
      return tx.leaveRequest.findUnique({ where: { id } });
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
      // A failed refresh must not leave a silently stale attendance row.
      await this.attendance.recomputeDay(leave.employeeId, d).catch((err) => {
        this.logger.warn(`attendance refresh failed for ${leave.employeeId} ${d}: ${err?.message ?? err}`);
      });
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

  async leaveBalances(employeeId?: string, scopeEmployeeId?: string | null) {
    const where = scopeEmployeeId ? { employeeId: scopeEmployeeId } : employeeId ? { employeeId } : undefined;
    return this.prisma.leaveBalance.findMany({
      where,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: [{ employee: { name: "asc" } }, { period: "desc" }],
    });
  }

  /**
   * Which employee's leave data may this caller read?
   * `null` = company-wide (HR / approvers / PEOPLE editors), otherwise the
   * caller's own employee id, so a Team Member cannot enumerate the team's
   * sick-leave consumption through `?employeeId=`.
   */
  async scopeEmployeeId(user: any): Promise<string | null> {
    const role = String(user?.role ?? "");
    const canSeeAll = APPROVER_ROLES.includes(role) || user?.permissions?.PEOPLE?.edit === true;
    if (canSeeAll) return null;
    const self = await this.prisma.employee.findFirst({ where: { user: { id: user?.sub } }, select: { id: true } });
    return self?.id ?? "__none__";
  }
}
