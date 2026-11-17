import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { logAudit } from "./finance-kernel";

/**
 * Fiscal periods and the period-close control.
 *
 * Without a lock, editing a January invoice in November silently rewrites the
 * January P&L, the VAT return and every balance sheet ever printed. A CLOSED
 * period blocks new postings; LOCKED additionally blocks reopening without an
 * explicit unlock by an owner.
 */
@Injectable()
export class PeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(year?: string) {
    const y = Number(year);
    const where = Number.isFinite(y) && y > 1900
      ? { startDate: { gte: new Date(Date.UTC(y, 0, 1)) }, endDate: { lte: new Date(Date.UTC(y, 11, 31)) } }
      : {};
    const periods = await this.prisma.fiscalPeriod.findMany({
      where,
      orderBy: { startDate: "desc" },
    });
    return periods.map((p) => ({
      ...p,
      isCurrent: p.startDate <= new Date() && p.endDate >= new Date(),
    }));
  }

  /** Create the 12 monthly periods of a calendar year (idempotent). */
  async generateYear(year: number) {
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      throw new BadRequestException("year must be between 2000 and 2100");
    }
    const existing = await this.prisma.fiscalPeriod.count({
      where: { startDate: { gte: new Date(Date.UTC(year, 0, 1)) }, endDate: { lte: new Date(Date.UTC(year, 11, 31)) } },
    });
    if (existing >= 12) return { created: 0, year };
    const rows: { name: string; periodType: any; startDate: Date; endDate: Date }[] = [];
    for (let m = 0; m < 12; m++) {
      const start = new Date(Date.UTC(year, m, 1));
      const end = new Date(Date.UTC(year, m + 1, 0));
      rows.push({
        name: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
        periodType: "MONTH",
        startDate: start,
        endDate: end,
      });
    }
    let created = 0;
    for (const row of rows) {
      const clash = await this.prisma.fiscalPeriod.findFirst({ where: { startDate: row.startDate, endDate: row.endDate } });
      if (clash) continue;
      await this.prisma.fiscalPeriod.create({ data: row });
      created += 1;
    }
    return { created, year };
  }

  async create(body: any) {
    const startDate = body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate ? new Date(body.endDate) : null;
    if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException("startDate and endDate are required");
    }
    if (startDate > endDate) throw new BadRequestException("startDate must be before endDate");
    if (!body.name?.trim()) throw new BadRequestException("name is required");
    const clash = await this.prisma.fiscalPeriod.findFirst({
      where: { OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }] },
    });
    if (clash) {
      throw new ConflictException(`This range overlaps "${clash.name}" (${clash.startDate.toISOString().slice(0, 10)} → ${clash.endDate.toISOString().slice(0, 10)})`);
    }
    return this.prisma.fiscalPeriod.create({
      data: {
        name: body.name.trim(),
        periodType: body.periodType ?? "MONTH",
        startDate,
        endDate,
        notes: body.notes ?? null,
      },
    });
  }

  async close(id: string, actorId?: string) {
    const period = await this.get(id);
    if (period.status === "LOCKED") throw new BadRequestException("A locked period cannot be closed — unlock it first.");
    if (period.status === "CLOSED") return period;
    // Closing must not freeze unposted work: the caller gets the checklist first
    // and has to clear it (or acknowledge) before the books are sealed.
    const checklist = await this.closeChecklist(id);
    const blockers = checklist.items.filter((i) => i.severity === "blocker" && i.count > 0);
    if (blockers.length) {
      throw new BadRequestException(
        `Cannot close ${period.name}: ${blockers.map((b) => b.label).join("; ")}`
      );
    }
    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), closedById: actorId ?? null },
    });
    await logAudit(this.prisma as any, "FiscalPeriod", id, "closed", { name: period.name }, actorId);
    return updated;
  }

  async reopen(id: string, actorId?: string) {
    const period = await this.get(id);
    if (period.status === "OPEN") return period;
    if (period.status === "LOCKED") throw new BadRequestException("A locked period cannot be reopened — unlock it first.");
    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    await logAudit(this.prisma as any, "FiscalPeriod", id, "reopened", { name: period.name }, actorId);
    return updated;
  }

  async lock(id: string, actorId?: string) {
    const period = await this.get(id);
    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: {
        status: "LOCKED",
        lockedAt: new Date(),
        lockedById: actorId ?? null,
        closedAt: period.closedAt ?? new Date(),
        closedById: period.closedById ?? actorId ?? null,
      },
    });
    await logAudit(this.prisma as any, "FiscalPeriod", id, "locked", { name: period.name }, actorId);
    return updated;
  }

  async unlock(id: string, actorId?: string) {
    const period = await this.get(id);
    if (period.status !== "LOCKED") return period;
    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: "CLOSED", lockedAt: null, lockedById: null },
    });
    await logAudit(this.prisma as any, "FiscalPeriod", id, "unlocked", { name: period.name }, actorId);
    return updated;
  }

  /**
   * What still has to be dealt with before this period can be sealed.
   * `blocker` stops the close; `warning` is advisory.
   */
  async closeChecklist(id: string) {
    const period = await this.get(id);
    const range = { gte: period.startDate, lte: period.endDate };
    const [draftInvoices, pendingExpenses, unpostedPayroll, unmatchedBanks, draftJournals] = await Promise.all([
      this.prisma.invoice.count({ where: { status: "DRAFT", issueDate: range } }),
      this.prisma.expense.count({ where: { approvalStatus: "PENDING", date: range } }),
      this.prisma.payrollRecord.count({ where: { status: { not: "PAID" }, createdAt: range } }),
      this.prisma.bankStatementLine.count({ where: { status: "UNMATCHED", statementDate: range } }),
      this.prisma.manualJournal.count({ where: { status: "DRAFT", entryDate: range } }),
    ]);
    const items = [
      { key: "draftInvoices", label: `${draftInvoices} draft invoice(s) not issued`, count: draftInvoices, severity: "warning" },
      { key: "pendingExpenses", label: `${pendingExpenses} expense(s) awaiting approval`, count: pendingExpenses, severity: "blocker" },
      { key: "unpostedPayroll", label: `${unpostedPayroll} payroll record(s) not finalized`, count: unpostedPayroll, severity: "warning" },
      { key: "unmatchedBanks", label: `${unmatchedBanks} bank statement line(s) unmatched`, count: unmatchedBanks, severity: "warning" },
      { key: "draftJournals", label: `${draftJournals} manual journal(s) still in draft`, count: draftJournals, severity: "warning" },
    ];
    return {
      period,
      items,
      canClose: items.every((i) => i.severity !== "blocker" || i.count === 0),
    };
  }

  async get(id: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException("Fiscal period not found");
    return period;
  }

  /** Period covering a date, or null when the calendar has not been generated. */
  async forDate(date: Date) {
    return this.prisma.fiscalPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      orderBy: { startDate: "desc" },
    });
  }

  /**
   * Throws when the date falls inside a CLOSED or LOCKED period. Dates with no
   * period row are treated as OPEN so a fresh install keeps working until the
   * calendar is generated.
   */
  async assertPostable(date: Date, db: any = this.prisma) {
    const period = await db.fiscalPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      select: { name: true, status: true },
    });
    if (!period) return;
    if (period.status === "LOCKED") {
      throw new BadRequestException(
        `${period.name} is locked. Post to an open period, or ask an owner to unlock it.`
      );
    }
    if (period.status === "CLOSED") {
      throw new BadRequestException(
        `${period.name} is closed. Reopen it before posting a transaction dated ${date.toISOString().slice(0, 10)}.`
      );
    }
  }
}
