import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { RECEIPT_PAYMENT_FILTER, invoiceTotals } from "../capital/finance-kernel";

const ACTIVE_INVOICE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];
/** Bangladesh company tax for a non-listed company; override in Settings.financeConfig.corporateTaxRate. */
const DEFAULT_CORPORATE_TAX_RATE = 0.275;

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
      this.prisma.payment.findMany({ where: { ...RECEIPT_PAYMENT_FILTER } }),
      this.prisma.expense.findMany({ where: { approvalStatus: { in: ["APPROVED", "PENDING"] } } }),
      this.prisma.lead.findMany(),
      this.prisma.client.findMany(),
      this.prisma.project.findMany(),
    ]);

    const total = (inv: any) => invoiceTotals(inv).grand;
    const paidOf = (inv: any) => invoiceTotals(inv).paid;

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
        outstanding: Math.round(invoices.filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status)).reduce((s, i) => s + Math.max(total(i) - paidOf(i), 0), 0) * 100) / 100,
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
        invoices: {
          select: {
            status: true, taxApplicable: true, taxRate: true, discountRate: true, shippingFee: true,
            lineItems: { select: { amount: true } },
            payments: { select: { amount: true, type: true } },
          },
        },
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
      totalRevenue: c.invoices.filter((i) => ACTIVE_INVOICE_STATUSES.includes(i.status)).reduce((s, i) => s + invoiceTotals(i).grand, 0),
      lastNote: c.healthLogs[0]?.driverSummary ?? null,
    }));
    });
  }

  async taxReport() {
    return this.cache.wrap("insight:tax", 60, async () => {
    // Taxable profit is accrual-based accounting profit, not "cash collected
    // minus expenses". The old formula used collections, so an invoiced-but-
    // unpaid quarter showed almost no tax while a collection-heavy quarter
    // showed too much. Read the rate from Settings.financeConfig so the company
    // can set its own slab instead of a hard-coded 22%.
    const [settings, invoices, glLines] = await Promise.all([
      this.prisma.settings.findFirst({ select: { financeConfig: true } }).catch(() => null),
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true } }),
      this.prisma.journalEntryLine.findMany({
        select: { debit: true, credit: true, account: { select: { category: true } }, entry: { select: { entryDate: true } } },
      }),
    ]);
    const configured = Number((settings?.financeConfig as any)?.corporateTaxRate);
    const taxRate = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CORPORATE_TAX_RATE;
    const total = (inv: any) => inv.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const quarters = new Map<string, { label: string; invoiced: number; collected: number; expenses: number; revenue: number }>();
    const qKey = (d: Date) => `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const add = (q: string, key: "invoiced" | "collected" | "expenses" | "revenue", amount: number) => {
      const entry = quarters.get(q) ?? { label: q, invoiced: 0, collected: 0, expenses: 0, revenue: 0 };
      entry[key] += amount;
      quarters.set(q, entry);
    };
    for (const i of invoices) {
      add(qKey(i.issueDate), "invoiced", total(i));
      for (const p of i.payments) add(qKey(p.paymentDate), "collected", p.type === "REFUND" ? -Number(p.amount) : Number(p.amount));
    }
    for (const line of glLines) {
      const q = qKey(line.entry.entryDate);
      const amount = Number(line.debit) - Number(line.credit);
      if (line.account.category === "REVENUE") add(q, "revenue", -amount);
      else if (line.account.category === "DIRECT_COST" || line.account.category === "OPEX") add(q, "expenses", amount);
    }
    const rows = Array.from(quarters.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((q) => {
        const net = q.revenue - q.expenses;
        const taxable = Math.max(net, 0);
        return {
          ...q,
          invoiced: Math.round(q.invoiced * 100) / 100,
          collected: Math.round(q.collected * 100) / 100,
          expenses: Math.round(q.expenses * 100) / 100,
          revenue: Math.round(q.revenue * 100) / 100,
          net: Math.round(net * 100) / 100,
          taxableIncome: Math.round(taxable * 100) / 100,
          estimatedTax: Math.round(taxable * taxRate * 100) / 100,
        };
      });
    const totals = rows.reduce(
      (acc, r) => ({
        invoiced: acc.invoiced + r.invoiced,
        collected: acc.collected + r.collected,
        expenses: acc.expenses + r.expenses,
        revenue: acc.revenue + r.revenue,
        net: acc.net + r.net,
        taxableIncome: acc.taxableIncome + r.taxableIncome,
        estimatedTax: acc.estimatedTax + r.estimatedTax,
      }),
      { invoiced: 0, collected: 0, expenses: 0, revenue: 0, net: 0, taxableIncome: 0, estimatedTax: 0 }
    );
    return { rows, totals, taxRate, basis: "accrual", fiscalYear: new Date().getFullYear() };
    });
  }

  async performance() {
    return this.cache.wrap("insight:performance", 60, async () => {
    const [invoices, leads, employees] = await Promise.all([
      this.prisma.invoice.findMany({
        include: {
          lineItems: true,
          client: { select: { companyName: true, industryVertical: true } },
        },
      }),
      this.prisma.lead.findMany({ include: { assignedTo: { select: { name: true } } } }),
      this.prisma.employee.findMany({ select: { id: true, name: true, roleTitle: true } }),
    ]);
    const total = (inv: any) => invoiceTotals(inv).grand;
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