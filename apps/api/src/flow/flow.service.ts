import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FileApprovalStatus, HealthStatus, ProjectStatus, TaskStatus } from "@prisma/client";
import { unlink } from "fs/promises";
import { join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";
import { CapitalService } from "../capital/capital.service";
import { ScoringService } from "../scoring/scoring.service";
import { CreateReferenceDto } from "./dto/create-reference.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import {
  AddDeliverableDto,
  AddFileDto,
  AddMilestoneDto,
  AssignDeliverableTasksDto,
  BulkAddDeliverablesDto,
  GenerateReportDto,
  UpdateDeliverableDto,
  UpdateMilestoneDto,
  UpdateReportDto,
  UpsertProjectProposalDto,
} from "./dto/flow-mutations.dto";
import { advanceBillingDate } from "../common/billing-date";
import { recomputeProjectStats } from "../common/project-stats";
import { writeSystemAudit } from "../common/system-audit";
import { signStoredFileUrl, uploadedFilename } from "../common/signed-url";
import { findUploadedFile, uploadsRoot } from "../common/file-storage";
import { mediaDir, removeOptimizedImage, uploadFilename } from "../common/image-pipeline";
import { dayKey } from "../calendar/calendar.utils";
import { TasksService } from "../tasks/tasks.service";

const DAY = 86400000;

const clampProgress = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
};

const dayStart = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** `@db.Date` columns round-trip best at UTC midnight. */
const dateOnly = (value: string | Date, field: string): Date => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
};

/** Deliverable kind → the task type the department rules speak in. */
const KIND_TASK_TYPE: Record<string, string> = {
  GRAPHIC: "design",
  VIDEO: "video",
  PHOTO: "photo",
  COPY: "copy",
  OTHER: "general",
};

