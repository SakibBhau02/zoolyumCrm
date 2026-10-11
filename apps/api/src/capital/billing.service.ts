import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LedgerService } from "./ledger.service";
import { InvoiceService } from "./invoice.service";
import { ExpenseService } from "./expense.service";
import { WhatsappTriggersService } from "../whatsapp/whatsapp-triggers.service";
import { buildTrend, invalidateFinance, invoiceTotals, logAudit, POSTABLE_STATUSES } from "./finance-kernel";

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly invoiceService: InvoiceService,
    private readonly expenseService: ExpenseService,
    private readonly wa: WhatsappTriggersService
  ) {}


  @Cron("0 2 * * *")
  async handleRecurring() {
    await this.runRecurringBilling();
  }


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
      const invoiceNumber = await this.ledger.nextInvoiceNumber();
      const recInv = await this.prisma.invoice.create({
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
      await this.invoiceService.syncProjectBilling(p.id);
      void this.wa.notifyInvoiceSent(recInv.id).catch(() => {});
      created++;
    }
    created += await this.runClientRetainerBilling();
    const reminders = await this.runInstallmentReminders();
    if (created > 0 || reminders > 0) await invalidateFinance(this.cache);
    return { created, reminders };
  }

  // ── Installment watch ──────────────────────────────────────────────
  /** Unpaid installments due within 7 days or already overdue (open invoices only). */


  async installmentsDue() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 7);
    const rows = await this.prisma.installment.findMany({
      where: {
        status: { not: "PAID" },
        dueDate: { lte: horizon },
        invoice: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as any } },
      },
      include: {
        invoice: {
          select: {
            id: true, invoiceNumber: true, status: true, currency: true,
            client: { select: { companyName: true } },
          },
        },
      },
      orderBy: { dueDate: "asc" },
    });
    return rows.map((s) => {
      const due = new Date(s.dueDate);
      due.setHours(0, 0, 0, 0);
      const balance = Math.round((Number(s.amount) - Number(s.paidAmount)) * 100) / 100;
      return {
        id: s.id,
        sequence: s.sequence,
        amount: Number(s.amount),
        paidAmount: Number(s.paidAmount),
        balance,
        dueDate: s.dueDate,
        status: s.status,
        overdue: due < now && balance > 0,
        invoiceId: s.invoiceId,
        invoiceNumber: s.invoice.invoiceNumber,
        invoiceStatus: s.invoice.status,
        currency: s.invoice.currency,
        clientName: s.invoice.client.companyName,
      };
    }).filter((s) => s.balance > 0);
  }

  /**
   * Daily installment nudges (called by the 2am cron + manual run):
   * approaching (due within 3 days) and overdue installments each get at most
   * one auto reminder per 7 days, tracked via `[inst:<id>]` in reminder notes.
   */


  private async runInstallmentReminders() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 3);
    const rows = await this.prisma.installment.findMany({
      where: {
        status: { not: "PAID" },
        OR: [{ dueDate: { lt: now } }, { dueDate: { gte: now, lte: horizon } }],
        invoice: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as any } },
      },
      include: {
        invoice: {
          select: {
            id: true, invoiceNumber: true,
            client: { select: { companyName: true, contacts: { select: { name: true, email: true }, take: 1 } } },
          },
        },
      },
    });
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    let count = 0;
    for (const s of rows) {
      const balance = Number(s.amount) - Number(s.paidAmount);
      if (balance <= 0) continue;
      const due = new Date(s.dueDate);
      due.setHours(0, 0, 0, 0);
      const overdue = due < now;
      const marker = `[inst:${s.id}]`;
      const recent = await this.prisma.invoiceReminder.findFirst({
        where: { invoiceId: s.invoiceId, notes: { contains: marker }, sentAt: { gte: weekAgo } },
        select: { id: true },
      });
      if (recent) continue;
      const dueStr = due.toISOString().slice(0, 10);
      const contact = s.invoice.client.contacts[0];
      await this.prisma.invoiceReminder.create({
        data: {
          invoiceId: s.invoiceId,
          type: overdue ? "overdue_1" : "approaching",
          channel: "system",
          recipientEmail: contact?.email ?? undefined,
          recipientName: contact?.name ?? s.invoice.client.companyName,
          subject: overdue
            ? `Installment #${s.sequence} overdue — ${s.invoice.invoiceNumber}`
            : `Installment #${s.sequence} due soon — ${s.invoice.invoiceNumber}`,
          notes: `${marker} Auto: installment #${s.sequence} of ${s.invoice.invoiceNumber} — ৳${balance.toLocaleString()} ${overdue ? `overdue since ${dueStr}` : `due ${dueStr}`}.`,
        },
      });
      try {
        await this.notifications.notifyRole(
          "Finance",
          "INSTALLMENT_DUE",
          overdue ? `Installment overdue — ${s.invoice.invoiceNumber} #${s.sequence}` : `Installment due soon — ${s.invoice.invoiceNumber} #${s.sequence}`,
          `${s.invoice.client.companyName}: ৳${balance.toLocaleString()} ${overdue ? `overdue since ${dueStr}` : `due ${dueStr}`}.`,
          `/capital/invoices?inv=${s.invoiceId}`
        );
      } catch {}
      count++;
    }
    return count;
  }

  /**
   * Client-level retainer auto-billing (mirrors Finance_System logic):
   * - MONTHLY: once the billing day of the current month is reached, one
   *   invoice per YYYY-MM cycle.
   * - BIWEEKLY / WEEKLY: whenever nextRetainerDate is reached, then advance
   *   by 14 / 7 days. Cycle id is the issue date (YYYY-MM-DD).
   * Duplicate cycles are guarded by lastAutoInvoiceCycle plus a
   * `[Retainer: <cycle>]` tag in notes (legacy monthly tags still match).
   */


  private async runClientRetainerBilling() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentDay = now.getDate();
    const monthCycle = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const clients = await this.prisma.client.findMany({
      where: { billingCycleType: "MONTHLY_RETAINER", autoGenerateInvoice: true },
      include: { contacts: { select: { email: true }, take: 1 } },
    });
    let created = 0;
    for (const c of clients) {
      const amount = Number(c.monthlyAmount ?? 0);
      if (amount <= 0) continue;
      const interval = (c.retainerInterval ?? "MONTHLY").toUpperCase();
      const periodDays = interval === "WEEKLY" ? 7 : interval === "BIWEEKLY" ? 14 : 0;

      let issueDate: Date;
      let cycleId: string;
      let periodLabel: string;
      if (periodDays > 0) {
        const next = c.nextRetainerDate ? new Date(c.nextRetainerDate) : todayStart;
        next.setHours(0, 0, 0, 0);
        if (next > todayStart) continue;
        issueDate = new Date(next);
        cycleId = issueDate.toISOString().slice(0, 10);
        periodLabel = interval === "WEEKLY" ? "Weekly" : "Biweekly";
      } else {
        const billingDay = Math.min(Math.max(c.billingDayOfMonth ?? 1, 1), 28);
        if (currentDay < billingDay) continue;
        if (c.lastAutoInvoiceCycle === monthCycle) continue;
        issueDate = new Date(now.getFullYear(), now.getMonth(), billingDay);
        cycleId = monthCycle;
        periodLabel = "Monthly";
      }
      if (c.lastAutoInvoiceCycle === cycleId) continue;
      const tagged = await this.prisma.invoice.findFirst({
        where: {
          clientId: c.id,
          OR: [{ notes: { contains: `[Retainer: ${cycleId}]` } }, { notes: { contains: `[Monthly Retainer: ${cycleId}]` } }],
        },
        select: { id: true },
      });
      if (tagged) {
        const patch: any = { lastAutoInvoiceCycle: cycleId };
        if (periodDays > 0) patch.nextRetainerDate = this.addDays(issueDate, periodDays);
        await this.prisma.client.update({ where: { id: c.id }, data: patch });
        continue;
      }
      const monthName = issueDate.toLocaleString("en-US", { month: "long", year: "numeric" });
      const due = new Date(issueDate);
      due.setDate(due.getDate() + (c.paymentDueDays ?? 15));
      const description = c.monthlyServiceDescription?.trim()
        ? `${c.monthlyServiceDescription.trim()} (${monthName})`
        : `${periodLabel} Retainer Service - ${monthName}`;
      const invoiceNumber = await this.ledger.nextInvoiceNumber();
      const invoice = await this.prisma.invoice.create({
        data: {
          invoiceNumber,
          clientId: c.id,
          invoiceType: "RECURRING",
          currency: c.currencyPreference ?? "BDT",
          exchangeRate: 1,
          issueDate,
          dueDate: due,
          status: "SENT",
          notes: `${periodLabel} Retainer Bill for ${monthName}. [Retainer: ${cycleId}]`,
          lineItems: {
            create: [{ description, quantity: 1, unitPrice: amount, amount, revenueTag: "AGENCY_REVENUE" }],
          },
        },
        include: { client: { select: { id: true, companyName: true } }, lineItems: true },
      });
      const patch: any = { lastAutoInvoiceCycle: cycleId };
      if (periodDays > 0) patch.nextRetainerDate = this.addDays(issueDate, periodDays);
      await this.prisma.client.update({ where: { id: c.id }, data: patch });
      if (POSTABLE_STATUSES.includes(invoice.status)) await this.ledger.postInvoiceGL(invoice);
      try {
        await this.notifications.notifyRole(
          "Finance",
          "INVOICE_CREATED",
          "Retainer invoice auto-generated",
          `${periodLabel} retainer ${invoice.invoiceNumber} for ${invoice.client.companyName} (${monthName}) has been created.`,
          "/capital/invoices"
        );
      } catch {}
      await logAudit(this.prisma, "Invoice", invoice.id, "retainer_auto_created", { invoiceNumber, cycle: cycleId });
      created++;
    }
    return created;
  }

  private addDays(from: Date, days: number) {
    const d = new Date(from);
    d.setDate(d.getDate() + days);
    return d;
  }

  private advanceBillingDate(from: Date, interval: string | null): Date {
    const d = new Date(from);
    const s = (interval ?? '30-days').toLowerCase();
    const days = s.includes('monthly') || s.includes('30') ? 30 : s.includes('90') ? 90 : s.includes('60') ? 60 : s.includes('15') ? 15 : s.includes('7') ? 7 : 30;
    d.setDate(d.getDate() + days);
    return d;
  }
}
