import { Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceStatus, RevenueTag } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../cache/cache.service";

const ACTIVE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];
const POSTABLE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];

@Injectable()
export class CapitalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService
  ) {}

  async overview() {
    return this.cache.wrap("capital:overview", 30, () => this.computeOverview());
  }

  async invalidateFinance() {
    await this.cache.del("capital:overview");
    await this.cache.del("capital:income-stats");
    await this.cache.del("capital:reports");
    await this.cache.del("capital:profitability");
    await this.cache.del("capital:activity");
    await this.cache.del("capital:aging");
    await this.cache.del("capital:aging-ap");
    await this.cache.del("capital:forecast");
    await this.cache.delPattern("capital:project-finance:*");
    await this.cache.del("capital:statements:pl");
    await this.cache.del("capital:statements:bs");
    await this.cache.del("capital:statements:tb");
    await this.cache.del("capital:statements:cf");
    await this.cache.del("insight:overview");
    await this.cache.del("insight:tax");
    await this.cache.del("insight:performance");
    await this.cache.del("insight:client-health");
    await this.cache.del("dashboard:overview");
  }

  private async nextInvoiceNumber() {
    const year = new Date().getFullYear();
    const existing = await this.prisma.invoice.findMany({
      where: { invoiceNumber: { startsWith: `ZLM-${year}-` } },
      select: { invoiceNumber: true },
    });
    const maxSeq = existing.reduce((m, i) => {
      const seq = parseInt(i.invoiceNumber.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `ZLM-${year}-${String(maxSeq + 1).padStart(4, "0")}`;
  }

  private async nextCreditNoteNumber() {
    const year = new Date().getFullYear();
    const existing = await this.prisma.creditNote.findMany({ select: { referenceNumber: true } });
    const maxSeq = existing.reduce((m, c) => {
      const seq = parseInt(c.referenceNumber.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `CRN-${year}-${String(maxSeq + 1).padStart(4, "0")}`;
  }

  // ── General ledger (double-entry) ────────────────────────────────────
  private async accountByCode(code: string) {
    const a = await this.prisma.account.findFirst({ where: { code } });
    if (!a) throw new Error(`GL account ${code} not found — run the seed`);
    return a;
  }

  private async postGL(entryType: string, reference: string, entryDate: Date, sourceId: string | null, notes: string | null, lines: { accountId: string; debit: number; credit: number; memo?: string }[], actorId?: string) {
    const rounded = lines.map((l) => ({ ...l, debit: Math.round(l.debit * 100) / 100, credit: Math.round(l.credit * 100) / 100 }));
    if (!rounded.length) return;
    if (Math.abs(rounded.reduce((s, l) => s + l.debit - l.credit, 0)) > 0.01) throw new Error("Unbalanced journal entry");
    return this.prisma.journalEntry.create({
      data: { entryType, reference, entryDate, sourceId, notes, createdById: actorId, lines: { create: rounded.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })) } },
    });
  }

  private async reverseGL(sourceId: string, actorId?: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { sourceId, reversedEntryId: null },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });
    if (!entry) return;
    await this.postGL(
      entry.entryType,
      `${entry.reference} (reversed)`,
      new Date(),
      entry.sourceId,
      entry.notes ? `${entry.notes} — reversed` : "Reversed",
      entry.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit), memo: l.memo ?? undefined })),
      actorId
    );
    const reversal = await this.prisma.journalEntry.findFirst({ where: { sourceId, reversedEntryId: null }, orderBy: { createdAt: "desc" } });
    if (reversal) await this.prisma.journalEntry.update({ where: { id: reversal.id }, data: { reversedEntryId: entry.id } });
  }

  private async postInvoiceGL(invoice: any, actorId?: string) {
    if (!invoice || !POSTABLE_STATUSES.includes(invoice.status)) return;
    const [acctAR, acctRevenue, acctMgmt, acctVat] = await Promise.all([
      this.accountByCode("1100"),
      this.accountByCode("4000"),
      this.accountByCode("4100"),
      this.accountByCode("2100"),
    ]);
    const lines: { accountId: string; debit: number; credit: number; memo?: string }[] = [];
    let total = 0;
    let tax = 0;
    for (const l of invoice.lineItems ?? []) {
      const amt = Number(l.amount);
      total += amt;
      lines.push({ accountId: l.revenueTag === "MANAGEMENT_FEE" ? acctMgmt.id : acctRevenue.id, debit: 0, credit: amt, memo: l.description });
    }
    if (invoice.taxApplicable && invoice.taxRate) {
      tax = Math.round((total * Number(invoice.taxRate)) / 10000) / 100;
      if (tax > 0) lines.push({ accountId: acctVat.id, debit: 0, credit: tax, memo: `VAT ${invoice.taxRate}%` });
    }
    if (total + tax > 0) {
      await this.postGL("INVOICE", invoice.invoiceNumber, invoice.issueDate, invoice.id, null, [{ accountId: acctAR.id, debit: total + tax, credit: 0, memo: invoice.client?.companyName }, ...lines], actorId);
    }
  }

  private async recomputeInvoiceStatus(invoiceId: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true, payments: true } });
    if (!inv) return;
    const total = inv.lineItems.reduce((s, l) => s + Number(l.amount), 0);
    const paid = inv.payments.filter((p) => p.type === "IN").reduce((s, p) => s + Number(p.amount), 0);
    if (inv.status === "DRAFT" || inv.status === "CANCELLED" || inv.status === "VOID") return;
    const status = paid >= total ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : inv.status;
    if (status !== inv.status) await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
    return { total, paid };
  }

  private async applyOverpayment(invoice: any) {
    if (!invoice) return;
    const total = invoice.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const paid = invoice.payments.filter((p: any) => p.type === "IN").reduce((s: number, p: any) => s + Number(p.amount), 0);
    const excess = Math.round((paid - total) * 100) / 100;
    if (excess > 0) {
      await this.prisma.creditBalance.create({ data: { clientId: invoice.clientId, amount: excess, currency: invoice.currency, source: `Overpayment on ${invoice.invoiceNumber}` } });
    }
  }

  private advanceBillingDate(from: Date, interval: string | null): Date {
    const d = new Date(from);
    const s = (interval ?? "30-days").toLowerCase();
    const days = s.includes("monthly") || s.includes("30") ? 30 : s.includes("90") ? 90 : s.includes("60") ? 60 : s.includes("15") ? 15 : s.includes("7") ? 7 : 30;
    d.setDate(d.getDate() + days);
    return d;
  }

  // ── Project billing sync ─────────────────────────────────────────────
  async syncProjectBilling(projectId: string | null | undefined) {
    if (!projectId) return;
    const invoices = await this.prisma.invoice.findMany({
      where: { projectId, status: { in: ACTIVE_STATUSES as InvoiceStatus[] } },
      include: { lineItems: true, payments: true },
    });
    const totalBilled = invoices.reduce((s, i) => s + i.lineItems.reduce((x, l) => x + Number(l.amount), 0), 0);
    const outstanding = invoices.reduce(
      (s, i) => s + Math.max(i.lineItems.reduce((x, l) => x + Number(l.amount), 0) - i.payments.reduce((x, p) => x + Number(p.amount), 0), 0),
      0
    );
    const paymentStatus = totalBilled === 0 ? "PENDING" : outstanding <= 0 ? "PAID" : "PARTIAL";
    await this.prisma.project
      .update({ where: { id: projectId }, data: { totalBilled: Math.round(totalBilled * 100) / 100, paymentStatus } })
      .catch(() => {});
  }

  // ── Bank account ledger ──────────────────────────────────────────────
  private async defaultBankAccount(): Promise<string | null> {
    const a = await this.prisma.bankAccount.findFirst({ orderBy: { accountType: "asc" } });
    return a?.id ?? null;
  }

  private async creditBankAccount(bankAccountId: string, amount: number) {
    await this.prisma.bankAccount.update({ where: { id: bankAccountId }, data: { currentBalance: { increment: amount } } });
  }

  private async debitBankAccount(bankAccountId: string, amount: number) {
    await this.prisma.bankAccount.update({ where: { id: bankAccountId }, data: { currentBalance: { decrement: amount } } });
  }

  // ── AR aging report ──────────────────────────────────────────────────
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
      const amount = inv.lineItems.reduce((s, l) => s + Number(l.amount), 0);
      const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      const bal = Math.max(amount - paid, 0);
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
      const amount = inv.lineItems.reduce((s, l) => s + Number(l.amount), 0);
      const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      const bal = Math.max(amount - paid, 0);
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
    const amountOf = (i: any) => i.lineItems.reduce((s: number, l: any) => s + Number(l.amount), 0);
    const paidOf = (i: any) => i.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const totalInvoiced = active.reduce((s, i) => s + amountOf(i), 0);
    const collected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const outstanding = Math.max(totalInvoiced - collected, 0);
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
      invoices: invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, issueDate: i.issueDate, dueDate: i.dueDate, amount: amountOf(i), paid: paidOf(i), balance: Math.max(amountOf(i) - paidOf(i), 0), client: i.client.companyName })),
      expenses: expenses.map((e) => ({ id: e.id, description: e.description, amount: Number(e.amount), category: e.category, date: e.date, approvalStatus: e.approvalStatus, vendor: e.vendor?.name ?? null, submittedBy: e.submittedBy?.name ?? null, isClientBillable: e.isClientBillable })),
    };
  }

  // ── Recurring billing ────────────────────────────────────────────────
  async runRecurringBilling() {
    const projects = await this.prisma.project.findMany({
      where: { billingType: "RECURRING", nextBillingDate: { lte: new Date() } },
    });
    let created = 0;
    for (const p of projects) {
      const amount = Number(p.monthlyRate ?? 0);
      if (amount <= 0) continue;
      const issueDate = p.nextBillingDate ?? new Date();
      const due = new Date(issueDate);
      due.setDate(due.getDate() + 30);
      const invoiceNumber = await this.nextInvoiceNumber();
      await this.prisma.invoice.create({
        data: {
          invoiceNumber,
          clientId: p.clientId,
          projectId: p.id,
          invoiceType: "RECURRING",
          issueDate,
          dueDate: due,
          status: "SENT",
          lineItems: {
            create: [{ description: `Recurring retainer — ${p.name}`, quantity: 1, unitPrice: amount, amount, revenueTag: "AGENCY_REVENUE" }],
          },
        },
      });
      await this.prisma.project.update({
        where: { id: p.id },
        data: { nextBillingDate: this.advanceBillingDate(issueDate, p.recurringInterval) },
      });
      await this.syncProjectBilling(p.id);
      created++;
    }
    if (created > 0) await this.invalidateFinance();
    return { created };
  }

  private async computeOverview() {
    const [invoices, expenses, bankAccounts, payments, snapshots] = await Promise.all([
      this.prisma.invoice.findMany({ include: { lineItems: true, payments: true } }),
      this.prisma.expense.findMany({
        where: { approvalStatus: "APPROVED" },
        select: { amount: true, date: true, category: true, isClientBillable: true, description: true },
      }),
      this.prisma.bankAccount.findMany({ select: { accountName: true, accountType: true, currentBalance: true } }),
      this.prisma.payment.findMany({ select: { amount: true, paymentMethod: true } }),
      this.prisma.metricSnapshot.findMany({ orderBy: { recordedAt: "asc" } }),
    ]);

    const invoiceable = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status));
    const sumLines = (i: any, tag?: RevenueTag) =>
      i.lineItems.filter((l: any) => (tag ? l.revenueTag === tag : true)).reduce((s: number, l: any) => s + Number(l.amount), 0);
    const paidOf = (i: any) => i.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);

    const totalInvoiced = invoiceable.reduce((s, i) => s + sumLines(i), 0);
    const recognizedRevenue = invoiceable.reduce((s, i) => s + sumLines(i, "AGENCY_REVENUE") + sumLines(i, "MANAGEMENT_FEE"), 0);
    const collected = invoices.reduce((s, i) => s + paidOf(i), 0);
    const outstanding = invoiceable.filter((i) => i.status !== "PAID").reduce((s, i) => s + Math.max(sumLines(i) - paidOf(i), 0), 0);
    const overdueAmount = invoiceable.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + Math.max(sumLines(i) - paidOf(i), 0), 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const expensesMonth = expenses.filter((e) => e.date >= monthStart).reduce((s, e) => s + Number(e.amount), 0);
    const billableShare = expensesMonth
      ? Math.round((expenses.filter((e) => e.isClientBillable && e.date >= monthStart).reduce((s, e) => s + Number(e.amount), 0) / expensesMonth) * 100)
      : 0;
    const cashPosition = bankAccounts.reduce((s, b) => s + Number(b.currentBalance), 0);

    const paymentSplit = new Map<string, number>();
    for (const p of payments) paymentSplit.set(p.paymentMethod, (paymentSplit.get(p.paymentMethod) ?? 0) + Number(p.amount));

    const trend = this.buildTrend(snapshots);
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
      paymentSplit: Array.from(paymentSplit.entries()).map(([method, amount]) => ({ method, amount })),
      trend,
      profitTrend,
    };
  }

  async invoices(query: { status?: string; clientId?: string; q?: string }) {
    return this.prisma.invoice.findMany({
      where: {
        ...(query.status ? { status: query.status as InvoiceStatus } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.q ? { OR: [{ invoiceNumber: { contains: query.q, mode: "insensitive" } }, { client: { companyName: { contains: query.q, mode: "insensitive" } } }] } : {}),
      },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        lineItems: true,
        payments: { select: { id: true, amount: true, paymentMethod: true, paymentDate: true } },
      },
      orderBy: { issueDate: "desc" },
    });
  }

  async invoiceDetail(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true, contacts: { select: { id: true, name: true, email: true } } } },
        project: { select: { id: true, name: true } },
        lineItems: true,
        installments: { orderBy: { sequence: "asc" } },
        payments: { include: { recordedBy: { select: { name: true } }, installment: { select: { sequence: true } } }, orderBy: { paymentDate: "desc" } },
        creditNotes: { orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } },
      },
    });
    if (!inv) throw new NotFoundException("Invoice not found");
    return inv;
  }

  async createInvoice(body: any, createdById?: string) {
    const invoiceNumber = await this.nextInvoiceNumber();
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        clientId: body.clientId,
        projectId: body.projectId,
        invoiceType: body.invoiceType ?? "ONE_TIME",
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        status: body.status ?? "DRAFT",
        taxApplicable: body.taxApplicable ?? false,
        taxRate: body.taxRate ?? null,
        notes: body.notes,
        createdById,
        lineItems: {
          create: (body.lines ?? body.lineItems ?? []).map((l: any) => {
            const quantity = l.quantity ?? 1;
            const unitPrice = l.unitPrice ?? (l.amount ? l.amount / quantity : 0);
            return {
              description: l.description,
              quantity,
              unitPrice,
              amount: (l.amount ?? unitPrice) * quantity,
              revenueTag: (l.revenueTag as RevenueTag) ?? "AGENCY_REVENUE",
            };
          }),
        },
      },
      include: { client: { select: { id: true, companyName: true } }, lineItems: true },
    });
    if (body.installments?.length) {
      await this.prisma.installment.createMany({
        data: body.installments.map((s: any, i: number) => ({
          invoiceId: invoice.id,
          sequence: i + 1,
          amount: s.amount,
          dueDate: new Date(s.dueDate),
        })),
      });
    }
    if (POSTABLE_STATUSES.includes(invoice.status)) await this.postInvoiceGL(invoice, createdById);
    await this.notifications.broadcast(
      "invoice_paid",
      "New Invoice Created",
      `Invoice ${invoice.invoiceNumber} for ${invoice.client.companyName} has been created.`,
      "/capital"
    );
    await this.logAudit("Invoice", invoice.id, "created", { invoiceNumber });
    await this.syncProjectBilling(body.projectId ?? null);
    await this.invalidateFinance();
    return invoice;
  }

  async updateInvoice(id: string, body: any, actorId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!existing) throw new NotFoundException("Invoice not found");
    const data: any = {};
    for (const f of ["status", "invoiceType", "issueDate", "dueDate", "taxApplicable", "taxRate", "notes", "projectId", "clientId", "currency", "exchangeRate"]) {
      if (body[f] !== undefined) data[f] = f.includes("Date") && body[f] ? new Date(body[f]) : body[f];
    }
    if (body.dueDate === null) data.dueDate = null;
    if (body.lines) {
      await this.prisma.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      data.lineItems = {
        create: body.lines.map((l: any) => ({
          description: l.description,
          quantity: l.quantity ?? 1,
          unitPrice: l.unitPrice,
          amount: (l.quantity ?? 1) * l.unitPrice,
          revenueTag: (l.revenueTag as RevenueTag) ?? "AGENCY_REVENUE",
        })),
      };
    }
    if (body.installments) {
      await this.prisma.installment.deleteMany({ where: { invoiceId: id } });
      data.installments = {
        create: body.installments.map((s: any, i: number) => ({
          sequence: i + 1,
          amount: s.amount,
          dueDate: new Date(s.dueDate),
        })),
      };
    }
    const wasPosted = POSTABLE_STATUSES.includes(existing.status);
    const willPost = body.status !== undefined ? POSTABLE_STATUSES.includes(body.status) : wasPosted;
    const postedBefore = wasPosted || willPost;
    if (postedBefore && (body.lines || body.installments || body.status !== undefined || body.taxApplicable !== undefined || body.taxRate !== undefined || body.issueDate !== undefined)) {
      await this.reverseGL(id, actorId);
    }
    const updated = await this.prisma.invoice.update({
      where: { id },
      data,
      include: { client: { select: { id: true, companyName: true } }, lineItems: true, payments: true },
    });
    if (wasPosted || willPost) await this.postInvoiceGL(updated, actorId);
    await this.logAudit("Invoice", id, "updated", { from: existing.status, to: body.status ?? existing.status }, actorId);
    if (body.projectId && body.projectId !== existing.projectId) {
      await this.syncProjectBilling(existing.projectId);
    }
    await this.syncProjectBilling(body.projectId ?? existing.projectId);
    await this.invalidateFinance();
    return updated;
  }

  async duplicateInvoice(id: string) {
    const src = await this.prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!src) throw new NotFoundException("Invoice not found");
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber: await this.nextInvoiceNumber(),
        clientId: src.clientId,
        projectId: src.projectId,
        invoiceType: src.invoiceType,
        issueDate: new Date(),
        dueDate: src.dueDate,
        status: "DRAFT",
        taxApplicable: src.taxApplicable,
        taxRate: src.taxRate,
        notes: src.notes,
        lineItems: {
          create: src.lineItems.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            revenueTag: l.revenueTag,
          })),
        },
      },
      include: { lineItems: true },
    });
    await this.syncProjectBilling(src.projectId);
    await this.invalidateFinance();
    return invoice;
  }

  async deleteInvoice(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: { payments: true } }).catch(() => null);
    if (!inv) throw new NotFoundException("Invoice not found");
    for (const p of inv.payments) {
      if (p.balanceCredited && p.bankAccountId && p.type === "IN") {
        await this.creditBankAccount(p.bankAccountId, Number(p.amount));
      }
      if (p.balanceCredited && p.bankAccountId && p.type === "REFUND") {
        await this.debitBankAccount(p.bankAccountId, Number(p.amount));
      }
    }
    await this.reverseGL(id);
    await this.prisma.invoice.delete({ where: { id } });
    await this.logAudit("Invoice", id, "deleted", {});
    await this.syncProjectBilling(inv.projectId);
    await this.invalidateFinance();
    return { ok: true };
  }

  async recordPayment(invoiceId: string, body: { amount: number; paymentMethod: string; referenceId?: string; paymentDate?: string; notes?: string; bankAccountId?: string; installmentId?: string }, recordedById?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, payments: true, installments: { orderBy: { sequence: "asc" } }, client: { select: { id: true, companyName: true } } },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    const total = invoice.lineItems.reduce((s, l) => s + Number(l.amount), 0);
    const paidSoFar = invoice.payments.filter((p) => p.type === "IN").reduce((s, p) => s + Number(p.amount), 0);
    let installmentId = body.installmentId ?? null;
    if (invoice.installments.length) {
      const target = invoice.installments.find((s) => s.id === body.installmentId) ?? invoice.installments.find((s) => s.status !== "PAID");
      if (target) {
        installmentId = target.id;
        await this.prisma.installment.update({
          where: { id: target.id },
          data: { paidAmount: { increment: body.amount }, status: Number(target.paidAmount) + body.amount >= Number(target.amount) ? "PAID" : "PARTIAL" },
        });
      }
    }
    const referenceId = body.referenceId ?? (installmentId ? `${invoice.invoiceNumber}/#${invoice.installments.find((s) => s.id === installmentId)?.sequence ?? 1}` : null);
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId,
        installmentId,
        amount: body.amount,
        paymentMethod: body.paymentMethod as any,
        referenceId,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
        notes: body.notes,
        recordedById,
      },
    });
    const bankId = body.bankAccountId ?? (await this.defaultBankAccount());
    if (bankId) {
      await this.creditBankAccount(bankId, Number(body.amount));
      await this.prisma.payment.update({ where: { id: payment.id }, data: { bankAccountId: bankId, balanceCredited: true } });
    }
    const [acctBank, acctAR] = await Promise.all([this.accountByCode("1200"), this.accountByCode("1100")]);
    await this.postGL(
      "PAYMENT",
      `${invoice.invoiceNumber} / ${referenceId ?? payment.id}`,
      body.paymentDate ? new Date(body.paymentDate) : new Date(),
      invoiceId,
      null,
      [
        { accountId: acctBank.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctAR.id, debit: 0, credit: Number(body.amount) },
      ],
      recordedById
    );
    const saved = await this.prisma.payment.findUnique({ where: { id: payment.id } });
    const paid = paidSoFar + Number(body.amount);
    const status = paid >= total ? "PAID" : "PARTIALLY_PAID";
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
    await this.logAudit("Invoice", invoiceId, "payment_recorded", { amount: body.amount, status, installment: installmentId ?? null });
    if (status === "PAID") {
      await this.notifications.broadcast(
        "payment_received",
        "Payment Received",
        `${invoice.client.companyName} paid ${invoice.invoiceNumber} in full.`,
        "/capital"
      );
    }
    const updatedInvoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true, payments: true, client: { select: { id: true } } } });
    if (updatedInvoice) await this.applyOverpayment(updatedInvoice);
    await this.syncProjectBilling(invoice.projectId);
    await this.invalidateFinance();
    return saved;
  }

  // ── Expenses ─────────────────────────────────────────────────────────
  async expenses(query: { status?: string; clientId?: string; q?: string; category?: string }) {
    return this.prisma.expense.findMany({
      where: {
        ...(query.status ? { approvalStatus: query.status as any } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { OR: [{ description: { contains: query.q, mode: "insensitive" } }, { vendor: { name: { contains: query.q, mode: "insensitive" } } }] } : {}),
      },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { date: "desc" },
    });
  }

  async createExpense(body: any, submittedById?: string) {
    const isApproved = (body.approvalStatus ?? "PENDING") === "APPROVED";
    const bankId = body.bankAccountId ?? (await this.defaultBankAccount());
    const expense = await this.prisma.expense.create({
      data: {
        description: body.description,
        amount: body.amount,
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        category: body.category ?? "MISC",
        subcategory: body.subcategory ?? null,
        date: body.date ? new Date(body.date) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        isPayable: body.isPayable ?? false,
        paidAmount: body.isPayable ? 0 : body.amount,
        isClientBillable: body.isClientBillable ?? false,
        clientId: body.clientId ?? null,
        projectId: body.projectId ?? null,
        paymentMethod: body.paymentMethod ?? "CASH",
        vendorId: body.vendorId ?? null,
        receiptUrl: body.receiptUrl ?? null,
        isRecurring: body.isRecurring ?? false,
        recurrenceSchedule: body.recurrenceSchedule ?? null,
        approvalStatus: body.approvalStatus ?? "PENDING",
        submittedById,
        accountId: body.accountId ?? null,
        bankAccountId: isApproved && !(body.isPayable ?? false) ? bankId : null,
        balanceDeducted: false,
      },
    });
    if (isApproved) await this.postExpenseGL(expense, submittedById);
    const savedExpense = await this.prisma.expense.findUnique({ where: { id: expense.id } });
    await this.syncProjectBilling(body.projectId ?? null);
    await this.invalidateFinance();
    return savedExpense ?? expense;
  }

  private async postExpenseGL(expense: any, actorId?: string) {
    const [acctExp, acctAP, acctBank] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: expense.accountId ?? "" } }).catch(() => null),
      this.accountByCode("2000"),
      this.accountByCode("1200"),
    ]);
    const def = await this.prisma.expenseCategoryDef.findUnique({ where: { key: expense.category } }).catch(() => null);
    const expenseAcct = acctExp ?? (def?.accountId ? await this.prisma.account.findUnique({ where: { id: def.accountId } }).catch(() => null) : null) ?? (await this.accountByCode("5070"));
    if (expense.isPayable) {
      await this.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        { accountId: expenseAcct.id, debit: Number(expense.amount), credit: 0, memo: expense.description },
        { accountId: acctAP.id, debit: 0, credit: Number(expense.amount) },
      ], actorId);
    } else {
      await this.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        { accountId: expenseAcct.id, debit: Number(expense.amount), credit: 0, memo: expense.description },
        { accountId: acctBank.id, debit: 0, credit: Number(expense.amount) },
      ], actorId);
    }
  }

  async updateExpense(id: string, body: any, actorId?: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense not found");
    const data: any = {};
    for (const f of ["description", "date", "dueDate", "isClientBillable", "clientId", "projectId", "paymentMethod", "vendorId", "receiptUrl", "isRecurring", "recurrenceSchedule", "approvalStatus", "amount", "category", "subcategory", "isPayable", "accountId", "currency", "exchangeRate"]) {
      if (body[f] !== undefined) data[f] = f.endsWith("Date") && body[f] ? new Date(body[f]) : body[f];
    }
    if (body.approvalStatus === "APPROVED" || body.approvalStatus === "REJECTED") {
      data.approvedBy = actorId ? { connect: { id: actorId } } : undefined;
    }
    const wasApproved = existing.approvalStatus === "APPROVED";
    const willBeApproved = body.approvalStatus !== undefined ? body.approvalStatus === "APPROVED" : wasApproved;
    const wasPayable = body.isPayable !== undefined ? body.isPayable : existing.isPayable;
    if (wasApproved && !willBeApproved) {
      await this.reverseGL(id, actorId);
    }
    if (wasApproved && willBeApproved && (body.amount !== undefined || body.category !== undefined || body.isPayable !== undefined || body.accountId !== undefined)) {
      await this.reverseGL(id, actorId);
    }
    if (!wasPayable && willBeApproved && !existing.balanceDeducted) {
      const bankId = body.bankAccountId ?? existing.bankAccountId ?? (await this.defaultBankAccount());
      if (bankId) {
        await this.debitBankAccount(bankId, Number(body.amount ?? existing.amount));
        data.bankAccountId = bankId;
        data.balanceDeducted = true;
      }
    }
    const result = await this.prisma.expense.update({ where: { id }, data });
    if (willBeApproved) await this.postExpenseGL(result, actorId);
    if (body.projectId !== undefined && body.projectId !== existing.projectId) await this.syncProjectBilling(existing.projectId);
    await this.syncProjectBilling(body.projectId ?? existing.projectId);
    await this.invalidateFinance();
    return result;
  }

  async deleteExpense(id: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense not found");
    if (existing.approvalStatus === "APPROVED") await this.reverseGL(id);
    if (existing.balanceDeducted && existing.bankAccountId && !existing.isPayable) {
      await this.creditBankAccount(existing.bankAccountId, Number(existing.amount));
    }
    await this.prisma.expense.delete({ where: { id } });
    await this.syncProjectBilling(existing.projectId);
    await this.invalidateFinance();
    return { ok: true };
  }

  // ── Pay a vendor expense (clears AP) ─────────────────────────────────
  async payExpense(id: string, body: { amount: number; paymentMethod: string; bankAccountId?: string; referenceId?: string; paymentDate?: string; notes?: string }, actorId?: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!expense) throw new NotFoundException("Expense not found");
    const remaining = Math.max(Number(expense.amount) - Number(expense.paidAmount ?? 0), 0);
    const amount = Math.min(Number(body.amount), remaining);
    if (amount <= 0) throw new Error("Nothing left to pay on this expense");
    const bankId = body.bankAccountId ?? (await this.defaultBankAccount());
    const payment = await this.prisma.payment.create({
      data: {
        expenseId: id,
        amount,
        paymentMethod: body.paymentMethod as any,
        referenceId: body.referenceId ?? `EXP-${id.slice(-8)}/pay`,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
        notes: body.notes,
        recordedById: actorId,
      },
    });
    if (bankId) {
      await this.debitBankAccount(bankId, amount);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { bankAccountId: bankId, balanceCredited: true } });
    }
    const [acctAP, acctBank] = await Promise.all([this.accountByCode("2000"), this.accountByCode("1200")]);
    await this.postGL(
      "EXPENSE_PAYMENT",
      `Pay ${expense.description} / ${payment.referenceId}`,
      body.paymentDate ? new Date(body.paymentDate) : new Date(),
      id,
      null,
      [
        { accountId: acctAP.id, debit: amount, credit: 0 },
        { accountId: acctBank.id, debit: 0, credit: amount },
      ],
      actorId
    );
    const newPaid = Number(expense.paidAmount ?? 0) + amount;
    await this.prisma.expense.update({ where: { id }, data: { paidAmount: newPaid, balanceDeducted: newPaid >= Number(expense.amount) } });
    await this.logAudit("Expense", id, "payment_recorded", { amount, remaining: Math.max(Number(expense.amount) - newPaid, 0) }, actorId);
    await this.invalidateFinance();
    return payment;
  }

  async apAging() {
    return this.cache.wrap("capital:aging-ap", 60, () => this.computeApAging());
  }

  private async computeApAging() {
    const expenses = await this.prisma.expense.findMany({
      where: { isPayable: true, approvalStatus: "APPROVED" },
      include: { vendor: true, payments: { select: { amount: true, paymentDate: true } } },
      orderBy: { dueDate: "asc" },
    });
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buckets: Record<string, number> = { CURRENT: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const byVendor = new Map<string, { vendorId: string | null; vendorName: string; total: number; paid: number; due: number }>();
    let totalPayable = 0;
    for (const e of expenses) {
      const paid = e.payments.reduce((s, p) => s + Number(p.amount), 0);
      const bal = Math.max(Number(e.amount) - paid, 0);
      if (bal <= 0) continue;
      totalPayable += bal;
      const due = e.dueDate ?? e.date;
      const days = Math.floor((now.getTime() - due.getTime()) / 86400000);
      const key = days <= 0 ? "CURRENT" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      buckets[key] += bal;
      const v = byVendor.get(e.vendorId ?? "none") ?? { vendorId: e.vendorId, vendorName: e.vendor?.name ?? "Unassigned", total: 0, paid: 0, due: 0 };
      v.total += Number(e.amount);
      v.paid += paid;
      v.due += bal;
      byVendor.set(e.vendorId ?? "none", v);
    }
    for (const b of Object.keys(buckets)) buckets[b] = Math.round(buckets[b] * 100) / 100;
    return { totalPayable: Math.round(totalPayable * 100) / 100, buckets, byVendor: Array.from(byVendor.values()).map((v) => ({ ...v, total: Math.round(v.total * 100) / 100, paid: Math.round(v.paid * 100) / 100, due: Math.round(v.due * 100) / 100 })).sort((a, b) => b.due - a.due) };
  }

  // ── Vendors & accounts ───────────────────────────────────────────────
  async vendors() {
    return this.prisma.vendor.findMany({
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: "asc" },
    });
  }

  async createVendor(body: any) {
    return this.prisma.vendor.create({
      data: {
        name: body.name,
        contactInfo: body.contactInfo ?? null,
        category: body.category ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        paymentTerms: body.paymentTerms ?? null,
        bankDetails: body.bankDetails ?? null,
        isActive: body.isActive ?? true,
      },
    });
  }

  async updateVendor(id: string, body: any) {
    const existing = await this.prisma.vendor.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Vendor not found");
    return this.prisma.vendor.update({ where: { id }, data: body });
  }

  async deleteVendor(id: string) {
    const existing = await this.prisma.vendor.findUnique({ where: { id }, include: { _count: { select: { expenses: true } } } }).catch(() => null);
    if (!existing) throw new NotFoundException("Vendor not found");
    if (existing._count.expenses > 0) throw new Error("Vendor has expenses — deactivate instead of deleting");
    return this.prisma.vendor.delete({ where: { id } });
  }

  async accounts() {
    return this.prisma.account.findMany({
      include: { _count: { select: { expenses: true } } },
      orderBy: { code: "asc" },
    });
  }

  async createAccount(body: any) {
    const valid = ["REVENUE", "DIRECT_COST", "OPEX", "ASSET", "LIABILITY"];
    return this.prisma.account.create({ data: { name: body.name, code: body.code ?? null, category: valid.includes(body.category) ? body.category : "OPEX" } as any });
  }

  async updateAccount(id: string, body: any) {
    const existing = await this.prisma.account.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Account not found");
    return this.prisma.account.update({ where: { id }, data: body });
  }

  async deleteAccount(id: string) {
    const existing = await this.prisma.account.findUnique({ where: { id }, include: { _count: { select: { expenses: true } } } }).catch(() => null);
    if (!existing) throw new NotFoundException("Account not found");
    if (existing._count.expenses > 0) throw new Error("Account has transactions — deactivate instead of deleting");
    return this.prisma.account.update({ where: { id }, data: { isActive: false } });
  }

  async bankAccounts() {
    return this.prisma.bankAccount.findMany({ orderBy: { accountType: "asc" } });
  }

  async createBankAccount(body: any) {
    return this.prisma.bankAccount.create({ data: { accountName: body.accountName, accountType: body.accountType, currency: body.currency ?? "BDT", currentBalance: body.currentBalance ?? 0 } });
  }

  async updateBankAccount(id: string, body: any) {
    const existing = await this.prisma.bankAccount.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Bank account not found");
    return this.prisma.bankAccount.update({ where: { id }, data: body });
  }

  // ── Expense category definitions (user-managed hierarchy) ────────────
  async expenseCategories() {
    return this.prisma.expenseCategoryDef.findMany({
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    });
  }

  async createExpenseCategory(body: any) {
    return this.prisma.expenseCategoryDef.create({
      data: { key: body.key, name: body.name, accountId: body.accountId ?? null, subcategories: body.subcategories ?? [] },
    });
  }

  async updateExpenseCategory(id: string, body: any) {
    const existing = await this.prisma.expenseCategoryDef.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense category not found");
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.accountId !== undefined) data.accountId = body.accountId;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.subcategories !== undefined) data.subcategories = body.subcategories;
    return this.prisma.expenseCategoryDef.update({ where: { id }, data });
  }

  // ── Budgets ──────────────────────────────────────────────────────────
  async budgets() {
    const [budgets, expenses] = await Promise.all([
      this.prisma.budget.findMany({ include: { project: { select: { id: true, name: true } } }, orderBy: { periodStart: "asc" } }),
      this.prisma.expense.findMany({ where: { approvalStatus: "APPROVED" }, select: { category: true, projectId: true, amount: true, date: true } }),
    ]);
    return budgets.map((b) => {
      const spent = expenses
        .filter((e) => (b.scopeType === "PROJECT" ? e.projectId === b.projectId : !b.category || e.category === b.category))
        .filter((e) => (b.periodStart && b.periodEnd ? e.date >= b.periodStart && e.date <= b.periodEnd : true))
        .reduce((s, e) => s + Number(e.amount), 0);
      return { ...b, spent: Math.round(spent * 100) / 100 };
    });
  }

  async createBudget(body: any) {
    return this.prisma.budget.create({ data: { scopeType: body.scopeType, projectId: body.projectId ?? null, departmentId: body.departmentId ?? null, category: body.category ?? null, budgetAmount: body.budgetAmount, currency: body.currency ?? "BDT", periodStart: body.periodStart ? new Date(body.periodStart) : null, periodEnd: body.periodEnd ? new Date(body.periodEnd) : null } });
  }

  async updateBudget(id: string, body: any) {
    const existing = await this.prisma.budget.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Budget not found");
    const data: any = {};
    for (const f of ["scopeType", "projectId", "departmentId", "category", "budgetAmount", "currency"]) if (body[f] !== undefined) data[f] = body[f];
    if (body.periodStart !== undefined) data.periodStart = body.periodStart ? new Date(body.periodStart) : null;
    if (body.periodEnd !== undefined) data.periodEnd = body.periodEnd ? new Date(body.periodEnd) : null;
    return this.prisma.budget.update({ where: { id }, data });
  }

  async deleteBudget(id: string) {
    const existing = await this.prisma.budget.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Budget not found");
    return this.prisma.budget.delete({ where: { id } });
  }

  // ── Bank reconciliation ──────────────────────────────────────────────
  async bankTransactions(bankAccountId: string) {
    const [payments, expenses, manualIncome, records] = await Promise.all([
      this.prisma.payment.findMany({ where: { bankAccountId }, include: { invoice: { select: { invoiceNumber: true, client: { select: { companyName: true } } } } }, orderBy: { paymentDate: "desc" } }),
      this.prisma.expense.findMany({ where: { bankAccountId }, orderBy: { date: "desc" } }),
      this.prisma.manualIncome.findMany({ where: { bankAccountId }, orderBy: { date: "desc" } }),
      this.prisma.reconciliationRecord.findMany({ where: { bankAccountId }, orderBy: { statementDate: "desc" } }),
    ]);
    const txns = [
      ...payments.map((p) => ({ id: p.id, date: p.paymentDate, ref: p.invoice?.invoiceNumber ?? p.referenceId ?? p.id, type: p.type, amount: p.type === "REFUND" ? -Number(p.amount) : Number(p.amount), kind: p.type === "REFUND" ? "REFUND" : "PAYMENT", client: p.invoice?.client.companyName ?? null, note: p.notes })),
      ...expenses.map((e) => ({ id: e.id, date: e.date, ref: e.description, type: "OUT" as const, amount: -Number(e.amount), kind: "EXPENSE", client: null, note: e.subcategory ?? null })),
      ...manualIncome.map((m) => ({ id: m.id, date: m.date, ref: m.description, type: "IN" as const, amount: Number(m.amount), kind: "MANUAL_INCOME", client: null, note: m.notes })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { transactions: txns, records, bank: await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } }) };
  }

  async reconcile(body: { bankAccountId: string; statementDate: string; statementAmount: number; statementReference?: string; matchedPaymentId?: string; matchStatus?: string }) {
    return this.prisma.reconciliationRecord.create({
      data: { bankAccountId: body.bankAccountId, statementDate: new Date(body.statementDate), statementAmount: body.statementAmount, statementReference: body.statementReference ?? null, matchedPaymentId: body.matchedPaymentId ?? null, matchStatus: (body.matchStatus as any) ?? "UNMATCHED" },
    });
  }

  async updateReconciliation(id: string, body: any) {
    return this.prisma.reconciliationRecord.update({ where: { id }, data: body });
  }

  // ── Income (payments + manual entries) ───────────────────────────────
  async income(query: { q?: string }) {
    const [payments, manual] = await Promise.all([
      this.prisma.payment.findMany({
        where: query.q ? { invoice: { client: { companyName: { contains: query.q, mode: "insensitive" } } } } : undefined,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, invoiceType: true, client: { select: { companyName: true } }, project: { select: { name: true } } } },
          recordedBy: { select: { name: true } },
        },
        orderBy: { paymentDate: "desc" },
      }),
      this.prisma.manualIncome.findMany({
        where: query.q ? { description: { contains: query.q, mode: "insensitive" } } : undefined,
        include: { recordedBy: { select: { name: true } } },
        orderBy: { date: "desc" },
      }),
    ]);
    const fromPayments = payments.map((p) => ({
      id: p.id,
      source: "invoice",
      date: p.paymentDate,
      amount: Number(p.amount),
      currency: p.currency,
      method: p.paymentMethod,
      reference: p.referenceId,
      description: p.invoice?.invoiceNumber ?? "Payment",
      client: p.invoice?.client.companyName ?? null,
      project: p.invoice?.project?.name ?? null,
      category: p.invoice?.invoiceType ?? "PAYMENT",
      recordedBy: p.recordedBy?.name ?? null,
    }));
    const fromManual = manual.map((m) => ({
      id: m.id,
      source: "manual",
      date: m.date,
      amount: Number(m.amount),
      currency: m.currency,
      method: m.paymentMethod,
      reference: null,
      description: m.description,
      client: null,
      project: null,
      category: m.category,
      recordedBy: m.recordedBy?.name ?? null,
    }));
    return [...fromPayments, ...fromManual].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async createIncome(body: any, actorId?: string) {
    const bankId = body.bankAccountId ?? (await this.defaultBankAccount());
    const income = await this.prisma.manualIncome.create({
      data: {
        description: body.description,
        amount: body.amount,
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        category: body.category ?? "OTHER_INCOME",
        date: body.date ? new Date(body.date) : new Date(),
        paymentMethod: body.paymentMethod ?? "CASH",
        bankAccountId: bankId ?? null,
        notes: body.notes ?? null,
        recordedById: actorId,
      },
    });
    if (bankId) await this.creditBankAccount(bankId, Number(body.amount));
    const [acctBank, acctOther] = await Promise.all([this.accountByCode("1200"), this.accountByCode("4200")]);
    await this.postGL(
      "MANUAL_INCOME",
      `Income — ${income.description}`,
      income.date,
      income.id,
      income.notes,
      [
        { accountId: acctBank.id, debit: Number(income.amount), credit: 0 },
        { accountId: acctOther.id, debit: 0, credit: Number(income.amount) },
      ],
      actorId
    );
    await this.logAudit("ManualIncome", income.id, "created", { description: income.description, amount: Number(income.amount) }, actorId);
    await this.invalidateFinance();
    return income;
  }

  async incomeStats() {
    return this.cache.wrap("capital:income-stats", 30, () => this.computeIncomeStats());
  }

  private async computeIncomeStats() {
    const [payments, manual] = await Promise.all([
      this.prisma.payment.findMany({ include: { invoice: { select: { id: true, invoiceType: true, invoiceNumber: true } } } }),
      this.prisma.manualIncome.findMany(),
    ]);
    const totalPayments = payments.filter((p) => p.type === "IN").reduce((s, p) => s + Number(p.amount), 0);
    const recurring = payments.filter((p) => p.invoice?.invoiceType === "RECURRING").reduce((s, p) => s + Number(p.amount), 0);
    const oneTime = totalPayments - recurring;
    const manualTotal = manual.reduce((s, m) => s + Number(m.amount), 0);
    const byMethod = new Map<string, number>();
    for (const p of payments) if (p.type === "IN") byMethod.set(p.paymentMethod, (byMethod.get(p.paymentMethod) ?? 0) + Number(p.amount));
    for (const m of manual) byMethod.set(m.paymentMethod, (byMethod.get(m.paymentMethod) ?? 0) + Number(m.amount));
    return {
      total: totalPayments + manualTotal,
      totalIncome: totalPayments + manualTotal,
      recurring,
      oneTime,
      manual: manualTotal,
      paymentCount: payments.filter((p) => p.type === "IN").length + manual.length,
      count: payments.filter((p) => p.type === "IN").length + manual.length,
      avgAmount: payments.filter((p) => p.type === "IN").length + manual.length ? (totalPayments + manualTotal) / (payments.filter((p) => p.type === "IN").length + manual.length) : 0,
      byMethod: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount),
      bySource: [
        { source: "invoice", amount: Math.round(totalPayments) },
        { source: "manual", amount: Math.round(manualTotal) },
      ].filter((s) => s.amount > 0),
    };
  }

  // ── Credit notes / refunds / write-offs ──────────────────────────────
  async creditNotes() {
    return this.prisma.creditNote.findMany({
      include: { client: { select: { id: true, companyName: true } }, invoice: { select: { id: true, invoiceNumber: true } }, createdBy: { select: { name: true } } },
      orderBy: { date: "desc" },
    });
  }

  async createCreditNote(body: any, actorId?: string) {
    const referenceNumber = await this.nextCreditNoteNumber();
    const type = body.type ?? "CREDIT_NOTE";
    const creditNote = await this.prisma.creditNote.create({
      data: {
        referenceNumber,
        type,
        clientId: body.clientId,
        invoiceId: body.invoiceId ?? null,
        amount: body.amount,
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        reason: body.reason,
        date: body.date ? new Date(body.date) : new Date(),
        status: "ISSUED",
        createdById: actorId,
      },
    });
    const [acctRevenue, acctAR, acctBank, acctBadDebt] = await Promise.all([this.accountByCode("4000"), this.accountByCode("1100"), this.accountByCode("1200"), this.accountByCode("6500")]);
    if (type === "CREDIT_NOTE") {
      await this.postGL("CREDIT_NOTE", referenceNumber, creditNote.date, creditNote.id, body.reason, [
        { accountId: acctRevenue.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctAR.id, debit: 0, credit: Number(body.amount) },
      ], actorId);
      if (body.invoiceId) {
        await this.recomputeInvoiceStatus(body.invoiceId);
      } else {
        await this.prisma.creditBalance.create({ data: { clientId: body.clientId, amount: Number(body.amount), currency: body.currency ?? "BDT", source: `Credit note ${referenceNumber}` } });
      }
    } else if (type === "REFUND") {
      const bankId = body.bankAccountId ?? (await this.defaultBankAccount());
      const payment = await this.prisma.payment.create({
        data: {
          invoiceId: body.invoiceId ?? null,
          type: "REFUND",
          amount: body.amount,
          paymentMethod: body.paymentMethod ?? "BANK_TRANSFER",
          referenceId: `RFN-${referenceNumber}`,
          paymentDate: creditNote.date,
          notes: body.reason,
          recordedById: actorId,
        },
      });
      if (bankId) {
        await this.debitBankAccount(bankId, Number(body.amount));
        await this.prisma.payment.update({ where: { id: payment.id }, data: { bankAccountId: bankId, balanceCredited: true } });
      }
      await this.prisma.creditNote.update({ where: { id: creditNote.id }, data: { refundPaymentId: payment.id } });
      await this.postGL("REFUND", referenceNumber, creditNote.date, creditNote.id, body.reason, [
        { accountId: acctAR.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctBank.id, debit: 0, credit: Number(body.amount) },
      ], actorId);
      if (body.invoiceId) await this.recomputeInvoiceStatus(body.invoiceId);
    } else {
      // WRITE_OFF
      await this.postGL("WRITE_OFF", referenceNumber, creditNote.date, creditNote.id, body.reason, [
        { accountId: acctBadDebt.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctAR.id, debit: 0, credit: Number(body.amount) },
      ], actorId);
      if (body.invoiceId) await this.recomputeInvoiceStatus(body.invoiceId);
    }
    await this.logAudit("CreditNote", creditNote.id, "created", { type, amount: Number(body.amount), referenceNumber }, actorId);
    await this.invalidateFinance();
    return this.prisma.creditNote.findUnique({ where: { id: creditNote.id }, include: { client: { select: { companyName: true } }, invoice: { select: { invoiceNumber: true } } } });
  }

  // ── Financial statements (GL-derived) ────────────────────────────────
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
    let totalRevenue = 0, totalExpense = 0;
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
      }
    }
    for (const r of revenue.values()) { r.amount = Math.round(r.amount * 100) / 100; totalRevenue += r.amount; }
    for (const e of expense.values()) { e.amount = Math.round(e.amount * 100) / 100; totalExpense += e.amount; }
    const grossProfit = totalRevenue - (expense.get("DIRECT_COST") ? expense.get("DIRECT_COST")!.amount : 0);
    return {
      revenue: Array.from(revenue.values()).sort((a, b) => a.code.localeCompare(b.code)),
      expenses: Array.from(expense.values()).sort((a, b) => a.code.localeCompare(b.code)),
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpense * 100) / 100,
      grossProfit: Math.round((totalRevenue - (expense.get("DIRECT_COST")?.amount ?? 0)) * 100) / 100,
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
    const paidOf = (i: any) => i.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);

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
    const totalInvoiced = invoices.filter((i) => ACTIVE_STATUSES.includes(i.status)).reduce((s, i) => s + sumLines(i), 0);
    const totalCollected = payments.reduce((s, p) => s + Number(p.amount), 0);
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
      const collected = p.invoices.reduce((s, i) => s + i.payments.filter((x) => x.type === "IN").reduce((y, x) => y + Number(x.amount), 0), 0);
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

  private async logAudit(entityType: string, entityId: string, action: string, changes: any, actorId?: string) {
    await this.prisma.financeAuditLog.create({
      data: { entityType, entityId, action, performedById: actorId, afterValue: changes },
    });
  }

  private buildTrend(snapshots: { metricName: string; value: number; recordedAt: Date }[]) {
    const months = new Map<string, { month: string; invoiced: number; collected: number; expenses: number }>();
    for (const s of snapshots) {
      const key = `${s.recordedAt.getMonth()}/${s.recordedAt.getFullYear()}`;
      const entry = months.get(key) ?? { month: s.recordedAt.toLocaleString("en-US", { month: "short" }), invoiced: 0, collected: 0, expenses: 0 };
      if (s.metricName === "monthly_invoiced") entry.invoiced = s.value;
      if (s.metricName === "monthly_collected") entry.collected = s.value;
      if (s.metricName === "monthly_expenses") entry.expenses = s.value;
      months.set(key, entry);
    }
    return Array.from(months.values());
  }
}