/** Minimal RFC-4180 parser: quoted cells, escaped quotes, CRLF, embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private reportsRunning = false;
  private reconcileRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
    private readonly capital: CapitalService,
    private readonly scoring: ScoringService,
    private readonly tasks: TasksService
  ) {}

  async overview() {
    return this.cache.wrap("flow:overview", 30, async () => {
      const [projects, tasks] = await Promise.all([
        this.prisma.project.findMany({
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, status: true, healthStatus: true, riskScore: true, budgetAmount: true, targetEndDate: true },
        }),
        // Archived tasks no longer describe live work; counting them made the
        // header disagree with the board.
        this.prisma.task.findMany({
          where: { archivedAt: null, project: { status: { not: "ARCHIVED" } } },
          select: { projectId: true, status: true },
        }),
      ]);
      const byStatus: Record<string, number> = {};
      const byHealth: Record<string, number> = { ON_TRACK: 0, AT_RISK: 0, DELAYED: 0 };
      for (const p of projects) {
        byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
        if (p.healthStatus in byHealth) byHealth[p.healthStatus]++;
      }
      const active = projects.filter((p) => ["PLANNING", "ACTIVE"].includes(p.status));
      const avgRisk = active.length ? Math.round(active.reduce((s, p) => s + (p.riskScore ?? 0), 0) / active.length) : 0;
      const completion = tasks.length
        ? Math.round((tasks.filter((t) => t.status === "DONE").length / tasks.length) * 100)
        : 0;
      // A project is "on time" while its target date has not passed. That is
      // the number the table footer renders; it was previously never returned.
      const dated = projects.filter((p) => p.targetEndDate && !["COMPLETED", "ARCHIVED"].includes(p.status));
      const onTimeRate = dated.length
        ? Math.round((dated.filter((p) => new Date(p.targetEndDate!).getTime() >= Date.now()).length / dated.length) * 100)
        : null;
      return { totalProjects: projects.length, active: active.length, byStatus, byHealth, avgRisk, completion, onTimeRate };
    });
  }

  async list(query: {
    q?: string;
    status?: string;
    health?: string;
    clientId?: string;
    managerId?: string;
    page?: string | number;
    pageSize?: string | number;
    limit?: string | number;
    lite?: string | boolean;
  }) {
    const where: any = {
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { client: { companyName: { contains: query.q, mode: "insensitive" } } },
              { assignedPm: { name: { contains: query.q, mode: "insensitive" } } },
              { uid: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status as ProjectStatus } : {}),
      ...(query.health ? { healthStatus: query.health as HealthStatus } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.managerId ? { assignedPmId: query.managerId } : {}),
    };

    // Picker mode (`?lite=1`): the task board and the calendar only render
    // id / name / clientId. The full payload costs three queries (the include,
    // the `_count` join, and a groupBy over every task on the page) plus ~40
    // columns per row — for a `<select>` that shows twelve characters of text.
    // Cached under its own prefix so neither shape evicts the other.
    if (query.lite === true || query.lite === "true" || query.lite === "1") {
      return this.cache.wrapQuery(
        "flow:lite",
        { q: query.q, status: query.status, clientId: query.clientId, managerId: query.managerId },
        300,
        () =>
          this.prisma.project.findMany({
            where,
            select: {
              id: true,
              name: true,
              clientId: true,
              client: { select: { companyName: true } },
            },
            orderBy: { name: "asc" },
            take: 500,
          })
      );
    }

    const listQuery: Record<string, unknown> = { ...query };
    delete listQuery.lite;
    return this.cache.wrapQuery("flow:list", listQuery, 30, async () => {
      // Paged callers get { items, total, page, pageSize }; legacy callers get
      // an array (capped). The cap is the difference between an 8 MB response
      // and a fast board — a caller that needs everything pages through it.
      const wantsPage = query.page !== undefined && query.page !== null && query.page !== "";
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
      const legacyLimit = Math.min(1000, Math.max(1, Number(query.limit) || 300));

      const [projects, total] = await Promise.all([
        this.prisma.project.findMany({
          where,
          include: {
            client: { select: { id: true, companyName: true } },
            assignedPm: { select: { id: true, name: true } },
            _count: { select: { tasks: true, milestones: true } },
          },
          // Risk first: the board exists to surface projects that need attention.
          orderBy: [{ healthStatus: "desc" }, { createdAt: "desc" }],
          ...(wantsPage ? { take: pageSize, skip: (page - 1) * pageSize } : { take: legacyLimit }),
        }),
        wantsPage ? this.prisma.project.count({ where }) : Promise.resolve(0),
      ]);

      // Aggregate only the rows this page actually needs. The previous version
      // grouped the entire task table on every list request.
      const ids = projects.map((p) => p.id);
      const taskGroups = ids.length
        ? await this.prisma.task.groupBy({
            by: ["projectId", "status"],
            where: { projectId: { in: ids }, archivedAt: null },
            _count: { _all: true },
          })
        : [];
      const byProject: Record<string, { total: number; completed: number }> = {};
      for (const g of taskGroups) {
        if (!g.projectId) continue;
        byProject[g.projectId] ??= { total: 0, completed: 0 };
        byProject[g.projectId].total += g._count._all;
        if (g.status === "DONE") byProject[g.projectId].completed += g._count._all;
      }
      const items = projects.map((p) => {
        const stats = byProject[p.id] ?? { total: 0, completed: 0 };
        return {
          ...p,
          // One progress authority: the task ratio. Manual values survive only
          // for projects that have no tasks at all.
          progress: stats.total ? Math.round((stats.completed / stats.total) * 100) : p.progress,
          tasksTotal: stats.total,
          tasksCompleted: stats.completed,
        };
      });
      return wantsPage ? { items, total, page, pageSize } : items;
    });
  }

  async nextUid() {
    // MAX(...) in the database instead of scanning every project row per attempt.
    try {
      const rows = await this.prisma.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(SUBSTRING("uid" FROM 4) AS INTEGER)) AS max
        FROM "Project"
        WHERE "uid" LIKE 'PJ-%'
      `;
      const next = Number(rows?.[0]?.max ?? 0) + 1;
      return `PJ-${String(next).padStart(4, "0")}`;
    } catch {
      const rows = await this.prisma.project.findMany({ select: { uid: true } });
      const used = new Set(rows.map((r) => r.uid).filter(Boolean));
      let n = 1;
      while (used.has(`PJ-${String(n).padStart(4, "0")}`)) n++;
      return `PJ-${String(n).padStart(4, "0")}`;
    }
  }

  async managers() {
    return this.prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Minimal project list for pickers in modules whose roles do not have the
   * Flow workspace (e.g. HR recording a project expense).
   *
   * `clientId` is required by every client → project cascade (invoice, expense,
   * income); without it the project dropdown empties as soon as a client is
   * chosen. Billing type/currency let the invoice form prefill correctly, while
   * budget, health and client details stay out of this endpoint.
   */
  async projectLookup() {
    return this.prisma.project.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: {
        id: true,
        name: true,
        uid: true,
        clientId: true,
        status: true,
        billingType: true,
        currency: true,
      },
      orderBy: [{ clientId: "asc" }, { name: "asc" }],
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
        proposal: { include: { updatedBy: { select: { id: true, name: true } } } },
        milestones: { orderBy: { dueDate: "asc" } },
        files: {
          include: { uploadedBy: { select: { name: true } } },
          orderBy: { uploadedAt: "desc" },
        },
        riskLogs: { orderBy: { calculatedAt: "desc" }, take: 6 },
        tasks: {
          where: { archivedAt: null },
          include: { assignedTo: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
        deliverables: {
          include: {
            tasks: {
              where: { archivedAt: null },
              select: { id: true, title: true, status: true },
            },
            campaign: { select: { id: true, name: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
        shoots: {
          include: {
            crew: {
              include: {
                employee: { select: { id: true, name: true, photoUrl: true, roleTitle: true } },
                vendor: { select: { id: true, name: true, phone: true, category: true } },
              },
              orderBy: { createdAt: "asc" },
            },
            campaign: { select: { id: true, name: true } },
          },
          orderBy: [{ shootDate: "asc" }, { createdAt: "asc" }],
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
    const progress = tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : project.progress;
    const files = project.files.map((f) => ({
      ...f,
      // The download route requires a signature; the UI uses this value.
      downloadUrl: signStoredFileUrl(f.fileUrl),
    }));
    const proposal = project.proposal ? this.proposalWithAccess(project.proposal) : null;
    return { ...project, proposal, files, deliverables, progress, tasksTotal, tasksCompleted };
  }

  async create(body: CreateProjectDto, actorId?: string) {
    // amount sync — keep budgetAmount for compat
    let amount = body.amount;
    let budgetAmount = body.budgetAmount;
    if (amount !== undefined && amount !== null) {
      budgetAmount = amount;
    } else if (budgetAmount !== undefined && budgetAmount !== null) {
      amount = budgetAmount;
    }
    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    const template = body.templateId
      ? await this.prisma.projectTemplate.findUnique({ where: { id: body.templateId } })
      : null;
    const targetEndDate =
      body.targetEndDate
        ? new Date(body.targetEndDate)
        : template?.benchmarkDurationDays
          ? new Date(startDate.getTime() + template.benchmarkDurationDays * DAY)
          : undefined;

    const data: any = {
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
      nextBillingDate: body.nextBillingDate ?? this.nextBillingDate(startDate.toISOString(), body.recurringInterval),
      monthlyRate: body.monthlyRate ?? undefined,
      totalBilled: body.totalBilled ?? 0,
      paymentStatus: body.paymentStatus ?? "PENDING",
      projectLink: body.projectLink,
      websiteUrl: body.websiteUrl,
      socialLinks: body.socialLinks,
      briefLink: body.briefLink,
      driveLink: body.driveLink,
      researchLink: body.researchLink,
      startDate,
      targetEndDate,
      status: body.status ?? undefined,
      confidenceScore: body.confidenceScore ?? undefined,
      reportMode: body.reportMode ?? "MANUAL",
      reportFrequency: body.reportFrequency ?? null,
      nextReportDate: body.nextReportDate ? new Date(body.nextReportDate) : undefined,
      // Health is derived by the scoring engine. An explicit level becomes a
      // stored override (with reason), exactly like the PATCH path.
      ...(body.healthStatus && String(body.healthStatus) !== "AUTO"
        ? {
            healthStatusOverride: body.healthStatus,
            healthOverrideReason: body.healthOverrideReason ?? "Set at creation",
          }
        : {}),
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

    // Templates were previously cosmetic: the wizard read fields that do not
    // exist. Applying the seeded task list here is the actual behaviour.
    const templateTasks = Array.isArray(template?.defaultTaskList)
      ? (template!.defaultTaskList as unknown[]).filter((t): t is string => typeof t === "string" && t.trim() !== "")
      : [];
    if (templateTasks.length) {
      try {
        await this.prisma.task.createMany({
          data: templateTasks.map((title, index) => ({
            projectId: project.id,
            title: title.trim(),
            status: TaskStatus.TODO,
            priority: "MEDIUM" as const,
            sortOrder: index,
          })),
        });
        await recomputeProjectStats(this.prisma, project.id).catch(() => {});
      } catch (e: any) {
        this.logger.warn(`Template tasks for project ${project.id} failed: ${e?.message ?? e}`);
      }
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
    } catch (e: any) {
      this.logger.warn(`Project notifications failed for ${project.id}: ${e?.message ?? e}`);
    }
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.project.create",
      entityType: "Project",
      entityId: project.id,
      after: { name: project.name, uid: project.uid, clientId: project.clientId, status: project.status },
    });
    await this.rescore(project.id, project.clientId);
    await this.invalidateProjects();
    return (await this.prisma.project.findUnique({ where: { id: project.id } })) ?? project;
  }

  async update(id: string, body: UpdateProjectDto, actorId?: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Project not found");

    const data: any = {};
    for (const field of [
      "name", "type", "templateId", "assignedPmId", "status", "clientId",
      "category", "priority", "team", "billingType", "recurringInterval",
      "monthlyRate", "totalBilled", "paymentStatus", "briefLink", "driveLink", "researchLink",
      "confidenceScore", "reportFrequency", "reportMode",
    ]) {
      const value = (body as any)[field];
      if (value !== undefined) data[field] = value;
    }

    // Progress is a derived value whenever the project has live tasks. Letting
    // a form overwrite it is how the board and the task list drifted apart.
    if (body.progress !== undefined) {
      const liveTasks = await this.prisma.task.count({ where: { projectId: id, archivedAt: null } });
      if (liveTasks === 0) data.progress = clampProgress(body.progress);
    }

    // Health is computed, not typed. A PM can still override it, but the
    // override is stored separately (with a reason) so the engine's own reading
    // stays visible and a later "clear override" restores it.
    if (body.clearHealthOverride) {
      data.healthStatusOverride = null;
      data.healthOverrideReason = null;
    } else if (body.healthStatus !== undefined) {
      if (!body.healthStatus || String(body.healthStatus) === "AUTO") {
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

    // Recurring report schedule: switching to AUTOMATIC needs a concrete next
    // date, otherwise the cron either never fires or fires every night.
    const reportMode = (data.reportMode ?? existing.reportMode) as string;
    const reportFrequency = (data.reportFrequency ?? existing.reportFrequency) as string | null;
    if (body.nextReportDate !== undefined) {
      data.nextReportDate = body.nextReportDate ? new Date(body.nextReportDate) : null;
    } else if (data.reportMode !== undefined || data.reportFrequency !== undefined) {
      if (reportMode === "MANUAL") {
        data.nextReportDate = null;
      } else if (reportMode === "AUTOMATIC" && reportFrequency) {
        const days = reportFrequency === "15-days" ? 15 : 30;
        data.nextReportDate = new Date(Date.now() + days * DAY);
      }
    }

    const result = await this.prisma.project.update({ where: { id }, data });
    // auto invoice hooks
    try {
      await this.handleAutoInvoice(existing as any, result as any);
    } catch (e: any) {
      // A finance hook must not fail the status transition, but silence here
      // meant a missing draft invoice was never noticed.
      this.logger.warn(`Auto-invoice for project ${id} failed: ${e?.message ?? e}`);
    }
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.project.update",
      entityType: "Project",
      entityId: id,
      before: {
        name: existing.name, status: existing.status, clientId: existing.clientId,
        amount: existing.amount, healthStatusOverride: existing.healthStatusOverride,
      },
      after: {
        name: result.name, status: result.status, clientId: result.clientId,
        amount: result.amount, healthStatusOverride: result.healthStatusOverride,
      },
    });
    if (existing.clientId !== result.clientId) {
      await this.rescore(id, existing.clientId);
    }
    await this.rescore(id, result.clientId);
    if (existing.amount?.toString() !== result.amount?.toString() || existing.currency !== result.currency) {
      await this.cache.del(`capital:project-finance:${id}`);
    }
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
    } catch (e: any) {
      this.logger.warn(`Project rescore failed for ${projectId}: ${e?.message ?? e}`);
    }
    if (clientId) {
      try {
        await this.scoring.recomputeClient(clientId);
      } catch (e: any) {
        this.logger.warn(`Client rescore failed for ${clientId}: ${e?.message ?? e}`);
      }
    }
  }

  private async handleAutoInvoice(prev: any, next: any) {
    const dueDate = new Date(Date.now() + 14 * DAY);
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

  async remove(id: string, actorId?: string) {
    const existing = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true, name: true, uid: true, clientId: true, status: true,
        files: { select: { fileUrl: true } },
      },
    });
    if (!existing) throw new NotFoundException("Project not found");

    // Invoices and expenses survive a project delete (their projectId is
    // nullable), which silently removed them from project reporting. Refuse the
    // delete instead of detaching financial history.
    const [invoices, expenses, incomes, engagements, tasks] = await Promise.all([
      this.prisma.invoice.count({ where: { projectId: id } }),
      this.prisma.expense.count({ where: { projectId: id } }),
      this.prisma.manualIncome.count({ where: { projectId: id } }),
      this.prisma.vendorEngagement.count({ where: { projectId: id } }),
      // Archived tasks are the exception: they are retired records, and the
      // board filters them out, so they cannot block a delete the user can
      // never resolve. They are removed with the project below.
      this.prisma.task.count({ where: { projectId: id, archivedAt: null } }),
    ]);
    const blockers = [
      invoices ? `${invoices} invoice(s)` : null,
      expenses ? `${expenses} expense(s)` : null,
      incomes ? `${incomes} income record(s)` : null,
      engagements ? `${engagements} vendor engagement(s)` : null,
      tasks ? `${tasks} task(s)` : null,
    ].filter(Boolean);
    if (blockers.length) {
      throw new ConflictException(
        `This project still has ${blockers.join(", ")}. Archive it instead, or detach those records first.`
      );
    }

    try {
      await this.prisma.task.deleteMany({ where: { projectId: id, archivedAt: { not: null } } });
      await this.prisma.project.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === "P2025") throw new NotFoundException("Project not found");
      if (err?.code === "P2003") {
        throw new ConflictException("This project is referenced by other records and cannot be deleted");
      }
      throw err;
    }

    // Remove the blobs too: a deleted row used to leave the file on disk forever.
    for (const f of existing.files) {
      const name = uploadedFilename(f.fileUrl);
      if (!name) continue;
      const candidates = new Set([
        join(uploadsRoot(), name),
        join(process.cwd(), "uploads", name),
        findUploadedFile(name),
      ]);
      for (const candidate of candidates) {
        try {
          await unlink(candidate);
        } catch {
          /* already gone */
        }
      }
    }

    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.project.delete",
      entityType: "Project",
      entityId: id,
      before: { name: existing.name, uid: existing.uid, clientId: existing.clientId, status: existing.status },
    });
    if (existing.clientId) {
      try {
        await this.scoring.recomputeClient(existing.clientId);
      } catch (e: any) {
        this.logger.warn(`Client rescore after delete failed: ${e?.message ?? e}`);
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

  private withSignedDownload<T extends { fileUrl?: string | null }>(row: T): T & { downloadUrl: string | null } {
    return { ...row, downloadUrl: signStoredFileUrl(row.fileUrl) };
  }

  async createReference(projectId: string, dto: CreateReferenceDto, userId?: string) {
    await this.ensureProject(projectId);
    const created = await this.prisma.projectReference.create({
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
    await writeSystemAudit(this.prisma, {
      actorId: userId,
      action: "flow.reference.create",
      entityType: "ProjectReference",
      entityId: created.id,
      after: { projectId, title: created.title },
    });
    return this.withSignedDownload(created);
  }

  async listReferences(projectId: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectReference.findMany({
      where: { projectId },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.withSignedDownload(r));
  }

  async updateReference(id: string, dto: Partial<CreateReferenceDto>, userId?: string) {
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl;
    try {
      const updated = await this.prisma.projectReference.update({ where: { id }, data });
      await writeSystemAudit(this.prisma, {
        actorId: userId, action: "flow.reference.update", entityType: "ProjectReference", entityId: id,
      });
      return this.withSignedDownload(updated);
    } catch {
      throw new NotFoundException("Reference not found");
    }
  }

  async deleteReference(id: string, userId?: string) {
    try {
      await this.prisma.projectReference.delete({ where: { id } });
    } catch {
      throw new NotFoundException("Reference not found");
    }
    await writeSystemAudit(this.prisma, {
      actorId: userId, action: "flow.reference.delete", entityType: "ProjectReference", entityId: id,
    });
    return { ok: true };
  }

  /**
   * Project logo. The pipeline writes a WebP plus an optional JPEG XL sibling;
   * the previous pair is removed so re-uploads do not pile up on disk.
   */
  async setLogo(projectId: string, logoUrl: string, logoJxlUrl: string | null) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { logoUrl: true, logoJxlUrl: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    await this.prisma.project.update({ where: { id: projectId }, data: { logoUrl, logoJxlUrl } });
    await removeOptimizedImage(mediaDir("logos"), uploadFilename(project.logoUrl), uploadFilename(project.logoJxlUrl));
    await writeSystemAudit(this.prisma, {
      actorId: undefined, action: "flow.project.logo", entityType: "Project", entityId: projectId,
      after: { logoUrl, hasJxl: !!logoJxlUrl },
    });
    return { logoUrl, logoJxlUrl };
  }

  async removeLogo(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { logoUrl: true, logoJxlUrl: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    await this.prisma.project.update({ where: { id: projectId }, data: { logoUrl: null, logoJxlUrl: null } });
    await removeOptimizedImage(mediaDir("logos"), uploadFilename(project.logoUrl), uploadFilename(project.logoJxlUrl));
    return { logoUrl: null, logoJxlUrl: null };
  }

  // ── Project proposal: exactly one per project ────────────────────────────  /** Shared shape so `detail()` and the dedicated GET return the same thing. */
  private proposalWithAccess<T extends { fileUrl?: string | null }>(row: T) {
    return { ...row, downloadUrl: signStoredFileUrl(row.fileUrl) };
  }

  async projectProposal(projectId: string) {
    await this.ensureProject(projectId);
    const row = await this.prisma.projectProposal.findUnique({
      where: { projectId },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    return {
      proposal: row ? this.proposalWithAccess(row) : null,
      limit: 1,
      used: row ? 1 : 0,
    };
  }

  /**
   * Save the final proposal. Upsert is deliberate: the limit is one, so a
   * second save replaces the first instead of stacking versions.
   */
  async upsertProjectProposal(projectId: string, dto: UpsertProjectProposalDto, actorId?: string) {
    await this.ensureProject(projectId);
    const notes = dto.notes?.trim() || null;
    if (!dto.fileUrl && !dto.link && !notes) {
      throw new BadRequestException("Add a PDF, a link, or a summary before saving the proposal");
    }
    const status = dto.status ?? "DRAFT";
    const sentDate =
      dto.sentDate ? new Date(dto.sentDate)
        : status !== "DRAFT" ? new Date()
          : null;
    const data = {
      title: dto.title?.trim() || "Final proposal",
      fileUrl: dto.fileUrl ?? null,
      fileName: dto.fileName ?? null,
      link: dto.link ?? null,
      notes,
      amount: dto.amount ?? null,
      status,
      sentDate,
      updatedById: actorId ?? null,
    };
    const saved = await this.prisma.projectProposal.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.proposal.save",
      entityType: "ProjectProposal",
      entityId: saved.id,
      after: { projectId, title: saved.title, status: saved.status, hasFile: !!saved.fileUrl, hasLink: !!saved.link },
    });
    return { proposal: this.proposalWithAccess(saved), limit: 1, used: 1 };
  }

  async deleteProjectProposal(projectId: string, userId?: string) {
    const row = await this.prisma.projectProposal.findUnique({ where: { projectId }, select: { id: true } });
    if (!row) throw new NotFoundException("Proposal not found");
    await this.prisma.projectProposal.delete({ where: { projectId } });
    await writeSystemAudit(this.prisma, {
      actorId: userId, action: "flow.proposal.delete", entityType: "ProjectProposal", entityId: row.id,
      after: { projectId },
    });
    return { ok: true };
  }

  async bulkAssignTasks(projectId: string, taskIds: string[], userId?: string) {
    const target = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, clientId: true },
    });
    if (!target) throw new NotFoundException("Project not found");
    if (!taskIds?.length) return { count: 0, rejected: [] as string[] };

    // Moving a task across clients would leak work (and budgets) between
    // accounts. Only unassigned tasks or tasks from the same client qualify.
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, projectId: true, project: { select: { clientId: true } } },
    });
    const allowed = tasks.filter(
      (t) => !t.projectId || t.project?.clientId === target.clientId
    );
    const rejected = tasks.filter(
      (t) => t.projectId && t.project?.clientId !== target.clientId
    ).map((t) => t.id);
    const affected = new Set<string>([target.id]);
    for (const t of allowed) if (t.projectId) affected.add(t.projectId);

    const res = allowed.length
      ? await this.prisma.task.updateMany({ where: { id: { in: allowed.map((t) => t.id) } }, data: { projectId } })
      : { count: 0 };

    for (const pid of affected) {
      await recomputeProjectStats(this.prisma, pid).catch(() => {});
      await this.rescore(pid, pid === target.id ? target.clientId : undefined);
    }
    await writeSystemAudit(this.prisma, {
      actorId: userId,
      action: "flow.tasks.bulk-assign",
      entityType: "Project",
      entityId: projectId,
      after: { assigned: res.count, rejected },
    });
    await this.invalidateProjects();
    return { count: res.count, rejected };
  }

  private async invalidateProjects() {
    await this.cache.del("flow:overview");
    await this.cache.delPattern("flow:list:*");
    await this.cache.delPattern("flow:lite:*");
    await this.cache.del("tasks:stats");
    await this.cache.delPattern("tasks:list:*");
    await this.cache.del("dashboard:overview");
    await this.cache.del("insight:overview");
    await this.cache.delPattern("capital:project-finance:*");
  }

  // ── CSV export / import ──────────────────────────────────────────────
  private statusMap(v: string): ProjectStatus {
    const s = v.trim().toLowerCase();
    if (s === "planning") return "PLANNING";
    if (s === "in-progress" || s === "in progress" || s === "active" || s === "review") return "ACTIVE";
    if (s === "completed" || s === "done") return "COMPLETED";
    if (s === "on-hold" || s === "on hold" || s === "paused") return "PAUSED";
    if (s === "archived") return "ARCHIVED";
    return "PLANNING";
  }

  private csvCell(v: unknown): string {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }

  async exportCsv(query: { q?: string; status?: string; clientId?: string; managerId?: string } = {}) {
    // Export must see every row, so page through the (capped) list endpoint
    // instead of relying on one huge response.
    const rows: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.list({ ...query, page, pageSize: 200 });
      const items = Array.isArray(result) ? result : result.items;
      rows.push(...items);
      if (Array.isArray(result) || result.items.length === 0) break;
      if (rows.length >= result.total) break;
    }
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
          p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : "",
          p.targetEndDate ? new Date(p.targetEndDate).toISOString().slice(0, 10) : "",
          p.billingType, p.recurringInterval ?? "", p.assignedPm?.name ?? "", p.paymentStatus ?? "PENDING",
        ].map((v) => this.csvCell(v)).join(",")
      );
    }
    const filename = `projects_export_${new Date().toISOString().slice(0, 10)}.csv`;
    return { filename, content: lines.join("\n") };
  }

  async importCsv(buffer: Buffer, actorId?: string) {
    const rows = parseCsv(buffer.toString("utf8"));
    if (rows.length < 2) return { imported: 0, skipped: [], errors: [], total: 0 };
    const header = rows[0].map((h) => h.toLowerCase());
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
    const date = (v: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };

    const skipped: string[] = [];
    const errors: { row: number; reason: string }[] = [];
    const payloads: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const c = rows[i];
      const get = (index: number) => (index >= 0 ? c[index] ?? "" : "");
      const name = get(idx.name);
      const clientName = get(idx.client);
      const clientId = clientByName.get(clientName.toLowerCase());
      if (!name || !clientId) {
        skipped.push(name || clientName || `row ${i + 1}`);
        continue;
      }
      const billingType = get(idx.billingType).toLowerCase() === "recurring" ? "RECURRING" : "ONE_TIME";
      const interval = get(idx.recurringInterval) || "30-days";
      const startDate = date(get(idx.startDate)) ?? new Date();
      const priority = get(idx.priority).toUpperCase();
      payloads.push({
        clientId,
        name,
        category: get(idx.category) || "General",
        status: this.statusMap(get(idx.status)),
        priority: ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority) ? priority : "MEDIUM",
        progress: clampProgress(get(idx.progress)),
        budgetAmount: Number(get(idx.budget)) || 0,
        spentAmount: Number(get(idx.spent)) || 0,
        startDate,
        targetEndDate: date(get(idx.dueDate)),
        billingType,
        recurringInterval: billingType === "RECURRING" ? interval : undefined,
        nextBillingDate: billingType === "RECURRING" ? this.nextBillingDate(startDate.toISOString(), interval) : undefined,
        assignedPmId: userByName.get(get(idx.projectManager).toLowerCase()),
        paymentStatus: get(idx.paymentStatus).toUpperCase() || "PENDING",
      });
    }

    // One transaction: a bad row must not leave a half-imported file behind.
    let uid = Number((await this.nextUid()).slice(3));
    const createdIds = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const payload of payloads) {
        const created = await tx.project.create({
          data: { ...payload, uid: `PJ-${String(uid++).padStart(4, "0")}` },
          select: { id: true },
        });
        ids.push(created.id);
      }
      return ids;
    });
    const imported = createdIds.length;

    for (const createdId of createdIds) {
      const project = await this.prisma.project.findUnique({
        where: { id: createdId },
        select: { clientId: true },
      });
      await recomputeProjectStats(this.prisma, createdId).catch(() => {});
      if (project?.clientId) {
        await this.rescore(createdId, project.clientId);
      }
    }
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.projects.import",
      entityType: "Project",
      entityId: "batch",
      after: { imported, skipped: skipped.length, errors: errors.length },
    });
    await this.invalidateProjects();
    return { imported, skipped, errors, total: rows.length - 1 };
  }

  // ── Milestones ───────────────────────────────────────────────────────
  async addMilestone(projectId: string, body: AddMilestoneDto, actorId?: string) {
    await this.ensureProject(projectId);
    const milestone = await this.prisma.milestone.create({
      data: {
        projectId,
        name: body.name,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        status: body.status ?? "PENDING",
        clientVisible: body.clientVisible ?? false,
      },
    });
    await writeSystemAudit(this.prisma, {
      actorId,
      action: "flow.milestone.create",
      entityType: "Milestone",
      entityId: milestone.id,
      after: { projectId, name: milestone.name, dueDate: milestone.dueDate },
    });
    return milestone;
  }

  async updateMilestone(id: string, body: UpdateMilestoneDto, actorId?: string) {
    const data: any = {};
    for (const field of ["name", "status", "clientVisible"]) {
      if ((body as any)[field] !== undefined) data[field] = (body as any)[field];
    }
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.status === "COMPLETED") {
      data.completedAt = body.completedAt ? new Date(body.completedAt) : new Date();
    } else if (body.status !== undefined) {
      data.completedAt = null;
    }
    try {
      const updated = await this.prisma.milestone.update({ where: { id }, data });
      await writeSystemAudit(this.prisma, {
        actorId, action: "flow.milestone.update", entityType: "Milestone", entityId: id,
        after: { status: updated.status, dueDate: updated.dueDate },
      });
      return updated;
    } catch (err: any) {
      if (err?.code === "P2025") throw new NotFoundException("Milestone not found");
      throw err;
    }
  }

  async deleteMilestone(id: string, actorId?: string) {
    try {
      await this.prisma.milestone.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === "P2025") throw new NotFoundException("Milestone not found");
      throw err;
    }
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.milestone.delete", entityType: "Milestone", entityId: id,
    });
    return { ok: true };
  }

  // ── Files ────────────────────────────────────────────────────────────
  async addFile(projectId: string, body: AddFileDto, actorId?: string) {
    await this.ensureProject(projectId);
    if (body.milestoneId) {
      const milestone = await this.prisma.milestone.findFirst({
        where: { id: body.milestoneId, projectId },
        select: { id: true },
      });
      if (!milestone) throw new BadRequestException("Milestone does not belong to this project");
    }
    const created = await this.prisma.projectFile.create({
      data: {
        projectId,
        fileUrl: body.fileUrl,
        fileName: body.fileName,
        size: body.size,
        mimeType: body.mimeType,
        milestoneId: body.milestoneId,
        uploadedById: actorId,
      },
      include: { uploadedBy: { select: { name: true } } },
    });
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.file.create", entityType: "ProjectFile", entityId: created.id,
      after: { projectId, fileName: created.fileName, size: created.size },
    });
    return { ...created, downloadUrl: signStoredFileUrl(created.fileUrl) };
  }

  async setFileApproval(fileId: string, status: FileApprovalStatus, actorId?: string) {
    try {
      const updated = await this.prisma.projectFile.update({
        where: { id: fileId },
        data: { approvalStatus: status, approvedAt: status === "APPROVED" ? new Date() : null },
      });
      await writeSystemAudit(this.prisma, {
        actorId, action: "flow.file.approval", entityType: "ProjectFile", entityId: fileId,
        after: { approvalStatus: updated.approvalStatus },
      });
      return { ...updated, downloadUrl: signStoredFileUrl(updated.fileUrl) };
    } catch (err: any) {
      if (err?.code === "P2025") throw new NotFoundException("File not found");
      throw err;
    }
  }

  async deleteFile(fileId: string, actorId?: string) {
    let removed: { fileUrl: string } | null = null;
    try {
      removed = await this.prisma.projectFile.delete({
        where: { id: fileId },
        select: { fileUrl: true },
      });
    } catch (err: any) {
      if (err?.code === "P2025") throw new NotFoundException("File not found");
      throw err;
    }
    const name = uploadedFilename(removed?.fileUrl);
    if (name) {
      const candidates = new Set([
        join(uploadsRoot(), name),
        join(process.cwd(), "uploads", name),
        findUploadedFile(name),
      ]);
      for (const candidate of candidates) {
        try {
          await unlink(candidate);
        } catch {
          /* already gone */
        }
      }
    }
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.file.delete", entityType: "ProjectFile", entityId: fileId,
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
    await this.ensureProject(projectId);
    return this.prisma.clientComment.create({
      data: { projectId, content: body.content, authorId: body.authorId },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  // ── Capacity planner ─────────────────────────────────────────────────
  async capacity(range: { from?: string; to?: string } = {}) {
    const end = range.to ? new Date(range.to) : new Date();
    const start = range.from ? new Date(range.from) : new Date(end.getTime() - 28 * DAY);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException("Invalid capacity window");
    }
    const windowDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
    const capacityHours = Math.round((windowDays / 7) * 40 * 10) / 10;

    const [employees, timeLogs, projects] = await Promise.all([
      this.prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, name: true, roleTitle: true, department: true, skillTags: true },
      }),
      this.prisma.timeLog.findMany({
        where: { employeeId: { not: null }, date: { gte: start, lte: end } },
        select: { employeeId: true, hours: true, task: { select: { projectId: true } } },
      }),
      this.prisma.project.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true, client: { select: { companyName: true } } },
      }),
    ]);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const byEmployee: Record<string, Record<string, number>> = {};
    for (const l of timeLogs) {
      if (!l.employeeId) continue;
      const pid = l.task?.projectId ?? "unassigned";
      byEmployee[l.employeeId] ??= {};
      byEmployee[l.employeeId][pid] = (byEmployee[l.employeeId][pid] ?? 0) + Number(l.hours);
    }
    return employees.map((e) => {
      const alloc = byEmployee[e.id] ?? {};
      const totalHours = Math.round(Object.values(alloc).reduce((s, h) => s + h, 0) * 10) / 10;
      return {
        ...e,
        totalHours,
        capacityHours,
        utilizationPct: capacityHours > 0 ? Math.round((totalHours / capacityHours) * 100) : 0,
        projects: Object.entries(alloc)
          .map(([pid, hours]) => {
            const p = projectById.get(pid);
            return {
              projectId: pid,
              projectName: p?.name ?? "General",
              client: p?.client.companyName ?? "—",
              hours: Math.round(hours * 10) / 10,
              sharePct: totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0,
            };
          })
          .sort((a, b) => b.hours - a.hours),
      };
    });
  }

  async templates() {
    return this.prisma.projectTemplate.findMany();
  }

  // ── Deliverables (proposal commitments) ──────────────────────────────
  private async assertTasksInProject(projectId: string, taskIds: string[]) {
    if (!taskIds.length) return;
    const found = await this.prisma.task.count({ where: { id: { in: taskIds }, projectId } });
    if (found !== taskIds.length) {
      throw new BadRequestException("One or more tasks do not belong to this project");
    }
  }

  /**
   * Validate + map one deliverable payload. Campaigns must belong to the same
   * client as the project, otherwise a report would mix two clients' work.
   */
  private async deliverableFields(
    projectId: string,
    dto: AddDeliverableDto | UpdateDeliverableDto,
    campaignMemo?: Map<string, string>
  ) {
    let campaignId: string | null | undefined;
    if (dto.campaignId !== undefined) {
      if (!dto.campaignId) {
        campaignId = null;
      } else {
        const cached = campaignMemo?.get(dto.campaignId);
        if (cached !== undefined) {
          campaignId = cached;
        } else {
          const [project, campaign] = await Promise.all([
            this.prisma.project.findUnique({ where: { id: projectId }, select: { clientId: true } }),
            this.prisma.campaign.findUnique({
              where: { id: dto.campaignId },
              select: { id: true, clientId: true },
            }),
          ]);
          if (!project) throw new NotFoundException("Project not found");
          if (!campaign) throw new NotFoundException("Campaign not found");
          if (campaign.clientId !== project.clientId) {
            throw new BadRequestException("This campaign belongs to a different client");
          }
          campaignMemo?.set(campaign.id, campaign.id);
          campaignId = campaign.id;
        }
      }
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.topic !== undefined) data.topic = dto.topic?.trim() || null;
    if (dto.objective !== undefined) data.objective = dto.objective?.trim() || null;
    if (campaignId !== undefined) data.campaignId = campaignId;
    if (dto.startDate !== undefined) {
      data.startDate = dto.startDate ? dateOnly(dto.startDate, "Start date") : null;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? dateOnly(dto.dueDate, "Due date") : null;
    }
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId || null;
    if (dto.clientVisible !== undefined) data.clientVisible = dto.clientVisible;
    return data;
  }

  private readonly deliverableInclude = {
    tasks: { select: { id: true, title: true, status: true } },
    campaign: { select: { id: true, name: true } },
  } as const;

  async addDeliverable(projectId: string, dto: AddDeliverableDto, actorId?: string) {
    await this.ensureProject(projectId);
    const taskIds = dto.taskIds ?? [];
    await this.assertTasksInProject(projectId, taskIds);
    const last = await this.prisma.projectDeliverable.findFirst({
      where: { projectId },
      orderBy: { sortOrder: "desc" },
    });
    const data = await this.deliverableFields(projectId, dto);
    const d = await this.prisma.projectDeliverable.create({
      data: {
        projectId,
        title: dto.title.trim(),
        sortOrder: (last?.sortOrder ?? 0) + 1,
        ...data,
        ...(taskIds.length ? { tasks: { connect: taskIds.map((id) => ({ id })) } } : {}),
      },
      include: this.deliverableInclude,
    });
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.deliverable.create", entityType: "ProjectDeliverable", entityId: d.id,
      after: { projectId, title: d.title, kind: d.kind },
    });
    await this.invalidateProjects();
    return d;
  }

  /** Paste mode — "8 graphics + 4 videos" in one submit. */
  async bulkAddDeliverables(projectId: string, dto: BulkAddDeliverablesDto, actorId?: string) {
    await this.ensureProject(projectId);
    const last = await this.prisma.projectDeliverable.findFirst({
      where: { projectId },
      orderBy: { sortOrder: "desc" },
    });
    let sortOrder = last?.sortOrder ?? 0;
    const campaignMemo = new Map<string, string>();
    const created = [];
    for (const item of dto.items) {
      const data = await this.deliverableFields(projectId, item, campaignMemo);
      const row = await this.prisma.projectDeliverable.create({
        data: {
          projectId,
          title: item.title.trim(),
          sortOrder: ++sortOrder,
          ...data,
        },
        include: this.deliverableInclude,
      });
      created.push(row);
    }
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.deliverable.bulk_create", entityType: "ProjectDeliverable", entityId: projectId,
      after: { projectId, count: created.length },
    });
    await this.invalidateProjects();
    return { count: created.length, items: created };
  }

  async updateDeliverable(deliverableId: string, dto: UpdateDeliverableDto, actorId?: string) {
    const existing = await this.prisma.projectDeliverable.findUnique({
      where: { id: deliverableId },
    });
    if (!existing) throw new NotFoundException("Deliverable not found");
    const data: any = await this.deliverableFields(existing.projectId, dto);
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.completedAt = dto.status === "DELIVERED" ? new Date() : null;
    }
    const start = data.startDate !== undefined ? data.startDate : existing.startDate;
    const due = data.dueDate !== undefined ? data.dueDate : existing.dueDate;
    if (start && due && due < start) {
      throw new BadRequestException("Due date cannot be before the start date");
    }
    if (dto.taskIds !== undefined) {
      await this.assertTasksInProject(existing.projectId, dto.taskIds);
      data.tasks = { set: dto.taskIds.map((id) => ({ id })) };
    }
    const d = await this.prisma.projectDeliverable.update({
      where: { id: deliverableId },
      data,
      include: this.deliverableInclude,
    });
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.deliverable.update", entityType: "ProjectDeliverable", entityId: deliverableId,
      after: { status: d.status, kind: d.kind },
    });
    await this.invalidateProjects();
    return d;
  }

  /**
   * One-click "commitments → work". One task per deliverable, never a duplicate:
   * a deliverable that already owns a task is skipped and reported back.
   */
  async assignDeliverableTasks(
    projectId: string,
    dto: AssignDeliverableTasksDto,
    userId?: string
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    const deliverables = await this.prisma.projectDeliverable.findMany({
      where: { id: { in: dto.deliverableIds }, projectId },
      include: { tasks: { select: { id: true } } },
      orderBy: { sortOrder: "asc" },
    });
    const foundIds = new Set(deliverables.map((d) => d.id));
    const missing = dto.deliverableIds.filter((id) => !foundIds.has(id));

    const assignee = await this.prisma.employee.findUnique({
      where: { id: dto.assigneeId },
      select: { id: true, name: true, employmentStatus: true },
    });
    if (!assignee) throw new NotFoundException("Assignee not found");

    const coAssigneeIds = [...new Set(dto.coAssigneeIds ?? [])].filter(
      (id) => id !== assignee.id
    );
    const coAssignees = coAssigneeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: coAssigneeIds } },
          select: { id: true, name: true, photoUrl: true },
        })
      : [];

    const actor = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      : null;

    const results: {
      deliverableId: string;
      title: string;
      status: "created" | "skipped" | "failed";
      taskId?: string;
      reason?: string;
    }[] = [];

    for (const d of deliverables) {
      const title = (d.topic?.trim() || d.title).slice(0, 200);
      if (d.tasks.length) {
        results.push({
          deliverableId: d.id,
          title,
          status: "skipped",
          reason: "already assigned",
        });
        continue;
      }
      const description = [d.objective?.trim(), d.description?.trim()]
        .filter(Boolean)
        .join("\n\n");
      try {
        const task = await this.tasks.create({
          title,
          description: description || undefined,
          projectId,
          assignedToId: assignee.id,
          assignedToName: assignee.name,
          createdById: userId,
          createdByName: actor?.name ?? "Flow",
          priority: dto.priority ?? "MEDIUM",
          dueDate: dto.dueDateOverride
            ? dateOnly(dto.dueDateOverride, "Due date").toISOString()
            : d.dueDate?.toISOString(),
          taskType: dto.taskType ?? KIND_TASK_TYPE[d.kind ?? "OTHER"] ?? "general",
          isClientVisible: dto.clientVisible ?? d.clientVisible,
          assignees: coAssignees.map((e) => ({
            id: e.id,
            name: e.name,
            photoUrl: e.photoUrl ?? null,
          })),
        });
        await this.prisma.task.update({
          where: { id: task.id },
          data: { deliverableId: d.id },
        });
        results.push({ deliverableId: d.id, title, status: "created", taskId: task.id });
      } catch (e: any) {
        results.push({
          deliverableId: d.id,
          title,
          status: "failed",
          reason: e?.message ?? "Task could not be created",
        });
      }
    }

    for (const id of missing) {
      results.push({
        deliverableId: id,
        title: "—",
        status: "failed",
        reason: "Not found in this project",
      });
    }

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    await writeSystemAudit(this.prisma, {
      actorId: userId,
      action: "flow.deliverable.assign_tasks",
      entityType: "ProjectDeliverable",
      entityId: projectId,
      after: { projectId, assigneeId: assignee.id, created, skipped, failed },
    });
    await this.invalidateProjects();

    return {
      created,
      skipped,
      failed,
      assignee: { id: assignee.id, name: assignee.name, employmentStatus: assignee.employmentStatus },
      results,
    };
  }

  async removeDeliverable(deliverableId: string, actorId?: string) {
    try {
      await this.prisma.projectDeliverable.delete({ where: { id: deliverableId } });
    } catch {
      throw new NotFoundException("Deliverable not found");
    }
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.deliverable.delete", entityType: "ProjectDeliverable", entityId: deliverableId,
    });
    await this.invalidateProjects();
    return { ok: true };
  }

  // ── Reports (auto-populated from deliverables + tasks) ───────────────
  async generateReport(
    projectId: string,
    dto: GenerateReportDto,
    userId?: string
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: { select: { id: true, companyName: true } },
        deliverables: {
          where: dto.campaignId ? { campaignId: dto.campaignId } : undefined,
          include: {
            tasks: { where: { archivedAt: null }, select: { id: true, status: true } },
            campaign: { select: { id: true, name: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    // A campaign-scoped report only makes sense inside the project's own client.
    let campaignLabel: string | null = null;
    if (dto.campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: dto.campaignId },
        select: { id: true, name: true, clientId: true },
      });
      if (!campaign) throw new NotFoundException("Campaign not found");
      if (campaign.clientId !== project.clientId) {
        throw new BadRequestException("This campaign belongs to a different client");
      }
      campaignLabel = campaign.name;
    }

    const end = dto.periodEnd ? new Date(dto.periodEnd) : new Date();
    const start = dto.periodStart
      ? new Date(dto.periodStart)
      : new Date(end.getTime() - 30 * DAY);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw new BadRequestException("Invalid report period");
    }

    const ownerIds = [
      ...new Set(project.deliverables.map((d) => d.ownerId).filter(Boolean)),
    ] as string[];
    const owners = ownerIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : [];
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));

    const deriveStatus = (d: (typeof project.deliverables)[number]) => {
      if (!d.tasks.length) return d.status;
      const done = d.tasks.filter((t) => t.status === "DONE").length;
      const active = d.tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW").length;
      return done === d.tasks.length ? "DELIVERED" : done > 0 || active > 0 ? "IN_PROGRESS" : "PENDING";
    };

    type Bucket = { delivered: number; deliveredInPeriod: number; pending: number; total: number };
    const emptyBucket = (): Bucket => ({ delivered: 0, deliveredInPeriod: 0, pending: 0, total: 0 });
    const byKind: Record<string, Bucket> = {};
    const byCampaign = new Map<string, Bucket & { campaignId: string | null; name: string }>();
    const byOwner = new Map<string, Bucket & { employeeId: string | null; name: string }>();

    const completed: any[] = [];
    const pending: any[] = [];
    let tasksTotal = 0;
    let tasksDone = 0;

    for (const d of project.deliverables) {
      const status = deriveStatus(d);
      const done = d.tasks.filter((t) => t.status === "DONE").length;
      tasksTotal += d.tasks.length;
      tasksDone += done;

      const kind = d.kind ?? "OTHER";
      const kindBucket = (byKind[kind] ??= emptyBucket());
      const campKey = d.campaignId ?? "__none";
      const campBucket = byCampaign.get(campKey) ?? {
        ...emptyBucket(),
        campaignId: d.campaignId ?? null,
        name: d.campaign?.name ?? "No campaign",
      };
      const ownerKey = d.ownerId ?? "__none";
      const ownerBucket = byOwner.get(ownerKey) ?? {
        ...emptyBucket(),
        employeeId: d.ownerId ?? null,
        name: d.ownerId ? ownerName.get(d.ownerId) ?? "Unknown" : "Unassigned",
      };

      const item = {
        deliverableId: d.id,
        title: d.title,
        topic: d.topic,
        objective: d.objective,
        kind: d.kind,
        campaignId: d.campaignId,
        campaignName: d.campaign?.name ?? null,
        ownerId: d.ownerId,
        ownerName: d.ownerId ? ownerName.get(d.ownerId) ?? "Unknown" : null,
        dueDate: d.dueDate ? d.dueDate.toISOString() : null,
        tasksDone: done,
        tasksTotal: d.tasks.length,
      };

      kindBucket.total++;
      campBucket.total++;
      ownerBucket.total++;

      if (status === "DELIVERED") {
        kindBucket.delivered++;
        campBucket.delivered++;
        ownerBucket.delivered++;
        // The section says "Completed this period": work finished before the
        // window must not be re-announced inside it.
        const inPeriod = !d.completedAt || (d.completedAt >= start && d.completedAt <= end);
        if (inPeriod) {
          kindBucket.deliveredInPeriod++;
          campBucket.deliveredInPeriod++;
          ownerBucket.deliveredInPeriod++;
          completed.push({
            ...item,
            // Never invent a completion date.
            completedAt: d.completedAt ? d.completedAt.toISOString() : null,
          });
        }
      } else {
        kindBucket.pending++;
        campBucket.pending++;
        ownerBucket.pending++;
        pending.push({ ...item, status });
      }

      byCampaign.set(campKey, campBucket);
      byOwner.set(ownerKey, ownerBucket);
    }

    // Shoots inside the period — frozen with crew + gear so reports never change
    // when a call-sheet is edited later.
    const shoots = await this.prisma.shoot.findMany({
      where: {
        projectId,
        ...(dto.campaignId ? { campaignId: dto.campaignId } : {}),
        shootDate: { gte: dateOnly(start, "Period start"), lte: dateOnly(end, "Period end") },
      },
      include: {
        crew: {
          include: {
            employee: { select: { id: true, name: true } },
            vendor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { shootDate: "asc" },
    });
    const shootSnapshot = shoots.map((s) => ({
      id: s.id,
      title: s.title,
      date: dayKey(s.shootDate),
      endDate: s.endDate ? dayKey(s.endDate) : null,
      duration: s.durationType,
      callTime: s.callTime,
      wrapTime: s.wrapTime,
      location: s.location,
      status: s.status,
      description: s.description,
      equipment: s.equipment,
      crew: s.crew.map((c) => ({
        role: c.role,
        name: c.name,
        source: c.source,
        phone: c.phone,
        callTime: c.callTime,
        isConfirmed: c.isConfirmed,
        employeeId: c.employeeId,
        vendorId: c.vendorId,
      })),
    }));

    // Billing snapshot for the period — this used to sum the project's entire
    // invoice history while the title claimed a 15/30-day window.
    const invoices = await this.prisma.invoice.findMany({
      where: {
        projectId,
        issueDate: { gte: start, lte: end },
        status: { notIn: ["CANCELLED", "VOID"] },
      },
      include: {
        lineItems: true,
        payments: { where: { paymentDate: { gte: start, lte: end } } },
      },
    });
    const invoiced = invoices.reduce(
      (s, i) => s + i.lineItems.reduce((x, l) => x + Number(l.amount), 0),
      0
    );
    const collected = invoices.reduce((s, i) => s + i.payments.reduce((x, p) => x + Number(p.amount), 0), 0);

    const periodLabel =
      project.reportFrequency === "15-days"
        ? `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
        : start.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const title = campaignLabel
      ? `Campaign report — ${campaignLabel} · ${periodLabel}`
      : `Progress report — ${periodLabel}`;

    const summary = {
      delivered: project.deliverables.filter((d) => deriveStatus(d) === "DELIVERED").length,
      deliveredInPeriod: completed.length,
      pending: pending.length,
      total: project.deliverables.length,
      byKind,
      byCampaign: [...byCampaign.values()],
      byOwner: [...byOwner.values()],
      shoots: {
        count: shootSnapshot.length,
        fullDays: shootSnapshot.filter((s) => s.duration === "FULL_DAY").length,
        halfDays: shootSnapshot.filter((s) => s.duration === "HALF_DAY").length,
        crewCount: shootSnapshot.reduce((n, s) => n + s.crew.length, 0),
        equipmentCount: shootSnapshot.reduce((n, s) => n + s.equipment.length, 0),
      },
      tasksFromDeliverables: { total: tasksTotal, done: tasksDone },
    };

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
        groupBy: dto.groupBy ?? "CAMPAIGN",
        campaignId: dto.campaignId ?? null,
        campaignLabel,
        summary,
        shoots: shootSnapshot,
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
    } catch (e: any) {
      this.logger.warn(`Report notification failed for ${projectId}: ${e?.message ?? e}`);
    }
    await writeSystemAudit(this.prisma, {
      actorId: userId, action: "flow.report.generate", entityType: "ProjectReport", entityId: report.id,
      after: { projectId, start, end },
    });
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
    dto: { pmNotes?: string; status?: string },
    actorId?: string
  ) {
    const existing = await this.prisma.projectReport.findUnique({ where: { id: reportId } });
    if (!existing) throw new NotFoundException("Report not found");
    const data: any = {};
    if (dto.pmNotes !== undefined) data.pmNotes = dto.pmNotes;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === "SENT") data.sentAt = new Date();
    }
    const updated = await this.prisma.projectReport.update({
      where: { id: reportId },
      data,
      include: { generatedBy: { select: { name: true } } },
    });
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.report.update", entityType: "ProjectReport", entityId: reportId,
      after: { status: updated.status },
    });
    return updated;
  }

  async removeReport(reportId: string, actorId?: string) {
    try {
      await this.prisma.projectReport.delete({ where: { id: reportId } });
    } catch {
      throw new NotFoundException("Report not found");
    }
    await writeSystemAudit(this.prisma, {
      actorId, action: "flow.report.delete", entityType: "ProjectReport", entityId: reportId,
    });
    return { ok: true };
  }

  // ── Scheduled stats reconciliation ───────────────────────────────────
  @Cron("15 3 * * *")
  async reconcileProjectStats() {
    if (this.reconcileRunning) return { updated: 0, skipped: "already running" };
    this.reconcileRunning = true;
    try {
      const projects = await this.prisma.project.findMany({ select: { id: true } });
      let updated = 0;
      for (const p of projects) {
        try {
          await recomputeProjectStats(this.prisma, p.id);
          updated++;
        } catch (e: any) {
          this.logger.warn(`Stats reconcile failed for ${p.id}: ${e?.message ?? e}`);
        }
      }
      return { updated };
    } finally {
      this.reconcileRunning = false;
    }
  }

  // ── Scheduled report generation (recurring projects, AUTOMATIC mode) ──
  @Cron("30 2 * * *")
  async handleScheduledReports() {
    if (this.reportsRunning) return { created: 0, skipped: "already running" };
    this.reportsRunning = true;
    try {
      const due = await this.prisma.project.findMany({
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
        try {
          const end = new Date();
          const start = p.nextReportDate ? new Date(p.nextReportDate) : new Date(end.getTime() - 30 * DAY);
          // Dedupe: a previous run may have created the report and failed to
          // advance the cursor. Never send the same period twice.
          const already = await this.prisma.projectReport.findFirst({
            where: { projectId: p.id, periodStart: { gte: dayStart(start) }, periodEnd: { lte: end } },
            select: { id: true },
          });
          if (!already) {
            await this.generateReport(p.id, { periodStart: start.toISOString(), periodEnd: end.toISOString() });
            created++;
          }
          const days = p.reportFrequency === "15-days" ? 15 : 30;
          await this.prisma.project.update({
            where: { id: p.id },
            data: { nextReportDate: new Date(end.getTime() + days * DAY) },
          });
        } catch (e: any) {
          // One broken project must not stop the rest of the portfolio.
          this.logger.warn(`Scheduled report failed for ${p.id}: ${e?.message ?? e}`);
        }
      }
      return { created };
    } finally {
      this.reportsRunning = false;
    }
  }
}
