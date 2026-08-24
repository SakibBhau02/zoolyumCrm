import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

const ACTIVE_INVOICE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];
const TAX_RATE = 0.22;

@Injectable()
export class InsightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async metrics(metricName?: string) {
    return this.cache.wrap(`insight:metrics:${metricName ?? "all"}`, 60, async () => {
      const snapshots = await this.prisma.metricSnapshot.findMany({
        where: metricName ? { metricName } : undefined,
        orderBy: { recordedAt: "asc" },
      });
      const byMetric = new Map<string, { metric: string; points: { date: Date; value: number }[] }>();
      for (const s of snapshots) {
        const entry = byMetric.get(s.metricName) ?? { metric: s.metricName, points: [] };
        entry.points.push({ date: s.recordedAt, value: s.value });
        byMetric.set(s.metricName, entry);
      }
      return Array.from(byMetric.values());
    });
  }

  async correlations() {
    return this.cache.wrap("insight:correlations", 60, () =>
      this.prisma.correlationInsight.findMany({
        include: { dismissedBy: { select: { name: true } } },
        orderBy: { surfacedAt: "desc" },
      })
    );
  }

  async dismiss(id: string, userId: string) {
    const result = await this.prisma.correlationInsight.update({
      where: { id },
      data: { dismissedById: userId, dismissedAt: new Date() },
    });
    await this.cache.del("insight:correlations");
    return result;
  }

  async digests() {
    return this.cache.wrap("insight:digests", 60, () =>
      this.prisma.executiveDigestLog.findMany({ orderBy: { generatedAt: "desc" }, take: 6 })
    );
  }

  // ── Report library ─────────────────────────────────────────────────────
  async reportDefinitions() {
    return this.cache.wrap("insight:reports", 60, () =>
      this.prisma.reportDefinition.findMany({ orderBy: { createdAt: "desc" } })
    );
  }

  async createReport(body: { name: string; metrics?: any; dimensions?: any; filters?: any; schedule?: string }, userId?: string) {
    const result = await this.prisma.reportDefinition.create({
      data: {
        name: body.name,
        createdById: userId ?? null,
        metrics: body.metrics ?? [],
        dimensions: body.dimensions ?? [],
        filters: body.filters ?? {},
        schedule: body.schedule ?? null,
      },
    });
    await this.cache.del("insight:reports");
    return result;
  }

  async updateReport(id: string, body: any) {
    const existing = await this.prisma.reportDefinition.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Report not found");
    const result = await this.prisma.reportDefinition.update({
      where: { id },
      data: {
        name: body.name,
        metrics: body.metrics,
        dimensions: body.dimensions,
        filters: body.filters,
        schedule: body.schedule,
        lastRunAt: body.runNow ? new Date() : existing.lastRunAt,
      },
    });
    await this.cache.del("insight:reports");
    return result;
  }

  async deleteReport(id: string) {
    await this.prisma.reportDefinition.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Report not found");
    });
    await this.cache.del("insight:reports");
    return { deleted: true };
  }

  async runReport(id: string) {
    const report = await this.prisma.reportDefinition.findUnique({ where: { id } });
    if (!report) throw new NotFoundException("Report not found");
    await this.prisma.reportDefinition.update({ where: { id }, data: { lastRunAt: new Date() } });
    await this.cache.del("insight:reports");
    return { report, result: await this.overview() };
  }

  // ── Report pages ───────────────────────────────────────────────────────
  async overview() {
    return this.cache.wrap("insight:overview", 60, async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [invoices, payments, expenses, leads, clients, projects] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true, client: { select: { companyName: true } } } }),
      this.prisma.payment.findMany(),
      this.prisma.expense.findMany({ where: { approvalStatus: { in: ["APPROVED", "PENDING"] } } }),
      this.prisma.lead.findMany(),
      this.prisma.client.findMany(),
      this.prisma.project.findMany(),
    ]);

    const total = (inv: any) => inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const paidOf = (inv: any) => inv.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);

    const monthInvoices = invoices.filter((i) => i.issueDate >= monthStart);
    const monthPayments = payments.filter((p) => p.paymentDate >= monthStart);
    const monthExpenses = expenses.filter((e) => e.date >= monthStart);

    const trend = new Map<string, { month: string; invoiced: number; collected: number; expenses: number }>();
    const all = [...invoices.map((i) => i.issueDate), ...payments.map((p) => p.paymentDate), ...expenses.map((e) => e.date)];
    for (const d of all) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!trend.has(key)) trend.set(key, { month: d.toLocaleString("en-US", { month: "short" }), invoiced: 0, collected: 0, expenses: 0 });
    }
    for (const i of invoices) {
      const t = trend.get(`${i.issueDate.getFullYear()}-${i.issueDate.getMonth()}`);
      if (t) t.invoiced += total(i);
    }
    for (const p of payments) {
      const t = trend.get(`${p.paymentDate.getFullYear()}-${p.paymentDate.getMonth()}`);
      if (t) t.collected += Number(p.amount);
    }
    for (const e of expenses) {
      const t = trend.get(`${e.date.getFullYear()}-${e.date.getMonth()}`);
      if (t) t.expenses += Number(e.amount);
    }
    const trendArr = Array.from(trend.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-8);

    return {
      summary: {
        revenueThisMonth: Math.round(monthInvoices.reduce((s, i) => s + total(i), 0) * 100) / 100,
        collectedThisMonth: Math.round(monthPayments.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
        expensesThisMonth: Math.round(monthExpenses.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100,
        activeClients: clients.length,
        activeProjects: projects.filter((p) => ["ACTIVE", "PLANNING"].includes(p.status)).length,
        totalLeads: leads.length,
        conversionRate: leads.length ? Math.round((leads.filter((l) => l.stage === "WON").length / leads.length) * 1000) / 10 : 0,
        outstanding: Math.round(invoices.filter((i) => i.status !== "PAID").reduce((s, i) => s + total(i) - paidOf(i), 0) * 100) / 100,
      },
      trend: trendArr,
      paymentMethods: this.groupBy(payments, (p) => p.paymentMethod),
      topClients: Array.from(
        invoices
          .filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status))
          .reduce((acc, i) => {
            const key = i.client?.companyName ?? "Unknown";
            acc.set(key, (acc.get(key) ?? 0) + total(i));
            return acc;
          }, new Map<string, number>())
          .entries()
      )
        .map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5),
    };
    });
  }

  async clientHealth() {
    return this.cache.wrap("insight:client-health", 60, async () => {
    const clients = await this.prisma.client.findMany({
      include: {
        _count: { select: { projects: true } },
        invoices: { select: { status: true, lineItems: { select: { amount: true } } } },
        healthLogs: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });
    return clients.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      healthScore: c.healthScore,
      healthLevel: c.healthLevel,
      renewalDate: c.renewalDate,
      activeProjects: c._count.projects,
      totalRevenue: c.invoices.filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status)).reduce((s, i) => s + i.lineItems.reduce((x, l) => x + Number(l.amount), 0), 0),
      lastNote: c.healthLogs[0]?.driverSummary ?? null,
    }));
    });
  }

  async taxReport() {
    return this.cache.wrap("insight:tax", 60, async () => {
    const [invoices, expenses] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true } }),
      this.prisma.expense.findMany({ where: { approvalStatus: "APPROVED" } }),
    ]);
    const total = (inv: any) => inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const quarters = new Map<string, { label: string; invoiced: number; collected: number; expenses: number }>();
    const add = (d: Date, key: "invoiced" | "collected" | "expenses", amount: number) => {
      const q = `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
      const entry = quarters.get(q) ?? { label: q, invoiced: 0, collected: 0, expenses: 0 };
      entry[key] += amount;
      quarters.set(q, entry);
    };
    for (const i of invoices) {
      add(i.issueDate, "invoiced", total(i));
      for (const p of i.payments) add(p.paymentDate, "collected", Number(p.amount));
    }
    for (const e of expenses) add(e.date, "expenses", Number(e.amount));
    const rows = Array.from(quarters.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((q) => {
        const net = q.collected - q.expenses;
        return { ...q, invoiced: Math.round(q.invoiced * 100) / 100, collected: Math.round(q.collected * 100) / 100, expenses: Math.round(q.expenses * 100) / 100, net: Math.round(net * 100) / 100, estimatedTax: Math.round(net * TAX_RATE * 100) / 100 };
      });
    const totals = rows.reduce((acc, r) => ({ invoiced: acc.invoiced + r.invoiced, collected: acc.collected + r.collected, expenses: acc.expenses + r.expenses, net: acc.net + r.net, estimatedTax: acc.estimatedTax + r.estimatedTax }), { invoiced: 0, collected: 0, expenses: 0, net: 0, estimatedTax: 0 });
    return { rows, totals, taxRate: TAX_RATE, fiscalYear: new Date().getFullYear() };
    });
  }

  async performance() {
    return this.cache.wrap("insight:performance", 60, async () => {
    const [invoices, leads, employees] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, client: { select: { companyName: true, industryVertical: true } } } }),
      this.prisma.lead.findMany({ include: { assignedTo: { select: { name: true } } } }),
      this.prisma.employee.findMany({ select: { id: true, name: true, roleTitle: true } }),
    ]);
    const total = (inv: any) => inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const byClient = new Map<string, number>();
    for (const i of invoices.filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status))) {
      byClient.set(i.client?.companyName ?? "Unknown", (byClient.get(i.client?.companyName ?? "Unknown") ?? 0) + total(i));
    }
    const topClients = Array.from(byClient.entries()).map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const wonByRep = new Map<string, { count: number; value: number }>();
    for (const l of leads.filter((l) => l.stage === "WON")) {
      const rep = l.assignedTo?.name ?? "Unassigned";
      const e = wonByRep.get(rep) ?? { count: 0, value: 0 };
      e.count++;
      e.value += Number(l.estimatedDealSize ?? 0);
      wonByRep.set(rep, e);
    }
    return {
      topClients,
      revenueByIndustry: Array.from(
        invoices.filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status)).reduce((acc, i) => {
          const key = i.client?.industryVertical ?? "Other";
          acc.set(key, (acc.get(key) ?? 0) + total(i));
          return acc;
        }, new Map<string, number>()).entries()
      ).map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 })),
      salesReps: Array.from(wonByRep.entries()).map(([name, v]) => ({ name, ...v })),
      teamSize: employees.length,
      avgDealValue: wonByRep.size ? Math.round((Array.from(wonByRep.values()).reduce((s, v) => s + v.value, 0) / Array.from(wonByRep.values()).reduce((s, v) => s + v.count, 0)) * 100) / 100 : 0,
    };
    });
  }

  private groupBy(items: { [k: string]: any }[], keyFn: (i: any) => string) {
    const map = new Map<string, number>();
    for (const item of items) map.set(keyFn(item), (map.get(keyFn(item)) ?? 0) + Number(item.amount ?? 0));
    return Array.from(map.entries()).map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }));
  }
}