import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { OnboardingService } from "./onboarding.service";
import { dateStrDhaka, invalidatePeopleCache } from "./people-utils";

/** UTC-midnight labelled with today's Dhaka date — matches `attendance.date`. */
const todayColumn = () => new Date(`${dateStrDhaka(new Date())}T00:00:00.000Z`);

/** Compensation is only visible to Owner / HR — enforced on read, not just in the UI. */
const canSeePay = (user: any) => ["Owner", "HR/Admin"].includes(user?.role);
const stripPay = <T extends { salary?: any; costRate?: any }>(e: T, user: any): T =>
  canSeePay(user) ? e : { ...e, salary: null, costRate: null };
@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly onboarding: OnboardingService
  ) {}

  async overview() {    return this.cache.wrap("people:overview", 30, async () => {
      const today = todayColumn();
      const [employees, attendance, leaves, utilLogs] = await Promise.all([
        this.prisma.employee.findMany({
          select: { id: true, name: true, roleTitle: true, employmentStatus: true, department: true },
        }),
        this.prisma.attendance.findMany({ where: { date: today } }),
        this.prisma.leaveRequest.findMany({ where: { status: "APPROVED" } }),
        this.prisma.utilizationLog.groupBy({ by: ["employeeId"], _max: { weekStartDate: true } }),
      ]);
      const latestLogs = await this.prisma.utilizationLog.findMany({
        where: { OR: utilLogs.map((u) => ({ employeeId: u.employeeId, weekStartDate: u._max.weekStartDate! })) },
        select: { utilizationRate: true },
      });
      const present = attendance.filter((a) => a.status !== "ABSENT").length;
      const onLeave = leaves.filter((l) => l.startDate <= today && l.endDate >= today).length;
      const avgUtil = latestLogs.length
        ? Math.round((latestLogs.reduce((s, l) => s + l.utilizationRate, 0) / latestLogs.length) * 100)
        : 0;
      const overloaded = latestLogs.filter((l) => l.utilizationRate >= 1.05).length;
      return {
        totalEmployees: employees.length,
        activeEmployees: employees.filter((e) => e.employmentStatus === "ACTIVE").length,
        presentToday: present,
        onLeaveToday: onLeave,
        avgUtilization: avgUtil,
        overloaded,
        absentToday: attendance.filter((a) => a.status === "ABSENT").length,
      };
    });
  }

  async employees(user?: any) {
    // NOTE: cache key is role-split — compensation is stripped for non-HR.
    return this.cache.wrap(canSeePay(user) ? "people:employees" : "people:employees:masked", 30, async () => {
      const utilLogs = await this.prisma.utilizationLog.groupBy({ by: ["employeeId"], _max: { weekStartDate: true } });
      const latestLogs = await this.prisma.utilizationLog.findMany({
        where: { OR: utilLogs.map((u) => ({ employeeId: u.employeeId, weekStartDate: u._max.weekStartDate! })) },
        select: { employeeId: true, utilizationRate: true, billableHours: true },
      });
      const today = todayColumn();
      const attendance = await this.prisma.attendance.findMany({ where: { date: today } });
      const employees = await this.prisma.employee.findMany({
        include: {
          reportingManager: { select: { name: true } },
          user: { select: { email: true } },
          _count: { select: { tasks: true, leaveRequests: true } },
        },
        orderBy: { name: "asc" },
      });
      return employees.map((e) => {
        const util = latestLogs.find((l) => l.employeeId === e.id);
        const att = attendance.find((a) => a.employeeId === e.id);
        return stripPay({
          ...e,
          utilizationRate: util?.utilizationRate ?? null,
          billableHours: util ? Number(util.billableHours) : null,
          todayStatus: att?.status ?? "NOT_LOGGED",
        }, user);
      });
    });
  }

  async employeeDetail(id: string, user?: any) {
    const detail = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: { select: { email: true } },
        reportingManager: { select: { id: true, name: true, roleTitle: true } },
        reports: { select: { id: true, name: true, roleTitle: true }, orderBy: { name: "asc" } },
        attendance: { orderBy: { date: "desc" }, take: 30 },
        leaveRequests: { orderBy: { appliedAt: "desc" }, take: 10 },
        leaveBalances: true,
        payrollRecords: { orderBy: { createdAt: "desc" }, take: 6 },
        performanceReviews: { orderBy: { createdAt: "desc" }, take: 3 },
        utilizationLogs: { orderBy: { weekStartDate: "desc" }, take: 6 },
        tasks: { where: { status: { not: "DONE" } }, take: 10, include: { project: { select: { name: true } } } },
        okrs: { orderBy: { createdAt: "desc" } },
        enrollments: { include: { course: true } },
        checklists: { include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { startedAt: "desc" } },
        assets: { select: { id: true, tag: true, name: true, category: true, status: true, assignedAt: true }, orderBy: { assignedAt: "desc" } },
      },
    });
    if (!detail) throw new NotFoundException("Employee not found");
    const payrollRecords = canSeePay(user)
      ? detail.payrollRecords
      : detail.payrollRecords.map((p: any) => ({ ...p, basicSalary: null, netPay: null, allowances: null, bonus: null, deductions: null, lateDeduction: null, halfDayDeduction: null, absentDeduction: null, unpaidLeaveDeduction: null }));
    return stripPay({ ...detail, payrollRecords }, user);
  }

  async createEmployee(body: any, user?: any) {
    if (!body.name?.trim()) {
      throw new BadRequestException("Employee name is required");
    }
    if (body.salary !== undefined && !["Owner", "HR/Admin"].includes(user?.role)) {
      throw new ForbiddenException("Only Owner or HR/Admin can set salary");
    }
    const result = await this.prisma.employee.create({
      data: {
        name: body.name,
        roleTitle: body.roleTitle,
        department: body.department ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        workLocation: body.workLocation ?? "Remote",
        employmentType: body.employmentType ?? "full-time",
        salary: body.salary ?? null,
        payFrequency: body.payFrequency ?? "monthly",
        documents: body.documents ?? [],
        careerHistory: body.careerHistory ?? [],
        education: body.education ?? null,
        emergencyContactName: body.emergencyContactName ?? null,
        emergencyContactPhone: body.emergencyContactPhone ?? null,
        emergencyContactRelation: body.emergencyContactRelation ?? null,
        joinDate: body.joinDate ? new Date(body.joinDate) : new Date(),
        reportingManagerId: body.reportingManagerId ?? null,
        employmentStatus: body.employmentStatus ?? "ACTIVE",
        costRate: body.costRate ?? null,
        skillTags: body.skillTags ?? [],
        deviceId: body.deviceId ?? null,
        weeklyOffDays: body.weeklyOffDays ?? [],
        shiftStart: body.shiftStart ?? null,
        shiftEnd: body.shiftEnd ?? null,
        graceMinutes: body.graceMinutes ?? null,
      },
    });
    await invalidatePeopleCache(this.cache);
    // Onboarding starts itself — a new hire's first week usually slips because
    // nobody remembered to open the checklist.
    await this.onboarding.autoStartOnboarding(result.id);
    return result;
  }

  async updateEmployee(id: string, body: any, user?: any) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Employee not found");
    const sensitive = ["salary", "costRate", "deviceId", "weeklyOffDays", "shiftStart", "shiftEnd", "graceMinutes"];
    if (sensitive.some((f) => body[f] !== undefined) && !["Owner", "HR/Admin"].includes(user?.role)) {
      throw new ForbiddenException("Only Owner or HR/Admin can change salary, device mapping or schedule");
    }
    const data: any = {};
    for (const f of ["name", "roleTitle", "department", "email", "phone", "workLocation", "employmentType", "employmentStatus", "reportingManagerId", "skillTags", "documents", "careerHistory", "education", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation", "costRate", "deviceId", "weeklyOffDays", "shiftStart", "shiftEnd", "graceMinutes"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.salary !== undefined) data.salary = body.salary;
    if (body.payFrequency !== undefined) data.payFrequency = body.payFrequency;
    if (body.joinDate !== undefined) data.joinDate = new Date(body.joinDate);
    const result = await this.prisma.employee.update({ where: { id }, data });
    await invalidatePeopleCache(this.cache);
    // Exiting an employee opens the offboarding run so gear and access are
    // actually collected instead of living in someone's memory.
    if (body.employmentStatus === "EXITED" && existing.employmentStatus !== "EXITED") {
      await this.onboarding.autoStartOffboarding(id);
    }
    return result;
  }

  async deleteEmployee(id: string) {
    await this.prisma.employee.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Employee not found");
    });
    await invalidatePeopleCache(this.cache);
    return { ok: true };
  }

  // ── Org chart ────────────────────────────────────────────────────────
  /**
   * Returns a real tree, not a flat list. The UI drew one row per employee and
   * badged every row "Lead" because it expected `directReports` that the API
   * never produced. Parents are matched by `reportingManagerId`, and anyone
   * caught in a reporting cycle is promoted to a root so the chart cannot lose
   * people silently.
   */
  async orgChart() {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: { not: "EXITED" } },
      select: {
        id: true,
        name: true,
        roleTitle: true,
        department: true,
        reportingManagerId: true,
        employmentStatus: true,
        email: true,
        workLocation: true,
        _count: { select: { reports: true } },
      },
      orderBy: { name: "asc" },
    });

    type Node = (typeof employees)[number] & { directReports: Node[] };
    const byId = new Map<string, Node>();
    for (const e of employees) byId.set(e.id, { ...e, directReports: [] });

    const roots: Node[] = [];
    for (const node of byId.values()) {
      const parent = node.reportingManagerId ? byId.get(node.reportingManagerId) : null;
      if (parent && parent.id !== node.id) parent.directReports.push(node);
      else roots.push(node);
    }

    // Promote cycle members (A→B→A) that never got a root.
    const seen = new Set<string>();
    const walk = (n: Node) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      n.directReports.forEach(walk);
    };
    roots.forEach(walk);
    for (const node of byId.values()) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        walk(node);
        roots.push(node);
      }
    }

    const sortRec = (list: Node[]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((n) => sortRec(n.directReports));
    };
    sortRec(roots);
    return roots;
  }

  // ── Skills matrix ────────────────────────────────────────────────────
  async skillsMatrix() {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: { not: "EXITED" } },
      select: { id: true, name: true, roleTitle: true, department: true, skillTags: true, joinDate: true },
    });
    const map = new Map<string, { employees: string[]; departments: Set<string>; avgYears: number[] }>();
    for (const e of employees) {
      for (const skill of e.skillTags) {
        const entry = map.get(skill) ?? { employees: [], departments: new Set<string>(), avgYears: [] };
        entry.employees.push(e.name);
        entry.departments.add(e.department ?? "General");
        entry.avgYears.push(Math.max(0, (Date.now() - e.joinDate.getTime()) / (365 * 86400000)));
        map.set(skill, entry);
      }
    }
    return Array.from(map.entries()).map(([skill, v]) => ({
      skill,
      count: v.employees.length,
      employees: v.employees,
      departments: Array.from(v.departments),
      avgExperience: Math.round((v.avgYears.reduce((s, y) => s + y, 0) / v.avgYears.length) * 10) / 10,
    })).sort((a, b) => b.count - a.count);
  }

  async utilizationTrend() {
    return this.cache.wrap("people:utilization", 60, () => this.utilizationTrendCompute());
  }

  private async utilizationTrendCompute() {
    const weeks = await this.prisma.utilizationLog.groupBy({
      by: ["weekStartDate"],
      orderBy: { weekStartDate: "desc" },
      take: 4,
    });
    const sortedWeeks = [...weeks.map((w) => w.weekStartDate)].sort((a, b) => a.getTime() - b.getTime());
    const logs = await this.prisma.utilizationLog.findMany({
      where: { weekStartDate: { in: sortedWeeks } },
      include: { employee: { select: { name: true } } },
    });
    const rows = new Map<string, number[]>();
    const weekIndex = new Map(sortedWeeks.map((w, i) => [w.getTime(), i]));
    for (const l of logs) {
      const arr = rows.get(l.employee.name) ?? new Array(sortedWeeks.length).fill(0);
      const idx = weekIndex.get(l.weekStartDate.getTime());
      if (idx !== undefined) arr[idx] = l.utilizationRate;
      rows.set(l.employee.name, arr);
    }
    return {
      weeks: sortedWeeks.map((w) => w.toLocaleDateString("en-US", { month: "short", day: "numeric" })),
      rows: Array.from(rows.entries()).map(([name, values]) => ({ name, values })),
    };
  }
}
