import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceStatus, RevenueTag } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ACTIVE_STATUSES, INVOICE_CREDIT_INCLUDE, RECEIPT_PAYMENT_FILTER, invoiceTotals, startOfTodayUtc, toBdt } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

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
    const [invoices, expenses, bankAccounts, payments, , unreconciledCount] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE } }),
      this.prisma.expense.findMany({
        where: { approvalStatus: "APPROVED" },
        select: { amount: true, exchangeRate: true, date: true, category: true, isClientBillable: true, description: true },
      }),
      this.prisma.bankAccount.findMany({ select: { accountName: true, accountType: true, currentBalance: true } }),
      this.prisma.payment.findMany({
        where: { ...RECEIPT_PAYMENT_FILTER },
        select: { amount: true, exchangeRate: true, type: true, paymentMethod: true, paymentDate: true },
      }),
      this.prisma.metricSnapshot.findMany({ orderBy: { recordedAt: "asc" } }),
      // Bank entries nobody has matched yet — the cash figure cannot be trusted
      // until these are cleared, so the overview surfaces them.
      this.prisma.reconciliationRecord.count({ where: { matchStatus: "UNMATCHED" } }),
    ]);

    const invoiceable = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status));
    const sumLines = (i: any, tag?: RevenueTag) =>
      i.lineItems.filter((l: any) => (tag ? l.revenueTag === tag : true)).reduce((s: number, l: any) => s + toBdt(Number(l.amount), i), 0);
    // Net of refunds and credits; identical rule to the Accounts module and the web UI.
    const paidOf = (i: any) => invoiceTotals(i).paidBdt;

    const totalInvoiced = invoiceable.reduce((s, i) => s + invoiceTotals(i).grandBdt, 0);
    const passThroughBilled = invoiceable.reduce((s, i) => s + sumLines(i, "PASS_THROUGH"), 0);
    // "Our" revenue: agency fees + management fees, i.e. everything that is not
    // a pass-through reimbursement. `totalInvoiced` stays gross so the two
    // figures reconcile: gross − pass-through − tax + discount − shipping = this.
    const recognizedRevenue = invoiceable.reduce((s, i) => s + sumLines(i, "AGENCY_REVENUE") + sumLines(i, "MANAGEMENT_FEE"), 0);
    const collected = invoiceable.reduce((s, i) => s + paidOf(i), 0);
    const outstanding = invoiceable.reduce((s, i) => s + invoiceTotals(i).balanceBdt, 0);
    const today = startOfTodayUtc();
    // Date-based: status badges are synced, but this must hold even if a row
    // was never swept (e.g. between cron runs).
    const overdueAmount = invoiceable.reduce((s, i) => {
      const bal = invoiceTotals(i).balanceBdt;
      return bal > 0 && i.dueDate && new Date(i.dueDate).getTime() < today.getTime() ? s + bal : s;
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const expensesMonth = expenses.filter((e) => e.date >= monthStart).reduce((s, e) => s + toBdt(Number(e.amount), e), 0);
    const billableShare = expensesMonth
      ? Math.round((expenses.filter((e) => e.isClientBillable && e.date >= monthStart).reduce((s, e) => s + toBdt(Number(e.amount), e), 0) / expensesMonth) * 100)
      : 0;
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);

    const paymentSplit = new Map<string, number>();
    for (const p of payments) paymentSplit.set(p.paymentMethod, (paymentSplit.get(p.paymentMethod) ?? 0) + (p.type === "REFUND" ? -1 : 1) * toBdt(Number(p.amount), p));

    // Revenue trend from the real documents. This used to read MetricSnapshot,
    // a demo table, so the board showed months of revenue that had no invoices.
    const trendMonths: { month: string; invoiced: number; collected: number; expenses: number }[] = [];
    const trendKeys: string[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      trendKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      trendMonths.push({ month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), invoiced: 0, collected: 0, expenses: 0 });
    }
    const trendIndex = new Map(trendKeys.map((k, i) => [k, i]));
    const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    for (const inv of invoiceable) {
      const idx = trendIndex.get(monthOf(inv.issueDate));
      if (idx !== undefined) trendMonths[idx].invoiced += sumLines(inv);
    }
    for (const p of payments) {
      const idx = trendIndex.get(monthOf(p.paymentDate));
      if (idx !== undefined) trendMonths[idx].collected += (p.type === "REFUND" ? -1 : 1) * toBdt(Number(p.amount), p);
    }
    for (const e of expenses) {
      const idx = trendIndex.get(monthOf(e.date));
      if (idx !== undefined) trendMonths[idx].expenses += toBdt(Number(e.amount), e);
    }
    const trend = trendMonths.map((m) => ({
      ...m,
      invoiced: Math.round(m.invoiced * 100) / 100,
      collected: Math.round(m.collected * 100) / 100,
      expenses: Math.round(m.expenses * 100) / 100,
    }));
    const profitTrend = trend.map((t) => ({ month: t.month, revenue: t.invoiced, expenses: t.expenses, profit: t.invoiced - t.expenses }));

    return {
      totalInvoiced,
      passThroughBilled,
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
      include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE, client: { select: { id: true, companyName: true } } },
    });
    const now = startOfTodayUtc();
    const buckets: Record<string, number> = { CURRENT: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const byClient = new Map<string, { clientId: string; clientName: string; total: number; current: number; d30: number; d60: number; d90: number; d90p: number }>();
    let totalOutstanding = 0;
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      const bal = t.balanceBdt;
      if (bal <= 0) continue;
      totalOutstanding += bal;
      const due = inv.dueDate ?? inv.issueDate;
      const days = Math.floor((now.getTime() - new Date(due).getTime()) / 86400000);
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
    const now = startOfTodayUtc();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 90);
    const [invoices, expenses, bankAccounts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as InvoiceStatus[] }, dueDate: { lte: horizon } },
        include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE },
      }),
      this.prisma.expense.findMany({ where: { approvalStatus: "APPROVED", date: { gte: now, lte: horizon } } }),
      this.prisma.bankAccount.findMany({ select: { currentBalance: true } }),
    ]);
    const buckets = [0, 1, 2].map((i) => ({ label: `0-${(i + 1) * 30}d`, inflow: 0, outflow: 0, net: 0 }));
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      const bal = t.balanceBdt;
      if (bal <= 0) continue;
      const due = inv.dueDate ?? inv.issueDate;
      const days = Math.floor((new Date(due).getTime() - now.getTime()) / 86400000);
      const idx = Math.min(2, Math.floor(Math.max(days, 0) / 30));
      buckets[idx].inflow += bal;
    }
    for (const e of expenses) {
      const days = Math.floor((e.date.getTime() - now.getTime()) / 86400000);
      const idx = Math.min(2, Math.floor(Math.max(days, 0) / 30));
      buckets[idx].outflow += toBdt(Number(e.amount), e);
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
        select: { id: true, name: true, billingType: true, recurringInterval: true, nextBillingDate: true, monthlyRate: true, totalBilled: true, paymentStatus: true, budgetAmount: true, currency: true },
      }),
      this.prisma.invoice.findMany({
        where: { projectId },
        include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE, client: { select: { id: true, companyName: true } } },
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
    const amountOf = (i: any) => invoiceTotals(i).grandBdt;
    const paidOf = (i: any) => invoiceTotals(i).paidBdt;
    const totalInvoiced = active.reduce((s, i) => s + amountOf(i), 0);
    const collected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const outstanding = active.reduce((s, i) => s + invoiceTotals(i).balanceBdt, 0);
    const approvedExpenses = expenses.filter((e) => e.approvalStatus === "APPROVED");
    const expensesTotal = approvedExpenses.reduce((s, e) => s + toBdt(Number(e.amount), e), 0);
    const byCategory = new Map<string, number>();
    for (const e of approvedExpenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + toBdt(Number(e.amount), e));
    return {
      project: { id: project.id, name: project.name, billingType: project.billingType, recurringInterval: project.recurringInterval, nextBillingDate: project.nextBillingDate, monthlyRate: project.monthlyRate, totalBilled: project.totalBilled, paymentStatus: project.paymentStatus, budgetAmount: project.budgetAmount, currency: (project as any).currency ?? "BDT" },
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


  /** Inclusive date window for a statement. Defaults: fiscal-year-to-date. */
  private resolveRange(fromStr?: string, toStr?: string) {
    const startOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const endOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    const parse = (value: string, endOfDay: boolean) => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
      return endOfDay ? endOf(d) : startOf(d);
    };
    const now = new Date();
    const to = toStr ? parse(toStr, true) : endOf(now);
    const from = fromStr ? parse(fromStr, false) : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from.getTime() > to.getTime()) throw new BadRequestException("`from` must be before `to`");
    return { from, to, label: `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}` };
  }

  async trialBalance(fromStr?: string, toStr?: string) {
    const { from, to, label } = this.resolveRange(fromStr, toStr);
    return this.cache.wrap(`capital:statements:tb:${from.toISOString()}:${to.toISOString()}`, 30, () =>
      this.computeTrialBalance(from, to, label)
    );
  }


  /**
   * One grouped read for every financial statement.
   *
   * The three statements used to `findMany` the entire journal line table with
   * the account joined, then aggregate in JS. `groupBy` pushes that to Postgres
   * and returns one row per account (≈20 rows instead of hundreds of thousands).
   *
   * `from`/`to` restrict the movement window. Passing only `to` gives the
   * cumulative position up to that date (balance sheet); passing both gives the
   * movement inside the window (P&L, trial balance).
   */
  private async accountTotals(from?: Date | null, to?: Date | null) {
    const dateFilter =
      from || to
        ? { entry: { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }
        : {};
    const [totals, accounts] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({
        by: ["accountId"],
        where: dateFilter,
        _sum: { debit: true, credit: true },
      }),
      this.prisma.account.findMany({ select: { id: true, code: true, name: true, category: true } }),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return totals
      .map((t) => {
        const account = byId.get(t.accountId);
        return account
          ? { accountId: t.accountId, account, debit: Number(t._sum.debit ?? 0), credit: Number(t._sum.credit ?? 0) }
          : null;
      })
      .filter((x): x is { accountId: string; account: (typeof accounts)[number]; debit: number; credit: number } => !!x);
  }

  private async computeTrialBalance(from: Date, to: Date, label: string) {
    const lines = await this.accountTotals(from, to);
    const rows = new Map<string, { accountId: string; code: string; name: string; category: string; debit: number; credit: number }>();
    for (const l of lines) {
      const r = rows.get(l.accountId) ?? { accountId: l.accountId, code: l.account.code ?? "", name: l.account.name, category: l.account.category, debit: 0, credit: 0 };
      r.debit += l.debit;
      r.credit += l.credit;
      rows.set(l.accountId, r);
    }
    const list = Array.from(rows.values())
      .map((r) => ({ ...r, debit: Math.round(r.debit * 100) / 100, credit: Math.round(r.credit * 100) / 100, balance: Math.round((r.debit - r.credit) * 100) / 100 }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      from,
      to,
      label,
      rows: list,
      totalDebit: Math.round(list.reduce((s, r) => s + r.debit, 0) * 100) / 100,
      totalCredit: Math.round(list.reduce((s, r) => s + r.credit, 0) * 100) / 100,
    };
  }


  async profitLoss(fromStr?: string, toStr?: string) {
    const { from, to, label } = this.resolveRange(fromStr, toStr);
    return this.cache.wrap(`capital:statements:pl:${from.toISOString()}:${to.toISOString()}`, 30, () =>
      this.computeProfitLoss(from, to, label)
    );
  }


  private async computeProfitLoss(from: Date, to: Date, label: string) {
    const lines = await this.accountTotals(from, to);
    const revenue = new Map<string, { name: string; code: string; amount: number }>();
    const expense = new Map<string, { name: string; code: string; amount: number }>();
    let totalRevenue = 0, totalExpense = 0, totalDirectCost = 0;
    for (const l of lines) {
      const amount = l.credit - l.debit;
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
      from,
      to,
      label,
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


  async balanceSheet(asOfStr?: string) {
    // Balance sheet is a point-in-time statement: cumulative up to the date.
    const { to, label } = this.resolveRange(undefined, asOfStr);
    return this.cache.wrap(`capital:statements:bs:${to.toISOString()}`, 30, () =>
      this.computeBalanceSheet(to, label)
    );
  }


  private async computeBalanceSheet(asOf: Date, label: string) {
    const lines = await this.accountTotals(null, asOf);
    const assets = new Map<string, { name: string; code: string; amount: number }>();
    const liabilities = new Map<string, { name: string; code: string; amount: number }>();
    const equityAccounts = new Map<string, { name: string; code: string; amount: number }>();
    const pnl = new Map<string, { name: string; code: string; amount: number }>();
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of lines) {
      const debit = l.debit;
      const credit = l.credit;
      totalDebit += debit;
      totalCredit += credit;
      const bal = debit - credit;
      const code = String(l.account.code ?? "");
      const bucket = (map: typeof assets) => {
        const row = map.get(l.accountId) ?? { name: l.account.name, code, amount: 0 };
        row.amount += -bal;
        map.set(l.accountId, row);
      };
      if (l.account.category === "ASSET") {
        const row = assets.get(l.accountId) ?? { name: l.account.name, code, amount: 0 };
        row.amount += bal;
        assets.set(l.accountId, row);
      } else if (l.account.category === "LIABILITY") {
        // Equity is the 3xxx block (seed keeps "Retained Earnings" at 3000).
        if (code.startsWith("3")) bucket(equityAccounts);
        else bucket(liabilities);
      } else if (l.account.category === "REVENUE" || l.account.category === "DIRECT_COST" || l.account.category === "OPEX") {
        // Profit & loss accounts are not closed into equity in this workspace,
        // so their net movement is presented as current-period equity.
        bucket(pnl);
      }
    }
    const round = (m: Map<string, { name: string; code: string; amount: number }>) => {
      for (const row of m.values()) row.amount = Math.round(row.amount * 100) / 100;
      return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code));
    };
    const assetRows = round(assets);
    const liabilityRows = round(liabilities);
    const equityRows = round(equityAccounts);
    const pnlRows = round(pnl);
    const totalAssets = Math.round(assetRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const totalLiabilities = Math.round(liabilityRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const currentProfit = Math.round(pnlRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const retained = Math.round(equityRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const totalEquity = Math.round((retained + currentProfit) * 100) / 100;
    return {
      asOf,
      label,
      assets: assetRows,
      liabilities: liabilityRows,
      equityAccounts: equityRows,
      equity: totalEquity,
      retainedEarnings: retained,
      currentProfit,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalEquityAndLiabilities: Math.round((totalLiabilities + totalEquity) * 100) / 100,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      // A real check: assets must equal liabilities + equity. The old version
      // defined equity as assets − liabilities and then compared the two, so it
      // could never report an imbalance. The trial-balance check is independent.
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      trialBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  }


  async cashFlow(fromStr?: string, toStr?: string) {
    const { from, to, label } = this.resolveRange(fromStr, toStr);
    return this.cache.wrap(`capital:statements:cf:${from.toISOString()}:${to.toISOString()}`, 30, () =>
      this.computeCashFlow(from, to, label)
    );
  }


  private async computeCashFlow(from: Date, to: Date, label: string) {
    const cashAccount = { account: { code: "1200" } };
    const [entries, bankAccounts, openingAgg] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { lines: { some: cashAccount }, entryDate: { gte: from, lte: to } },
        include: { lines: { include: { account: true } } },
        orderBy: { entryDate: "asc" },
      }),
      this.prisma.bankAccount.findMany({ select: { currentBalance: true } }),
      // Everything that moved cash BEFORE the window is the opening balance.
      this.prisma.journalEntryLine.aggregate({
        where: { account: { code: "1200" }, entry: { entryDate: { lt: from } } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    // Cash-flow sections. An opening-balance journal is NOT operating cash: it
    // is the starting position of the business and must sit above the statement.
    const FINANCING_TYPES = new Set(["FX_OPENING", "LOAN", "CAPITAL", "OWNER_CONTRIBUTION", "DIVIDEND"]);
    const INVESTING_TYPES = new Set(["ASSET_PURCHASE", "ASSET_SALE", "FIXED_ASSET_PURCHASE", "FIXED_ASSET_SALE", "ASSET_DISPOSAL"]);
    const sectionOf = (entryType: string) =>
      FINANCING_TYPES.has(entryType) ? "financing" : INVESTING_TYPES.has(entryType) ? "investing" : "operating";

    const operating = new Map<string, number>();
    let openingBalance = Math.round((Number(openingAgg._sum.debit ?? 0) - Number(openingAgg._sum.credit ?? 0)) * 100) / 100;
    let netOperating = 0;
    let netInvesting = 0;
    let netFinancing = 0;
    const detail: { entryType: string; reference: string | null; date: Date; inflow: number; outflow: number; label: string; in: number; out: number; net: number; section: string }[] = [];
    for (const e of entries) {
      const cash = e.lines.find((l) => l.account.code === "1200");
      if (!cash) continue;
      const inflow = Number(cash.debit);
      const outflow = Number(cash.credit);
      const net = inflow - outflow;
      const section = sectionOf(e.entryType);
      if (section === "financing") netFinancing += net;
      else if (section === "investing") netInvesting += net;
      else {
        netOperating += net;
        operating.set(e.entryType, (operating.get(e.entryType) ?? 0) + net);
      }
      detail.push({
        entryType: e.entryType,
        reference: e.reference,
        date: e.entryDate,
        inflow: Math.round(inflow * 100) / 100,
        outflow: Math.round(outflow * 100) / 100,
        label: e.reference || e.entryType.replace(/_/g, " ").toLowerCase(),
        in: Math.round(inflow * 100) / 100,
        out: Math.round(outflow * 100) / 100,
        net: Math.round(net * 100) / 100,
        section,
      });
    }
    const bankTotal = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);
    const netChange = Math.round((netOperating + netInvesting + netFinancing) * 100) / 100;
    const calculatedClosing = Math.round((openingBalance + netChange) * 100) / 100;
    // For a historical window the closing balance IS the calculated one; the
    // bank mirror only makes sense as a cross-check for a window ending today.
    const asOfNow = to.getTime() >= Date.now() - 86400000;
    const closingBalance = asOfNow ? Math.round(bankTotal * 100) / 100 : calculatedClosing;
    return {
      from,
      to,
      label,
      operating: Array.from(operating.entries()).map(([type, net]) => ({ type, net: Math.round(net * 100) / 100 })),
      netOperating: Math.round(netOperating * 100) / 100,
      netInvesting: Math.round(netInvesting * 100) / 100,
      netFinancing: Math.round(netFinancing * 100) / 100,
      openingBalance,
      closingBalance,
      calculatedClosing,
      netChange,
      // The GL cash account and the operational bank balances must agree.
      reconciled: Math.abs(calculatedClosing - Math.round(bankTotal * 100) / 100) < 0.01,
      detail: detail.slice(-200),
    };
  }
  // ── Reports data ─────────────────────────────────────────────────────


  async reportsData() {
    return this.cache.wrap("capital:reports", 60, () => this.computeReportsData());
  }


  private async computeReportsData() {
    const [invoices, expenses, payments, projects] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE } }),
      this.prisma.expense.findMany({ where: { approvalStatus: "APPROVED" } }),
      this.prisma.payment.findMany({ where: { ...RECEIPT_PAYMENT_FILTER } }),
      this.prisma.project.findMany({ select: { id: true, name: true } }),
    ]);

    const sumLines = (i: any) => i.lineItems.reduce((s: number, l: any) => s + toBdt(Number(l.amount), i), 0);
    const paidOf = (i: any) => invoiceTotals(i).paidBdt;
    // Signed BDT value of a payment: refunds reduce the total.
    const paymentBdt = (p: any) => (p.type === "REFUND" ? -1 : 1) * toBdt(Number(p.amount), p);

    // Revenue by category (invoiceType)
    const byCategory = new Map<string, number>();
    for (const i of invoices) {
      if (!ACTIVE_STATUSES.includes(i.status)) continue;
      byCategory.set(i.invoiceType, (byCategory.get(i.invoiceType) ?? 0) + sumLines(i));
    }

    // Payment methods distribution
    const byMethod = new Map<string, number>();
    for (const p of payments) byMethod.set(p.paymentMethod, (byMethod.get(p.paymentMethod) ?? 0) + paymentBdt(p));

    // 8-month trend — collected is bucketed by PAYMENT date (cash actually
    // arrived), revenue by invoice issue date. Previously collected was added
    // from issue date, which made the cash trend lag reality.
    const months: { month: string; revenue: number; expenses: number; profit: number; collected: number }[] = [];
    const monthKeys: string[] = [];
    const now = new Date();
    // Build the buckets in UTC. Mixing `new Date(y, m, 1)` (local) with the
    // `getUTC*` getters shifted every key one month back east of UTC (UTC+6 in
    // Bangladesh) — the "Oct" bucket held September's numbers and the current
    // month's invoices fell outside the window entirely.
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      months.push({
        month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
        revenue: 0, expenses: 0, profit: 0, collected: 0,
      });
    }
    const monthIndex = new Map(monthKeys.map((k, i) => [k, i]));
    const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    for (const inv of invoices) {
      const idx = monthIndex.get(keyOf(inv.issueDate));
      if (idx === undefined) continue;
      if (ACTIVE_STATUSES.includes(inv.status)) months[idx].revenue += sumLines(inv);
    }
    for (const p of payments) {
      const idx = monthIndex.get(keyOf(p.paymentDate));
      if (idx === undefined) continue;
      months[idx].collected += paymentBdt(p);
    }
    for (const e of expenses) {
      const idx = monthIndex.get(keyOf(e.date));
      if (idx === undefined) continue;
      months[idx].expenses += toBdt(Number(e.amount), e);
    }
    for (const m of months) {
      m.profit = Math.round((m.revenue - m.expenses) * 100) / 100;
      m.revenue = Math.round(m.revenue * 100) / 100;
      m.expenses = Math.round(m.expenses * 100) / 100;
      m.collected = Math.round(m.collected * 100) / 100;
    }

    // Weekly cash flow (current month) — bucketed by the date cash moved.
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const cashFlow = [0, 1, 2, 3].map((w) => ({ week: `W${w + 1}`, inflow: 0, outflow: 0, net: 0 }));
    for (const p of payments) {
      if (p.paymentDate < monthStart || p.paymentDate >= nextMonth) continue;
      const w = Math.min(3, Math.floor((new Date(p.paymentDate).getUTCDate() - 1) / 7));
      const signed = paymentBdt(p);
      if (signed >= 0) cashFlow[w].inflow += signed;
      else cashFlow[w].outflow += Math.abs(signed);
    }
    for (const e of expenses) {
      if (e.date < monthStart || e.date >= nextMonth) continue;
      const w = Math.min(3, Math.floor((new Date(e.date).getUTCDate() - 1) / 7));
      cashFlow[w].outflow += toBdt(Number(e.amount), e);
    }
    for (const w of cashFlow) {
      w.inflow = Math.round(w.inflow * 100) / 100;
      w.outflow = Math.round(w.outflow * 100) / 100;
      w.net = Math.round((w.inflow - w.outflow) * 100) / 100;
    }

    // Budget overview (top expense categories, with real budgets)
    const byExpCat = new Map<string, number>();
    for (const e of expenses) byExpCat.set(e.category, (byExpCat.get(e.category) ?? 0) + toBdt(Number(e.amount), e));
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
    const totalInvoiced = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status)).reduce((s, i) => s + invoiceTotals(i).grandBdt, 0);
    const totalCollected = payments.reduce((s, p) => s + paymentBdt(p), 0);
    const avgInvoiceValue = totalInvoiced ? totalInvoiced / Math.max(invoices.filter((i) => ACTIVE_STATUSES.includes(i.status)).length, 1) : 0;
    const totalExpenses = expenses.reduce((s, e) => s + toBdt(Number(e.amount), e), 0);
    const profitMargin = totalInvoiced ? ((totalInvoiced - totalExpenses) / totalInvoiced) * 100 : 0;
    const collectionRate = totalInvoiced ? (totalCollected / totalInvoiced) * 100 : 0;

    // Tax report (quarterly). Collected is real cash received in the quarter —
    // it used to be hard-coded to 0, so the tax table always showed ৳0.
    const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q, qi) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), qi * 3, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), qi * 3 + 3, 1));
      let revenue = 0, exp = 0, collected = 0;
      for (const inv of invoices) if (inv.issueDate >= start && inv.issueDate < end && ACTIVE_STATUSES.includes(inv.status)) revenue += sumLines(inv);
      for (const e of expenses) if (e.date >= start && e.date < end) exp += toBdt(Number(e.amount), e);
      for (const p of payments) if (p.paymentDate >= start && p.paymentDate < end) collected += paymentBdt(p);
      const taxable = Math.max(revenue - exp, 0);
      return {
        quarter: q,
        revenue: Math.round(revenue),
        collected: Math.round(collected),
        expenses: Math.round(exp),
        taxableIncome: Math.round(taxable),
        estimatedTax: Math.round(taxable * 0.22),
      };
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
          collected: q.collected,
          expenses: q.expenses,
          net: q.taxableIncome,
          estimatedTax: q.estimatedTax,
        })),
        totals: {
          invoiced: quarters.reduce((s, q) => s + q.revenue, 0),
          collected: quarters.reduce((s, q) => s + q.collected, 0),
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
        include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE, client: { select: { id: true, companyName: true } } },
        orderBy: { issueDate: "desc" },
      }),
      this.prisma.payment.findMany({
        where: { paymentDate: { gte: from, lte: to }, ...RECEIPT_PAYMENT_FILTER },
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
      (i.lineItems ?? []).reduce((s: number, l: any) => s + toBdt(Number(l.amount ?? 0), i), 0);
    const paymentBdt = (p: any) => (p.type === "REFUND" ? -1 : 1) * toBdt(Number(p.amount ?? 0), p);

    const invoiced = r2(active.reduce((s, i) => s + invoiceTotals(i).grandBdt, 0));
    const collected = r2(payments.reduce((s, p) => s + paymentBdt(p), 0));
    const expensesTotal = r2(expenses.reduce((s, e) => s + toBdt(Number(e.amount), e), 0));
    const profit = r2(invoiced - expensesTotal);
    const margin = invoiced ? Math.round((profit / invoiced) * 10000) / 100 : 0;
    // Collected can exceed invoiced in a window when prior-period invoices are
    // paid in it, which used to print a nonsensical "213.94%" collection rate.
    const collectionRate = invoiced ? Math.min(100, Math.round((collected / invoiced) * 10000) / 100) : 0;
    const outstanding = r2(active.reduce((s, i) => s + invoiceTotals(i).balanceBdt, 0));

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
      if (b) b.invoiced += invoiceTotals(inv).grandBdt;
    }
    for (const p of payments) {
      const b = buckets.get(monthKey(p.paymentDate));
      if (b) b.collected += paymentBdt(p);
    }
    for (const e of expenses) {
      const b = buckets.get(monthKey(e.date));
      if (b) b.expenses += toBdt(Number(e.amount), e);
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
      row.invoiced += ACTIVE_STATUSES.includes(inv.status) ? t.grandBdt : 0;
      row.paid += t.paidBdt;
      row.balance += ACTIVE_STATUSES.includes(inv.status) ? t.balanceBdt : 0;
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
      byMethodMap.set(p.paymentMethod, (byMethodMap.get(p.paymentMethod) ?? 0) + paymentBdt(p));
    }

    const byExpenseCategoryMap = new Map<string, number>();
    for (const e of expenses)
      byExpenseCategoryMap.set(e.category, (byExpenseCategoryMap.get(e.category) ?? 0) + toBdt(Number(e.amount), e));

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
      row.invoiced += ACTIVE_STATUSES.includes(inv.status) ? t.grandBdt : 0;
      row.paid += t.paidBdt;
      row.balance += ACTIVE_STATUSES.includes(inv.status) ? t.balanceBdt : 0;
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
        invoiceCount: invoices.filter((i) => i.status !== "VOID" && i.status !== "CANCELLED").length,
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
          amount: t.grandBdt,
          paid: t.paidBdt,
          balance: t.balanceBdt,
        };
      }),
      expenses: expenses.map((e) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.category,
        amount: toBdt(Number(e.amount), e),
        paymentMethod: e.paymentMethod,
        isClientBillable: e.isClientBillable,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        date: p.paymentDate,
        amount: paymentBdt(p),
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
    // Every figure is aggregated in Postgres. The previous version hydrated the
    // whole company (projects → invoices → line items → payments, expenses,
    // tasks → time logs) into one nested payload per request.
    const [projects, revenueRows, collectedRows, costRows, hourRows, monthlyRevenue, monthlyExpense] = await Promise.all([
      this.prisma.project.findMany({ select: { id: true, name: true, budgetAmount: true } }),
      this.prisma.$queryRaw<{ id: string; revenue: number; agency: number; passthrough: number }[]>`
        SELECT i."projectId" AS id,
               COALESCE(SUM(li.amount * COALESCE(i."exchangeRate", 1)), 0)::float8 AS revenue,
               COALESCE(SUM(CASE WHEN li."revenueTag" <> 'PASS_THROUGH' THEN li.amount * COALESCE(i."exchangeRate", 1) ELSE 0 END), 0)::float8 AS agency,
               COALESCE(SUM(CASE WHEN li."revenueTag" = 'PASS_THROUGH' THEN li.amount * COALESCE(i."exchangeRate", 1) ELSE 0 END), 0)::float8 AS passthrough
        FROM "Invoice" i
        JOIN "InvoiceLineItem" li ON li."invoiceId" = i.id
        WHERE i.status IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE')
          AND i."projectId" IS NOT NULL
        GROUP BY i."projectId"
      `,
      this.prisma.$queryRaw<{ id: string; collected: number }[]>`
        SELECT i."projectId" AS id,
               COALESCE(SUM((CASE WHEN p.type = 'REFUND' THEN -p.amount ELSE p.amount END) * COALESCE(i."exchangeRate", 1)), 0)::float8 AS collected
        FROM "Payment" p
        JOIN "Invoice" i ON i.id = p."invoiceId"
        WHERE i."projectId" IS NOT NULL AND p.type IN ('IN','REFUND')
        GROUP BY i."projectId"
      `,
      this.prisma.$queryRaw<{ id: string; cost: number }[]>`
        SELECT e."projectId" AS id,
               COALESCE(SUM(e.amount * COALESCE(e."exchangeRate", 1)), 0)::float8 AS cost
        FROM "Expense" e
        WHERE e."approvalStatus" = 'APPROVED' AND e."projectId" IS NOT NULL
        GROUP BY e."projectId"
      `,
      this.prisma.$queryRaw<{ id: string; hours: number }[]>`
        SELECT t."projectId" AS id, COALESCE(SUM(l.hours), 0)::float8 AS hours
        FROM "TimeLog" l
        JOIN "Task" t ON t.id = l."taskId"
        WHERE t."projectId" IS NOT NULL
        GROUP BY t."projectId"
      `,
      this.prisma.$queryRaw<{ month: string; revenue: number }[]>`
        SELECT to_char(i."issueDate", 'YYYY-MM') AS month,
               COALESCE(SUM(li.amount * COALESCE(i."exchangeRate", 1)), 0)::float8 AS revenue
        FROM "Invoice" i
        JOIN "InvoiceLineItem" li ON li."invoiceId" = i.id
        WHERE i.status IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE')
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ month: string; expenses: number }[]>`
        SELECT to_char(e.date, 'YYYY-MM') AS month,
               COALESCE(SUM(e.amount * COALESCE(e."exchangeRate", 1)), 0)::float8 AS expenses
        FROM "Expense" e
        WHERE e."approvalStatus" = 'APPROVED'
        GROUP BY 1
      `,
    ]);

    const revenueById = new Map(revenueRows.map((r) => [r.id, Number(r.revenue)]));
    const agencyById = new Map(revenueRows.map((r) => [r.id, Number(r.agency)]));
    const passThroughById = new Map(revenueRows.map((r) => [r.id, Number(r.passthrough)]));
    const collectedById = new Map(collectedRows.map((r) => [r.id, Number(r.collected)]));
    const costById = new Map(costRows.map((r) => [r.id, Number(r.cost)]));
    const hoursById = new Map(hourRows.map((r) => [r.id, Number(r.hours)]));

    const rows = projects.map((p) => {
      // Revenue is gross (pass-through included) so it matches what was billed
      // and what the GL records. Excluding pass-through revenue while keeping
      // every pass-through cost made project margins structurally wrong.
      const revenue = revenueById.get(p.id) ?? 0;
      const cost = costById.get(p.id) ?? 0;
      const collected = collectedById.get(p.id) ?? 0;
      const hours = hoursById.get(p.id) ?? 0;
      return {
        id: p.id,
        name: p.name,
        revenue: Math.round(revenue * 100) / 100,
        agencyRevenue: Math.round((agencyById.get(p.id) ?? 0) * 100) / 100,
        passThroughRevenue: Math.round((passThroughById.get(p.id) ?? 0) * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round((revenue - cost) * 100) / 100,
        margin: revenue ? Math.round(((revenue - cost) / revenue) * 100) : 0,
        hoursLogged: Math.round(hours * 10) / 10,
        budget: Number(p.budgetAmount ?? 0),
        collected: Math.round(collected * 100) / 100,
      };
    });

    const monthMap = new Map<string, { month: string; revenue: number; expenses: number; profit: number; margin: number | null }>();
    for (const r of monthlyRevenue) {
      const entry = monthMap.get(r.month) ?? { month: r.month, revenue: 0, expenses: 0, profit: 0, margin: null };
      entry.revenue += Number(r.revenue);
      monthMap.set(r.month, entry);
    }
    for (const e of monthlyExpense) {
      const entry = monthMap.get(e.month) ?? { month: e.month, revenue: 0, expenses: 0, profit: 0, margin: null };
      entry.expenses += Number(e.expenses);
      monthMap.set(e.month, entry);
    }
    const monthly = Array.from(monthMap.values())
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

  /**
   * Cost by department — the expense side of a departmental P&L.
   *
   * Revenue cannot be split by department (invoices attach to clients, not
   * teams), so this reports spend, direct cost vs overhead and each department's
   * share of the total. Anything untagged lands in "Unassigned" instead of
   * disappearing.
   */
  async costByDepartment(fromStr?: string, toStr?: string) {
    const { from, to, label } = this.resolveRange(fromStr, toStr);
    const expenses = await this.prisma.expense.findMany({
      where: { approvalStatus: "APPROVED", date: { gte: from, lte: to } },
      select: { department: true, category: true, amount: true, exchangeRate: true, isClientBillable: true },
    });
    const DIRECT = new Set(["AD_SPEND", "FREELANCER", "PRODUCTION"]);
    const byDept = new Map<string, { department: string; total: number; billable: number; directCost: number; overhead: number; categories: Map<string, number> }>();
    for (const e of expenses) {
      const dept = e.department?.trim() || "Unassigned";
      const row = byDept.get(dept) ?? { department: dept, total: 0, billable: 0, directCost: 0, overhead: 0, categories: new Map<string, number>() };
      const amount = toBdt(Number(e.amount), e);
      row.total += amount;
      if (e.isClientBillable) row.billable += amount;
      if (DIRECT.has(e.category)) row.directCost += amount;
      else row.overhead += amount;
      row.categories.set(e.category, (row.categories.get(e.category) ?? 0) + amount);
      byDept.set(dept, row);
    }
    const total = Array.from(byDept.values()).reduce((s, r) => s + r.total, 0);
    const rows = Array.from(byDept.values())
      .map((r) => ({
        department: r.department,
        total: r2(r.total),
        directCost: r2(r.directCost),
        overhead: r2(r.overhead),
        billable: r2(r.billable),
        share: total ? Math.round((r.total / total) * 10000) / 100 : 0,
        categories: Array.from(r.categories.entries())
          .map(([category, amount]) => ({ category, amount: r2(amount) }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.total - a.total);
    return { from, to, label, rows, total: r2(total) };
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
      this.prisma.payment.findMany({
        where: { type: "IN" },
        include: { invoice: { select: { id: true, invoiceType: true, invoiceNumber: true } } },
      }),
      this.prisma.manualIncome.findMany(),
      this.prisma.dollarSale.findMany({ select: { usdAmount: true, profit: true, marginPct: true, paymentMethod: true } }),
    ]);
    const totalPayments = payments.filter((p) => p.type === "IN").reduce((s, p) => s + toBdt(Number(p.amount), p), 0);
    const recurring = payments
      .filter((p) => p.type === "IN" && p.invoice?.invoiceType === "RECURRING")
      .reduce((s, p) => s + toBdt(Number(p.amount), p), 0);
    const oneTime = totalPayments - recurring;
    const manualTotal = manual.reduce((s, m) => s + toBdt(Number(m.amount), m), 0);
    const fxProfit = dollarSales.reduce((s, d) => s + Number(d.profit), 0);
    const fxUsd = dollarSales.reduce((s, d) => s + Number(d.usdAmount), 0);
    const txCount = payments.filter((p) => p.type === "IN").length + manual.length + dollarSales.length;
    const byMethod = new Map<string, number>();
    for (const p of payments) if (p.type === "IN") byMethod.set(p.paymentMethod, (byMethod.get(p.paymentMethod) ?? 0) + toBdt(Number(p.amount), p));
    for (const m of manual) byMethod.set(m.paymentMethod, (byMethod.get(m.paymentMethod) ?? 0) + toBdt(Number(m.amount), m));
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
