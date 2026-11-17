import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { ScoringService } from "../scoring/scoring.service";
import { dateStrDhaka } from "../people/people-utils";
import { RECEIPT_PAYMENT_FILTER, invoiceTotals } from "../capital/finance-kernel";
import { modulePermission } from "../common/module-keys";

/** UTC-midnight labelled with today's Dhaka date — matches `attendance.date`. */
const dhakaTodayColumn = () => new Date(`${dateStrDhaka(new Date())}T00:00:00.000Z`);

const STAGE_PROBABILITY: Record<string, number> = {
  NEW: 0.1,
  CONTACTED: 0.25,
  PROPOSAL_SENT: 0.5,
  NEGOTIATION: 0.75,
};

const ACTIVE_INVOICE_STATUSES = [
  "SENT",
  "VIEWED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
];

/* ── Period windows ─────────────────────────────────────────────────────────
   The dashboard answers "how did we do?" over a window. Balances (outstanding,
   overdue, cash) stay point-in-time; flows (invoiced, collected, expenses) are
   scoped to the window. One definition, used by every KPI and panel. */
export type DashboardPeriod = "month" | "quarter" | "year";

const PERIOD_MONTHS: Record<DashboardPeriod, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  month: "This month",
  quarter: "Last 3 months",
  year: "Last 12 months",
};

function resolvePeriod(raw?: string) {
  const key: DashboardPeriod =
    raw === "quarter" || raw === "year" ? raw : "month";
  const now = new Date();
  const months = PERIOD_MONTHS[key];
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const prevFrom = new Date(
    now.getFullYear(),
    now.getMonth() - (months * 2 - 1),
    1
  );
  return {
    key,
    months,
    from,
    prevFrom,
    prevTo: from,
    label: PERIOD_LABEL[key],
    days: Math.max(
      1,
      Math.round((now.getTime() - from.getTime()) / 86400000)
    ),
  };
}

const pct = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

