import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

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
    private readonly cache: CacheService
  ) {}

  async overview() {
    return this.cache.wrap("dashboard:overview", 30, () => this.computeOverview());
  }

  private async computeOverview() {
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
    ] = await Promise.all([
      this.prisma.lead.findMany({ select: { id: true, stage: true, estimatedDealSize: true, name: true, company: true, leadScore: true, assignedToId: true, convertedClientId: true, createdAt: true } }),
      this.prisma.pipelineStage.findMany({ orderBy: { order: "asc" } }),
      this.prisma.client.findMany({ select: { id: true, companyName: true, healthScore: true, healthLevel: true, renewalDate: true, industryVertical: true } }),
      this.prisma.project.findMany({ select: { id: true, name: true, status: true, healthStatus: true, riskScore: true, budgetAmount: true, targetEndDate: true, clientId: true } }),
      this.prisma.task.findMany({ select: { id: true, status: true, dueDate: true, priority: true, title: true, projectId: true, estimatedHours: true } }),
      this.prisma.employee.findMany({ select: { id: true, name: true, roleTitle: true, employmentStatus: true } }),
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
        select: { id: true, amount: true, date: true, category: true, description: true, approvalStatus: true, isClientBillable: true, clientId: true },
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
      this.prisma.attendance.findMany({ where: { date: this.startOfToday() }, select: { employeeId: true, status: true } }),
      this.prisma.taskComment.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { author: { select: { name: true } } } }),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = this.startOfToday();
    const in30Days = new Date(now.getTime() + 30 * 86400000);

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
    const totalInvoiced = invoiceable.reduce(
      (s, i) => s + i.lineItems.reduce((x, l) => x + Number(l.amount), 0),
      0
    );
    const recognizedRevenue = invoiceable.reduce(
      (s, i) =>
        s +
        i.lineItems
          .filter((l) => l.revenueTag !== "PASS_THROUGH")
          .reduce((x, l) => x + Number(l.amount), 0),
      0
    );
    const collected = invoices.reduce((s, i) => s + i.payments.reduce((x, p) => x + Number(p.amount), 0), 0);
    const outstanding = invoiceable
      .filter((i) => i.status !== "PAID")
      .reduce((s, i) => s + (i.lineItems.reduce((x, l) => x + Number(l.amount), 0) - i.payments.reduce((x, p) => x + Number(p.amount), 0)), 0);
    const overdueAmount = invoiceable
      .filter((i) => i.status === "OVERDUE")
      .reduce((s, i) => s + (i.lineItems.reduce((x, l) => x + Number(l.amount), 0) - i.payments.reduce((x, p) => x + Number(p.amount), 0)), 0);
    const expensesMonth = expenses
      .filter((e) => e.date >= monthStart)
      .reduce((s, e) => s + Number(e.amount), 0);
    const pendingExpenses = expenses.filter((e) => e.approvalStatus === "PENDING").length;
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);
    const paymentSplit = this.groupByMethod(payments);

    const revenueTrend = this.buildTrend(snapshots);

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

    const overdueInvoices = invoices
      .filter((i) => i.status === "OVERDUE")
      .map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        dueDate: i.dueDate,
        amount: i.lineItems.reduce((s, l) => s + Number(l.amount), 0),
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
