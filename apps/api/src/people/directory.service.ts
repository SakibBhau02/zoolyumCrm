import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { OnboardingService } from "./onboarding.service";
import { canManageHrFields, canPeople, canSeePay, dateStrDhaka, invalidatePeopleCache } from "./people-utils";
import { mediaDir, removeOptimizedImage, uploadFilename } from "../common/image-pipeline";

/** UTC-midnight labelled with today's Dhaka date — matches `attendance.date`. */
const todayColumn = () => new Date(`${dateStrDhaka(new Date())}T00:00:00.000Z`);

/** Full company directory needs PEOPLE view; everyone else gets a picker shape. */
const canViewPeople = (user: any) => canPeople(user, "view");
const stripPay = <T extends { salary?: any; costRate?: any }>(e: T, user: any): T =>
  canSeePay(user) ? e : { ...e, salary: null, costRate: null };
/** Emergency contacts and contract documents are HR-only. */
const stripPrivate = <T extends Record<string, any>>(e: T, user: any): T =>
  canSeePay(user) ? e : { ...e, emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelation: null, documents: [] };
const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "EXITED"] as const;
const cleanText = (v: any): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const assertManager = async (prisma: PrismaService, managerId: any, selfId?: string) => {
  if (managerId === undefined) return undefined;
  if (managerId === null || managerId === "") return null;
  const id = String(managerId);
  if (selfId && id === selfId) throw new BadRequestException("An employee cannot report to themselves");
  const exists = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new BadRequestException("reportingManagerId does not match any employee");
  return id;
};
const assertStatus = (status: any) => {
  if (status === undefined) return undefined;
  if (!EMPLOYMENT_STATUSES.includes(status)) {
    throw new BadRequestException(`employmentStatus must be one of ${EMPLOYMENT_STATUSES.join(", ")}`);
  }
  return status;
};
const assertMoney = (v: any, field: string) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field} must be a positive number`);
  return n;
};
@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly onboarding: OnboardingService
  ) {}

  async overview() {    return this.cache.wrap("people:overview", 30, async () => {
      const today = todayColumn();
      const [employees, attendanceByStatus, onLeave, latestLogs] = await Promise.all([
        this.prisma.employee.findMany({
          select: { id: true, name: true, roleTitle: true, employmentStatus: true, department: true },
        }),
        this.prisma.attendance.groupBy({ by: ["status"], where: { date: today }, _count: { _all: true } }),
        // Count today's approved leave in SQL. Loading every approved leave ever
        // recorded just to filter by date made this grow with company history.
        this.prisma.leaveRequest.count({
          where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
        }),
        this.prisma.$queryRaw<{ utilizationRate: number }[]>`
          SELECT DISTINCT ON ("employeeId") "utilizationRate"
          FROM "UtilizationLog"
          ORDER BY "employeeId", "weekStartDate" DESC
        `,
      ]);
      const present = attendanceByStatus
        .filter((a) => a.status !== "ABSENT")
        .reduce((s, a) => s + a._count._all, 0);
      const absent = attendanceByStatus.find((a) => a.status === "ABSENT")?._count._all ?? 0;
      const avgUtil = latestLogs.length
        ? Math.round((latestLogs.reduce((s, l) => s + Number(l.utilizationRate), 0) / latestLogs.length) * 100)
        : 0;
      const overloaded = latestLogs.filter((l) => Number(l.utilizationRate) >= 1.05).length;
      return {
        totalEmployees: employees.length,
        activeEmployees: employees.filter((e) => e.employmentStatus === "ACTIVE").length,
        presentToday: present,
        onLeaveToday: onLeave,
        avgUtilization: avgUtil,
        overloaded,
        absentToday: absent,
      };
    });
  }

  async employees(user?: any) {
    // `@SkipPermission` so pickers work for every signed-in user, but the shape
    // follows the caller's rights: full directory for PEOPLE viewers, a minimal
    // picker list (id/name/role) for everyone else.
    const full = canViewPeople(user);
    const key = !full ? "people:employees:minimal" : canSeePay(user) ? "people:employees" : "people:employees:masked";
    return this.cache.wrap(key, 30, async () => {
      const latestLogs = await this.prisma.$queryRaw<
        { employeeId: string; utilizationRate: number; billableHours: number }[]
      >`
        SELECT DISTINCT ON ("employeeId") "employeeId", "utilizationRate", "billableHours"
        FROM "UtilizationLog"
        ORDER BY "employeeId", "weekStartDate" DESC
      `;
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
      if (!full) {
        // Enough for an assignee / attendee dropdown, nothing more.
        return employees.map((e) => ({
          id: e.id,
          name: e.name,
          roleTitle: e.roleTitle,
          department: e.department,
          employmentStatus: e.employmentStatus,
          workLocation: e.workLocation,
          photoUrl: e.photoUrl,
          photoJxlUrl: e.photoJxlUrl,
        }));
      }
      return employees.map((e) => {
        const util = latestLogs.find((l) => l.employeeId === e.id);
        const att = attendance.find((a) => a.employeeId === e.id);
        return stripPrivate(stripPay({
          ...e,
          utilizationRate: util?.utilizationRate ?? null,
          billableHours: util ? Number(util.billableHours) : null,
          todayStatus: att?.status ?? "NOT_LOGGED",
        }, user), user);
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
      : detail.payrollRecords.map((p: any) => ({
          ...p,
          basicSalary: null,
          netPay: null,
          allowances: null,
          bonus: null,
          deductions: null,
          lateDeduction: null,
          halfDayDeduction: null,
          absentDeduction: null,
          unpaidLeaveDeduction: null,
          // breakdown holds the daily rate and auditTrail holds before/after
          // net pay — both leaked the salary even though netPay was nulled.
          breakdown: null,
          auditTrail: [],
        }));
    return stripPrivate(stripPay({ ...detail, payrollRecords }, user), user);
  }

  async createEmployee(body: any, user?: any) {
    if (!body.name?.trim()) {
      throw new BadRequestException("Employee name is required");
    }
    if (!body.roleTitle?.trim()) {
      throw new BadRequestException("roleTitle is required");
    }
    if (body.salary !== undefined && !canManageHrFields(user)) {
      throw new ForbiddenException("Only HR roles (People → Approve) can set salary");
    }
    const managerId = await assertManager(this.prisma, body.reportingManagerId);
    const status = assertStatus(body.employmentStatus);
    const joinDate = body.joinDate ? new Date(body.joinDate) : new Date();
    if (Number.isNaN(joinDate.getTime())) throw new BadRequestException("joinDate must be a valid date");
    const result = await this.prisma.employee.create({
      data: {
        name: String(body.name).trim(),
        roleTitle: String(body.roleTitle).trim(),
        department: cleanText(body.department),
        email: cleanText(body.email),
        phone: cleanText(body.phone),
        workLocation: cleanText(body.workLocation) ?? "Remote",
        employmentType: cleanText(body.employmentType) ?? "full-time",
        salary: assertMoney(body.salary, "salary"),
        payFrequency: cleanText(body.payFrequency) ?? "monthly",
        documents: body.documents ?? [],
        careerHistory: body.careerHistory ?? [],
        education: cleanText(body.education),
        emergencyContactName: cleanText(body.emergencyContactName),
        emergencyContactPhone: cleanText(body.emergencyContactPhone),
        emergencyContactRelation: cleanText(body.emergencyContactRelation),
        joinDate,
        reportingManagerId: managerId ?? null,
        employmentStatus: status ?? "ACTIVE",
        costRate: assertMoney(body.costRate, "costRate"),
        skillTags: Array.isArray(body.skillTags) ? body.skillTags : [],
        deviceId: cleanText(body.deviceId),
        weeklyOffDays: Array.isArray(body.weeklyOffDays) ? body.weeklyOffDays : [],
        shiftStart: cleanText(body.shiftStart),
        shiftEnd: cleanText(body.shiftEnd),
        graceMinutes: body.graceMinutes === undefined || body.graceMinutes === "" || body.graceMinutes === null ? null : Number(body.graceMinutes),
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
    if (sensitive.some((f) => body[f] !== undefined) && !canManageHrFields(user)) {
      throw new ForbiddenException("Only HR roles (People → Approve) can change salary, device mapping or schedule");
    }
    const managerId = await assertManager(this.prisma, body.reportingManagerId, id);
    const status = assertStatus(body.employmentStatus);
    const data: any = {};
    for (const f of ["roleTitle", "department", "email", "phone", "workLocation", "employmentType", "education", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation", "payFrequency", "deviceId", "shiftStart", "shiftEnd"]) {
      if (body[f] !== undefined) data[f] = cleanText(body[f]);
    }
    if (body.name !== undefined) {
      if (!body.name?.trim()) throw new BadRequestException("Employee name is required");
      data.name = String(body.name).trim();
    }
    for (const f of ["skillTags", "documents", "careerHistory", "weeklyOffDays"]) {
      if (body[f] !== undefined) {
        if (!Array.isArray(body[f])) throw new BadRequestException(`${f} must be an array`);
        data[f] = body[f];
      }
    }
    if (body.salary !== undefined) data.salary = assertMoney(body.salary, "salary");
    if (body.costRate !== undefined) data.costRate = assertMoney(body.costRate, "costRate");
    if (body.graceMinutes !== undefined) {
      data.graceMinutes = body.graceMinutes === "" || body.graceMinutes === null ? null : Number(body.graceMinutes);
      if (data.graceMinutes !== null && !Number.isFinite(data.graceMinutes)) throw new BadRequestException("graceMinutes must be a number");
    }
    if (managerId !== undefined) data.reportingManagerId = managerId;
    if (status !== undefined) data.employmentStatus = status;
    if (body.joinDate !== undefined) {
      const jd = new Date(body.joinDate);
      if (Number.isNaN(jd.getTime())) throw new BadRequestException("joinDate must be a valid date");
      data.joinDate = jd;
    }
    const result = await this.prisma.employee.update({ where: { id }, data });
    await invalidatePeopleCache(this.cache);
    // Exiting an employee opens the offboarding run so gear and access are
    // actually collected instead of living in someone's memory.
    if (status === "EXITED" && existing.employmentStatus !== "EXITED") {
      await this.onboarding.autoStartOffboarding(id);
    }
    return result;
  }

  /**
   * Staff photo. Stored as WebP with an optional JPEG XL sibling; the previous
   * pair is deleted so the uploads folder stays bounded.
   */
  async setPhoto(id: string, photoUrl: string, photoJxlUrl: string | null) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { photoUrl: true, photoJxlUrl: true },
    });
    if (!employee) throw new NotFoundException("Employee not found");
    const updated = await this.prisma.employee.update({
      where: { id },
      data: { photoUrl, photoJxlUrl },
    });
    await removeOptimizedImage(mediaDir("people"), uploadFilename(employee.photoUrl), uploadFilename(employee.photoJxlUrl));
    await invalidatePeopleCache(this.cache);
    return { id: updated.id, photoUrl, photoJxlUrl };
  }

  async removePhoto(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { photoUrl: true, photoJxlUrl: true },
    });
    if (!employee) throw new NotFoundException("Employee not found");
    await this.prisma.employee.update({ where: { id }, data: { photoUrl: null, photoJxlUrl: null } });
    await removeOptimizedImage(mediaDir("people"), uploadFilename(employee.photoUrl), uploadFilename(employee.photoJxlUrl));
    await invalidatePeopleCache(this.cache);
    return { id, photoUrl: null, photoJxlUrl: null };
  }

  async deleteEmployee(id: string) {
    await this.prisma.employee.delete({ where: { id } }).catch((err) => {
      if (err?.code === "P2025") throw new NotFoundException("Employee not found");
      if (err?.code === "P2003") {
        throw new BadRequestException(
          "This employee still has attendance, payroll, tasks or reportees attached. Set their status to EXITED instead of deleting."
        );
      }
      throw err;
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
