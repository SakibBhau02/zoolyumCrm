import { Injectable, NotFoundException } from "@nestjs/common";
import { HealthStatus, ProjectStatus, ProjectType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";

@Injectable()
export class FlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService
  ) {}

  async overview() {
    return this.cache.wrap("flow:overview", 30, async () => {
      const [projects, tasks] = await Promise.all([
        this.prisma.project.findMany({
          select: { id: true, status: true, healthStatus: true, riskScore: true, budgetAmount: true, targetEndDate: true },
        }),
        this.prisma.task.findMany({ select: { projectId: true, status: true } }),
      ]);
      const byStatus: Record<string, number> = {};
      const byHealth: Record<string, number> = { ON_TRACK: 0, AT_RISK: 0, DELAYED: 0 };
      for (const p of projects) {
        byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
        if (p.healthStatus in byHealth) byHealth[p.healthStatus]++;
      }
      const active = projects.filter((p) => ["PLANNING", "ACTIVE"].includes(p.status));
      const avgRisk = active.length ? Math.round(active.reduce((s, p) => s + (p.riskScore ?? 0), 0) / active.length) : 0;
      const completion = projects.length
        ? Math.round((tasks.filter((t) => t.status === "DONE").length / Math.max(tasks.length, 1)) * 100)
        : 0;
      return { totalProjects: projects.length, active: active.length, byStatus, byHealth, avgRisk, completion };
    });
  }

  async list(query: { q?: string; status?: string; health?: string; clientId?: string; managerId?: string }) {
    return this.cache.wrapQuery("flow:list", query, 30, async () => {
      const where: any = {
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { client: { companyName: { contains: query.q, mode: "insensitive" } } },
              { assignedPm: { name: { contains: query.q, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status as ProjectStatus } : {}),
      ...(query.health ? { healthStatus: query.health as HealthStatus } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.managerId ? { assignedPmId: query.managerId } : {}),
    };
    const [projects, tasks] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true } },
          assignedPm: { select: { id: true, name: true } },
          _count: { select: { tasks: true, milestones: true } },
        },
        orderBy: [{ healthStatus: "asc" }, { createdAt: "desc" }],
      }),
      this.prisma.task.findMany({ where: { projectId: { not: null } }, select: { projectId: true, status: true } }),
    ]);
    const byProject: Record<string, { total: number; completed: number }> = {};
    for (const t of tasks) {
      if (!t.projectId) continue;
      byProject[t.projectId] ??= { total: 0, completed: 0 };
      byProject[t.projectId].total++;
      if (t.status === "DONE") byProject[t.projectId].completed++;
    }
    return projects.map((p) => ({
      ...p,
      tasksTotal: byProject[p.id]?.total ?? 0,
      tasksCompleted: byProject[p.id]?.completed ?? 0,
    }));
    });
  }

  async nextUid() {
    const rows = await this.prisma.project.findMany({ select: { uid: true } });
    const used = new Set(rows.map((r) => r.uid).filter(Boolean));
    let n = 1;
    while (used.has(`PJ-${String(n).padStart(4, "0")}`)) n++;
    return `PJ-${String(n).padStart(4, "0")}`;
  }

  async managers() {
    return this.prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  private nextBillingDate(start: string, interval?: string): Date | undefined {
    if (!interval) return undefined;
    const s = new Date(start);
    const days = interval === "7-days" ? 7 : interval === "15-days" ? 15 : interval === "30-days" ? 30 : undefined;
    if (days) return new Date(s.getTime() + days * 86400000);
    const next = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    return next;
  }

  async detail(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true } },
        assignedPm: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
        sourceLead: { select: { id: true, name: true, company: true, source: true, vertical: true, estimatedDealSize: true, contactEmail: true, contactPhone: true } },
        sourceProposal: { select: { id: true, versionNumber: true, status: true, fileUrl: true, portalLink: true, sentDate: true } },
        milestones: { orderBy: { dueDate: "asc" } },
        files: { include: { uploadedBy: { select: { name: true } } }, orderBy: { uploadedAt: "desc" } },
        riskLogs: { orderBy: { calculatedAt: "desc" }, take: 6 },
        tasks: {
          include: { assignedTo: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!project) throw new Error("Project not found");
    return project;
  }

  async create(body: any) {
    const uid = await this.nextUid();
    const project = await this.prisma.project.create({
      data: {
        uid,
        clientId: body.clientId,
        name: body.name,
        type: body.type ?? "FIXED",
        templateId: body.templateId,
        assignedPmId: body.assignedPmId,
        budgetAmount: body.budgetAmount ?? undefined,
        spentAmount: body.spentAmount ?? undefined,
        category: body.category ?? "",
        priority: body.priority ?? "MEDIUM",
        progress: body.progress ?? 0,
        team: body.team ?? [],
        billingType: body.billingType ?? "ONE_TIME",
        recurringInterval: body.recurringInterval,
        nextBillingDate: body.nextBillingDate ?? this.nextBillingDate(body.startDate ?? new Date().toISOString(), body.recurringInterval),
        monthlyRate: body.monthlyRate ?? undefined,
        totalBilled: body.totalBilled ?? 0,
        paymentStatus: body.paymentStatus ?? "PENDING",
        briefLink: body.briefLink,
        driveLink: body.driveLink,
        researchLink: body.researchLink,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        targetEndDate: body.targetEndDate ? new Date(body.targetEndDate) : undefined,
      },
    });
    await this.notifications.broadcast(
      "project_update",
      "New Project Created",
      `New project "${project.name}" has been created.`,
      "/flow"
    );
    await this.invalidateProjects();
    return project;
  }

  async update(id: string, body: any) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Project not found");
    const data: any = {};
    for (const field of [
      "name", "type", "templateId", "assignedPmId", "status", "healthStatus", "clientId",
      "category", "priority", "progress", "team", "billingType", "recurringInterval",
      "monthlyRate", "totalBilled", "paymentStatus", "briefLink", "driveLink", "researchLink",
      "riskScore", "riskDriver",
    ]) {
      if (body[field] !== undefined) data[field] = body[field];
    }
    if (body.budgetAmount !== undefined) data.budgetAmount = body.budgetAmount;
    if (body.spentAmount !== undefined) data.spentAmount = body.spentAmount;
    if (body.startDate !== undefined) data.startDate = new Date(body.startDate);
    if (body.targetEndDate !== undefined) data.targetEndDate = body.targetEndDate ? new Date(body.targetEndDate) : null;
    if (body.nextBillingDate !== undefined) data.nextBillingDate = body.nextBillingDate ? new Date(body.nextBillingDate) : null;
    else if (body.recurringInterval !== undefined && (body.startDate !== undefined || body.recurringInterval === null)) {
      data.nextBillingDate = body.recurringInterval === null ? null : this.nextBillingDate(body.startDate ?? existing.startDate.toISOString(), body.recurringInterval);
    }
    const result = await this.prisma.project.update({ where: { id }, data });
    await this.invalidateProjects();
    return result;
  }

  async remove(id: string) {
    await this.prisma.project.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Project not found");
    });
    await this.invalidateProjects();
    return { ok: true };
  }

  private async invalidateProjects() {
    await this.cache.del("flow:overview");
    await this.cache.delPattern("flow:list:*");
    await this.cache.del("tasks:stats");
    await this.cache.delPattern("tasks:list:*");
    await this.cache.del("dashboard:overview");
    await this.cache.del("insight:overview");
  }

  // ── CSV export / import ──────────────────────────────────────────────
  private statusMap(v: string): string {
    const s = v.trim().toLowerCase();
    if (s === "planning") return "PLANNING";
    if (s === "in-progress" || s === "in progress" || s === "active" || s === "review") return "ACTIVE";
    if (s === "completed" || s === "done") return "COMPLETED";
    if (s === "on-hold" || s === "on hold" || s === "paused") return "PAUSED";
    if (s === "archived") return "ARCHIVED";
    return v.toUpperCase();
  }

  private csvCell(v: unknown): string {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }

  async exportCsv(query: { q?: string; status?: string; clientId?: string; managerId?: string } = {}) {
    const rows = await this.list(query);
    const header = [
      "uid", "name", "client", "category", "status", "priority", "progress", "budget", "spent",
      "startDate", "dueDate", "billingType", "recurringInterval", "projectManager", "paymentStatus",
    ];
    const lines = [header.join(",")];
    for (const p of rows) {
      lines.push(
        [
          p.uid, p.name, p.client?.companyName ?? "", p.category ?? "", p.status, p.priority ?? "MEDIUM",
          p.progress ?? 0, Number(p.budgetAmount ?? 0), Number(p.spentAmount ?? 0),
          p.startDate ? p.startDate.toISOString().slice(0, 10) : "",
          p.targetEndDate ? p.targetEndDate.toISOString().slice(0, 10) : "",
          p.billingType, p.recurringInterval ?? "", p.assignedPm?.name ?? "", p.paymentStatus ?? "PENDING",
        ].map((v) => this.csvCell(v)).join(",")
      );
    }
    const filename = `projects_export_${new Date().toISOString().slice(0, 10)}.csv`;
    return { filename, content: lines.join("\n") };
  }

  async importCsv(buffer: Buffer) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return { imported: 0, skipped: [], total: lines.length - 1 };
    const parse = (line: string) =>
      line.split(",").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
    const header = parse(lines[0]).map((h) => h.toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const idx = {
      name: col("name"), client: col("client"), category: col("category"), status: col("status"),
      priority: col("priority"), progress: col("progress"), budget: col("budget"), spent: col("spent"),
      startDate: col("startdate"), dueDate: col("duedate"), billingType: col("billingtype"),
      recurringInterval: col("recurringinterval"), projectManager: col("projectmanager"),
      paymentStatus: col("paymentstatus"),
    };
    const [clients, users] = await Promise.all([
      this.prisma.client.findMany({ select: { id: true, companyName: true } }),
      this.prisma.user.findMany({ select: { id: true, name: true } }),
    ]);
    const clientByName = new Map(clients.map((c) => [c.companyName.toLowerCase(), c.id]));
    const userByName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));
    let imported = 0;
    const skipped: string[] = [];
    for (const line of lines.slice(1)) {
      const c = parse(line);
      const get = (i: number) => (i >= 0 ? c[i] ?? "" : "");
      const name = get(idx.name);
      const clientName = get(idx.client);
      const clientId = clientByName.get(clientName.toLowerCase());
      if (!name || !clientId) {
        skipped.push(name || clientName || "unknown");
        continue;
      }
      const billingType = get(idx.billingType).toLowerCase() === "recurring" ? "RECURRING" : "ONE_TIME";
      const interval = get(idx.recurringInterval);
      const startDate = get(idx.startDate) || new Date().toISOString().slice(0, 10);
      await this.prisma.project.create({
        data: {
          uid: await this.nextUid(),
          clientId,
          name,
          category: get(idx.category) || "General",
          status: this.statusMap(get(idx.status)) as ProjectStatus,
          priority: get(idx.priority).toUpperCase() || "MEDIUM",
          progress: Math.min(100, Math.max(0, Number(get(idx.progress)) || 0)),
          budgetAmount: Number(get(idx.budget)) || 0,
          spentAmount: Number(get(idx.spent)) || 0,
          startDate: new Date(startDate),
          targetEndDate: get(idx.dueDate) ? new Date(get(idx.dueDate)) : undefined,
          billingType,
          recurringInterval: billingType === "RECURRING" ? (interval || "30-days") : undefined,
          nextBillingDate: billingType === "RECURRING" ? this.nextBillingDate(startDate, interval || "30-days") : undefined,
          assignedPmId: userByName.get(get(idx.projectManager).toLowerCase()),
          paymentStatus: get(idx.paymentStatus).toUpperCase() || "PENDING",
        },
      });
      imported++;
    }
    return { imported, skipped, total: lines.length - 1 };
  }

  // ── Milestones ───────────────────────────────────────────────────────
  async addMilestone(projectId: string, body: { name: string; dueDate?: string; clientVisible?: boolean }) {
    return this.prisma.milestone.create({
      data: {
        projectId,
        name: body.name,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        clientVisible: body.clientVisible ?? false,
      },
    });
  }

  async updateMilestone(id: string, body: any) {
    const data: any = {};
    for (const field of ["name", "status", "clientVisible"]) {
      if (body[field] !== undefined) data[field] = body[field];
    }
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.status === "COMPLETED" && !body.completedAt) data.completedAt = new Date();
    return this.prisma.milestone.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException("Milestone not found");
    });
  }

  async deleteMilestone(id: string) {
    await this.prisma.milestone.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Milestone not found");
    });
    return { ok: true };
  }

  // ── Files ────────────────────────────────────────────────────────────
  async addFile(projectId: string, body: { fileUrl: string; milestoneId?: string; uploadedById?: string }) {
    return this.prisma.projectFile.create({
      data: {
        projectId,
        fileUrl: body.fileUrl,
        milestoneId: body.milestoneId,
        uploadedById: body.uploadedById,
      },
      include: { uploadedBy: { select: { name: true } } },
    });
  }

  async setFileApproval(fileId: string, status: "PENDING" | "APPROVED" | "REVISION_REQUESTED") {
    return this.prisma.projectFile.update({ where: { id: fileId }, data: { approvalStatus: status } }).catch(() => {
      throw new NotFoundException("File not found");
    });
  }

  async deleteFile(fileId: string) {
    await this.prisma.projectFile.delete({ where: { id: fileId } }).catch(() => {
      throw new NotFoundException("File not found");
    });
    return { ok: true };
  }

  // ── Discussions (internal, via ClientComment with author) ────────────
  async discussions(projectId: string) {
    return this.prisma.clientComment.findMany({
      where: { projectId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addDiscussion(projectId: string, body: { content: string; authorId?: string }) {
    return this.prisma.clientComment.create({
      data: { projectId, content: body.content, authorId: body.authorId },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  // ── Capacity planner ─────────────────────────────────────────────────
  async capacity() {
    const employees = await this.prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, name: true, roleTitle: true, department: true, skillTags: true },
    });
    const timeLogs = await this.prisma.timeLog.findMany({
      where: { employeeId: { not: null } },
      select: { employeeId: true, hours: true, task: { select: { projectId: true } } },
    });
    const projects = await this.prisma.project.findMany({
      select: { id: true, name: true, client: { select: { companyName: true } }, status: true },
    });
    const byEmployee: Record<string, Record<string, number>> = {};
    for (const l of timeLogs) {
      const pid = l.task?.projectId ?? "unassigned";
      if (!l.employeeId) continue;
      byEmployee[l.employeeId] ??= {};
      byEmployee[l.employeeId][pid] = (byEmployee[l.employeeId][pid] ?? 0) + Number(l.hours);
    }
    return employees.map((e) => {
      const alloc = byEmployee[e.id] ?? {};
      return {
        ...e,
        projects: Object.entries(alloc).map(([pid, hours]) => {
          const p = projects.find((x) => x.id === pid);
          return { projectId: pid, projectName: p?.name ?? "General", client: p?.client.companyName ?? "—", hours: Math.round(hours * 10) / 10 };
        }),
      };
    });
  }

  async templates() {
    return this.prisma.projectTemplate.findMany();
  }
}
