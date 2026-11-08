import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { basename, join } from "path";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PortalAccessService, PortalScope } from "./portal-access.service";
import { TelegramService } from "./telegram.service";
import { findUploadedFile, sanitizeFilename, uploadsDir } from "../common/file-storage";
import { invoiceTotals, isReceivable } from "../capital/finance-kernel";

const ACTIVE_PROJECT_STATUSES = ["ACTIVE", "PLANNING"];
const DONE_TASK_STATUSES = ["DONE"];

/** "Karim Hossain" -> "Karim" — clients see a first name + role, never a full staff identity. */
function firstName(name?: string | null) {
  if (!name) return "";
  return name.trim().split(/\s+/)[0];
}

function money(n: number) {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class PortalClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly access: PortalAccessService,
    private readonly telegram: TelegramService
  ) {}

  private async invalidatePortal() {
    await this.cache.del("portal:comments");
    await this.cache.del("portal:approvals");
    await this.cache.del("portal:activity");
  }

  /** Public-safe company branding for portal invoice / receipt PDFs. */
  async branding() {
    const b = await this.prisma.brandingConfig.findFirst();
    if (!b) return null;
    const { id, updatedAt, ...rest } = b as any;
    return rest;
  }

  async login(email: string, password: string) {
    const normalized = String(email ?? "").toLowerCase().trim();

    // Brute-force guard: 8 failures per identifier per 15 minutes.
    const attemptKey = `portal:login:fail:${normalized}`;
    const failures = Number((await this.cache.get<number>(attemptKey)) ?? 0);
    if (failures >= 8) {
      throw new BadRequestException("Too many sign-in attempts. Please try again in a few minutes.");
    }

    const contact = await this.prisma.clientContact.findFirst({
      where: { email: normalized, portalAccessEnabled: true },
      include: { portalUser: true, client: { select: { id: true, companyName: true } } },
    });
    if (!contact?.portalUser || !contact.portalUser.isActive) {
      await this.cache.set(attemptKey, failures + 1, 15 * 60);
      throw new UnauthorizedException("Invalid portal credentials");
    }
    const valid = await bcrypt.compare(password, contact.portalUser.passwordHash);
    if (!valid) {
      await this.cache.set(attemptKey, failures + 1, 15 * 60);
      throw new UnauthorizedException("Invalid portal credentials");
    }
    await this.cache.del(attemptKey);

    await this.prisma.portalUser.update({
      where: { id: contact.portalUser.id },
      data: { lastLoginAt: new Date() },
    });
    await this.prisma.clientContact.update({ where: { id: contact.id }, data: { lastPortalLogin: new Date() } });
    await this.prisma.portalActivityLog.create({
      data: { portalUserId: contact.portalUser.id, action: "LOGGED_IN" },
    });

    return {
      portalToken: await this.jwt.signAsync({
        sub: contact.portalUser.id,
        scope: "portal",
        clientId: contact.clientId,
        aud: "portal",
      }),
      portalUser: {
        id: contact.portalUser.id,
        name: contact.name,
        email: contact.email,
        clientId: contact.clientId,
        clientName: contact.client.companyName,
      },
    };
  }

  async me(scope: PortalScope) {
    return {
      id: scope.portalUserId,
      name: scope.contactName,
      email: scope.contactEmail,
      clientId: scope.clientId,
      clientName: scope.clientName,
      modules: scope.modules,
      canSeeAdSpend: scope.canSeeAdSpend,
      restrictedProjects: scope.projectIds,
    };
  }

  // ── Overview: "what is happening / what is not" ────────────────────────
  /** Project-wise billing snapshot shared by the dashboard and invoices tab. */
  private buildBilling(invoices: any[], projects: any[]) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const byProject = projects
      .map((p) => {
        const rows = invoices.filter((i) => i.projectId === p.id);
        const totalInvoiced = rows.reduce((s, i) => s + invoiceTotals(i).grand, 0);
        const totalPaid = rows.reduce((s, i) => s + invoiceTotals(i).paid, 0);
        const outstanding = rows.reduce(
          (s, i) => s + (isReceivable(i.status) ? invoiceTotals(i).balance : 0),
          0
        );
        const paidThisMonth = rows
          .filter((i) => new Date(i.issueDate) >= monthStart)
          .reduce((s, i) => s + invoiceTotals(i).paid, 0);
        const recurring = p.billingType === "RECURRING";
        const monthlyRate = Number(p.monthlyRate ?? 0);
        // Monthly clients only need to know what is due this month — never how
        // many months they have paid.
        const monthlyDue = recurring ? Math.max(monthlyRate - paidThisMonth, 0) : 0;
        return {
          projectId: p.id,
          projectName: p.name,
          status: p.status,
          billingType: p.billingType,
          contractValue: money(Number(p.amount ?? p.budgetAmount ?? 0)),
          totalInvoiced: money(totalInvoiced),
          totalPaid: money(totalPaid),
          outstanding: money(outstanding),
          invoiceCount: rows.length,
          monthlyRate: money(monthlyRate),
          monthlyDue: money(monthlyDue),
          nextBillingDate: p.nextBillingDate ?? null,
        };
      })
      .filter(
        (row) =>
          row.invoiceCount > 0 ||
          row.contractValue > 0 ||
          row.monthlyRate > 0 ||
          row.outstanding > 0
      )
      .sort((a, b) => b.outstanding - a.outstanding);

    const totalOverdue = invoices.reduce((s, i) => {
      const t = invoiceTotals(i);
      return isReceivable(i.status) && i.dueDate && new Date(i.dueDate) < today ? s + t.balance : s;
    }, 0);
    const totalMonthlyDue = byProject
      .filter((r) => r.billingType === "RECURRING")
      .reduce((s, r) => s + r.monthlyDue, 0);

    return {
      byProject,
      totalOverdue: money(totalOverdue),
      totalMonthlyDue: money(totalMonthlyDue),
    };
  }

  async overview(scope: PortalScope) {
    this.access.requireModule(scope, "WORK");
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const weekAhead = new Date(now.getTime() + 7 * 86400000);
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const projectFilter = this.access.projectWhere(scope);

    const [projects, visibleTasks, updates, invoices, adAccounts, adSpend] = await Promise.all([
      this.prisma.project.findMany({
        where: { clientId: scope.clientId, ...projectFilter },
        select: {
          id: true,
          name: true,
          status: true,
          healthStatus: true,
          progress: true,
          startDate: true,
          targetEndDate: true,
          billingType: true,
          budgetAmount: true,
          amount: true,
          monthlyRate: true,
          nextBillingDate: true,
          recurringInterval: true,
          assignedPmId: true,
          milestones: { where: { clientVisible: true }, select: { id: true, name: true, status: true, dueDate: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.task.findMany({
        where: {
          isClientVisible: true,
          archivedAt: null,
          project: { clientId: scope.clientId, ...projectFilter },
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: "asc" }],
        take: 500,
      }),
      this.prisma.projectReport.findMany({
        where: { status: "SENT", project: { clientId: scope.clientId, ...projectFilter } },
        select: {
          id: true,
          title: true,
          periodStart: true,
          periodEnd: true,
          pmNotes: true,
          sentAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { periodEnd: "desc" },
        take: 3,
      }),
      this.prisma.invoice.findMany({
        where: {
          clientId: scope.clientId,
          status: { notIn: ["DRAFT", "VOID", "CANCELLED"] },
          ...(scope.projectIds ? { projectId: { in: scope.projectIds } } : {}),
        },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          projectId: true,
          issueDate: true,
          dueDate: true,
          lineItems: { select: { amount: true } },
          payments: { select: { amount: true, type: true } },
          taxApplicable: true,
          taxRate: true,
          discountRate: true,
          shippingFee: true,
        },
        orderBy: { issueDate: "desc" },
        take: 200,
      }),
      scope.modules.includes("PERFORMANCE") && scope.canSeeAdSpend
        ? this.prisma.adAccount.findMany({
            where: { clientId: scope.clientId },
            select: { id: true, lastSyncAt: true },
          })
        : Promise.resolve([]),
      scope.modules.includes("PERFORMANCE") && scope.canSeeAdSpend
        ? this.prisma.adInsight.aggregate({
            where: {
              clientId: scope.clientId,
              date: { gte: monthStart },
              adSetId: null,
              adId: null,
            },
            _sum: { spend: true, conversions: true, conversionValue: true },
            _count: true,
          })
        : Promise.resolve(null),
    ]);

    const active = projects.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status));
    const doneStatuses = new Set(DONE_TASK_STATUSES);
    const lastSyncedAt = adAccounts
      .map((a) => a.lastSyncAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const pmIds = Array.from(new Set(projects.map((p) => p.assignedPmId).filter(Boolean))) as string[];
    const [accountOwner, pms] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: scope.clientId },
        select: {
          accountOwner: { select: { id: true, name: true, email: true, employee: { select: { phone: true } } } },
        },
      }),
      pmIds.length
        ? this.prisma.user.findMany({ where: { id: { in: pmIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const teamMap = new Map<string, { id: string; name: string; email: string | null; phone: string | null; role: string }>();
    if (accountOwner?.accountOwner) {
      const am = accountOwner.accountOwner;
      teamMap.set(am.id, {
        id: am.id,
        name: firstName(am.name),
        email: am.email,
        phone: am.employee?.phone ?? null,
        role: "Account Manager",
      });
    }
    for (const pm of pms) {
      const existing = teamMap.get(pm.id);
      teamMap.set(pm.id, {
        id: pm.id,
        name: firstName(pm.name),
        email: existing?.email ?? null,
        phone: existing?.phone ?? null,
        role: existing ? "Account & Project Manager" : "Project Manager",
      });
    }
    const team = Array.from(teamMap.values());

    const sumLines = (i: any) => invoiceTotals(i).grand;
    const paidOf = (i: any) => invoiceTotals(i).paid;
    const pending = invoices.filter((i) => isReceivable(i.status) && invoiceTotals(i).balance > 0);
    const billingBreakdown = this.buildBilling(invoices, projects);

    // Per-project progress prefers client-visible milestones, then visible tasks,
    // and only falls back to the stored project percentage.
    const projectCards = projects.map((p) => {
      const tasks = visibleTasks.filter((t) => t.projectId === p.id);
      const done = tasks.filter((t) => doneStatuses.has(t.status)).length;
      let progress = Number(p.progress ?? 0);
      if (p.milestones.length) {
        progress = Math.round((p.milestones.filter((m) => m.status === "COMPLETED").length / p.milestones.length) * 100);
      } else if (tasks.length) {
        progress = Math.round((done / tasks.length) * 100);
      }
      const nextMilestone =
        p.milestones
          .filter((m) => m.status !== "COMPLETED" && m.dueDate)
          .sort((a, b) => +new Date(a.dueDate!) - +new Date(b.dueDate!))[0] ?? null;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        healthStatus: p.healthStatus,
        billingType: p.billingType,
        progress: Math.max(0, Math.min(100, progress)),
        taskCount: tasks.length,
        tasksDone: done,
        nextMilestone: nextMilestone ? { name: nextMilestone.name, dueDate: nextMilestone.dueDate } : null,
        targetEndDate: p.targetEndDate,
      };
    });

    const thisWeek = {
      // completedAt is not always recorded (bulk imports); fall back to dueDate.
      completed: visibleTasks.filter((t) => {
        if (!doneStatuses.has(t.status)) return false;
        const at = t.completedAt ?? t.dueDate;
        return !!at && new Date(at) >= weekAgo;
      }).length,
      inProgress: visibleTasks.filter((t) => t.status === "IN_PROGRESS").length,
      inReview: visibleTasks.filter((t) => t.status === "REVIEW").length,
      blocked: visibleTasks.filter((t) => t.status === "BLOCKED" || (t as any).isBlocked).length,
      dueSoon: visibleTasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) >= now && new Date(t.dueDate) <= weekAhead && !doneStatuses.has(t.status)
      ).length,
      overdue: visibleTasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < now && !doneStatuses.has(t.status)
      ).length,
    };

    const totalInvoiced = invoices.reduce((s, i) => s + sumLines(i), 0);
    const totalCollected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const nextMilestone =
      active
        .flatMap((p) =>
          p.milestones
            .filter((m) => m.status !== "COMPLETED" && m.dueDate)
            .map((m) => ({ name: m.name, dueDate: m.dueDate!, projectName: p.name }))
        )
        .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))[0] ?? null;

    return {
      clientName: scope.clientName,
      contactName: firstName(scope.contactName),
      generatedAt: now,
      activeProjectCount: active.length,
      projectCount: projects.length,
      team,
      nextMilestone,
      taskStats: {
        total: visibleTasks.length,
        done: visibleTasks.filter((t) => doneStatuses.has(t.status)).length,
        inProgress: visibleTasks.filter((t) => t.status === "IN_PROGRESS").length,
        todo: visibleTasks.filter((t) => t.status === "TODO").length,
        review: visibleTasks.filter((t) => t.status === "REVIEW").length,
        blocked: visibleTasks.filter((t) => t.status === "BLOCKED").length,
      },
      thisWeek,
      projects: projectCards,
      latestUpdate: updates[0]
        ? {
            id: updates[0].id,
            title: updates[0].title,
            projectName: updates[0].project.name,
            periodStart: updates[0].periodStart,
            periodEnd: updates[0].periodEnd,
            note: updates[0].pmNotes,
            sentAt: updates[0].sentAt,
          }
        : null,
      recentUpdates: updates.map((u) => ({
        id: u.id,
        title: u.title,
        projectName: u.project.name,
        periodStart: u.periodStart,
        periodEnd: u.periodEnd,
        sentAt: u.sentAt,
      })),
      billing: {
        totalInvoiced: money(totalInvoiced),
        totalCollected: money(totalCollected),
        pendingInvoiceCount: pending.length,
        pendingInvoiceValue: money(pending.reduce((s, i) => s + invoiceTotals(i).balance, 0)),
        totalOutstanding: money(invoices.reduce((s, i) => s + (isReceivable(i.status) ? invoiceTotals(i).balance : 0), 0)),
        overdueAmount: billingBreakdown.totalOverdue,
        totalMonthlyDue: billingBreakdown.totalMonthlyDue,
        byProject: billingBreakdown.byProject,
      },
      recentInvoices: invoices.slice(0, 5).map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        amount: money(invoiceTotals(i).grand),
        paid: money(paidOf(i)),
        status: i.status,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
      })),
      ads: adSpend && adAccounts.length > 0
        ? {
            available: true,
            monthSpend: money(Number(adSpend._sum.spend ?? 0)),
            monthConversions: adSpend._sum.conversions ?? 0,
            monthConversionValue: money(Number(adSpend._sum.conversionValue ?? 0)),
            lastSyncedAt,
            connectedAccounts: adAccounts.length,
          }
        : { available: false },
    };
  }

  // ── Work: client-visible tasks ──────────────────────────────────────────
  async tasks(
    scope: PortalScope,
    query: {
      projectId?: string;
      status?: string;
      q?: string;
      due?: "week" | "overdue" | "all";
      page?: string;
      pageSize?: string;
    }
  ) {
    this.access.requireModule(scope, "WORK");
    if (query.projectId) this.access.assertProjectId(scope, query.projectId);

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86400000);

    const where: any = {
      isClientVisible: true,
      archivedAt: null,
      project: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { description: { contains: query.q, mode: "insensitive" } }] }
        : {}),
    };
    if (query.due === "week") where.dueDate = { gte: now, lte: weekAhead };
    if (query.due === "overdue") where.dueDate = { lt: now };
    if (query.due && query.due !== "all") where.status = { not: "DONE" };

    const [items, total, grouped] = await Promise.all([
      this.prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          assignedTo: { select: { name: true } },
          deliverable: { select: { id: true, title: true } },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.task.count({ where }),
      this.prisma.task.groupBy({
        by: ["status"],
        where: {
          isClientVisible: true,
          archivedAt: null,
          project: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
        },
        _count: true,
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status] = g._count;
    const sum = (keys: string[]) => keys.reduce((s, k) => s + (counts[k] ?? 0), 0);

    return {
      items: items.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
        project: t.project ? { id: t.project.id, name: t.project.name } : null,
        assignee: t.assignedTo ? { name: firstName(t.assignedTo.name), role: "Team" } : null,
        deliverable: t.deliverable ? { id: t.deliverable.id, title: t.deliverable.title } : null,
      })),
      total,
      page,
      pageSize,
      stats: {
        todo: counts["TODO"] ?? 0,
        inProgress: counts["IN_PROGRESS"] ?? 0,
        review: counts["REVIEW"] ?? 0,
        done: sum(["DONE"]),
        blocked: counts["BLOCKED"] ?? 0,
      },
    };
  }

  async projects(scope: PortalScope) {
    this.access.requireModule(scope, "WORK");
    const projects = await this.prisma.project.findMany({
      where: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
      include: {
        milestones: { where: { clientVisible: true }, orderBy: { dueDate: "asc" } },
        files: { orderBy: { uploadedAt: "desc" } },
        assignedPm: { select: { id: true, name: true, email: true, employee: { select: { phone: true } } } },
        deliverables: { orderBy: { sortOrder: "asc" } },
        client: {
          select: {
            accountOwner: {
              select: { id: true, name: true, email: true, employee: { select: { phone: true } } },
            },
          },
        },
        tasks: {
          where: { isClientVisible: true, archivedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
            assignedTo: { select: { id: true, name: true } },
          },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }],
        },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return projects.map((p) => {
      const done = p.tasks.filter((t) => t.status === "DONE").length;
      let progress = Number(p.progress ?? 0);
      if (p.milestones.length) {
        progress = Math.round((p.milestones.filter((m) => m.status === "COMPLETED").length / p.milestones.length) * 100);
      } else if (p.tasks.length) {
        progress = Math.round((done / p.tasks.length) * 100);
      }
      return {
        ...p,
        progress: Math.max(0, Math.min(100, progress)),
        tasksDone: done,
        tasksTotal: p.tasks.length,
        tasks: p.tasks.map((t) => ({
          ...t,
          assignedTo: t.assignedTo ? { id: t.assignedTo.id, name: firstName(t.assignedTo.name) } : null,
        })),
        assignedPm: p.assignedPm
          ? {
              id: p.assignedPm.id,
              name: firstName(p.assignedPm.name),
              email: p.assignedPm.email,
              employee: p.assignedPm.employee,
              role: "Project Manager",
            }
          : null,
        client: p.client?.accountOwner
          ? {
              accountOwner: {
                id: p.client.accountOwner.id,
                name: firstName(p.client.accountOwner.name),
                email: p.client.accountOwner.email,
                employee: p.client.accountOwner.employee,
              },
            }
          : { accountOwner: null },
      };
    });
  }

  async projectDetail(scope: PortalScope, projectId: string) {
    this.access.requireModule(scope, "WORK");
    await this.access.assertProjectOwned(scope, projectId);

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId: scope.clientId },
      include: {
        milestones: { where: { clientVisible: true }, orderBy: { dueDate: "asc" } },
        deliverables: { orderBy: { sortOrder: "asc" } },
        files: { orderBy: { uploadedAt: "desc" } },
        assignedPm: { select: { id: true, name: true } },
        tasks: {
          where: { isClientVisible: true, archivedAt: null },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
            assignedTo: { select: { name: true } },
            deliverable: { select: { id: true, title: true } },
          },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }],
        },
        reports: {
          where: { status: "SENT" },
          orderBy: { periodEnd: "desc" },
          take: 5,
          select: {
            id: true,
            title: true,
            periodStart: true,
            periodEnd: true,
            completed: true,
            pending: true,
            pmNotes: true,
            sentAt: true,
          },
        },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const done = project.tasks.filter((t) => t.status === "DONE").length;
    let progress = Number(project.progress ?? 0);
    if (project.milestones.length) {
      progress = Math.round((project.milestones.filter((m) => m.status === "COMPLETED").length / project.milestones.length) * 100);
    } else if (project.tasks.length) {
      progress = Math.round((done / project.tasks.length) * 100);
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      healthStatus: project.healthStatus,
      billingType: project.billingType,
      startDate: project.startDate,
      targetEndDate: project.targetEndDate,
      progress: Math.max(0, Math.min(100, progress)),
      tasksDone: done,
      tasksTotal: project.tasks.length,
      assignedPm: project.assignedPm
        ? { id: project.assignedPm.id, name: firstName(project.assignedPm.name), role: "Project Manager" }
        : null,
      milestones: project.milestones,
      deliverables: project.deliverables,
      files: project.files,
      tasks: project.tasks.map((t) => ({
        ...t,
        assignedTo: t.assignedTo ? { name: firstName(t.assignedTo.name) } : null,
      })),
      updates: project.reports,
    };
  }

  async updates(scope: PortalScope) {
    this.access.requireModule(scope, "WORK");
    const reports = await this.prisma.projectReport.findMany({
      where: {
        status: "SENT",
        project: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
      },
      select: {
        id: true,
        title: true,
        periodStart: true,
        periodEnd: true,
        completed: true,
        pending: true,
        pmNotes: true,
        sentAt: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: { periodEnd: "desc" },
      take: 50,
    });
    return reports.map((r) => ({
      id: r.id,
      title: r.title,
      project: r.project,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      completed: r.completed,
      pending: r.pending,
      note: r.pmNotes,
      sentAt: r.sentAt,
    }));
  }

  /** One report with every field needed to render a PDF. */
  async reportDetail(scope: PortalScope, id: string) {
    this.access.requireModule(scope, "WORK");
    const r = await this.prisma.projectReport.findFirst({
      where: {
        id,
        status: "SENT",
        project: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
      },
      select: {
        id: true,
        title: true,
        periodStart: true,
        periodEnd: true,
        completed: true,
        pending: true,
        pmNotes: true,
        billing: true,
        sentAt: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (!r) throw new NotFoundException("Report not found");
    return {
      id: r.id,
      title: r.title,
      project: r.project,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      completed: r.completed,
      pending: r.pending,
      note: r.pmNotes,
      billing: r.billing,
      sentAt: r.sentAt,
    };
  }

  async invoices(scope: PortalScope) {
    this.access.requireModule(scope, "BILLING");
    const invoices = await this.prisma.invoice.findMany({
      where: {
        clientId: scope.clientId,
        // Drafts are internal work-in-progress; the client only sees issued bills.
        status: { notIn: ["DRAFT", "VOID", "CANCELLED"] },
        ...(scope.projectIds ? { projectId: { in: scope.projectIds } } : {}),
      },
      include: {
        lineItems: true,
        payments: { orderBy: { paymentDate: "desc" } },
        installments: { orderBy: { sequence: "asc" } },
        project: { select: { id: true, name: true } },
        client: {
          select: {
            companyName: true,
            contacts: { select: { name: true, email: true, phone: true, roleTitle: true }, take: 3 },
          },
        },
      },
      orderBy: { issueDate: "desc" },
    });
    const totalsOf = (i: any) => invoiceTotals(i);
    const paidOf = (i: any) => invoiceTotals(i).paid;
    const totalInvoiced = invoices.reduce((s, i) => s + totalsOf(i).grand, 0);
    const totalCollected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const totalOutstanding = invoices.reduce((s, i) => s + (isReceivable(i.status) ? totalsOf(i).balance : 0), 0);

    const projects = await this.prisma.project.findMany({
      where: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
      select: {
        id: true,
        name: true,
        status: true,
        billingType: true,
        monthlyRate: true,
        nextBillingDate: true,
        amount: true,
        budgetAmount: true,
      },
    });
    const billingBreakdown = this.buildBilling(invoices, projects);

    return {
      summary: {
        totalInvoiced: money(totalInvoiced),
        totalCollected: money(totalCollected),
        totalOutstanding: money(totalOutstanding),
        overdueAmount: billingBreakdown.totalOverdue,
        totalMonthlyDue: billingBreakdown.totalMonthlyDue,
      },
      byProject: billingBreakdown.byProject,
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        status: i.status,
        amount: money(totalsOf(i).grand),
        paid: money(paidOf(i)),
        balance: money(totalsOf(i).balance),
        currency: i.currency,
        taxApplicable: i.taxApplicable,
        taxRate: Number(i.taxRate ?? 0),
        discountRate: Number((i as any).discountRate ?? 0),
        shippingFee: Number((i as any).shippingFee ?? 0),
        templateStyle: (i as any).templateStyle ?? "modern-orange",
        terms: (i as any).terms ?? null,
        notes: i.notes,
        project: i.project ? { id: i.project.id, name: i.project.name } : null,
        client: { companyName: i.client.companyName, contacts: i.client.contacts },
        lines: i.lineItems.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          amount: Number(l.amount),
        })),
        payments: (() => {
          const chrono = [...i.payments].sort(
            (a: any, b: any) =>
              +new Date(a.paymentDate) - +new Date(b.paymentDate) ||
              +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0) ||
              String(a.id).localeCompare(String(b.id))
          );
          return i.payments.map((p) => {
            const serial = chrono.findIndex((x: any) => x.id === p.id) + 1;
            return {
              id: p.id,
              amount: Number(p.amount),
              paymentMethod: p.paymentMethod,
              referenceId: p.referenceId,
              serial,
              receiptNo: p.referenceId ?? `${i.invoiceNumber}-P${serial}`,
              paymentDate: p.paymentDate,
            };
          });
        })(),
        installments: i.installments.map((s) => ({
          sequence: s.sequence,
          amount: Number(s.amount),
          paidAmount: Number(s.paidAmount),
          dueDate: s.dueDate,
          status: s.status,
        })),
      })),
    };
  }

  async activity(scope: PortalScope) {
    const logs = await this.prisma.portalActivityLog.findMany({
      where: { portalUserId: scope.portalUserId },
      orderBy: { timestamp: "desc" },
      take: 30,
    });
    return logs.map((l) => ({
      id: l.id,
      action: l.action,
      relatedEntityType: l.relatedEntityType,
      relatedEntityId: l.relatedEntityId,
      timestamp: l.timestamp,
    }));
  }

  // ── Messaging (project thread or "general") ─────────────────────────────
  async messages(scope: PortalScope, threadKey?: string) {
    this.access.requireModule(scope, "MESSAGES");
    const key = threadKey?.trim() || "general";
    if (key !== "general") await this.access.assertProjectOwned(scope, key);

    const rows = await this.prisma.clientComment.findMany({
      where:
        key === "general"
          ? { threadKey: key, clientId: scope.clientId }
          : { threadKey: key, project: { clientId: scope.clientId } },
      include: {
        project: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
        portalUser: { select: { clientContact: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
      take: 300,
    });
    return rows.map((c) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      attachmentUrl: c.attachmentUrl,
      createdAt: c.createdAt,
      threadKey: c.threadKey,
      projectId: c.projectId,
      project: c.project,
      authorName: c.portalUser ? c.portalUser.clientContact.name : firstName(c.author?.name),
      authorType: c.portalUser ? "client" : "agency",
      // Legacy shape kept so older portal builds keep rendering.
      author: c.author ? { id: c.author.id, name: firstName(c.author.name) } : null,
      portalUser: c.portalUser ? { clientContact: { name: c.portalUser.clientContact.name } } : null,
    }));
  }

  async threads(scope: PortalScope) {
    this.access.requireModule(scope, "MESSAGES");
    const projects = await this.prisma.project.findMany({
      where: { clientId: scope.clientId, ...this.access.projectWhere(scope) },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    const keys = ["general", ...projects.map((p) => p.id)];
    const [counts, reads] = await Promise.all([
      this.prisma.clientComment.groupBy({
        by: ["threadKey"],
        where: { threadKey: { in: keys } },
        _count: true,
        _max: { createdAt: true },
      }),
      this.prisma.portalThreadRead.findMany({ where: { portalUserId: scope.portalUserId } }),
    ]);
    const readMap = new Map(reads.map((r) => [r.threadKey, r.lastReadAt]));
    const countMap = new Map(counts.map((c) => [c.threadKey, c]));

    const projectThreads = projects.map((p) => {
      const c = countMap.get(p.id);
      const lastRead = readMap.get(p.id);
      return {
        threadKey: p.id,
        title: p.name,
        type: "project" as const,
        messageCount: c?._count ?? 0,
        lastMessageAt: c?._max.createdAt ?? null,
        unread: !!(c?._max.createdAt && (!lastRead || c._max.createdAt > lastRead)),
      };
    });
    const general = countMap.get("general");
    const generalRead = readMap.get("general");
    return [
      {
        threadKey: "general",
        title: "General",
        type: "general" as const,
        messageCount: general?._count ?? 0,
        lastMessageAt: general?._max.createdAt ?? null,
        unread: !!(general?._max.createdAt && (!generalRead || general._max.createdAt > generalRead)),
      },
      ...projectThreads,
    ];
  }

  async postMessage(scope: PortalScope, threadKey: string, content: string, parentId?: string) {
    this.access.requireModule(scope, "MESSAGES");
    const text = String(content ?? "").trim();
    if (!text) throw new BadRequestException("Message cannot be empty");
    if (text.length > 5000) throw new BadRequestException("Message is too long");

    const key = threadKey?.trim() || "general";
    const project = key === "general" ? null : await this.access.assertProjectOwned(scope, key);

    const comment = await this.prisma.clientComment.create({
      data: {
        threadKey: key,
        clientId: scope.clientId,
        projectId: project?.id ?? null,
        parentId: parentId ?? null,
        content: text,
        portalUserId: scope.portalUserId,
      },
    });
    await this.prisma.portalActivityLog.create({
      data: {
        portalUserId: scope.portalUserId,
        action: "COMMENTED",
        relatedEntityType: project ? "Project" : "Client",
        relatedEntityId: project?.id ?? scope.clientId,
      },
    });

    try {
      if (project) {
        const proj = await this.prisma.project.findUnique({
          where: { id: project.id },
          select: { name: true, assignedPmId: true },
        });
        if (proj?.assignedPmId) {
          await this.notifications.create(
            proj.assignedPmId,
            "CLIENT_MESSAGE",
            "New client message",
            `${scope.contactName} commented on "${proj.name}".`,
            `/portal?thread=${encodeURIComponent(`project:${project.id}`)}`
          );
        }
      } else {
        const client = await this.prisma.client.findUnique({
          where: { id: scope.clientId },
          select: { accountOwnerId: true },
        });
        if (client?.accountOwnerId) {
          await this.notifications.create(
            client.accountOwnerId,
            "CLIENT_MESSAGE",
            "New client message",
            `${scope.contactName} sent a message in the general thread.`,
            `/portal?thread=${encodeURIComponent(`client:${scope.clientId}`)}`
          );
        }
      }
    } catch {}

    await this.invalidatePortal();
    return { ok: true, id: comment.id, createdAt: comment.createdAt };
  }

  async markThreadRead(scope: PortalScope, threadKey: string) {
    this.access.requireModule(scope, "MESSAGES");
    const key = threadKey?.trim() || "general";
    if (key !== "general") await this.access.assertProjectOwned(scope, key);
    await this.prisma.portalThreadRead.upsert({
      where: { portalUserId_threadKey: { portalUserId: scope.portalUserId, threadKey: key } },
      create: { portalUserId: scope.portalUserId, threadKey: key },
      update: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  // ── Deliverable approvals ───────────────────────────────────────────────
  async approveDeliverable(
    scope: PortalScope,
    fileId: string,
    decision: "APPROVED" | "REVISION_REQUESTED",
    revisionNotes?: string
  ) {
    this.access.requireModule(scope, "FILES");
    const file = await this.prisma.projectFile.findUnique({
      where: { id: fileId },
      include: { project: { select: { clientId: true, id: true } } },
    });
    if (!file || file.project.clientId !== scope.clientId) throw new NotFoundException("File not found");
    this.access.assertProjectId(scope, file.project.id);

    const approval = await this.prisma.deliverableApproval.create({
      data: { projectFileId: fileId, portalUserId: scope.portalUserId, decision, revisionNotes },
    });
    await this.prisma.projectFile.update({
      where: { id: fileId },
      data: { approvalStatus: decision === "APPROVED" ? "APPROVED" : "REVISION_REQUESTED" },
    });
    await this.prisma.portalActivityLog.create({
      data: {
        portalUserId: scope.portalUserId,
        action: "APPROVED_DELIVERABLE",
        relatedEntityType: "ProjectFile",
        relatedEntityId: fileId,
      },
    });

    try {
      const proj = await this.prisma.project.findUnique({
        where: { id: file.projectId },
        select: { name: true, assignedPmId: true },
      });
      if (proj?.assignedPmId) {
        await this.notifications.create(
          proj.assignedPmId,
          "CLIENT_MESSAGE",
          decision === "APPROVED" ? "Client approved a file" : "Client requested revision",
          `${scope.contactName} ${decision === "APPROVED" ? "approved" : "requested changes on"} a file in "${proj.name}".`,
          `/flow/${file.projectId}?tab=files&file=${fileId}`
        );
      }
    } catch {}

    await this.invalidatePortal();
    return approval;
  }

  // ── Client-side notifications ───────────────────────────────────────────
  async listNotifications(scope: PortalScope, limit = 30) {    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { portalUserId: scope.portalUserId },
        orderBy: { createdAt: "desc" },
        take: Math.min(100, Math.max(1, limit)),
      }),
      this.prisma.notification.count({ where: { portalUserId: scope.portalUserId, isRead: false } }),
    ]);
    return { items, unread };
  }

  async markNotificationsRead(scope: PortalScope) {
    await this.prisma.notification.updateMany({
      where: { portalUserId: scope.portalUserId, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }

  // ── File downloads (ownership-checked) ─────────────────────────────────
  /**
   * Resolves a project file to a disk path, but only when the file belongs to a
   * project this contact is allowed to see. The public `/api/flow/uploads/:name`
   * route stays for staff; clients go through here instead.
   */
  async fileForDownload(scope: PortalScope, fileId: string) {
    this.access.requireModule(scope, "FILES");
    const file = await this.prisma.projectFile.findUnique({
      where: { id: fileId },
      select: { id: true, fileUrl: true, projectId: true, project: { select: { clientId: true } } },
    });
    if (!file || file.project.clientId !== scope.clientId) throw new NotFoundException("File not found");
    this.access.assertProjectId(scope, file.projectId);

    const raw = String(file.fileUrl ?? "");
    const name = basename(raw.split("?")[0]);
    if (!name || name.includes("..")) throw new NotFoundException("File not found");

    const safe = basename(sanitizeFilename(name));
    const dir = uploadsDir();
    const filePath = findUploadedFile(safe);
    if (!filePath.startsWith(dir) && !filePath.startsWith(join(process.cwd(), "uploads"))) {
      throw new NotFoundException("File not found");
    }
    return { path: filePath, filename: safe };
  }

  // ── Telegram linking ───────────────────────────────────────────────────
  telegramStatus(scope: PortalScope) {
    return this.telegram.status(scope.portalUserId);
  }

  telegramLink(scope: PortalScope) {
    this.access.requireModule(scope, "MESSAGES");
    return this.telegram.createLink(scope.portalUserId);
  }

  telegramUnlink(scope: PortalScope) {
    return this.telegram.unlink(scope.portalUserId);
  }
}
