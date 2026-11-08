import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { ScoringService } from "../scoring/scoring.service";
import { dateStrDhaka } from "../people/people-utils";
import { invoiceTotals } from "../capital/finance-kernel";

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

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly scoring: ScoringService
  ) {}

  async overview() {
    return this.cache.wrap("dashboard:overview", 30, () => this.computeOverview());
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

  private async computeOverview() {
    const now = new Date();
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
      settingsRow,
    ] = await Promise.all([
      this.prisma.lead.findMany({ select: { id: true, stage: true, estimatedDealSize: true, name: true, company: true, leadScore: true, assignedToId: true, convertedClientId: true, createdAt: true, nextFollowUpAt: true } }),
      this.prisma.pipelineStage.findMany({ orderBy: { order: "asc" } }),
      this.prisma.client.findMany({ select: { id: true, companyName: true, healthScore: true, healthLevel: true, renewalDate: true, industryVertical: true } }),
      this.prisma.project.findMany({ select: { id: true, name: true, status: true, healthStatus: true, riskScore: true, budgetAmount: true, targetEndDate: true, clientId: true, billingType: true, monthlyRate: true } }),
      this.prisma.task.findMany({ select: { id: true, status: true, dueDate: true, priority: true, title: true, projectId: true, estimatedHours: true, completedAt: true, assignedTo: { select: { id: true, name: true } }, project: { select: { name: true } } } }),
      this.prisma.employee.findMany({ select: { id: true, name: true, roleTitle: true, employmentStatus: true, joinDate: true, department: true } }),
      this.prisma.invoice.findMany({
        select: {
          id: true, invoiceNumber: true, status: true, clientId: true, issueDate: true, dueDate: true,
          lineItems: { select: { amount: true, revenueTag: true } },
          payments: { select: { amount: true } },
        },
      }),
      this.prisma.payment.findMany({ select: { id: true, amount: true, paymentMethod: true, paymentDate: true } }),
      this.prisma.expense.findMany({
        where: { approvalStatus: { in: ["APPROVED", "PENDING"] } },
        select: { id: true, amount: true, date: true, category: true, description: true, approvalStatus: true, isClientBillable: true, clientId: true, isPayable: true, paidAmount: true, dueDate: true },
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
      this.prisma.settings.findUnique({ where: { id: "default" }, select: { financeConfig: true } }),
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
    const staleLeads = activeLeads.filter((l) => {
      const createdAt = l.createdAt.getTime();
      const stageSla = stages.find((s) => s.name.toUpperCase().replace(/\s+/g, "_") === l.stage)?.slaDays ?? 5;
      return now.getTime() - createdAt > stageSla * 86400000;
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
    const projectRiskDrivers = await this.prisma.project.findMany({
      where: { id: { in: atRisk.map((p) => p.id) } },
      select: { id: true, riskDriver: true },
    });
    for (const p of atRisk) {
      p.riskDriver = projectRiskDrivers.find((r) => r.id === p.id)?.riskDriver ?? null;
    }

    // ── Tasks ──────────────────────────────────────────────────────────
    const openTasks = tasks.filter((t) => t.status !== "DONE");
    const dueToday = openTasks.filter((t) => t.dueDate && t.dueDate <= today && t.dueDate >= new Date(today.getTime() - 86400000)).length;
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
    const latestUtilLogs = await this.prisma.utilizationLog.findMany({
      where: {
        OR: utilLogs.map((u) => ({ employeeId: u.employeeId, weekStartDate: u._max.weekStartDate! })),
      },
      select: { utilizationRate: true, employeeId: true },
    });
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
    const expensesMonth = expenses
      .filter((e) => e.date >= monthStart)
      .reduce((s, e) => s + Number(e.amount), 0);
    const pendingExpenses = expenses.filter((e) => e.approvalStatus === "PENDING").length;
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);
    const paymentSplit = this.groupByMethod(payments);

    const revenueTrend = this.buildTrend(snapshots);

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
    const overall = await this.scoring.computeOverall({
      finance: collectionRate,
      delivery: deliveryScore,
      people: attendanceRate,
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
        hint: `${followUpsDue} follow-up${followUpsDue === 1 ? "" : "s"} due today or earlier`,
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
        hint: `${renewalsNext30} renewal${renewalsNext30 === 1 ? "" : "s"} in the next 30 days`,
        action: "Review accounts",
        href: "/accounts",
      });
    }
    if (activeEmployees > 0 && attendanceRate < 60) {
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
    const todayTasks = openTasks
      .filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < new Date(today.getTime() + 86400000))
      .sort(
        (a, b) =>
          (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
          (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0)
      )
      .slice(0, 6)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate,
        assignee: t.assignedTo?.name ?? null,
        projectName: t.project?.name ?? null,
      }));
    const overdueTasks = openTasks
      .filter((t) => t.dueDate && t.dueDate < today)
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
        assignee: t.assignedTo?.name ?? null,
        projectName: t.project?.name ?? null,
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
      flow: { totalProjects: projects.length, activeProjects: activeProjects.length, healthStatusCounts, avgRisk, onTimeRate, atRisk: atRisk.slice(0, 5) },
      tasks: { openTasks: openTasks.length, dueToday, overdue, blocked, hoursThisWeek, highPriority },
      people: { totalEmployees: employees.length, presentToday, onLeaveToday, avgUtilization, overloaded },
      capital: { totalInvoiced, recognizedRevenue, collected, outstanding, overdueAmount, expensesMonth, pendingExpenses, cashPosition, paymentSplit, revenueTrend, overdueInvoices },
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
    const logs = await this.prisma.timeLog.findMany({
      where: { date: { gte: weekStart } },
      select: { hours: true },
    });
    return Math.round(logs.reduce((s, l) => s + Number(l.hours), 0) * 10) / 10;
  }

  private groupByMethod(payments: { amount: any; paymentMethod: string }[]) {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.paymentMethod, (map.get(p.paymentMethod) ?? 0) + Number(p.amount));
    }
    return Array.from(map.entries()).map(([method, amount]) => ({ method, amount }));
  }

  private buildTrend(snapshots: { metricName: string; value: number; recordedAt: Date }[]) {
    const months = new Map<string, { month: string; invoiced: number; collected: number; expenses: number }>();
    for (const s of snapshots) {
      const key = `${s.recordedAt.getMonth()}/${s.recordedAt.getFullYear()}`;
      const label = s.recordedAt.toLocaleString("en-US", { month: "short" });
      const entry = months.get(key) ?? { month: label, invoiced: 0, collected: 0, expenses: 0 };
      if (s.metricName === "monthly_invoiced") entry.invoiced = s.value;
      if (s.metricName === "monthly_collected") entry.collected = s.value;
      if (s.metricName === "monthly_expenses") entry.expenses = s.value;
      months.set(key, entry);
    }
    return Array.from(months.values());
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
  async home(roleName?: string, userId?: string, permissions?: Record<string, any>) {
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

    const [full, personal] = await Promise.all([this.overview(), this.myDay(userId)]);
    const base = { view, generatedAt: full.generatedAt, personal };
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
        capital: full.capital,
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
        flow: full.flow,
        tasks: full.tasks,
        people: full.people,
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
        people: full.people,
        tasks: full.tasks,
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
        pulse: full.pulse,
        accounts: { renewalsNext30: full.accounts.renewalsNext30, avgHealth: full.accounts.avgHealth },
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
