import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";
import { ACTIVE_STATUSES, INVOICE_CREDIT_INCLUDE, invoiceTotals, logAudit, toBdt } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Revenue recognition over time.
 *
 * An annual retainer billed in advance is not one month's revenue. Creating a
 * schedule reclasses the billed amount out of revenue into Deferred Revenue
 * (2500); each period then recognises one slice. Voiding the invoice reverses
 * everything still outstanding.
 */
@Injectable()
export class RevenueRecognitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService
  ) {}

  async list(status?: string) {
    const schedules = await this.prisma.deferredRevenue.findMany({
      where: status ? { status } : {},
      include: {
        runs: { orderBy: { period: "asc" } },
      },
      orderBy: { startDate: "desc" },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: schedules.map((s) => s.invoiceId) } },
      select: { id: true, invoiceNumber: true, client: { select: { companyName: true } } },
    });
    const byId = new Map(invoices.map((i) => [i.id, i]));
    return schedules.map((s) => ({
      ...s,
      invoiceNumber: byId.get(s.invoiceId)?.invoiceNumber ?? null,
      clientName: byId.get(s.invoiceId)?.client?.companyName ?? null,
      remaining: r2(Number(s.totalAmount) - Number(s.recognizedAmount)),
    }));
  }

  async get(id: string) {
    const schedule = await this.prisma.deferredRevenue.findUnique({
      where: { id },
      include: { runs: { orderBy: { period: "asc" } } },
    });
    if (!schedule) throw new NotFoundException("Revenue schedule not found");
    return schedule;
  }

  /**
   * Create the schedule for an issued invoice. `periods` months starting
   * `startDate` (defaults to the invoice issue date).
   */
  async create(body: any, actorId?: string) {
    const invoiceId = String(body?.invoiceId ?? "");
    if (!invoiceId) throw new BadRequestException("invoiceId is required");
    const periods = Number(body?.periods ?? 12);
    if (!Number.isInteger(periods) || periods < 2 || periods > 60) {
      throw new BadRequestException("periods must be between 2 and 60");
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (!ACTIVE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException("Issue the invoice before scheduling its revenue.");
    }
    const existing = await this.prisma.deferredRevenue.findUnique({ where: { invoiceId } });
    if (existing) throw new ConflictException("This invoice already has a revenue schedule");

    const total = r2(invoiceTotals(invoice).grandBdt);
    if (total <= 0) throw new BadRequestException("Nothing to defer on this invoice");
    const startDate = body?.startDate ? new Date(body.startDate) : new Date(invoice.issueDate);
    if (Number.isNaN(startDate.getTime())) throw new BadRequestException("Invalid start date");
    const monthly = r2(total / periods);

    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deferredRevenue.create({
        data: { invoiceId, totalAmount: total, startDate, periods, monthlyAmount: monthly, createdById: actorId ?? null },
      });
      const [acctRevenue, acctDeferred] = await Promise.all([
        this.ledger.accountByCode("4000", tx),
        this.ledger.ensureAccount("2500", "Deferred Revenue", "LIABILITY", tx),
      ]);
      await this.ledger.postGL(
        "DEFERRAL",
        `Revenue deferred ${invoice.invoiceNumber}`,
        invoice.issueDate,
        created.id,
        `${periods} months from ${startDate.toISOString().slice(0, 10)}`,
        [
          { accountId: acctRevenue.id, debit: total, credit: 0, memo: "Move billed revenue to deferred" },
          { accountId: acctDeferred.id, debit: 0, credit: total, memo: invoice.invoiceNumber },
        ],
        actorId,
        tx
      );
      await tx.invoice.update({ where: { id: invoiceId }, data: { deferRevenue: true, deferPeriods: periods } });
      await logAudit(tx, "DeferredRevenue", created.id, "created", { invoiceId, periods, total }, actorId);
      return created;
    }, { timeout: 15000 });

    return this.get(schedule.id);
  }

  /** Recognise one month for every active schedule. Idempotent per period. */
  async runRecognition(period: string, actorId?: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) throw new BadRequestException("period must be YYYY-MM");
    const schedules = await this.prisma.deferredRevenue.findMany({ where: { status: "ACTIVE" } });
    const [acctRevenue, acctDeferred] = await Promise.all([
      this.ledger.accountByCode("4000"),
      this.ledger.ensureAccount("2500", "Deferred Revenue", "LIABILITY"),
    ]);
    const [year, month] = period.split("-").map(Number);
    const entryDate = new Date(Date.UTC(year, month - 1, 1));

    const posted: { scheduleId: string; amount: number }[] = [];
    const skipped: { scheduleId: string; reason: string }[] = [];
    for (const schedule of schedules) {
      const done = await this.prisma.deferredRevenueRun.findUnique({
        where: { scheduleId_period: { scheduleId: schedule.id, period } },
      });
      if (done) {
        skipped.push({ scheduleId: schedule.id, reason: "already recognised" });
        continue;
      }
      const startMonth = new Date(Date.UTC(schedule.startDate.getUTCFullYear(), schedule.startDate.getUTCMonth(), 1));
      if (startMonth > entryDate) {
        skipped.push({ scheduleId: schedule.id, reason: "starts later" });
        continue;
      }
      const remaining = r2(Number(schedule.totalAmount) - Number(schedule.recognizedAmount));
      if (remaining <= 0.01) {
        await this.prisma.deferredRevenue.update({ where: { id: schedule.id }, data: { status: "COMPLETED" } });
        skipped.push({ scheduleId: schedule.id, reason: "fully recognised" });
        continue;
      }
      const amount = Math.min(r2(Number(schedule.monthlyAmount)), remaining);
      await this.prisma.$transaction(async (tx) => {
        const entry = await this.ledger.postGL(
          "REVENUE_RECOGNITION",
          `Recognise ${period}`,
          entryDate,
          schedule.id,
          `Monthly revenue recognition ${period}`,
          [
            { accountId: acctDeferred.id, debit: amount, credit: 0 },
            { accountId: acctRevenue.id, debit: 0, credit: amount },
          ],
          actorId,
          tx
        );
        const run = await tx.deferredRevenueRun.create({
          data: { scheduleId: schedule.id, period, amount, journalId: entry?.id ?? null },
        });
        const nextTotal = r2(Number(schedule.recognizedAmount) + amount);
        await tx.deferredRevenue.update({
          where: { id: schedule.id },
          data: {
            recognizedAmount: nextTotal,
            status: nextTotal >= Number(schedule.totalAmount) - 0.01 ? "COMPLETED" : "ACTIVE",
          },
        });
        await logAudit(tx, "DeferredRevenueRun", run.id, "recognized", { period, amount }, actorId);
      }, { timeout: 15000 });
      posted.push({ scheduleId: schedule.id, amount });
    }
    return { period, posted, skipped, total: r2(posted.reduce((s, p) => s + p.amount, 0)) };
  }

  /** Cancel the schedule and reverse whatever is still deferred. */
  async cancel(id: string, actorId?: string) {
    const schedule = await this.get(id);
    if (schedule.status === "CANCELLED") return schedule;
    const remaining = r2(Number(schedule.totalAmount) - Number(schedule.recognizedAmount));
    await this.prisma.$transaction(async (tx) => {
      if (remaining > 0.01) {
        const [acctRevenue, acctDeferred] = await Promise.all([
          this.ledger.accountByCode("4000", tx),
          this.ledger.ensureAccount("2500", "Deferred Revenue", "LIABILITY", tx),
        ]);
        await this.ledger.postGL(
          "DEFERRAL_CANCEL",
          `Cancel deferral ${schedule.invoiceId}`,
          new Date(),
          schedule.id,
          "Remaining deferred revenue released",
          [
            { accountId: acctDeferred.id, debit: remaining, credit: 0 },
            { accountId: acctRevenue.id, debit: 0, credit: remaining },
          ],
          actorId,
          tx
        );
      }
      await tx.deferredRevenue.update({ where: { id }, data: { status: "CANCELLED", recognizedAmount: Number(schedule.totalAmount) } });
      await tx.invoice.update({ where: { id: schedule.invoiceId }, data: { deferRevenue: false } }).catch(() => null);
      await logAudit(tx, "DeferredRevenue", id, "cancelled", { remaining }, actorId);
    }, { timeout: 15000 });
    return this.get(id);
  }
}
