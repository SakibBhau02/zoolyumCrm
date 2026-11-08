import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceStatus, RevenueTag } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ACTIVE_STATUSES, buildTrend, invoiceTotals } from "./finance-kernel";

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService
  ) {}


  async overview() {
    return this.cache.wrap("capital:overview", 30, () => this.computeOverview());
  }


  private async computeOverview() {
    const [invoices, expenses, bankAccounts, payments, snapshots, unreconciledCount] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true } }),
      this.prisma.expense.findMany({
        where: { approvalStatus: "APPROVED" },
        select: { amount: true, date: true, category: true, isClientBillable: true, description: true },
      }),
      this.prisma.bankAccount.findMany({ select: { accountName: true, accountType: true, currentBalance: true } }),
      this.prisma.payment.findMany({ select: { amount: true, paymentMethod: true } }),
      this.prisma.metricSnapshot.findMany({ orderBy: { recordedAt: "asc" } }),
      // Bank entries nobody has matched yet — the cash figure cannot be trusted
      // until these are cleared, so the overview surfaces them.
      this.prisma.reconciliationRecord.count({ where: { matchStatus: "UNMATCHED" } }),
    ]);

    const invoiceable = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status));
    const sumLines = (i: any, tag?: RevenueTag) =>
      i.lineItems.filter((l: any) => (tag ? l.revenueTag === tag : true)).reduce((s: number, l: any) => s + Number(l.amount), 0);
    // Net of refunds; identical rule to the Accounts module and the web UI.
    const paidOf = (i: any) => invoiceTotals(i).paid;

    const totalInvoiced = invoiceable.reduce((s, i) => s + invoiceTotals(i).grand, 0);
    const recognizedRevenue = invoiceable.reduce((s, i) => s + sumLines(i, "AGENCY_REVENUE") + sumLines(i, "MANAGEMENT_FEE"), 0);
    const collected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const outstanding = invoiceable.reduce((s, i) => s + invoiceTotals(i).balance, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Date-based: status badges are synced, but this must hold even if a row
    // was never swept (e.g. between cron runs).
    const overdueAmount = invoiceable.reduce((s, i) => {
      const bal = invoiceTotals(i).balance;
      return bal > 0 && i.dueDate && i.dueDate < today ? s + bal : s;
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const expensesMonth = expenses.filter((e) => e.date >= monthStart).reduce((s, e) => s + Number(e.amount), 0);
    const billableShare = expensesMonth
      ? Math.round((expenses.filter((e) => e.isClientBillable && e.date >= monthStart).reduce((s, e) => s + Number(e.amount), 0) / expensesMonth) * 100)
      : 0;
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);

    const paymentSplit = new Map<string, number>();
    for (const p of payments) paymentSplit.set(p.paymentMethod, (paymentSplit.get(p.paymentMethod) ?? 0) + Number(p.amount));

    const trend = buildTrend(snapshots);
    const profitTrend = trend.map((t) => ({ month: t.month, revenue: t.invoiced, expenses: t.expenses, profit: t.invoiced - t.expenses }));

    return {
      totalInvoiced,
      recognizedRevenue,
      collected,
      outstanding,
      overdueAmount,
      expensesMonth,
      billableShare,
      cashPosition,
      unreconciledCount,
      paymentSplit: Array.from(paymentSplit.entries()).map(([method, amount]) => ({ method, amount })),
      trend,
      profitTrend,
    };
  }


  async aging() {
    return this.cache.wrap("capital:aging", 60, () => this.computeAging());
  }


  private async computeAging() {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as InvoiceStatus[] } },
      include: { lineItems: true, payments: true, client: { select: { id: true, companyName: true } } },
    });
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buckets: Record<string, number> = { CURRENT: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const byClient = new Map<string, { clientId: string; clientName: string; total: number; current: number; d30: number; d60: number; d90: number; d90p: number }>();
    let totalOutstanding = 0;
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      const bal = Math.max(t.grand - t.paid, 0);
      if (bal <= 0) continue;
      totalOutstanding += bal;
      const due = inv.dueDate ?? inv.issueDate;
      const days = Math.floor((now.getTime() - due.getTime()) / 86400000);
      const key = days <= 0 ? "CURRENT" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      buckets[key] += bal;
      const c = byClient.get(inv.clientId) ?? { clientId: inv.clientId, clientName: inv.client.companyName, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
      c.total += bal;
      c[key === "CURRENT" ? "current" : key === "1-30" ? "d30" : key === "31-60" ? "d60" : key === "61-90" ? "d90" : "d90p"] += bal;
      byClient.set(inv.clientId, c);
    }
    for (const b of Object.keys(buckets)) buckets[b] = Math.round(buckets[b] * 100) / 100;
    for (const c of byClient.values()) {
      c.total = Math.round(c.total * 100) / 100;
      c.current = Math.round(c.current * 100) / 100;
      c.d30 = Math.round(c.d30 * 100) / 100;
      c.d60 = Math.round(c.d60 * 100) / 100;
      c.d90 = Math.round(c.d90 * 100) / 100;
      c.d90p = Math.round(c.d90p * 100) / 100;
    }
    return { totalOutstanding: Math.round(totalOutstanding * 100) / 100, buckets, byClient: Array.from(byClient.values()).sort((a, b) => b.total - a.total) };
  }

  // ── Cash flow forecast (30/60/90 day) ────────────────────────────────


  async forecast() {
    return this.cache.wrap("capital:forecast", 60, () => this.computeForecast());
  }


  private async computeForecast() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 90);
    const [invoices, expenses, bankAccounts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as InvoiceStatus[] }, dueDate: { lte: horizon } },
        include: { lineItems: true, payments: true },
      }),
      this.prisma.expense.findMany({ where: { approvalStatus: "APPROVED", date: { gte: now, lte: horizon } } }),
      this.prisma.bankAccount.findMany({ select: { currentBalance: true } }),
    ]);
    const buckets = [0, 1, 2].map((i) => ({ label: `0-${(i + 1) * 30}d`, inflow: 0, outflow: 0, net: 0 }));
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      const bal = Math.max(t.grand - t.paid, 0);
      if (bal <= 0) continue;
      const due = inv.dueDate ?? inv.issueDate;
      const days = Math.floor((due.getTime() - now.getTime()) / 86400000);
      const idx = Math.min(2, Math.floor(Math.max(days, 0) / 30));
      buckets[idx].inflow += bal;
    }
    for (const e of expenses) {
      const days = Math.floor((e.date.getTime() - now.getTime()) / 86400000);
      const idx = Math.min(2, Math.floor(Math.max(days, 0) / 30));
      buckets[idx].outflow += Number(e.amount);
    }
    for (const b of buckets) {
      b.inflow = Math.round(b.inflow * 100) / 100;
      b.outflow = Math.round(b.outflow * 100) / 100;
      b.net = Math.round((b.inflow - b.outflow) * 100) / 100;
    }
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);
    return { asOf: now, cashPosition, buckets, totalInflow: buckets.reduce((s, b) => s + b.inflow, 0), totalOutflow: buckets.reduce((s, b) => s + b.outflow, 0) };
  }

  // ── Project finance summary ──────────────────────────────────────────


  async projectFinance(projectId: string) {
    return this.cache.wrap(`capital:project-finance:${projectId}`, 30, () => this.computeProjectFinance(projectId));
  }


  private async computeProjectFinance(projectId: string) {
    const [project, invoices, expenses] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, billingType: true, recurringInterval: true, nextBillingDate: true, monthlyRate: true, totalBilled: true, paymentStatus: true, budgetAmount: true },
      }),
      this.prisma.invoice.findMany({
        where: { projectId },
        include: { lineItems: true, payments: true, client: { select: { id: true, companyName: true } } },
        orderBy: { issueDate: "desc" },
      }),
      this.prisma.expense.findMany({
        where: { projectId },
        include: { vendor: { select: { name: true } }, submittedBy: { select: { name: true } } },
        orderBy: { date: "desc" },
      }),
    ]);
    if (!project) throw new NotFoundException("Project not found");
    const active = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status));
    const amountOf = (i: any) => invoiceTotals(i).grand;
    const paidOf = (i: any) => invoiceTotals(i).paid;
    const totalInvoiced = active.reduce((s, i) => s + amountOf(i), 0);
    const collected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const outstanding = active.reduce((s, i) => s + invoiceTotals(i).balance, 0);
    const approvedExpenses = expenses.filter((e) => e.approvalStatus === "APPROVED");
    const expensesTotal = approvedExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const byCategory = new Map<string, number>();
    for (const e of approvedExpenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
    return {
      project: { id: project.id, name: project.name, billingType: project.billingType, recurringInterval: project.recurringInterval, nextBillingDate: project.nextBillingDate, monthlyRate: project.monthlyRate, totalBilled: project.totalBilled, paymentStatus: project.paymentStatus, budgetAmount: project.budgetAmount },
      totalInvoiced,
      collected,
      outstanding,
      expensesTotal,
      profit: totalInvoiced - expensesTotal,
      margin: totalInvoiced ? Math.round(((totalInvoiced - expensesTotal) / totalInvoiced) * 100) : 0,
      byCategory: Array.from(byCategory.entries()).map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })),
      invoices: invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, invoiceType: (i as any).invoiceType ?? null, title: (i as any).lineItems?.[0]?.description ?? null, issueDate: i.issueDate, dueDate: i.dueDate, amount: amountOf(i), paid: paidOf(i), balance: Math.max(amountOf(i) - paidOf(i), 0), client: i.client.companyName })),
      payments: invoices
        .flatMap((i) =>
          i.payments.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            paymentDate: p.paymentDate,
            paymentMethod: p.paymentMethod,
            referenceId: p.referenceId,
            notes: p.notes,
            invoiceNumber: i.invoiceNumber,
            invoiceStatus: i.status,
          }))
        )
        .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()),
      expenses: expenses.map((e) => ({ id: e.id, description: e.description, amount: Number(e.amount), category: e.category, date: e.date, approvalStatus: e.approvalStatus, vendor: e.vendor?.name ?? null, submittedBy: e.submittedBy?.name ?? null, isClientBillable: e.isClientBillable })),
    };
  }

  // ── Recurring billing ────────────────────────────────────────────────


  async trialBalance() {
    return this.cache.wrap("capital:statements:tb", 30, () => this.computeTrialBalance());
  }


  private async computeTrialBalance() {
    const lines = await this.prisma.journalEntryLine.findMany({ include: { account: true } });
    const rows = new Map<string, { accountId: string; code: string; name: string; category: string; debit: number; credit: number }>();
    for (const l of lines) {
      const r = rows.get(l.accountId) ?? { accountId: l.accountId, code: l.account.code ?? "", name: l.account.name, category: l.account.category, debit: 0, credit: 0 };
      r.debit += Number(l.debit);
      r.credit += Number(l.credit);
      rows.set(l.accountId, r);
    }
    const list = Array.from(rows.values())
      .map((r) => ({ ...r, debit: Math.round(r.debit * 100) / 100, credit: Math.round(r.credit * 100) / 100, balance: Math.round((r.debit - r.credit) * 100) / 100 }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return { rows: list, totalDebit: list.reduce((s, r) => s + r.debit, 0), totalCredit: list.reduce((s, r) => s + r.credit, 0) };
  }


  async profitLoss() {
    return this.cache.wrap("capital:statements:pl", 30, () => this.computeProfitLoss());
  }


  private async computeProfitLoss() {
    const lines = await this.prisma.journalEntryLine.findMany({ include: { account: true } });
    const revenue = new Map<string, { name: string; code: string; amount: number }>();
    const expense = new Map<string, { name: string; code: string; amount: number }>();
    let totalRevenue = 0, totalExpense = 0, totalDirectCost = 0;
    for (const l of lines) {
      const amount = Number(l.credit) - Number(l.debit);
      if (l.account.category === "REVENUE") {
        const r = revenue.get(l.accountId) ?? { name: l.account.name, code: l.account.code ?? "", amount: 0 };
        r.amount += amount;
        revenue.set(l.accountId, r);
      } else if (l.account.category === "DIRECT_COST" || l.account.category === "OPEX") {
        const e = expense.get(l.accountId) ?? { name: l.account.name, code: l.account.code ?? "", amount: 0 };
        e.amount += -amount;
        expense.set(l.accountId, e);
        // Track direct cost separately for gross profit. The old lookup used
        // the accountId-keyed map with the category name, so it never matched
        // and gross profit always equalled total revenue.
        if (l.account.category === "DIRECT_COST") totalDirectCost += -amount;
      }
    }
    for (const r of revenue.values()) { r.amount = Math.round(r.amount * 100) / 100; totalRevenue += r.amount; }
    for (const e of expense.values()) { e.amount = Math.round(e.amount * 100) / 100; totalExpense += e.amount; }
    const grossProfit = totalRevenue - totalDirectCost;
    return {
      revenue: Array.from(revenue.values()).sort((a, b) => a.code.localeCompare(b.code)),
      expenses: Array.from(expense.values()).sort((a, b) => a.code.localeCompare(b.code)),
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpense * 100) / 100,
      totalDirectCost: Math.round(totalDirectCost * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      netIncome: Math.round((totalRevenue - totalExpense) * 100) / 100,
      margin: totalRevenue ? Math.round(((totalRevenue - totalExpense) / totalRevenue) * 100) : 0,
    };
  }


  async balanceSheet() {
    return this.cache.wrap("capital:statements:bs", 30, () => this.computeBalanceSheet());
  }


  private async computeBalanceSheet() {
    const lines = await this.prisma.journalEntryLine.findMany({ include: { account: true } });
    const assets = new Map<string, { name: string; code: string; amount: number }>();
    const liabilities = new Map<string, { name: string; code: string; amount: number }>();
    let totalAssets = 0, totalLiabilities = 0;
    for (const l of lines) {
      const bal = Number(l.debit) - Number(l.credit);
      if (l.account.category === "ASSET") {
        const a = assets.get(l.accountId) ?? { name: l.account.name, code: l.account.code ?? "", amount: 0 };
        a.amount += bal;
        assets.set(l.accountId, a);
      } else if (l.account.category === "LIABILITY") {
        const li = liabilities.get(l.accountId) ?? { name: l.account.name, code: l.account.code ?? "", amount: 0 };
        li.amount += -bal;
        liabilities.set(l.accountId, li);
      }
    }
    for (const a of assets.values()) { a.amount = Math.round(a.amount * 100) / 100; totalAssets += a.amount; }
    for (const li of liabilities.values()) { li.amount = Math.round(li.amount * 100) / 100; totalLiabilities += li.amount; }
    const equity = Math.round((totalAssets - totalLiabilities) * 100) / 100;
    return {
      assets: Array.from(assets.values()).sort((a, b) => a.code.localeCompare(b.code)),
      liabilities: Array.from(liabilities.values()).sort((a, b) => a.code.localeCompare(b.code)),
      totalAssets: Math.round(totalAssets * 100) / 100,
      totalLiabilities: Math.round(totalLiabilities * 100) / 100,
      equity,
      balanced: Math.abs(equity - (totalAssets - totalLiabilities)) < 0.01,
    };
  }


  async cashFlow() {
    return this.cache.wrap("capital:statements:cf", 30, () => this.computeCashFlow());
  }


  private async computeCashFlow() {
    const [entries, bankAccounts] = await Promise.all([
      this.prisma.journalEntry.findMany({ where: { lines: { some: { account: { code: "1200" } } } }, include: { lines: { include: { account: true } } }, orderBy: { entryDate: "asc" } }),
      this.prisma.bankAccount.findMany({ select: { currentBalance: true } }),
    ]);
    const operating = new Map<string, number>();
    const sections = ["INVOICE", "PAYMENT", "EXPENSE", "EXPENSE_PAYMENT", "MANUAL_INCOME", "CREDIT_NOTE", "REFUND", "WRITE_OFF", "MANUAL"];
    let netOperating = 0;
    const detail: { entryType: string; reference: string | null; date: Date; inflow: number; outflow: number; label: string; in: number; out: number; net: number }[] = [];
    for (const e of entries) {
      const cash = e.lines.find((l) => l.account.code === "1200");
      if (!cash) continue;
      const inflow = Number(cash.debit);
      const outflow = Number(cash.credit);
      netOperating += inflow - outflow;
      operating.set(e.entryType, (operating.get(e.entryType) ?? 0) + inflow - outflow);
      detail.push({
        entryType: e.entryType,
        reference: e.reference,
        date: e.entryDate,
        inflow: Math.round(inflow * 100) / 100,
        outflow: Math.round(outflow * 100) / 100,
        label: e.reference || e.entryType.replace(/_/g, " ").toLowerCase(),
        in: Math.round(inflow * 100) / 100,
        out: Math.round(outflow * 100) / 100,
        net: Math.round((inflow - outflow) * 100) / 100,
      });
    }
    const openingBalance = 0; // ledger starts this cycle
    const closingBalance = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);
    return {
      operating: Array.from(operating.entries()).map(([type, net]) => ({ type, net: Math.round(net * 100) / 100 })),
      netOperating: Math.round(netOperating * 100) / 100,
      openingBalance,
      closingBalance,
      netChange: Math.round((closingBalance - openingBalance) * 100) / 100,
      detail: detail.slice(0, 200),
    };
  }
  // ── Reports data ─────────────────────────────────────────────────────


  async reportsData() {
    return this.cache.wrap("capital:reports", 60, () => this.computeReportsData());
  }


  private async computeReportsData() {
    const [invoices, expenses, payments, projects] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true } }),
      this.prisma.expense.findMany({ where: { approvalStatus: "APPROVED" } }),
      this.prisma.payment.findMany(),
      this.prisma.project.findMany({ select: { id: true, name: true } }),
    ]);

    const sumLines = (i: any) => i.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const paidOf = (i: any) => invoiceTotals(i).paid;

    // Revenue by category (invoiceType)
    const byCategory = new Map<string, number>();
    for (const i of invoices) {
      if (!ACTIVE_STATUSES.includes(i.status)) continue;
      byCategory.set(i.invoiceType, (byCategory.get(i.invoiceType) ?? 0) + sumLines(i));
    }

    // Payment methods distribution
    const byMethod = new Map<string, number>();
    for (const p of payments) byMethod.set(p.paymentMethod, (byMethod.get(p.paymentMethod) ?? 0) + Number(p.amount));

    // 8-month trend
    const months: { month: string; revenue: number; expenses: number; profit: number; collected: number }[] = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({
        month: d.toLocaleString("en-US", { month: "short" }),
        revenue: 0, expenses: 0, profit: 0, collected: 0,
      });
      const idx = months.length - 1;
      for (const inv of invoices) {
        if (inv.issueDate.toISOString().slice(0, 7) !== key) continue;
        if (ACTIVE_STATUSES.includes(inv.status)) months[idx].revenue += sumLines(inv);
        months[idx].collected += paidOf(inv);
      }
      for (const e of expenses) {
        if (e.date.toISOString().slice(0, 7) === key) months[idx].expenses += Number(e.amount);
      }
      months[idx].profit = Math.round((months[idx].revenue - months[idx].expenses) * 100) / 100;
      months[idx].revenue = Math.round(months[idx].revenue * 100) / 100;
      months[idx].expenses = Math.round(months[idx].expenses * 100) / 100;
      months[idx].collected = Math.round(months[idx].collected * 100) / 100;
    }

    // Weekly cash flow (current month)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const cashFlow = [0, 1, 2, 3].map((w) => ({ week: `W${w + 1}`, inflow: 0, outflow: 0, net: 0 }));
    for (const inv of invoices) {
      if (inv.payments.length === 0) continue;
      if (inv.issueDate >= monthStart && inv.issueDate < nextMonth) {
        const w = Math.min(3, Math.floor((inv.issueDate.getDate() - 1) / 7));
        cashFlow[w].inflow += paidOf(inv);
      }
    }
    for (const e of expenses) {
      if (e.date >= monthStart && e.date < nextMonth) {
        const w = Math.min(3, Math.floor((e.date.getDate() - 1) / 7));
        cashFlow[w].outflow += Number(e.amount);
      }
    }
    for (const w of cashFlow) {
      w.inflow = Math.round(w.inflow * 100) / 100;
      w.outflow = Math.round(w.outflow * 100) / 100;
      w.net = Math.round((w.inflow - w.outflow) * 100) / 100;
    }

    // Budget overview (top expense categories, with real budgets)
    const byExpCat = new Map<string, number>();
    for (const e of expenses) byExpCat.set(e.category, (byExpCat.get(e.category) ?? 0) + Number(e.amount));
    const budgets = await this.prisma.budget.findMany();
    const budgetPlanned = new Map<string, number>();
    for (const b of budgets) {
      if (b.scopeType !== "PROJECT" && b.category) budgetPlanned.set(b.category, (budgetPlanned.get(b.category) ?? 0) + Number(b.budgetAmount));
    }
    const budgetOverview = Array.from(byExpCat.entries())
      .map(([category, spent]) => ({ category, spent: Math.round(spent * 100) / 100 }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 6)
      .map((x) => ({ name: x.category, planned: Math.round(budgetPlanned.get(x.category) ?? 0), actual: x.spent }));

    // Key metrics
    const totalInvoiced = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status)).reduce((s, i) => s + invoiceTotals(i).grand, 0);
    const totalCollected = payments.reduce((s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
    const avgInvoiceValue = totalInvoiced ? totalInvoiced / Math.max(invoices.filter((i) => ACTIVE_STATUSES.includes(i.status)).length, 1) : 0;
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const profitMargin = totalInvoiced ? ((totalInvoiced - totalExpenses) / totalInvoiced) * 100 : 0;
    const collectionRate = totalInvoiced ? (totalCollected / totalInvoiced) * 100 : 0;

    // Tax report (quarterly)
    const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q, qi) => {
      const start = new Date(now.getFullYear(), qi * 3, 1);
      const end = new Date(now.getFullYear(), qi * 3 + 3, 1);
      let revenue = 0, exp = 0;
      for (const inv of invoices) if (inv.issueDate >= start && inv.issueDate < end && ACTIVE_STATUSES.includes(inv.status)) revenue += sumLines(inv);
      for (const e of expenses) if (e.date >= start && e.date < end) exp += Number(e.amount);
      const taxable = Math.max(revenue - exp, 0);
      return { quarter: q, revenue: Math.round(revenue), expenses: Math.round(exp), taxableIncome: Math.round(taxable), estimatedTax: Math.round(taxable * 0.22) };
    });

    return {
      byCategory: Array.from(byCategory.entries()).map(([category, amount]) => ({ name: category, amount: Math.round(amount) })),
      byMethod: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount: Math.round(amount) })),
      trend8: months,
      cashFlow: cashFlow.map((w) => ({ ...w, income: w.inflow })),
      budgetOverview: budgetOverview.length ? budgetOverview : Array.from(byExpCat.entries()).map(([name, actual]) => ({ name, planned: 0, actual: Math.round(actual * 100) / 100 })),
      keyMetrics: {
        avgInvoiceValue: Math.round(avgInvoiceValue),
        profitMargin: Math.round(profitMargin * 100) / 100,
        totalInvoiced: Math.round(totalInvoiced),
        totalCollected: Math.round(totalCollected),
        totalExpenses: Math.round(totalExpenses),
        collectionRate: Math.round(collectionRate * 100) / 100,
      },
      taxReport: {
        fiscalYear: `${now.getFullYear()}-${now.getFullYear() + 1}`,
        taxRate: 22,
        rows: quarters.map((q) => ({
          label: q.quarter,
          invoiced: q.revenue,
          collected: 0,
          expenses: q.expenses,
          net: q.taxableIncome,
          estimatedTax: q.estimatedTax,
        })),
        totals: {
          invoiced: quarters.reduce((s, q) => s + q.revenue, 0),
          collected: 0,
          expenses: quarters.reduce((s, q) => s + q.expenses, 0),
          net: quarters.reduce((s, q) => s + q.taxableIncome, 0),
          estimatedTax: quarters.reduce((s, q) => s + q.estimatedTax, 0),
        },
        year: now.getFullYear(),
        totalRevenue: quarters.reduce((s, q) => s + q.revenue, 0),
        totalExpenses: quarters.reduce((s, q) => s + q.expenses, 0),
        taxableIncome: quarters.reduce((s, q) => s + q.taxableIncome, 0),
        estimatedTax: quarters.reduce((s, q) => s + q.estimatedTax, 0),
        quarters,
        projectCount: projects.length,
      },
    };
  }


  // ── Period report (monthly / custom range) ───────────────────────────

  /**
   * Financial report for an arbitrary date window.
   *
   * The reports screen is a live snapshot; downloadable monthly and six-month
   * reports need the invoices / payments / expenses that actually belong to the
   * window. Returning the headline figures plus line-level breakdowns here
   * keeps the printed report identical no matter which range was picked.
   */
  async reportPeriod(fromStr?: string, toStr?: string) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const parse = (value: string | undefined, fallback: Date, endOfDay: boolean) => {
      if (!value) return fallback;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
      if (endOfDay) d.setHours(23, 59, 59, 999);
      else d.setHours(0, 0, 0, 0);
      return d;
    };
    const from = parse(fromStr, defaultFrom, false);
    const to = parse(toStr, defaultTo, true);
    if (from.getTime() > to.getTime()) throw new BadRequestException("`from` must be before `to`");

    const [invoices, payments, expenses] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { issueDate: { gte: from, lte: to } },
        include: { lineItems: true, payments: true, client: { select: { id: true, companyName: true } } },
        orderBy: { issueDate: "desc" },
      }),
      this.prisma.payment.findMany({
        where: { paymentDate: { gte: from, lte: to } },
        include: { invoice: { select: { invoiceNumber: true, invoiceType: true } } },
        orderBy: { paymentDate: "desc" },
      }),
      this.prisma.expense.findMany({
        where: { approvalStatus: "APPROVED", date: { gte: from, lte: to } },
        orderBy: { date: "desc" },
      }),
    ]);

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const active = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status));
    const sumLines = (i: any) =>
      (i.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);

    const invoiced = r2(active.reduce((s, i) => s + invoiceTotals(i).grand, 0));
    const collected = r2(
      payments.reduce((s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0)
    );
    const expensesTotal = r2(expenses.reduce((s, e) => s + Number(e.amount), 0));
    const profit = r2(invoiced - expensesTotal);
    const margin = invoiced ? Math.round((profit / invoiced) * 10000) / 100 : 0;
    const collectionRate = invoiced ? Math.round((collected / invoiced) * 10000) / 100 : 0;
    const outstanding = r2(active.reduce((s, i) => s + invoiceTotals(i).balance, 0));

    // ── monthly buckets across the window ──
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const buckets = new Map<
      string,
      { key: string; label: string; invoiced: number; collected: number; expenses: number; profit: number }
    >();
    for (
      let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      cursor.getTime() <= to.getTime();
      cursor.setMonth(cursor.getMonth() + 1)
    ) {
      buckets.set(monthKey(cursor), {
        key: monthKey(cursor),
        label: cursor.toLocaleString("en-US", { month: "short", year: "numeric" }),
        invoiced: 0,
        collected: 0,
        expenses: 0,
        profit: 0,
      });
    }
    for (const inv of active) {
      const b = buckets.get(monthKey(inv.issueDate));
      if (b) b.invoiced += invoiceTotals(inv).grand;
    }
    for (const p of payments) {
      const b = buckets.get(monthKey(p.paymentDate));
      if (b) b.collected += p.type === "REFUND" ? -Number(p.amount) : Number(p.amount);
    }
    for (const e of expenses) {
      const b = buckets.get(monthKey(e.date));
      if (b) b.expenses += Number(e.amount);
    }
    const monthly = Array.from(buckets.values()).map((b) => ({
      ...b,
      invoiced: r2(b.invoiced),
      collected: r2(b.collected),
      expenses: r2(b.expenses),
      profit: r2(b.invoiced - b.expenses),
    }));

    // ── breakdowns ──
    const byStatusMap = new Map<
      string,
      { status: string; count: number; invoiced: number; paid: number; balance: number }
    >();
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      const row =
        byStatusMap.get(inv.status) ?? { status: inv.status, count: 0, invoiced: 0, paid: 0, balance: 0 };
      row.count += 1;
      row.invoiced += ACTIVE_STATUSES.includes(inv.status) ? t.grand : 0;
      row.paid += t.paid;
      row.balance += ACTIVE_STATUSES.includes(inv.status) ? t.balance : 0;
      byStatusMap.set(inv.status, row);
    }
    const byStatus = Array.from(byStatusMap.values())
      .map((s) => ({ ...s, invoiced: r2(s.invoiced), paid: r2(s.paid), balance: r2(s.balance) }))
      .sort((a, b) => b.invoiced - a.invoiced);

    const byCategoryMap = new Map<string, number>();
    for (const inv of active)
      byCategoryMap.set(inv.invoiceType, (byCategoryMap.get(inv.invoiceType) ?? 0) + sumLines(inv));

    const byMethodMap = new Map<string, number>();
    for (const p of payments) {
      const net = p.type === "REFUND" ? -Number(p.amount) : Number(p.amount);
      byMethodMap.set(p.paymentMethod, (byMethodMap.get(p.paymentMethod) ?? 0) + net);
    }

    const byExpenseCategoryMap = new Map<string, number>();
    for (const e of expenses)
      byExpenseCategoryMap.set(e.category, (byExpenseCategoryMap.get(e.category) ?? 0) + Number(e.amount));

    const clientMap = new Map<
      string,
      { id: string; clientName: string; invoiced: number; paid: number; balance: number; invoices: number }
    >();
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      const row =
        clientMap.get(inv.clientId) ?? {
          id: inv.clientId,
          clientName: inv.client.companyName,
          invoiced: 0,
          paid: 0,
          balance: 0,
          invoices: 0,
        };
      row.invoices += 1;
      row.invoiced += ACTIVE_STATUSES.includes(inv.status) ? t.grand : 0;
      row.paid += t.paid;
      row.balance += ACTIVE_STATUSES.includes(inv.status) ? t.balance : 0;
      clientMap.set(inv.clientId, row);
    }
    const topClients = Array.from(clientMap.values())
      .map((c) => ({ ...c, invoiced: r2(c.invoiced), paid: r2(c.paid), balance: r2(c.balance) }))
      .sort((a, b) => b.invoiced - a.invoiced)
      .slice(0, 10);

    const fmtDay = (d: Date) =>
      d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

    return {
      from,
      to,
      label: `${fmtDay(from)} — ${fmtDay(to)}`,
      generatedAt: new Date(),
      totals: {
        invoiced,
        collected,
        expenses: expensesTotal,
        profit,
        margin,
        collectionRate,
        outstanding,
        invoiceCount: invoices.length,
        paidInvoiceCount: invoices.filter((i) => i.status === "PAID").length,
        paymentCount: payments.length,
        expenseCount: expenses.length,
      },
      monthly,
      byStatus,
      byCategory: Array.from(byCategoryMap.entries())
        .map(([name, amount]) => ({ name, amount: r2(amount) }))
        .sort((a, b) => b.amount - a.amount),
      byMethod: Array.from(byMethodMap.entries())
        .map(([method, amount]) => ({ method, amount: r2(amount) }))
        .sort((a, b) => b.amount - a.amount),
      expensesByCategory: Array.from(byExpenseCategoryMap.entries())
        .map(([name, amount]) => ({ name, amount: r2(amount) }))
        .sort((a, b) => b.amount - a.amount),
      topClients,
      invoices: invoices.map((inv) => {
        const t = invoiceTotals(inv);
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          clientName: inv.client.companyName,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          status: inv.status,
          invoiceType: inv.invoiceType,
          amount: t.grand,
          paid: t.paid,
          balance: t.balance,
        };
      }),
      expenses: expenses.map((e) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.category,
        amount: Number(e.amount),
        paymentMethod: e.paymentMethod,
        isClientBillable: e.isClientBillable,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        date: p.paymentDate,
        amount: p.type === "REFUND" ? -Number(p.amount) : Number(p.amount),
        method: p.paymentMethod,
        type: p.type,
        reference: p.referenceId,
        invoiceNumber: p.invoice?.invoiceNumber ?? null,
      })),
    };
  }

  async profitability() {
    return this.cache.wrap("capital:profitability", 30, () => this.computeProfitability());
  }


  private async computeProfitability() {
    const projects = await this.prisma.project.findMany({
      include: {
        invoices: { include: { lineItems: true, payments: true } },
        expenses: true,
        tasks: { include: { timeLogs: true } },
      },
    });
    const rows = projects.map((p) => {
      const revenue = p.invoices
        .filter((i) => ACTIVE_STATUSES.includes(i.status))
        .reduce((s, i) => s + i.lineItems.filter((l) => l.revenueTag !== "PASS_THROUGH").reduce((x, l) => x + Number(l.amount), 0), 0);
      const cost = p.expenses.filter((e) => e.approvalStatus === "APPROVED").reduce((s, e) => s + Number(e.amount), 0);
      const collected = p.invoices.reduce((s, i) => s + invoiceTotals(i).paid, 0);
      const hours = p.tasks.reduce((s, t) => s + t.timeLogs.reduce((x, l) => x + Number(l.hours), 0), 0);
      return {
        id: p.id,
        name: p.name,
        revenue: Math.round(revenue * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round((revenue - cost) * 100) / 100,
        margin: revenue ? Math.round(((revenue - cost) / revenue) * 100) : 0,
        hoursLogged: Math.round(hours * 10) / 10,
        budget: Number(p.budgetAmount ?? 0),
        collected: Math.round(collected * 100) / 100,
      };
    });
    const months = new Map<string, { month: string; revenue: number; expenses: number; profit: number; margin: number | null }>();
    for (const p of projects) {
      const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthlyRevenue = new Map<string, number>();
      const monthlyExpense = new Map<string, number>();
      for (const i of p.invoices) {
        if (!ACTIVE_STATUSES.includes(i.status)) continue;
        const rev = i.lineItems.filter((l) => l.revenueTag !== "PASS_THROUGH").reduce((x, l) => x + Number(l.amount), 0);
        if (rev > 0) monthlyRevenue.set(monthKey(i.issueDate), (monthlyRevenue.get(monthKey(i.issueDate)) ?? 0) + rev);
      }
      for (const e of p.expenses) {
        if (e.approvalStatus !== "APPROVED") continue;
        monthlyExpense.set(monthKey(e.date), (monthlyExpense.get(monthKey(e.date)) ?? 0) + Number(e.amount));
      }
      for (const [m, rev] of monthlyRevenue) {
        const entry = months.get(m) ?? { month: m, revenue: 0, expenses: 0, profit: 0, margin: null as number | null };
        entry.revenue += rev;
        months.set(m, entry);
      }
      for (const [m, exp] of monthlyExpense) {
        const entry = months.get(m) ?? { month: m, revenue: 0, expenses: 0, profit: 0, margin: null as number | null };
        entry.expenses += exp;
        months.set(m, entry);
      }
    }
    const monthly = Array.from(months.values())
      .map((m) => ({ ...m, profit: Math.round((m.revenue - m.expenses) * 100) / 100, margin: m.revenue ? Math.round(((m.revenue - m.expenses) / m.revenue) * 100) : 0 }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const best = rows.length ? rows.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
    return {
      projects: rows.sort((a, b) => b.profit - a.profit),
      monthly,
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalCost * 100) / 100,
        netProfit: Math.round((totalRevenue - totalCost) * 100) / 100,
        margin: totalRevenue ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100) : 0,
        bestProject: best ? `${best.name} (+BDT ${best.profit.toLocaleString("en-US")})` : null,
      },
    };
  }

  // ── Activity log ─────────────────────────────────────────────────────


  async activityLog() {
    return this.cache.wrap("capital:activity", 30, () =>
      this.prisma.financeAuditLog.findMany({
        include: { performedBy: { select: { name: true } } },
        orderBy: { timestamp: "desc" },
        take: 50,
      })
    );
  }


  async incomeStats() {
    return this.cache.wrap("capital:income-stats", 30, () => this.computeIncomeStats());
  }


  private async computeIncomeStats() {
    const [payments, manual, dollarSales] = await Promise.all([
      this.prisma.payment.findMany({ include: { invoice: { select: { id: true, invoiceType: true, invoiceNumber: true } } } }),
      this.prisma.manualIncome.findMany(),
      this.prisma.dollarSale.findMany({ select: { usdAmount: true, profit: true, marginPct: true, paymentMethod: true } }),
    ]);
    const totalPayments = payments.filter((p) => p.type === "IN").reduce((s, p) => s + Number(p.amount), 0);
    const recurring = payments
      .filter((p) => p.type === "IN" && p.invoice?.invoiceType === "RECURRING")
      .reduce((s, p) => s + Number(p.amount), 0);
    const oneTime = totalPayments - recurring;
    const manualTotal = manual.reduce((s, m) => s + Number(m.amount), 0);
    const fxProfit = dollarSales.reduce((s, d) => s + Number(d.profit), 0);
    const fxUsd = dollarSales.reduce((s, d) => s + Number(d.usdAmount), 0);
    const txCount = payments.filter((p) => p.type === "IN").length + manual.length + dollarSales.length;
    const byMethod = new Map<string, number>();
    for (const p of payments) if (p.type === "IN") byMethod.set(p.paymentMethod, (byMethod.get(p.paymentMethod) ?? 0) + Number(p.amount));
    for (const m of manual) byMethod.set(m.paymentMethod, (byMethod.get(m.paymentMethod) ?? 0) + Number(m.amount));
    for (const d of dollarSales) {
      if (Number(d.profit) === 0) continue;
      byMethod.set(d.paymentMethod, (byMethod.get(d.paymentMethod) ?? 0) + Number(d.profit));
    }
    const totalIncome = totalPayments + manualTotal + fxProfit;
    return {
      total: totalIncome,
      totalIncome,
      recurring,
      oneTime,
      manual: manualTotal,
      fxProfit: Math.round(fxProfit * 100) / 100,
      fxUsd: Math.round(fxUsd * 100) / 100,
      fxCount: dollarSales.length,
      paymentCount: txCount,
      count: txCount,
      avgAmount: txCount ? totalIncome / txCount : 0,
      byMethod: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount),
      bySource: [
        { source: "invoice", amount: Math.round(totalPayments) },
        { source: "manual", amount: Math.round(manualTotal) },
        { source: "dollar", amount: Math.round(fxProfit) },
      ].filter((s) => s.amount !== 0),
    };
  }

  // ── Credit notes / refunds / write-offs ──────────────────────────────
}