const deltaPct = (current: number, previous: number) =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  /** Last successfully computed snapshot (process-local, survives cache flushes). */
  private lastSnapshot: any = null;
  /** Last time a user actually opened the dashboard (drives cron warming). */
  private lastAccess = 0;
  private inflight: Promise<any> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly scoring: ScoringService
  ) {}

  async overview(period?: string, role?: string, permissions?: Record<string, any>) {
    this.lastAccess = Date.now();
    const snapshot = await this.overviewSnapshot(period);
    return this.redactOverview(snapshot, role, permissions);
  }

  /**
   * The dashboard used to hand every signed-in role the whole company snapshot:
   * cash position, receivables, client revenue concentration and pipeline. The
   * module matrix was enforced everywhere else, so HR / Sales could read finance
   * numbers they cannot open in Capital (audit SEC-02 / BUG-009).
   *
   * Blocks the caller's role cannot view are removed rather than zeroed — a
   * zeroed card reads as "we earned nothing", which is worse than no card.
   * The snapshot itself stays cached in full; redaction is per request.
   */
  private redactOverview(data: any, role?: string, permissions?: Record<string, any>) {
    if (!permissions || role === "Owner") return data;
    const canView = (module: string) => {
      const m = modulePermission(permissions, module);
      return !!(m?.view || m?.edit || m?.approve);
    };
    const out: any = { ...data };
    const hidden: string[] = [];

    if (!canView("CAPITAL")) {
      delete out.capital;
      delete out.targets;
      delete out.concentration;
      if (out.today) {
        const { payables, approvals, approvalItems, ...rest } = out.today;
        out.today = { ...rest, approvals: { ...(approvals ?? {}), expenses: 0 }, approvalItems: { ...(approvalItems ?? {}), expenses: [] } };
      }
      hidden.push("CAPITAL");
    }
    if (!canView("PULSE")) {
      delete out.pulse;
      hidden.push("PULSE");
    }
    if (!canView("ACCOUNTS")) {
      delete out.accounts;
      delete out.topClients;
      hidden.push("ACCOUNTS");
    }
    if (!canView("FLOW")) {
      delete out.flow;
      hidden.push("FLOW");
    }
    if (!canView("TASKS")) {
      delete out.tasks;
      if (out.today) {
        const { dueTasks, overdueTasks, followUps, ...rest } = out.today;
        out.today = { ...rest, dueTasks: [], dueTodayCount: 0, overdueTasks: [], overdueCount: 0, followUps: [], followUpsCount: 0 };
      }
      hidden.push("TASKS");
    }
    if (!canView("PEOPLE")) {
      delete out.people;
      hidden.push("PEOPLE");
    }
    if (!canView("INSIGHT")) {
      delete out.insight;
      hidden.push("INSIGHT");
    }
    // Client names are account data even when Capital is readable.
    if (!canView("ACCOUNTS") && !canView("CAPITAL")) delete out.topClients;
    return { ...out, hidden };
  }

  private async overviewSnapshot(period?: string) {
    const p = resolvePeriod(period);
    // Two-level cache: Redis for the snapshot (120s) and a process-local copy
    // used only when a recompute fails mid-request.
    // Keep the legacy key for the default period so every existing
    // `cache.del("dashboard:overview")` invalidation still clears it.
    const cacheKey =
      p.key === "month" ? "dashboard:overview" : `dashboard:overview:${p.key}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) {
      if (p.key === "month") this.lastSnapshot = cached;
      return cached;
    }
    // A missing cache means a write just invalidated it. Recompute instead of
    // serving the previous snapshot: approvals and money must reflect the
    // action the user just took, not the state from thirty seconds ago.
    try {
      return await this.refreshSnapshot(p.key);
    } catch (error) {
      if (p.key === "month" && this.lastSnapshot) return this.lastSnapshot;
      throw error;
    }
  }

  private async refreshSnapshot(period: DashboardPeriod = "month"): Promise<any> {
    if (this.inflight) return this.inflight;
    const run = this.computeOverview(period)
      .then(async (value) => {
        if (period === "month") this.lastSnapshot = value;
        await this.cache.set(
          period === "month" ? "dashboard:overview" : `dashboard:overview:${period}`,
          value,
          120
        );
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = run;
    return run;
  }

  /**
   * Keep the company snapshot warm.
   *
   * The overview is the most expensive read in the product (~65 queries and a
   * large JS aggregation). Running it on a timer moves that work off the
   * request path entirely.
   */
  @Cron("0 * * * * *")
  async warmOverview() {
    try {
      // Warming is only worth 41 queries/minute while someone is actually
      // looking at the dashboard. On an idle instance this ran forever and was
      // the single biggest background load in the audit (PERF-01).
      if (Date.now() - this.lastAccess > 5 * 60_000) return;
      const started = Date.now();
      await this.refreshSnapshot();
      const ms = Date.now() - started;
      if (ms > 1500) this.logger.warn(`Dashboard warm-up took ${ms} ms`);
    } catch (e: any) {
      this.logger.warn(`Dashboard warm-up failed: ${e?.message ?? e}`);
    }
  }

  /** Personal glimpse: my tasks, my leads + follow-ups, today events, my attendance. */
  async myDay(userId?: string) {
    if (!userId) return { tasks: [], leads: [], followUpsDue: [], events: [], attendance: null, leaves: [] };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, employeeId: true },
    });
    const now = new Date();
    const todayStr = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);

    const [tasks, leads, events, attendance, leaves] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          status: { not: "DONE" },
          archivedAt: null,
          ...(user?.employeeId ? { assignedToId: user.employeeId } : { assignedToId: "__none__" }),
        },
        select: {
          id: true, title: true, status: true, priority: true, dueDate: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: "asc" }],
        take: 12,
      }),
      this.prisma.lead.findMany({
        where: { assignedToId: userId, stage: { notIn: ["WON", "LOST"] } },
        select: {
          id: true, name: true, company: true, stage: true, temperature: true,
          estimatedDealSize: true, nextFollowUpAt: true, leadScore: true,
        },
        orderBy: [{ nextFollowUpAt: "asc" }],
        take: 10,
      }),
      this.prisma.calendarEvent.findMany({
        where: { date: todayStr },
        select: { id: true, title: true, type: true, date: true, clientId: true },
      }),
      this.prisma.attendance.findFirst({
        where: { employeeId: user?.employeeId ?? "__none__", date: dhakaTodayColumn() },
        select: { status: true, checkInTime: true, checkOutTime: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: user?.employeeId ?? "__none__", status: "PENDING" },
        select: { id: true, leaveType: true, startDate: true, endDate: true, status: true },
      }),
    ]);

    const startOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const endOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tasksOverdue = tasks.filter((t) => t.dueDate && t.dueDate < startOfDay).length;
    const tasksDueToday = tasks.filter((t) => t.dueDate && t.dueDate >= startOfDay && t.dueDate < endOfDay).length;
    const followUpsDue = leads.filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() <= now.getTime());

    return {
      tasks,
      tasksOverdue,
      tasksDueToday,
      leads,
      followUpsDue,
      followUpsDueCount: followUpsDue.length,
      events,
      attendance,
      leaves,
    };
  }

  private async computeOverview(period: DashboardPeriod = "month") {
    const now = new Date();
    const periodWindow = resolvePeriod(period);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = this.startOfToday();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const in30Days = new Date(now.getTime() + 30 * 86400000);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const todayStr = dateStrDhaka(now);

    const [
      leads,
      stages,
      clients,
      projects,
      tasks,
      employees,
      invoices,
      payments,
      expenses,
      bankAccounts,
      utilLogs,
      snapshots,
      insights,
      portalActivity,
      auditLogs,
      approvedLeaves,
      todayAttendance,
      taskComments,
      todayEvents,
      upcomingMilestones,
      pendingLeaveCount,
      churnRiskFlags,
      pendingDeliverables,
      adAgg,
      connectedAdAccounts,
      activePortalUsers,
      portalCommentRows,
      connectedIntegrations,
      auditToday,
      activeUserCount,
      reportDefinitionCount,
      attendanceWeek,
      calendarWeek,
      adTrendRows,
      vendorEngagements,
      dollarSales,
      pendingExpenseItems,
      pendingLeaveItems,
      pendingDeliverableItems,
      capacityLogs,
      settingsRow,
    ] = await Promise.all([
      this.prisma.lead.findMany({ select: { id: true, stage: true, estimatedDealSize: true, name: true, company: true, leadScore: true, assignedToId: true, convertedClientId: true, createdAt: true, lastContactedAt: true, nextFollowUpAt: true } }),
      this.prisma.pipelineStage.findMany({ orderBy: { order: "asc" } }),
      this.prisma.client.findMany({ select: { id: true, companyName: true, healthScore: true, healthLevel: true, renewalDate: true, industryVertical: true } }),
      this.prisma.project.findMany({ select: { id: true, name: true, status: true, healthStatus: true, riskScore: true, riskDriver: true, budgetAmount: true, targetEndDate: true, clientId: true, billingType: true, monthlyRate: true } }),
      this.prisma.task.findMany({ select: { id: true, status: true, dueDate: true, priority: true, title: true, projectId: true, assignedToId: true, estimatedHours: true, completedAt: true } }),
      this.prisma.employee.findMany({ select: { id: true, name: true, roleTitle: true, employmentStatus: true, joinDate: true, department: true } }),
      this.prisma.invoice.findMany({
        select: {
          id: true, invoiceNumber: true, status: true, clientId: true, issueDate: true, dueDate: true,
          // Only the money fields: the dashboard never renders an invoice line.
          lineItems: { select: { amount: true, revenueTag: true } },
          payments: { select: { amount: true, type: true } },
        },
      }),
      this.prisma.payment.findMany({ where: { ...RECEIPT_PAYMENT_FILTER }, select: { id: true, amount: true, paymentMethod: true, paymentDate: true } }),
      this.prisma.expense.findMany({
        where: { approvalStatus: { in: ["APPROVED", "PENDING"] } },
        select: { id: true, amount: true, exchangeRate: true, date: true, category: true, description: true, approvalStatus: true, isClientBillable: true, clientId: true, isPayable: true, paidAmount: true, dueDate: true },
      }),
      this.prisma.bankAccount.findMany({ select: { accountName: true, currentBalance: true } }),
      this.prisma.utilizationLog.groupBy({
        by: ["employeeId"],
        _max: { weekStartDate: true },
      }),
      this.prisma.metricSnapshot.findMany({ select: { metricName: true, value: true, recordedAt: true }, orderBy: { recordedAt: "asc" } }),
      this.prisma.correlationInsight.findMany({ orderBy: { surfacedAt: "desc" }, take: 4 }),
      this.prisma.portalActivityLog.findMany({ orderBy: { timestamp: "desc" }, take: 6, include: { portalUser: { include: { clientContact: { select: { name: true, client: { select: { companyName: true } } } } } } } }),
      this.prisma.systemAuditLog.findMany({ orderBy: { timestamp: "desc" }, take: 4 }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED" }, select: { employeeId: true, startDate: true, endDate: true } }),
      this.prisma.attendance.findMany({ where: { date: dhakaTodayColumn() }, select: { employeeId: true, status: true } }),
      this.prisma.taskComment.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { author: { select: { name: true } } } }),
      this.prisma.calendarEvent.findMany({
        where: { date: todayStr },
        select: { id: true, title: true, type: true, date: true, project: { select: { name: true } }, client: { select: { companyName: true } } },
        orderBy: { title: "asc" },
        take: 8,
      }),
      this.prisma.milestone.findMany({
        where: { status: { not: "COMPLETED" }, dueDate: { gte: today, lte: in30Days } },
        select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } },
        orderBy: { dueDate: "asc" },
        take: 8,
      }),
      this.prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      this.prisma.churnRiskFlag.findMany({ distinct: ["clientId"], select: { clientId: true } }),
      this.prisma.projectFile.count({ where: { approvalStatus: "PENDING" } }),
      this.prisma.adInsight.aggregate({
        where: { date: { gte: monthStart } },
        _sum: { spend: true, conversions: true, conversionValue: true },
      }),
      this.prisma.adAccount.count({ where: { status: "CONNECTED" } }),
      this.prisma.portalUser.count({ where: { isActive: true } }),
      this.prisma.clientComment.findMany({ where: { portalUserId: { not: null }, createdAt: { gte: weekAgo } }, select: { createdAt: true } }),
      this.prisma.integration.count({ where: { status: "CONNECTED" } }),
      this.prisma.systemAuditLog.count({ where: { timestamp: { gte: today } } }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.reportDefinition.count(),
      this.prisma.attendance.findMany({ where: { date: { gte: weekAgo } }, select: { date: true, status: true } }),
      this.prisma.calendarEvent.findMany({ where: { date: { gte: todayStr, lte: dateStrDhaka(in7Days) } }, select: { date: true } }),
      this.prisma.adInsight.findMany({ where: { date: { gte: sixMonthsAgo } }, select: { date: true, spend: true } }),
      this.prisma.vendorEngagement.findMany({
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true, vendorId: true, totalAmount: true, dueDate: true, status: true, retentionPct: true, deliveredAt: true,
          payments: { select: { amount: true, type: true, taxWithheld: true } },
        },
      }),
      this.prisma.dollarSale.findMany({
        select: { usdAmount: true, bdtAmount: true, costBdt: true, profit: true, marginPct: true, date: true, clientId: true },
      }),
      // Action Center rows — the counts alone could not be acted on inline.
      this.prisma.expense.findMany({
        where: { approvalStatus: "PENDING" },
        select: {
          id: true, description: true, amount: true, date: true, category: true,
          submittedBy: { select: { name: true } },
          client: { select: { companyName: true } },
        },
        orderBy: [{ date: "asc" }],
        take: 8,
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: "PENDING" },
        select: {
          id: true, leaveType: true, startDate: true, endDate: true, appliedAt: true,
          employee: { select: { name: true } },
        },
        orderBy: [{ appliedAt: "asc" }],
        take: 8,
      }),
      this.prisma.projectFile.findMany({
        where: { approvalStatus: "PENDING" },
        select: {
          id: true, fileName: true, uploadedAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ uploadedAt: "asc" }],
        take: 8,
      }),
      // Capacity heatmap: six weeks of logged utilisation per employee.
      this.prisma.utilizationLog.findMany({
        where: { weekStartDate: { gte: new Date(now.getTime() - 42 * 86400000) } },
        select: {
          weekStartDate: true,
          utilizationRate: true,
          employee: { select: { id: true, name: true, roleTitle: true } },
        },
        orderBy: [{ weekStartDate: "asc" }],
      }),
      this.prisma.settings.findUnique({ where: { id: "default" }, select: { financeConfig: true, leadRules: true } }),
    ]);

    // ── Pulse ──────────────────────────────────────────────────────────
    const activeLeads = leads.filter((l) => !["WON", "LOST"].includes(l.stage));
    const pipelineValue = activeLeads.reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0);
    const weightedForecast = activeLeads.reduce(
      (s, l) => s + Number(l.estimatedDealSize ?? 0) * (STAGE_PROBABILITY[l.stage] ?? 0),
      0
    );
    const won = leads.filter((l) => l.stage === "WON").length;
    const lost = leads.filter((l) => l.stage === "LOST").length;
    const leadsByStage = stages.map((st) => ({
      stage: st.name,
      count: leads.filter((l) => l.stage === st.name.toUpperCase().replace(/\s+/g, "_")).length,
      value: leads
        .filter((l) => l.stage === st.name.toUpperCase().replace(/\s+/g, "_"))
        .reduce((s, l) => s + Number(l.estimatedDealSize ?? 0), 0),
    }));
    const hotLeads = activeLeads.filter((l) => (l.leadScore ?? 0) >= 70).length;
    // Same rule Pulse uses (`LeadRulesService.isStale`): no touch for N days,
    // anchored on lastContactedAt, not on creation. The old stage-SLA-from-
    // createdAt rule made the dashboard say 5 while Pulse said 3 (BUG-005).
    const staleDays = Number(((settingsRow as any)?.leadRules?.sla?.staleDays ?? 7)) || 7;
    const staleLeads = activeLeads.filter((l) => {
      const anchor = (l as any).lastContactedAt ?? l.createdAt;
      return now.getTime() - new Date(anchor).getTime() > staleDays * 86_400_000;
    }).length;

    // ── Accounts ───────────────────────────────────────────────────────
    const health = { GREEN: 0, YELLOW: 0, RED: 0 };
    let healthTotal = 0;
    for (const c of clients) {
      health[c.healthLevel] = (health[c.healthLevel] ?? 0) + 1;
      healthTotal += c.healthScore ?? 0;
    }
    const avgHealth = clients.length ? Math.round(healthTotal / clients.length) : 0;
    const renewalsNext30 = clients.filter((c) => c.renewalDate && c.renewalDate > today && c.renewalDate <= in30Days).length;

    // ── Flow ───────────────────────────────────────────────────────────
    const activeProjects = projects.filter((p) => p.status === "ACTIVE" || p.status === "PLANNING");
    const healthStatusCounts = { ON_TRACK: 0, AT_RISK: 0, DELAYED: 0 };
    for (const p of projects) healthStatusCounts[p.healthStatus] = (healthStatusCounts[p.healthStatus] ?? 0) + 1;
    const avgRisk = activeProjects.length
      ? Math.round(activeProjects.reduce((s, p) => s + (p.riskScore ?? 0), 0) / activeProjects.length)
      : 0;
    const completed = projects.filter((p) => p.status === "COMPLETED");
    const onTimeRate = completed.length
      ? Math.round((completed.filter((p) => (p.riskScore ?? 0) <= 30).length / completed.length) * 100)
      : null;
    const atRisk = projects.filter((p) => ["AT_RISK", "DELAYED"].includes(p.healthStatus)).map((p) => ({
      id: p.id,
      name: p.name,
      healthStatus: p.healthStatus,
      riskScore: p.riskScore,
      riskDriver: null as string | null,
      clientId: p.clientId,
    }));
    // Risk drivers already came with the project select — the follow-up query
    // here was a second round-trip for data we had.
    for (const p of atRisk) {
      const row = projects.find((r) => r.id === p.id);
      p.riskDriver = row?.riskDriver ?? null;
    }

    // ── Tasks ──────────────────────────────────────────────────────────
    const openTasks = tasks.filter((t) => t.status !== "DONE");
    // Window is [today 00:00, tomorrow 00:00). The previous version used
    // `dueDate <= today`, which is yesterday's window: a task due today was
    // counted as neither due-today nor overdue, so the card read 0 while the
    // same response listed 3 due tasks and /tasks/stats said 3 (audit BUG-001).
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const dueToday = openTasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < tomorrow).length;
    const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today).length;
    const blocked = tasks.filter((t) => t.status === "BLOCKED").length;
    const hoursThisWeek = await this.aggregateHoursThisWeek();
    const highPriority = openTasks
      .filter((t) => t.priority === "URGENT" || t.priority === "HIGH")
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.status }));
    const highPriorityCount = openTasks.filter((t) => t.priority === "URGENT" || t.priority === "HIGH").length;

    // ── People ─────────────────────────────────────────────────────────
    const presentToday = todayAttendance.filter((a) => a.status !== "ABSENT").length;
    const onLeaveToday = approvedLeaves.filter(
      (l) => l.startDate <= today && l.endDate >= today
    ).length;
    // Latest utilization per employee in ONE statement. The old OR-list grew
    // with the headcount and ran on every dashboard build.
    const latestUtilLogs = utilLogs.length
      ? await this.prisma.$queryRaw<{ employeeId: string; utilizationRate: number }[]>`
          SELECT DISTINCT ON ("employeeId") "employeeId", "utilizationRate"
          FROM "UtilizationLog"
          ORDER BY "employeeId", "weekStartDate" DESC
        `
      : [];
    const avgUtilization = latestUtilLogs.length
      ? Math.round((latestUtilLogs.reduce((s, l) => s + l.utilizationRate, 0) / latestUtilLogs.length) * 100)
      : 0;
    const overloaded = latestUtilLogs.filter((l) => l.utilizationRate >= 1.05).length;

    // ── Capital ────────────────────────────────────────────────────────
    const invoiceable = invoices.filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status));
    // Same canonical math as Capital + Accounts (tax/discount/shipping, net refunds).
    const totalInvoiced = invoiceable.reduce((s, i) => s + invoiceTotals(i).grand, 0);
    const recognizedRevenue = invoiceable.reduce(
      (s, i) =>
        s +
        i.lineItems
          .filter((l) => l.revenueTag !== "PASS_THROUGH")
          .reduce((x, l) => x + Number(l.amount), 0),
      0
    );
    const collected = invoices.reduce((s, i) => s + invoiceTotals(i).paid, 0);
    const outstanding = invoiceable.reduce((s, i) => s + invoiceTotals(i).balance, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const overdueOpen = invoiceable.filter((i) => {
      const bal = invoiceTotals(i).balance;
      return bal > 0 && !!i.dueDate && new Date(i.dueDate) < todayStart;
    });
    const overdueAmount = overdueOpen.reduce((s, i) => s + invoiceTotals(i).balance, 0);
    // Approved only, converted to BDT — the same definition Capital and Insight
    // use. Including PENDING rows in raw currency made this card disagree with
    // the finance module by 60,000 BDT (BUG-005).
    const expensesMonth = expenses
      .filter((e) => e.date >= monthStart && e.approvalStatus === "APPROVED")
      .reduce((s, e) => s + Number(e.amount) * (Number((e as any).exchangeRate ?? 1) || 1), 0);
    const pendingExpenses = expenses.filter((e) => e.approvalStatus === "PENDING").length;
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);
    const paymentSplit = this.groupByMethod(payments);

    const revenueTrend = await this.buildTrend();

    // ── Period flows, targets and forecasts ────────────────────────────
    // Everything below is scoped by `periodWindow` so the header switcher and
    // every KPI tell the same story. Balances (outstanding/overdue/cash) stay
    // point-in-time on purpose.
    const revenueOf = (invoice: any) =>
      invoice.lineItems
        .filter((l: any) => l.revenueTag !== "PASS_THROUGH")
        .reduce((x: number, l: any) => x + Number(l.amount), 0);
    const inWindow = (d: Date | null | undefined, from: Date, to?: Date) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= from.getTime() && (!to || t < to.getTime());
    };
    const sumBy = <T,>(rows: T[], pick: (row: T) => number) =>
      rows.reduce((s, row) => s + pick(row), 0);

    const periodInvoices = invoiceable.filter((i) =>
      inWindow(i.issueDate, periodWindow.from)
    );
    const prevInvoices = invoiceable.filter((i) =>
      inWindow(i.issueDate, periodWindow.prevFrom, periodWindow.prevTo)
    );
    const periodRevenue = sumBy(periodInvoices, revenueOf);
    const prevRevenue = sumBy(prevInvoices, revenueOf);
    const periodInvoiced = sumBy(periodInvoices, (i) => invoiceTotals(i).grand);
    const prevInvoiced = sumBy(prevInvoices, (i) => invoiceTotals(i).grand);
    const periodCollected = sumBy(
      payments.filter((p) => inWindow(p.paymentDate, periodWindow.from)),
      (p) => Number(p.amount)
    );
    const prevCollected = sumBy(
      payments.filter((p) =>
        inWindow(p.paymentDate, periodWindow.prevFrom, periodWindow.prevTo)
      ),
      (p) => Number(p.amount)
    );
    const periodExpenses = sumBy(
      expenses.filter(
        (e) =>
          e.approvalStatus === "APPROVED" &&
          inWindow(e.date, periodWindow.from)
      ),
      (e) => Number(e.amount)
    );
    const prevExpenses = sumBy(
      expenses.filter(
        (e) =>
          e.approvalStatus === "APPROVED" &&
          inWindow(e.date, periodWindow.prevFrom, periodWindow.prevTo)
      ),
      (e) => Number(e.amount)
    );
    const periodNet = periodRevenue - periodExpenses;
    const periodMargin = pct(periodNet, periodRevenue);

    const financeConfig: any = (settingsRow?.financeConfig as any) ?? {};
    const positiveNumber = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const monthlyRevenueTarget = positiveNumber(financeConfig.monthlyRevenueTarget);
    const monthlyFixedCost = positiveNumber(financeConfig.monthlyFixedCost);
    const targetForPeriod = monthlyRevenueTarget
      ? monthlyRevenueTarget * periodWindow.months
      : null;
    const targetProgress = targetForPeriod
      ? pct(periodRevenue, targetForPeriod)
      : null;

    // Runway uses cash ÷ average monthly spend (gross outflow, the
    // conservative number an owner means by "how long can I survive").
    const burnWindowStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const burnRows = expenses.filter(
      (e) =>
        e.approvalStatus === "APPROVED" &&
        new Date(e.date).getTime() >= burnWindowStart.getTime()
    );
    const burnMonths = new Set(
      burnRows.map((e) => {
        const d = new Date(e.date);
        return `${d.getFullYear()}-${d.getMonth()}`;
      })
    );
    const avgMonthlySpend = burnMonths.size
      ? sumBy(burnRows, (e) => Number(e.amount)) / burnMonths.size
      : 0;
    const monthlyBurn = Math.max(avgMonthlySpend, monthlyFixedCost ?? 0);
    const runwayMonths =
      monthlyBurn > 0
        ? Math.round((cashPosition / monthlyBurn) * 10) / 10
        : null;

    // Days sales outstanding: how long the current book takes to collect.
    const dsoDays =
      periodRevenue > 0
        ? Math.round((outstanding / periodRevenue) * periodWindow.days)
        : null;

    // AR aging — every open balance, bucketed by days past due.
    const agingBuckets = [
      { key: "0-30", label: "0–30", amount: 0, count: 0 },
      { key: "31-60", label: "31–60", amount: 0, count: 0 },
      { key: "61-90", label: "61–90", amount: 0, count: 0 },
      { key: "90+", label: "90+", amount: 0, count: 0 },
    ];
    let agingNotDue = 0;
    for (const invoice of invoiceable) {
      const balance = invoiceTotals(invoice).balance;
      if (balance <= 0) continue;
      const due = invoice.dueDate ? new Date(invoice.dueDate) : new Date(invoice.issueDate);
      const days = Math.floor((now.getTime() - due.getTime()) / 86400000);
      if (days < 0) {
        agingNotDue += balance;
        agingBuckets[0].amount += balance;
        agingBuckets[0].count += 1;
        continue;
      }
      const index = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
      agingBuckets[index].amount += balance;
      agingBuckets[index].count += 1;
    }
    const agingTotal = sumBy(agingBuckets, (b) => b.amount);
    const agingWorst = agingBuckets[3];

    // Client concentration — the risk that one relationship is the business.
    const revenueByClient = new Map<string, number>();
    for (const invoice of invoiceable) {
      revenueByClient.set(
        invoice.clientId,
        (revenueByClient.get(invoice.clientId) ?? 0) + revenueOf(invoice)
      );
    }
    const clientName = new Map(clients.map((c) => [c.id, c.companyName]));
    const clientHealth = new Map(clients.map((c) => [c.id, c.healthLevel]));
    const rankedClients = [...revenueByClient.entries()]
      .map(([id, revenue]) => ({
        id,
        name: clientName.get(id) ?? "Unknown",
        healthLevel: clientHealth.get(id) ?? null,
        revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    const concentrationTotal = sumBy(rankedClients, (c) => c.revenue);
    const top1Share = pct(rankedClients[0]?.revenue ?? 0, concentrationTotal);
    const top3Share = pct(
      sumBy(rankedClients.slice(0, 3), (c) => c.revenue),
      concentrationTotal
    );
    const concentrationWarn = positiveNumber(financeConfig.concentrationWarnPct) ?? 50;
    const concentrationCritical =
      positiveNumber(financeConfig.concentrationCriticalPct) ?? 60;
    const concentration = {
      top1Share,
      top3Share,
      totalRevenue: concentrationTotal,
      top: rankedClients.slice(0, 5).map((c) => ({
        ...c,
        share: pct(c.revenue, concentrationTotal),
      })),
      top3: rankedClients.slice(0, 3).map((c) => ({
        ...c,
        share: pct(c.revenue, concentrationTotal),
      })),
      level:
        top3Share >= concentrationCritical
          ? "critical"
          : top3Share >= concentrationWarn
            ? "warning"
            : "ok",
      warnAt: concentrationWarn,
      criticalAt: concentrationCritical,
    };

    // Capacity heatmap — six most recent weeks × employee.
    const weekKeys = new Map<string, { key: string; label: string; short: string; start: Date }>();
    for (const log of capacityLogs) {
      const start = new Date(log.weekStartDate);
      const key = start.toISOString().slice(0, 10);
      if (!weekKeys.has(key)) {
        weekKeys.set(key, {
          key,
          label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
          short: start.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }),
          start,
        });
      }
    }
    const weeks = [...weekKeys.values()]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(-6);
    const capacityRows = new Map<
      string,
      { id: string; name: string; role: string; values: Record<string, number | null> }
    >();
    for (const log of capacityLogs) {
      const key = new Date(log.weekStartDate).toISOString().slice(0, 10);
      if (!weeks.some((w) => w.key === key)) continue;
      const row =
        capacityRows.get(log.employee.id) ??
        {
          id: log.employee.id,
          name: log.employee.name,
          role: log.employee.roleTitle,
          values: {},
        };
      row.values[key] = Math.round(Number(log.utilizationRate) * 100);
      capacityRows.set(log.employee.id, row);
    }
    const capacity = {
      weeks,
      rows: [...capacityRows.values()]
        .map((row) => {
          const filled = weeks
            .map((w) => row.values[w.key])
            .filter((v): v is number => v != null);
          return {
            ...row,
            avg: filled.length
              ? Math.round(filled.reduce((s, v) => s + v, 0) / filled.length)
              : null,
          };
        })
        .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)),
      hasData: capacityLogs.length > 0,
    };

    // Data completeness — a number is only useful if the inputs exist.
    const activeProjectRows = projects.filter((p) => p.status === "ACTIVE");
    const openTaskRows = tasks.filter((t) => t.status !== "DONE");
    const completenessChecks = [
      {
        key: "budget",
        label: "Active projects without a budget",
        count: activeProjectRows.filter((p) => !Number(p.budgetAmount ?? 0)).length,
        total: activeProjectRows.length,
        href: "/flow",
      },
      {
        key: "estimate",
        label: "Open tasks without an estimate",
        count: openTaskRows.filter((t) => t.estimatedHours == null).length,
        total: openTaskRows.length,
        href: "/tasks",
      },
      {
        key: "next-action",
        label: "Open leads without a next action",
        count: activeLeads.filter((l) => !l.nextFollowUpAt).length,
        total: activeLeads.length,
        href: "/pulse",
      },
      {
        key: "time",
        label: hoursThisWeek > 0 ? "Time logged this week" : "No time logged this week",
        count: hoursThisWeek > 0 ? 0 : 1,
        total: 1,
        href: "/tasks",
      },
    ];
    const completenessScore = Math.round(
      (completenessChecks.reduce(
        (s, c) => s + (c.total ? 1 - c.count / c.total : 1),
        0
      ) /
        completenessChecks.length) *
        100
    );
    const completeness = {
      score: completenessScore,
      checks: completenessChecks,
    };


    // ── Today + module insights ────────────────────────────────────────
    const activeEmployees = employees.filter((e) => e.employmentStatus === "ACTIVE").length;
    const absentToday = Math.max(activeEmployees - presentToday - onLeaveToday, 0);
    const attendanceRate = activeEmployees ? Math.round((presentToday / activeEmployees) * 100) : 0;
    const newJoiners = employees.filter((e) => e.joinDate && e.joinDate >= monthStart).length;
    const followUpsDue = activeLeads.filter(
      (l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() <= now.getTime()
    ).length;
    const newLeadsWeek = leads.filter((l) => l.createdAt >= weekAgo).length;
    const reviewCount = tasks.filter((t) => t.status === "REVIEW").length;
    const completedThisWeek = tasks.filter(
      (t) => t.status === "DONE" && t.completedAt && t.completedAt >= weekStart
    ).length;
    const monthlyRecurring = projects
      .filter((p) => p.billingType === "RECURRING" && ["ACTIVE", "PLANNING"].includes(p.status))
      .reduce((s, p) => s + Number(p.monthlyRate ?? 0), 0);
    const collectionRate = totalInvoiced ? Math.round((collected / totalInvoiced) * 100) : 0;
    const adSpend = Number(adAgg?._sum?.spend ?? 0);
    const adConversions = Number(adAgg?._sum?.conversions ?? 0);
    const adConversionValue = Number(adAgg?._sum?.conversionValue ?? 0);
    const adRoas = adSpend > 0 ? Math.round((adConversionValue / adSpend) * 100) / 100 : null;

    // ── Time series for sparklines, funnels and rings ──────────────────
    const dayKey = (d: Date) => dateStrDhaka(d);
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getTime() - (6 - i) * 86400000);
      return { key: dayKey(d), label: d.toLocaleDateString("en-US", { weekday: "narrow" }) };
    });
    const next7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() + i * 86400000);
      return { key: dateStrDhaka(d), label: d.toLocaleDateString("en-US", { weekday: "narrow" }) };
    });
    const attendance7d = last7.map((d) => ({
      label: d.label,
      value: attendanceWeek.filter((a) => dayKey(a.date) === d.key && a.status !== "ABSENT").length,
    }));
    const calendar7d = next7.map((d) => ({
      label: d.label,
      value: calendarWeek.filter((e) => e.date === d.key).length,
    }));
    const comments7d = last7.map((d) => ({
      label: d.label,
      value: portalCommentRows.filter((c) => dayKey(c.createdAt) === d.key).length,
    }));
    const adTrend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      return {
        label: d.toLocaleDateString("en-US", { month: "short" }),
        value: Math.round(
          adTrendRows
            .filter((r) => `${r.date.getFullYear()}-${r.date.getMonth()}` === key)
            .reduce((s, r) => s + Number(r.spend ?? 0), 0)
        ),
      };
    });
    const capitalTrend = revenueTrend.map((m) => ({ label: m.month, value: m.collected }));
    const tasksByStatus: Record<string, number> = { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, BLOCKED: 0, DONE: 0 };
    for (const t of tasks) tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
    const tasksByPriority: Record<string, number> = { URGENT: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const t of openTasks) tasksByPriority[t.priority] = (tasksByPriority[t.priority] ?? 0) + 1;

    // ── Liabilities: vendor commitments + other payables ───────────────
    const paidOn = (e: any) => {
      const sum = (types: string[]) =>
        e.payments.filter((p: any) => types.includes(p.type)).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
      return sum(["ADVANCE", "PARTIAL", "FINAL"]) - sum(["REFUND"]);
    };
    const nextWeek = new Date(today.getTime() + 7 * 86400000);
    let liabCommitted = 0;
    let liabPaid = 0;
    let liabPayable = 0;
    let liabOverdue = 0;
    let liabOverdueCount = 0;
    let liabDueWeek = 0;
    let liabDueWeekCount = 0;
    let liabAdvance = 0;
    let liabRetention = 0;
    const liabilityVendors = new Set<string>();
    for (const e of vendorEngagements) {
      const total = Number(e.totalAmount);
      const paid = paidOn(e);
      const balance = Math.max(total - paid, 0);
      liabCommitted += total;
      liabPaid += paid;
      liabPayable += balance;
      liabilityVendors.add(e.vendorId);
      liabRetention += (total * Number(e.retentionPct ?? 0)) / 100;
      if (e.status !== "COMPLETED") liabAdvance += paid;
      if (balance > 0 && e.dueDate && e.dueDate < today) {
        liabOverdue += balance;
        liabOverdueCount += 1;
      }
      if (balance > 0 && e.dueDate && e.dueDate >= today && e.dueDate <= nextWeek) {
        liabDueWeek += balance;
        liabDueWeekCount += 1;
      }
    }
    const payableExpenses = expenses.filter((e) => e.isPayable && e.approvalStatus === "APPROVED");
    const expensePayable = payableExpenses.reduce(
      (s, e) => s + Math.max(Number(e.amount) - Number(e.paidAmount ?? 0), 0),
      0
    );
    const expenseOverdue = payableExpenses.reduce((s, e) => {
      const bal = Math.max(Number(e.amount) - Number(e.paidAmount ?? 0), 0);
      const due = e.dueDate ?? e.date;
      return bal > 0 && due && due < today ? s + bal : s;
    }, 0);
    const totalOwed = liabPayable + expensePayable;
    const totalOwedOverdue = liabOverdue + expenseOverdue;

    // ── Dollar Desk: client FX sales ───────────────────────────────────
    const dollarCostRateRaw = Number((settingsRow?.financeConfig as any)?.dollarCostRate);
    const dollarCostRate = Number.isFinite(dollarCostRateRaw) && dollarCostRateRaw > 0 ? dollarCostRateRaw : 130;
    const dsMonth = dollarSales.filter((s) => s.date >= monthStart);
    const sumD = (list: any[], key: string) => list.reduce((s, r) => s + Number((r as any)[key] ?? 0), 0);
    const dollarUsdMtd = sumD(dsMonth, "usdAmount");
    const dollarBdtMtd = sumD(dsMonth, "bdtAmount");
    const dollarCostMtd = sumD(dsMonth, "costBdt");
    const dollarProfitMtd = sumD(dsMonth, "profit");
    const dollarProfitAll = sumD(dollarSales, "profit");
    const dollarUsdAll = sumD(dollarSales, "usdAmount");
    const dollarMarginMtd = dollarBdtMtd ? Math.round((dollarProfitMtd / dollarBdtMtd) * 1000) / 10 : 0;
    const dollarLossRows = dsMonth.filter((s) => Number(s.profit) < 0);
    const dollarMonthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const next = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
      const list = dollarSales.filter((s) => s.date >= d && s.date < next);
      return {
        label: d.toLocaleDateString("en-US", { month: "short" }),
        value: Math.round(sumD(list, "profit") * 100) / 100,
      };
    });
    const expenseOverdueCount = payableExpenses.filter((e) => {
      const bal = Math.max(Number(e.amount) - Number(e.paidAmount ?? 0), 0);
      const due = e.dueDate ?? e.date;
      return bal > 0 && !!due && due < today;
    }).length;

    // ── Decision layer: one score + ranked alerts ──────────────────────
    const onTrackCount = healthStatusCounts.ON_TRACK ?? 0;
    const deliveryScore = activeProjects.length
      ? Math.round((onTrackCount / activeProjects.length) * 100)
      : 100;
    // Attendance is meaningless on a weekly off (nobody punched), so the Team
    // driver uses weekly utilisation when it exists and only falls back to
    // today's attendance. This is why the score used to drop to 0 every Friday.
    const teamScore = avgUtilization > 0
      ? Math.min(100, Math.round(avgUtilization))
      : attendanceRate;
    const overall = await this.scoring.computeOverall({
      finance: collectionRate,
      delivery: deliveryScore,
      people: teamScore,
      clients: avgHealth,
    });
    const scoreComponents = overall.components.map((c) => ({
      key: c.key,
      label: c.label,
      value: c.value,
      weight: c.weight / 100,
      contribution: c.contribution,
    }));
    const healthScore = overall.score;
    const healthGrade = overall.grade;

    const oldestOverdueDays = openTasks.reduce(
      (max, t) =>
        t.dueDate && t.dueDate < today
          ? Math.max(max, Math.floor((today.getTime() - t.dueDate.getTime()) / 86400000))
          : max,
      0
    );
    const worstOverdueInvoice = [...overdueOpen].sort(
      (a, b) => invoiceTotals(b).balance - invoiceTotals(a).balance
    )[0];
    const approvalTotalAll = pendingExpenses + pendingLeaveCount + pendingDeliverables;

    type Severity = "critical" | "warning" | "info";
    type Alert = {
      id: string;
      severity: Severity;
      module: string;
      label: string;
      metric: number;
      kind: "money" | "count" | "percent" | "ratio";
      hint: string;
      action: string;
      href: string;
    };
    const alerts: Alert[] = [];

    if (overdueAmount > 0) {
      const share = recognizedRevenue > 0 ? overdueAmount / recognizedRevenue : 1;
      alerts.push({
        id: "overdue-invoices",
        severity: overdueOpen.length >= 3 || share >= 0.25 ? "critical" : "warning",
        module: "capital",
        label: "Overdue invoices",
        metric: overdueAmount,
        kind: "money",
        hint: `${overdueOpen.length} invoice${overdueOpen.length === 1 ? "" : "s"}${
          worstOverdueInvoice
            ? ` · largest ${worstOverdueInvoice.invoiceNumber} ৳${Math.round(
                invoiceTotals(worstOverdueInvoice).balance
              ).toLocaleString("en-US")}`
            : ""
        }`,
        action: "Collect now",
        href: "/capital/invoices",
      });
    }
    if (atRisk.length > 0) {
      alerts.push({
        id: "projects-at-risk",
        severity: atRisk.length >= 2 ? "critical" : "warning",
        module: "flow",
        label: "Projects at risk",
        metric: atRisk.length,
        kind: "count",
        hint: `${atRisk
          .slice(0, 2)
          .map((p) => p.name)
          .join(" · ")}${atRisk.length > 2 ? ` +${atRisk.length - 2}` : ""}`,
        action: "Review projects",
        href: "/flow",
      });
    }
    if (overdue > 0) {
      alerts.push({
        id: "tasks-overdue",
        severity: overdue >= 8 ? "critical" : "warning",
        module: "tasks",
        label: "Tasks overdue",
        metric: overdue,
        kind: "count",
        hint: oldestOverdueDays > 0 ? `Oldest ${oldestOverdueDays} day${oldestOverdueDays === 1 ? "" : "s"} late` : "Past due date",
        action: "Open task board",
        href: "/tasks",
      });
    }
    if (staleLeads > 0) {
      alerts.push({
        id: "leads-stale",
        severity: "warning",
        module: "pulse",
        label: "Stale leads",
        metric: staleLeads,
        kind: "count",
        hint: `${staleLeads} lead${staleLeads === 1 ? " is" : "s are"} past their stage SLA`,
        action: "Work the pipeline",
        href: "/pulse",
      });
    }
    if (approvalTotalAll > 0) {
      alerts.push({
        id: "approvals",
        severity: "warning",
        module: "people",
        label: "Approvals waiting",
        metric: approvalTotalAll,
        kind: "count",
        hint: `${pendingExpenses} expense · ${pendingLeaveCount} leave · ${pendingDeliverables} file${
          pendingDeliverables === 1 ? "" : "s"
        }`,
        action: "Clear approvals",
        href: "/notifications",
      });
    }
    if (churnRiskFlags.length > 0) {
      alerts.push({
        id: "churn-risk",
        severity: "warning",
        module: "accounts",
        label: "Clients at churn risk",
        metric: churnRiskFlags.length,
        kind: "count",
        hint: "Flagged by the client scoring engine",
        action: "Review accounts",
        href: "/accounts",
      });
    }
    if (activeEmployees > 0 && todayAttendance.length > 0 && attendanceRate < 60) {
      alerts.push({
        id: "attendance-low",
        severity: "warning",
        module: "people",
        label: "Attendance below 60%",
        metric: attendanceRate,
        kind: "percent",
        hint: `${presentToday} of ${activeEmployees} checked in today`,
        action: "View attendance",
        href: "/people/attendance",
      });
    }
    if (adRoas != null && adRoas < 1.5 && adSpend > 0) {
      alerts.push({
        id: "roas-low",
        severity: "warning",
        module: "insight",
        label: "Ad return below target",
        metric: adRoas,
        kind: "ratio",
        hint: `Target ≥ 1.5x · ৳${Math.round(adSpend).toLocaleString("en-US")} spent MTD`,
        action: "Inspect campaigns",
        href: "/insight",
      });
    }
    if (renewalsNext30 > 0) {
      alerts.push({
        id: "renewals",
        severity: "info",
        module: "accounts",
        label: "Renewals in 30 days",
        metric: renewalsNext30,
        kind: "count",
        hint: "Prepare renewal conversations",
        action: "See renewals",
        href: "/accounts",
      });
    }
    if (totalOwedOverdue > 0) {
      alerts.push({
        id: "vendor-payables-overdue",
        severity: totalOwed > 0 && totalOwedOverdue / totalOwed >= 0.4 ? "critical" : "warning",
        module: "liabilities",
        label: "Vendor payables overdue",
        metric: totalOwedOverdue,
        kind: "money",
        hint: `${liabOverdueCount} commitment${liabOverdueCount === 1 ? "" : "s"} past due · ৳${Math.round(totalOwed).toLocaleString("en-US")} total owed`,
        action: "Settle payables",
        href: "/capital/liabilities?status=OVERDUE",
      });
    }
    if (liabDueWeek > 0) {
      alerts.push({
        id: "vendor-payables-due-week",
        severity: "warning",
        module: "liabilities",
        label: "Vendor payments due this week",
        metric: liabDueWeek,
        kind: "money",
        hint: `${liabDueWeekCount} commitment${liabDueWeekCount === 1 ? "" : "s"} due within 7 days`,
        action: "Plan payments",
        href: "/capital/liabilities",
      });
    }
    if (dollarLossRows.length > 0) {
      alerts.push({
        id: "dollar-sale-below-cost",
        severity: "warning",
        module: "dollar",
        label: "Dollar sales below cost",
        metric: dollarLossRows.reduce((s, r) => s + Math.abs(Number(r.profit)), 0),
        kind: "money",
        hint: `${dollarLossRows.length} sale${dollarLossRows.length === 1 ? "" : "s"} this month below the ${dollarCostRate} cost rate`,
        action: "Review sales",
        href: "/capital/dollar",
      });
    }

    const severityRank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.metric - a.metric);

    const moduleAlerts: Record<string, { severity: Severity; count: number }> = {};
    for (const a of alerts) {
      const cur = moduleAlerts[a.module];
      if (!cur || severityRank[a.severity] < severityRank[cur.severity]) {
        moduleAlerts[a.module] = { severity: a.severity, count: (cur?.count ?? 0) + 1 };
      } else {
        cur.count += 1;
      }
    }

    const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const todayTaskRows = openTasks
      .filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < new Date(today.getTime() + 86400000))
      .sort(
        (a, b) =>
          (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
          (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0)
      )
      .slice(0, 6);
    const overdueTaskRows = openTasks
      .filter((t) => t.dueDate && t.dueDate < today)
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
      .slice(0, 5);
    // Only the rows we actually render need names; the list query no longer
    // joins every task to its assignee/project.
    const shownTaskIds = [...new Set([...todayTaskRows, ...overdueTaskRows].map((t) => t.id))];
    const shownMeta = shownTaskIds.length
      ? await this.prisma.task.findMany({
          where: { id: { in: shownTaskIds } },
          select: { id: true, assignedTo: { select: { name: true } }, project: { select: { name: true } } },
        })
      : [];
    const metaById = new Map(shownMeta.map((m) => [m.id, m]));
    const todayTasks = todayTaskRows.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
      assignee: metaById.get(t.id)?.assignedTo?.name ?? null,
      projectName: metaById.get(t.id)?.project?.name ?? null,
    }));
    const overdueTasks = overdueTaskRows.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      assignee: metaById.get(t.id)?.assignedTo?.name ?? null,
      projectName: metaById.get(t.id)?.project?.name ?? null,
    }));
    const followUps = activeLeads
      .filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() <= now.getTime())
      .sort((a, b) => new Date(a.nextFollowUpAt!).getTime() - new Date(b.nextFollowUpAt!).getTime())
      .slice(0, 5)
      .map((l) => ({
        id: l.id,
        name: l.name,
        company: l.company,
        stage: l.stage,
        estimatedDealSize: Number(l.estimatedDealSize ?? 0),
        nextFollowUpAt: l.nextFollowUpAt,
      }));
    const eventsToday = todayEvents.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      projectName: e.project?.name ?? null,
      clientName: e.client?.companyName ?? null,
    }));
    const nextMilestone = upcomingMilestones[0]
      ? {
          id: upcomingMilestones[0].id,
          name: upcomingMilestones[0].name,
          dueDate: upcomingMilestones[0].dueDate,
          projectName: upcomingMilestones[0].project.name,
        }
      : null;

    const moduleInsights = {
      pulse: {
        totalLeads: leads.length,
        activeLeads: activeLeads.length,
        pipelineValue,
        weightedForecast,
        hotLeads,
        staleLeads,
        followUpsDue,
        won,
        lost,
        newThisWeek: newLeadsWeek,
        leadsByStage,
      },
      accounts: {
        total: clients.length,
        green: health.GREEN,
        yellow: health.YELLOW,
        red: health.RED,
        avgHealth,
        renewals30: renewalsNext30,
        churnRisks: churnRiskFlags.length,
      },
      flow: {
        total: projects.length,
        active: activeProjects.length,
        atRisk: atRisk.length,
        onTrack: healthStatusCounts.ON_TRACK ?? 0,
        delayed: healthStatusCounts.DELAYED ?? 0,
        onTimeRate,
        avgRisk,
        upcomingMilestones: upcomingMilestones.length,
        nextMilestone,
      },
      tasks: {
        open: openTasks.length,
        dueToday,
        overdue,
        blocked,
        review: reviewCount,
        completedThisWeek,
        hoursThisWeek,
        highPriority: highPriorityCount,
        byStatus: tasksByStatus,
        byPriority: tasksByPriority,
      },
      people: {
        headcount: activeEmployees,
        present: presentToday,
        onLeave: onLeaveToday,
        absent: absentToday,
        attendanceRate,
        utilization: avgUtilization,
        overloaded,
        pendingLeave: pendingLeaveCount,
        newJoiners,
        attendance7d,
      },
      capital: {
        invoiced: totalInvoiced,
        recognized: recognizedRevenue,
        collected,
        outstanding,
        overdue: overdueAmount,
        expensesMonth,
        cash: cashPosition,
        collectionRate,
        pendingExpenses,
        monthlyRecurring,
        trend: capitalTrend,
      },
      insight: {
        correlations: insights.length,
        adSpend,
        adConversions,
        adConversionValue,
        adRoas,
        adAccounts: connectedAdAccounts,
        reports: reportDefinitionCount,
        adTrend,
      },
      calendar: {
        todayEvents: todayEvents.length,
        upcomingMilestones: upcomingMilestones.length,
        next7: calendar7d,
      },
      portal: {
        activeUsers: activePortalUsers,
        comments7d: portalCommentRows.length,
        pendingDeliverables,
        commentsSeries: comments7d,
      },
      control: {
        activeUsers: activeUserCount,
        connectedIntegrations,
        auditToday,
      },
      liabilities: {
        committed: liabCommitted,
        paid: liabPaid,
        payable: liabPayable,
        overdue: liabOverdue,
        overdueCount: liabOverdueCount,
        dueWeek: liabDueWeek,
        dueWeekCount: liabDueWeekCount,
        advanceOutstanding: liabAdvance,
        retentionHeld: liabRetention,
        vendors: liabilityVendors.size,
        otherPayables: expensePayable,
        otherOverdue: expenseOverdue,
        totalOwed,
        totalOverdue: totalOwedOverdue,
      },
      dollar: {
        costRate: dollarCostRate,
        usdMtd: dollarUsdMtd,
        bdtMtd: dollarBdtMtd,
        costMtd: dollarCostMtd,
        profitMtd: dollarProfitMtd,
        marginMtd: dollarMarginMtd,
        profitAll: dollarProfitAll,
        usdAll: dollarUsdAll,
        countMtd: dsMonth.length,
        clients: new Set(dollarSales.map((s) => s.clientId)).size,
        lossCount: dollarLossRows.length,
        lossAmount: dollarLossRows.reduce((s, r) => s + Math.abs(Number(r.profit)), 0),
        monthly: dollarMonthly,
      },
    };

    const todayWork = {
      date: now.toISOString(),
      dueTasks: todayTasks,
      dueTodayCount: dueToday,
      overdueTasks,
      overdueCount: overdue,
      followUps,
      followUpsCount: followUpsDue,
      events: eventsToday,
      eventCount: eventsToday.length,
      approvals: {
        expenses: pendingExpenses,
        leave: pendingLeaveCount,
        deliverables: pendingDeliverables,
      },
      approvalItems: {
        expenses: pendingExpenseItems.map((e) => ({
          id: e.id,
          title: e.description,
          amount: Number(e.amount),
          date: e.date,
          category: e.category,
          who: e.submittedBy?.name ?? null,
          client: e.client?.companyName ?? null,
          href: "/capital/expenses",
        })),
        leave: pendingLeaveItems.map((l) => ({
          id: l.id,
          title: `${l.employee?.name ?? "Employee"} · ${String(l.leaveType)
            .replace(/_/g, " ")
            .toLowerCase()}`,
          startDate: l.startDate,
          endDate: l.endDate,
          appliedAt: l.appliedAt,
          href: "/people/leave",
        })),
        deliverables: pendingDeliverableItems.map((f) => ({
          id: f.id,
          title: f.fileName ?? "Deliverable",
          project: f.project?.name ?? null,
          uploadedAt: f.uploadedAt,
          href: f.project?.id ? `/flow?project=${f.project.id}` : "/flow",
        })),
      },
      payables: {
        overdueAmount: totalOwedOverdue,
        overdueCount: liabOverdueCount + expenseOverdueCount,
        dueWeekAmount: liabDueWeek,
        dueWeekCount: liabDueWeekCount,
      },
      team: {
        headcount: activeEmployees,
        present: presentToday,
        onLeave: onLeaveToday,
        absent: absentToday,
      },
    };

    // ── Insight + activity feed ────────────────────────────────────────
    const recentActivity = [
      ...portalActivity.map((a) => ({
        id: `p-${a.id}`,
        text: `${a.portalUser.clientContact.name} (${a.portalUser.clientContact.client.companyName}) ${this.describePortalAction(a.action)}`,
        at: a.timestamp,
        kind: "portal" as const,
      })),
      ...auditLogs.map((a) => ({
        id: `a-${a.id}`,
        text: `${a.action} on ${a.entityType}`,
        at: a.timestamp,
        kind: "system" as const,
      })),
      ...taskComments.map((c) => ({
        id: `c-${c.id}`,
        text: `${c.author?.name ?? "Someone"} commented on a task`,
        at: c.createdAt,
        kind: "task" as const,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8);

    const topClients = clients
      .map((c) => {
        const revenue = invoices
          .filter((i) => i.clientId === c.id && ACTIVE_INVOICE_STATUSES.includes(i.status))
          .reduce((s, i) => s + i.lineItems.filter((l) => l.revenueTag !== "PASS_THROUGH").reduce((x, l) => x + Number(l.amount), 0), 0);
        return { id: c.id, companyName: c.companyName, revenue, healthLevel: c.healthLevel, healthScore: c.healthScore };
      })
      .filter((c) => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const overdueInvoices = overdueOpen.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      dueDate: i.dueDate,
      amount: invoiceTotals(i).balance,
      clientId: i.clientId,
    }));

    return {
      generatedAt: now.toISOString(),
      pulse: { totalLeads: leads.length, activeLeads: activeLeads.length, pipelineValue, weightedForecast, won, lost, hotLeads, staleLeads, leadsByStage },
      accounts: { totalClients: clients.length, avgHealth, health, renewalsNext30 },
      flow: { totalProjects: projects.length, activeProjects: activeProjects.length, healthStatusCounts, avgRisk, onTimeRate, atRisk },
      tasks: { openTasks: openTasks.length, dueToday, overdue, blocked, hoursThisWeek, highPriority },
      people: { totalEmployees: employees.length, presentToday, onLeaveToday, avgUtilization, overloaded },
      capital: {
        totalInvoiced,
        recognizedRevenue,
        collected,
        outstanding,
        overdueAmount,
        expensesMonth,
        pendingExpenses,
        cashPosition,
        paymentSplit,
        revenueTrend,
        overdueInvoices,
        // Period-scoped flows (used by the KPI strip and Cash & revenue panel)
        periodInvoiced,
        periodRevenue,
        periodCollected,
        periodExpenses,
        periodNet,
        periodMargin,
        prevInvoiced,
        prevRevenue,
        prevCollected,
        prevExpenses,
        revenueDelta: deltaPct(periodRevenue, prevRevenue),
        collectedDelta: deltaPct(periodCollected, prevCollected),
        expensesDelta: deltaPct(periodExpenses, prevExpenses),
        monthlyRevenueTarget,
        monthlyFixedCost,
        targetForPeriod,
        targetProgress,
        monthlyBurn,
        runwayMonths,
        dsoDays,
        aging: agingBuckets,
        agingTotal,
        agingNotDue,
        agingWorstAmount: agingWorst.amount,
        agingWorstCount: agingWorst.count,
      },
      period: {
        key: periodWindow.key,
        label: periodWindow.label,
        months: periodWindow.months,
        from: periodWindow.from.toISOString(),
        to: now.toISOString(),
        days: periodWindow.days,
      },
      targets: { monthlyRevenueTarget, monthlyFixedCost },
      concentration,
      capacity,
      completeness,
      insight: { insights: insights.map((i) => ({ id: i.id, description: i.description, confidenceLevel: i.confidenceLevel, surfacedAt: i.surfacedAt })) },
      nextMilestone,
      moduleInsights,
      today: todayWork,
      scorecard: { score: healthScore, grade: healthGrade, components: scoreComponents },
      alerts,
      moduleAlerts,
      recentActivity,
      topClients,
    };
  }

  private async aggregateHoursThisWeek(): Promise<number> {
    const weekStart = new Date();
    const day = (weekStart.getDay() + 6) % 7; // Monday
    weekStart.setDate(weekStart.getDate() - day);
    weekStart.setHours(0, 0, 0, 0);
    // Sum in Postgres: the old findMany pulled every time log of the week into
    // Node just to add them up.
    const agg = await this.prisma.timeLog.aggregate({
      where: { date: { gte: weekStart } },
      _sum: { hours: true },
    });
    return Math.round(Number(agg._sum.hours ?? 0) * 10) / 10;
  }

  private groupByMethod(payments: { amount: any; paymentMethod: string }[]) {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.paymentMethod, (map.get(p.paymentMethod) ?? 0) + Number(p.amount));
    }
    return Array.from(map.entries()).map(([method, amount]) => ({ method, amount }));
  }

  /**
   * Revenue / collection / expense trend straight from the ledgers.
   *
   * The dashboard used to read `MetricSnapshot`, a demo table. The seed wrote
   * months of snapshots for periods with no invoices at all, so the board showed
   * revenue the company never earned. Aggregating the real documents keeps the
   * dashboard identical to the Capital report (and to the GL).
   */
  private async buildTrend() {
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 7, 1));
    const [invoiced, collected, expenses] = await Promise.all([
      this.prisma.$queryRaw<{ month: string; amount: number }[]>`
        SELECT to_char(i."issueDate", 'YYYY-MM') AS month,
               COALESCE(SUM(li.amount * COALESCE(i."exchangeRate", 1)), 0)::float8 AS amount
        FROM "Invoice" i
        JOIN "InvoiceLineItem" li ON li."invoiceId" = i.id
        WHERE i.status IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE')
          AND i."issueDate" >= ${since}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ month: string; amount: number }[]>`
        SELECT to_char(p."paymentDate", 'YYYY-MM') AS month,
               COALESCE(SUM(CASE WHEN p.type = 'REFUND' THEN -p.amount ELSE p.amount END), 0)::float8 AS amount
        FROM "Payment" p
        WHERE p.type IN ('IN','REFUND') AND p."paymentDate" >= ${since}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ month: string; amount: number }[]>`
        SELECT to_char(e.date, 'YYYY-MM') AS month,
               COALESCE(SUM(e.amount * COALESCE(e."exchangeRate", 1)), 0)::float8 AS amount
        FROM "Expense" e
        WHERE e."approvalStatus" = 'APPROVED' AND e.date >= ${since}
        GROUP BY 1
      `,
    ]);
    const keyOf = (v: string | number) =>
      typeof v === "number"
        ? `${v}`
        : v;
    const byMonth = {
      invoiced: new Map(invoiced.map((r) => [keyOf(r.month), Number(r.amount)])),
      collected: new Map(collected.map((r) => [keyOf(r.month), Number(r.amount)])),
      expenses: new Map(expenses.map((r) => [keyOf(r.month), Number(r.amount)])),
    };
    const rows: { month: string; invoiced: number; collected: number; expenses: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      rows.push({
        month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
        invoiced: Math.round((byMonth.invoiced.get(key) ?? 0) * 100) / 100,
        collected: Math.round((byMonth.collected.get(key) ?? 0) * 100) / 100,
        expenses: Math.round((byMonth.expenses.get(key) ?? 0) * 100) / 100,
      });
    }
    return rows;
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private describePortalAction(action: string): string {
    const map: Record<string, string> = {
      VIEWED_INVOICE: "viewed an invoice",
      APPROVED_DELIVERABLE: "approved a deliverable",
      COMMENTED: "left a comment",
      LOGGED_IN: "logged into the portal",
    };
    return map[action] ?? action.toLowerCase();
  }

  // ── Role-aware home payload ─────────────────────────────────────────
  /**
   * One call that returns exactly what the signed-in role needs.
   *
   * The old dashboard shipped the entire company snapshot to every account,
   * including finance figures an employee should never see. This keeps the
   * heavy aggregation cached while narrowing the response per role.
   */
  async home(
    roleName?: string,
    userId?: string,
    permissions?: Record<string, any>,
    period?: string
  ) {
    const role = (roleName ?? "").toLowerCase();
    const controlAdmin = permissions?.CONTROL?.view === true;
    // Order matters: "HR/Admin" must be HR (not admin) and "Team Member" must be
    // an employee (not a manager). Owner is checked first, then the specific
    // functions, then permission-based/admin, then employee, then manager.
    const view: "admin" | "owner" | "finance" | "manager" | "hr" | "sales" | "employee" =
      /owner/.test(role)
        ? "owner"
        : /(^|[^a-z])hr([^a-z]|$)|people|human/.test(role)
          ? "hr"
          : /finance|account/.test(role)
            ? "finance"
            : /sales|(^|[^a-z])bd([^a-z]|$)/.test(role)
              ? "sales"
              : controlAdmin || /admin/.test(role)
                ? "admin"
                : /employee|intern|member|staff|associate|junior/.test(role)
                  ? "employee"
                  : /project|manager|team\s*lead|teamlead|\bpm\b|lead/.test(role)
                    ? "manager"
                    : "employee";

    const [full, personal] = await Promise.all([this.overview(period), this.myDay(userId)]);
    const base = {
      view,
      generatedAt: full.generatedAt,
      personal,
      // The period switcher and metric definitions apply to every role.
      period: full.period,
      targets: full.targets,
    };
    const pickModules = (keys: string[]) =>
      Object.fromEntries(
        keys
          .map((k) => [k, (full as any).moduleInsights?.[k]])
          .filter(([, v]) => v !== undefined)
      );
    const pickAlerts = (keys: string[]) =>
      ((full as any).alerts ?? []).filter((a: any) => keys.includes(a.module));
    const pickModuleAlerts = (keys: string[]) =>
      Object.fromEntries(
        Object.entries((full as any).moduleAlerts ?? {}).filter(([k]) => keys.includes(k))
      );

    if (view === "owner" || view === "admin") return { ...base, ...full };

    if (view === "finance") {
      return {
        ...base,
        moduleInsights: pickModules(["accounts", "capital", "flow", "liabilities", "dollar"]),
        moduleAlerts: pickModuleAlerts(["accounts", "capital", "flow", "liabilities", "dollar"]),
        alerts: pickAlerts(["accounts", "capital", "flow", "liabilities", "dollar"]),
        today: full.today,
        scorecard: full.scorecard,
        capital: full.capital,
        concentration: full.concentration,
        completeness: full.completeness,
        topClients: full.topClients,
        accounts: {
          totalClients: full.accounts.totalClients,
          avgHealth: full.accounts.avgHealth,
          health: full.accounts.health,
          renewalsNext30: full.accounts.renewalsNext30,
        },
        flow: {
          activeProjects: full.flow.activeProjects,
          healthStatusCounts: full.flow.healthStatusCounts,
          atRisk: full.flow.atRisk,
        },
        recentActivity: full.recentActivity,
      };
    }

    if (view === "manager") {
      return {
        ...base,
        moduleInsights: pickModules(["pulse", "flow", "tasks", "people"]),
        moduleAlerts: pickModuleAlerts(["pulse", "flow", "tasks", "people"]),
        alerts: pickAlerts(["pulse", "flow", "tasks", "people"]),
        today: full.today,
        scorecard: full.scorecard,
        flow: full.flow,
        tasks: full.tasks,
        people: full.people,
        capacity: full.capacity,
        completeness: full.completeness,
        pulse: {
          pipelineValue: full.pulse.pipelineValue,
          weightedForecast: full.pulse.weightedForecast,
          activeLeads: full.pulse.activeLeads,
          leadsByStage: full.pulse.leadsByStage,
        },
        accounts: { renewalsNext30: full.accounts.renewalsNext30 },
        recentActivity: full.recentActivity,
      };
    }

    if (view === "hr") {
      return {
        ...base,
        moduleInsights: pickModules(["people", "tasks", "calendar"]),
        moduleAlerts: pickModuleAlerts(["people", "tasks", "calendar"]),
        alerts: pickAlerts(["people", "tasks", "calendar"]),
        today: full.today,
        scorecard: full.scorecard,
        people: full.people,
        tasks: full.tasks,
        capacity: full.capacity,
        completeness: full.completeness,
        flow: { activeProjects: full.flow.activeProjects, atRisk: full.flow.atRisk },
        recentActivity: full.recentActivity,
      };
    }

    if (view === "sales") {
      return {
        ...base,
        moduleInsights: pickModules(["pulse", "accounts", "tasks", "calendar"]),
        moduleAlerts: pickModuleAlerts(["pulse", "accounts", "tasks", "calendar"]),
        alerts: pickAlerts(["pulse", "accounts", "tasks", "calendar"]),
        today: full.today,
        scorecard: full.scorecard,
        pulse: full.pulse,
        accounts: { renewalsNext30: full.accounts.renewalsNext30, avgHealth: full.accounts.avgHealth },
        completeness: full.completeness,
        tasks: { openTasks: full.tasks.openTasks, dueToday: full.tasks.dueToday, overdue: full.tasks.overdue },
        recentActivity: full.recentActivity,
      };
    }

    return {
      ...base,
      moduleInsights: {},
      today: null,
      tasks: { openTasks: full.tasks.openTasks, dueToday: full.tasks.dueToday, overdue: full.tasks.overdue },
      flow: { atRisk: full.flow.atRisk },
      accounts: { renewalsNext30: full.accounts.renewalsNext30 },
    };
  }

  // ── Role-scoped dashboards ─────────────────────────────────────────────
  async scoped(roleName?: string) {
    const full = await this.overview();
    const role = (roleName ?? "").toLowerCase();
    if (!role || /owner|admin/.test(role)) {
      return { view: "command-center", ...full };
    }
    if (/sales|bd/.test(role)) {
      return {
        view: "sales",
        pulse: full.pulse,
        recentActivity: full.recentActivity,
        insight: full.insight,
        generatedAt: full.generatedAt,
      };
    }
    if (/finance|account/.test(role)) {
      return {
        view: "finance",
        capital: full.capital,
        topClients: full.topClients,
        recentActivity: full.recentActivity,
        generatedAt: full.generatedAt,
      };
    }
    if (/project|pm/.test(role)) {
      return {
        view: "project",
        flow: full.flow,
        tasks: full.tasks,
        recentActivity: full.recentActivity,
        generatedAt: full.generatedAt,
      };
    }
    if (/hr/.test(role)) {
      return {
        view: "people",
        people: full.people,
        tasks: full.tasks,
        generatedAt: full.generatedAt,
      };
    }
    return {
      view: "accounts",
      accounts: full.accounts,
      capital: full.capital,
      generatedAt: full.generatedAt,
    };
  }
}
