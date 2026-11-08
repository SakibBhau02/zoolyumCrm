import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { HealthStatus, ProjectStatus, ProjectType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";
import { CapitalService } from "../capital/capital.service";
import { ScoringService } from "../scoring/scoring.service";
import { CreateReferenceDto } from "./dto/create-reference.dto";
import { advanceBillingDate } from "../common/billing-date";
import { recomputeProjectStats } from "../common/project-stats";

@Injectable()
export class FlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
    private readonly capital: CapitalService,
    private readonly scoring: ScoringService
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

  async list(query: { q?: string; status?: string; health?: string; clientId?: string; managerId?: string; page?: string | number; pageSize?: string | number }) {
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
    // Opt-in pagination: callers that pass `page` get { items, total, ... };
    // existing callers keep the plain array they already expect.
    const wantsPage = query.page !== undefined && query.page !== null && query.page !== "";
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));

    const [projects, total, taskGroups] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true } },
          assignedPm: { select: { id: true, name: true } },
          _count: { select: { tasks: true, milestones: true } },
        },
        orderBy: [{ healthStatus: "asc" }, { createdAt: "desc" }],
        ...(wantsPage ? { take: pageSize, skip: (page - 1) * pageSize } : {}),
      }),
      wantsPage ? this.prisma.project.count({ where }) : Promise.resolve(0),
      // Aggregated in the database instead of pulling every task row into
      // memory on each request (the list used to fetch all tasks, always).
      this.prisma.task.groupBy({
        by: ["projectId", "status"],
        where: { projectId: { not: null }, archivedAt: null },
        _count: { _all: true },
      }),
    ]);
    const byProject: Record<string, { total: number; completed: number }> = {};
    for (const g of taskGroups) {
      if (!g.projectId) continue;
      byProject[g.projectId] ??= { total: 0, completed: 0 };
      byProject[g.projectId].total += g._count._all;
      if (g.status === "DONE") byProject[g.projectId].completed += g._count._all;
    }
    const items = projects.map((p) => ({
      ...p,
      tasksTotal: byProject[p.id]?.total ?? 0,
      tasksCompleted: byProject[p.id]?.completed ?? 0,
    }));
    return wantsPage ? { items, total, page, pageSize } : items;
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

  /** id + name only, for pickers in modules that lack Flow permissions. */
  async projectLookup() {
    return this.prisma.project.findMany({
      select: { id: true, name: true, uid: true },
      orderBy: { name: "asc" },
      take: 500,
    });
  }

  private nextBillingDate(start: string, interval?: string): Date | undefined {
    if (!interval) return undefined;
    // Shared with the billing cron so the first cycle and every later cycle use
    // the same anchor day (see common/billing-date.ts).
    return advanceBillingDate(new Date(start), interval);
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
        deliverables: {
          include: { tasks: { select: { id: true, title: true, status: true } } },
          orderBy: { sortOrder: "asc" },
        },
        reports: {
          include: { generatedBy: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!project) throw new NotFoundException("Project not found");
    // derive deliverable status from linked tasks (manual status kept when no tasks)
    const deliverables = project.deliverables.map((d) => {
      if (!d.tasks.length) return d;
      const done = d.tasks.filter((t) => t.status === "DONE").length;
      const active = d.tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW").length;
      const status = done === d.tasks.length ? "DELIVERED" : done > 0 || active > 0 ? "IN_PROGRESS" : "PENDING";
      return { ...d, status };
    });
    const tasksTotal = project.tasks.length;
    const tasksCompleted = project.tasks.filter((t) => t.status === "DONE").length;
    return { ...project, deliverables, tasksTotal, tasksCompleted };
  }

  async create(body: any) {
    // amount sync — keep budgetAmount for compat
    let amount = body.amount;
    let budgetAmount = body.budgetAmount;
    if (amount !== undefined && amount !== null) {
      budgetAmount = amount;
    } else if (budgetAmount !== undefined && budgetAmount !== null) {
      amount = budgetAmount;
    }
    const data = {
        clientId: body.clientId,
        name: body.name,
        description: body.description ?? undefined,
        type: body.type ?? "FIXED",
        templateId: body.templateId,
        assignedPmId: body.assignedPmId,
        amount: amount ?? undefined,
        budgetAmount: budgetAmount ?? undefined,
        spentAmount: body.spentAmount ?? undefined,
        currency: body.currency ?? undefined,
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
        projectLink: body.projectLink,
        websiteUrl: body.websiteUrl,
        socialLinks: body.socialLinks,
        briefLink: body.briefLink,
        driveLink: body.driveLink,
        researchLink: body.researchLink,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        targetEndDate: body.targetEndDate ? new Date(body.targetEndDate) : undefined,
        status: body.status ?? undefined,
        confidenceScore: body.confidenceScore ?? undefined,
        // healthStatus / riskScore are derived by the scoring engine, never
        // taken from the create payload.
    };

    // `uid` is derived from "highest existing number + 1". Two concurrent
    // creates can pick the same value; the unique index rejects one, and the
    // retry recomputes it instead of surfacing a 500.
    let project: any = null;
    for (let attempt = 0; attempt < 6 && !project; attempt++) {
      const uid = await this.nextUid();
      try {
        project = await this.prisma.project.create({ data: { ...data, uid } });
      } catch (err: any) {
        if (err?.code !== "P2002") throw err;
      }
    }
    if (!project) {
      throw new ConflictException("Could not allocate a project number - please try again");
    }
    try {
      if (project.assignedPmId) {
        await this.notifications.create(
          project.assignedPmId,
          "PROJECT_ASSIGNED",
          "Project assigned to you",
          `You are now PM of "${project.name}".`,
          `/flow/${project.id}`
        );
      }
      await this.notifications.notifyRole(
        "Owner",
        "PROJECT_UPDATE",
        "New Project Created",
        `New project "${project.name}" has been created.`,
        `/flow/${project.id}`
      );
    } catch {}
    await this.rescore(project.id, project.clientId);
    await this.invalidateProjects();
    return (await this.prisma.project.findUnique({ where: { id: project.id } })) ?? project;
  }

  async update(id: string, body: any) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Project not found");
    const data: any = {};
    for (const field of [
      "name", "type", "templateId", "assignedPmId", "status", "clientId",
      "category", "priority", "progress", "team", "billingType", "recurringInterval",
      "monthlyRate", "totalBilled", "paymentStatus", "briefLink", "driveLink", "researchLink",
      "confidenceScore", "reportFrequency", "reportMode",
    ]) {
      if (body[field] !== undefined) data[field] = body[field];
    }
    // Health is computed, not typed. A PM can still override it, but the
    // override is stored separately (with a reason) so the engine's own reading
    // stays visible and a later "clear override" restores it.
    if (body.clearHealthOverride) {
      data.healthStatusOverride = null;
      data.healthOverrideReason = null;
    } else if (body.healthStatus !== undefined) {
      if (!body.healthStatus || body.healthStatus === "AUTO") {
        data.healthStatusOverride = null;
        data.healthOverrideReason = null;
      } else {
        data.healthStatusOverride = body.healthStatus;
        data.healthOverrideReason = body.healthOverrideReason ?? "Manual override";
      }
    }
    // amount ↔ budgetAmount sync
    if (body.amount !== undefined) {
      data.amount = body.amount;
      data.budgetAmount = body.amount;
    } else if (body.budgetAmount !== undefined) {
      data.budgetAmount = body.budgetAmount;
      data.amount = body.budgetAmount;
    }
    if (body.currency !== undefined) data.currency = body.currency;
    if (body.description !== undefined) data.description = body.description;
    if (body.projectLink !== undefined) data.projectLink = body.projectLink;
    if (body.websiteUrl !== undefined) data.websiteUrl = body.websiteUrl;
    if (body.socialLinks !== undefined) data.socialLinks = body.socialLinks;
    if (body.spentAmount !== undefined) data.spentAmount = body.spentAmount;
    if (body.startDate !== undefined) data.startDate = new Date(body.startDate);
    if (body.targetEndDate !== undefined) data.targetEndDate = body.targetEndDate ? new Date(body.targetEndDate) : null;
    if (body.nextBillingDate !== undefined) data.nextBillingDate = body.nextBillingDate ? new Date(body.nextBillingDate) : null;
    else if (body.recurringInterval !== undefined && (body.startDate !== undefined || body.recurringInterval === null)) {
      data.nextBillingDate = body.recurringInterval === null ? null : this.nextBillingDate(body.startDate ?? existing.startDate.toISOString(), body.recurringInterval);
    }
    if (body.nextReportDate !== undefined) data.nextReportDate = body.nextReportDate ? new Date(body.nextReportDate) : null;
    else if (body.reportFrequency !== undefined && body.reportMode === "AUTOMATIC") {
      const days = body.reportFrequency === "15-days" ? 15 : 30;
      data.nextReportDate = new Date(Date.now() + days * 86400000);
    }
    const result = await this.prisma.project.update({ where: { id }, data });
    // auto invoice hooks
    try {
      await this.handleAutoInvoice(existing as any, result as any);
    } catch {
      // do not fail status transition if invoice creation fails
    }
    await this.rescore(id, result.clientId);
    await this.invalidateProjects();
    return (await this.prisma.project.findUnique({ where: { id } })) ?? result;
  }

  /**
   * Recompute the project's own score (which may have changed its
   * healthStatus), then the client's score, since "at-risk projects" is a
   * client health factor. Failures never break the caller's write.
   */
  private async rescore(projectId: string, clientId?: string | null) {
    try {
      await this.scoring.recomputeProject(projectId);
    } catch {
      /* scoring must never fail a project write */
    }
    if (clientId) {
      try {
        await this.scoring.recomputeClient(clientId);
      } catch {
        /* same */
      }
    }
  }

  private async handleAutoInvoice(prev: any, next: any) {
    const dueDate = new Date(Date.now() + 14 * 86400000);
    // PLANNING|PAUSED → ACTIVE (start) — only if totalBilled == 0 and amount>0, DRAFT
    const isStart = (prev.status === "PLANNING" || prev.status === "PAUSED") && next.status === "ACTIVE";
    if (isStart) {
      const totalBilled = Number(next.totalBilled ?? 0);
      if (totalBilled === 0) {
        const rawAmount = next.amount ?? next.budgetAmount ?? next.monthlyRate;
        const amount = Number(rawAmount ?? 0);
        if (amount > 0) {
          const invoiceType = next.billingType === "RECURRING" ? "RECURRING" : "ONE_TIME";
          const description = next.billingType === "RECURRING" ? `Recurring retainer — ${next.name}` : `Project — ${next.name}`;
          await this.capital.createInvoice({
            clientId: next.clientId,
            projectId: next.id,
            invoiceType,
            status: "DRAFT",
            dueDate,
            currency: next.currency ?? "BDT",
            lines: [{ description, quantity: 1, unitPrice: amount, amount, revenueTag: "AGENCY_REVENUE" }],
          });
        }
      }
    }
    // * → COMPLETED (finish) — remaining >0 and not PAID, DRAFT
    const isFinish = prev.status !== "COMPLETED" && next.status === "COMPLETED";
    if (isFinish) {
      if (next.paymentStatus !== "PAID") {
        const total = Number(next.amount ?? next.budgetAmount ?? 0);
        const billed = Number(next.totalBilled ?? 0);
        const remaining = Math.round((total - billed) * 100) / 100;
        if (remaining > 0) {
          await this.capital.createInvoice({
            clientId: next.clientId,
            projectId: next.id,
            invoiceType: "ONE_TIME",
            status: "DRAFT",
            dueDate,
            currency: next.currency ?? "BDT",
            lines: [{ description: `Final invoice — ${next.name}`, quantity: 1, unitPrice: remaining, amount: remaining, revenueTag: "AGENCY_REVENUE" }],
          });
        }
      }
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.project.findUnique({ where: { id }, select: { clientId: true } });
    await this.prisma.project.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Project not found");
    });
    // The client's "at-risk projects" factor just changed.
    if (existing?.clientId) {
      try {
        await this.scoring.recomputeClient(existing.clientId);
      } catch {
        /* scoring must never fail a delete */
      }
    }
    await this.invalidateProjects();
    return { ok: true };
  }

  // ── ProjectReference CRUD + bulk task ─────────────────────────────────
  private async ensureProject(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!p) throw new NotFoundException("Project not found");
    return p;
  }

  async createReference(projectId: string, dto: CreateReferenceDto, userId?: string) {
    await this.ensureProject(projectId);
    return this.prisma.projectReference.create({
      data: {
        projectId,
        title: dto.title,
        url: dto.url,
        type: (dto.type as any) ?? "OTHER",
        fileUrl: dto.fileUrl,
        uploadedById: userId,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async listReferences(projectId: string) {
    await this.ensureProject(projectId);
    return this.prisma.projectReference.findMany({
      where: { projectId },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateReference(id: string, dto: Partial<CreateReferenceDto>) {
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl;
    return this.prisma.projectReference.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException("Reference not found");
    });
  }

  async deleteReference(id: string) {
    await this.prisma.projectReference.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Reference not found");
    });
    return { ok: true };
  }

  async bulkAssignTasks(projectId: string, taskIds: string[]) {
    await this.ensureProject(projectId);
    if (!taskIds?.length) return { count: 0 };
    const res = await this.prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: { projectId },
    });
    await this.cache.delPattern("tasks:list:*");
    await this.cache.del("tasks:stats");
    return res;
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
    const result = await this.list(query);
    const rows = Array.isArray(result) ? result : result.items;
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

  // ── Deliverables (proposal commitments) ──────────────────────────────
  async addDeliverable(
    projectId: string,
    dto: { title: string; description?: string; taskIds?: string[] }
  ) {
    await this.ensureProject(projectId);
    const last = await this.prisma.projectDeliverable.findFirst({
      where: { projectId },
      orderBy: { sortOrder: "desc" },
    });
    const d = await this.prisma.projectDeliverable.create({
      data: {
        projectId,
        title: dto.title.trim(),
        description: dto.description,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        ...(dto.taskIds?.length
          ? { tasks: { connect: dto.taskIds.map((id) => ({ id })) } }
          : {}),
      },
      include: { tasks: { select: { id: true, title: true, status: true } } },
    });
    await this.invalidateProjects();
    return d;
  }

  async updateDeliverable(
    deliverableId: string,
    dto: { title?: string; description?: string; status?: string; taskIds?: string[] }
  ) {
    const existing = await this.prisma.projectDeliverable.findUnique({
      where: { id: deliverableId },
    });
    if (!existing) throw new NotFoundException("Deliverable not found");
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.completedAt = dto.status === "DELIVERED" ? new Date() : null;
    }
    if (dto.taskIds !== undefined) {
      data.tasks = { set: dto.taskIds.map((id) => ({ id })) };
    }
    const d = await this.prisma.projectDeliverable.update({
      where: { id: deliverableId },
      data,
      include: { tasks: { select: { id: true, title: true, status: true } } },
    });
    await this.invalidateProjects();
    return d;
  }

  async removeDeliverable(deliverableId: string) {
    await this.prisma.projectDeliverable.delete({ where: { id: deliverableId } }).catch(() => {
      throw new NotFoundException("Deliverable not found");
    });
    await this.invalidateProjects();
    return { ok: true };
  }

  // ── Reports (auto-populated from deliverables + tasks) ───────────────
  async generateReport(
    projectId: string,
    dto: { periodStart?: string; periodEnd?: string; pmNotes?: string },
    userId?: string
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        deliverables: { include: { tasks: true }, orderBy: { sortOrder: "asc" } },
        invoices: { include: { lineItems: true, payments: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const end = dto.periodEnd ? new Date(dto.periodEnd) : new Date();
    const start = dto.periodStart
      ? new Date(dto.periodStart)
      : new Date(end.getTime() - 30 * 86400000);

    const deriveStatus = (d: (typeof project.deliverables)[number]) => {
      if (!d.tasks.length) return d.status;
      const done = d.tasks.filter((t) => t.status === "DONE").length;
      const active = d.tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW").length;
      return done === d.tasks.length ? "DELIVERED" : done > 0 || active > 0 ? "IN_PROGRESS" : "PENDING";
    };

    const completed: any[] = [];
    const pending: any[] = [];
    for (const d of project.deliverables) {
      const status = deriveStatus(d);
      if (status === "DELIVERED") {
        completed.push({
          deliverableId: d.id,
          title: d.title,
          completedAt: d.completedAt ?? end.toISOString(),
          tasksDone: d.tasks.filter((t) => t.status === "DONE").length,
          tasksTotal: d.tasks.length,
        });
      } else {
        pending.push({ deliverableId: d.id, title: d.title, status });
      }
    }

    // billing snapshot for the period
    const activeInv = project.invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "VOID");
    const invoiced = activeInv.reduce(
      (s, i) => s + i.lineItems.reduce((x, l) => x + Number(l.amount), 0),
      0
    );
    const collected = activeInv.reduce((s, i) => s + i.payments.reduce((x, p) => x + Number(p.amount), 0), 0);

    const title =
      project.reportFrequency === "15-days"
        ? `Progress report — ${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
        : `Progress report — ${start.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;

    const report = await this.prisma.projectReport.create({
      data: {
        projectId,
        title,
        periodStart: start,
        periodEnd: end,
        pmNotes: dto.pmNotes,
        generatedById: userId,
        completed,
        pending,
        billing: { invoiced, collected, outstanding: Math.max(invoiced - collected, 0) },
      },
      include: { generatedBy: { select: { name: true } } },
    });
    try {
      if (project.assignedPmId && project.assignedPmId !== userId) {
        await this.notifications.create(
          project.assignedPmId,
          "REPORT_READY",
          "Report generated",
          `Report "${report.title}" generated for ${project.name}.`,
          `/flow/${projectId}?tab=reports&report=${report.id}`
        );
      }
    } catch {}
    await this.invalidateProjects();
    return report;
  }

  async listReports(projectId: string) {
    await this.ensureProject(projectId);
    return this.prisma.projectReport.findMany({
      where: { projectId },
      include: { generatedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateReport(
    reportId: string,
    dto: { pmNotes?: string; status?: string }
  ) {
    const existing = await this.prisma.projectReport.findUnique({ where: { id: reportId } });
    if (!existing) throw new NotFoundException("Report not found");
    const data: any = {};
    if (dto.pmNotes !== undefined) data.pmNotes = dto.pmNotes;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === "SENT") data.sentAt = new Date();
    }
    return this.prisma.projectReport.update({
      where: { id: reportId },
      data,
      include: { generatedBy: { select: { name: true } } },
    });
  }

  async removeReport(reportId: string) {
    await this.prisma.projectReport.delete({ where: { id: reportId } }).catch(() => {
      throw new NotFoundException("Report not found");
    });
    return { ok: true };
  }

  // ── Scheduled report generation (recurring projects, AUTOMATIC mode) ──
  @Cron("15 3 * * *")
  async reconcileProjectStats() {
    // Self-healing sweep: any drift introduced by a direct DB edit, an import
    // or a failed hook is corrected overnight so the board and finance agree.
    const projects = await this.prisma.project.findMany({ select: { id: true } });
    for (const p of projects) {
      await recomputeProjectStats(this.prisma, p.id).catch(() => {});
    }
    return { updated: projects.length };
  }

  @Cron("30 2 * * *")
  async handleScheduledReports() {    const due = await this.prisma.project.findMany({
      where: {
        reportMode: "AUTOMATIC",
        reportFrequency: { not: null },
        OR: [{ nextReportDate: { lte: new Date() } }, { nextReportDate: null }],
        status: { in: ["PLANNING", "ACTIVE", "PAUSED"] },
      },
      select: { id: true, reportFrequency: true, nextReportDate: true },
    });
    let created = 0;
    for (const p of due) {
      const end = new Date();
      const start = p.nextReportDate
        ? new Date(p.nextReportDate)
        : new Date(end.getTime() - 30 * 86400000);
      await this.generateReport(p.id, { periodStart: start.toISOString(), periodEnd: end.toISOString() });
      const days = p.reportFrequency === "15-days" ? 15 : 30;
      await this.prisma.project.update({
        where: { id: p.id },
        data: { nextReportDate: new Date(end.getTime() + days * 86400000) },
      });
      created++;
    }
    return { created };
  }
}
