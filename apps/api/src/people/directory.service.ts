import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { invalidatePeopleCache } from "./people-utils";

@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async overview() {
    return this.cache.wrap("people:overview", 30, async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
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

  async employees() {
    return this.cache.wrap("people:employees", 30, async () => {
      const utilLogs = await this.prisma.utilizationLog.groupBy({ by: ["employeeId"], _max: { weekStartDate: true } });
      const latestLogs = await this.prisma.utilizationLog.findMany({
        where: { OR: utilLogs.map((u) => ({ employeeId: u.employeeId, weekStartDate: u._max.weekStartDate! })) },
        select: { employeeId: true, utilizationRate: true, billableHours: true },
      });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
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
        return {
          ...e,
          utilizationRate: util?.utilizationRate ?? null,
          billableHours: util ? Number(util.billableHours) : null,
          todayStatus: att?.status ?? "NOT_LOGGED",
        };
      });
    });
  }

  async employeeDetail(id: string) {
    return this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: { select: { email: true } },
        reportingManager: { select: { id: true, name: true } },
        attendance: { orderBy: { date: "desc" }, take: 30 },
        leaveRequests: { orderBy: { appliedAt: "desc" }, take: 10 },
        leaveBalances: true,
        payrollRecords: { orderBy: { createdAt: "desc" }, take: 6 },
        performanceReviews: { orderBy: { createdAt: "desc" }, take: 3 },
        utilizationLogs: { orderBy: { weekStartDate: "desc" }, take: 6 },
        tasks: { where: { status: { not: "DONE" } }, take: 10, include: { project: { select: { name: true } } } },
        okrs: { orderBy: { createdAt: "desc" } },
        enrollments: { include: { course: true } },
      },
    });
  }

  async createEmployee(body: any, user?: any) {
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
    for (const f of ["name", "roleTitle", "department", "email", "phone", "workLocation", "employmentType", "employmentStatus", "reportingManagerId", "skillTags", "documents", "careerHistory", "costRate", "deviceId", "weeklyOffDays", "shiftStart", "shiftEnd", "graceMinutes"]) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (body.salary !== undefined) data.salary = body.salary;
    if (body.payFrequency !== undefined) data.payFrequency = body.payFrequency;
    if (body.joinDate !== undefined) data.joinDate = new Date(body.joinDate);
    const result = await this.prisma.employee.update({ where: { id }, data });
    await invalidatePeopleCache(this.cache);
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
  async orgChart() {
    const employees = await this.prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        roleTitle: true,
        department: true,
        reportingManagerId: true,
        employmentStatus: true,
        _count: { select: { reports: true } },
      },
      orderBy: { name: "asc" },
    });
    return employees;
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
