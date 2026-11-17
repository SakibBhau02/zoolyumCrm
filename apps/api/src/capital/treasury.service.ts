import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";
import { ACTIVE_STATUSES, INVOICE_CREDIT_INCLUDE, invoiceTotals, logAudit, startOfTodayUtc, toBdt, utcDayNumber } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 86400000;

const PETTY_ACCOUNT = { code: "1010", name: "Petty Cash", category: "ASSET" };

/**
 * Treasury: working-capital ratios, a 13-week cash forecast and the petty-cash
 * register. Everything is derived from documents already in the ledger, so the
 * numbers always tie back to the statements.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService
  ) {}

  /** DSO / DPO / CCC over a trailing window (default 90 days). */
  async ratios(days = 90) {
    const window = Math.min(Math.max(Number(days) || 90, 30), 365);
    const to = startOfTodayUtc();
    const from = new Date(to.getTime() - window * DAY);

    const [invoices, expenses, payments, banks] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { in: ACTIVE_STATUSES as any } },
        include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE },
      }),
      this.prisma.expense.findMany({
        where: { approvalStatus: "APPROVED" },
        select: { amount: true, date: true, isPayable: true, paidAmount: true, currency: true, exchangeRate: true, dueDate: true },
      }),
      this.prisma.payment.findMany({ where: { type: { in: ["IN", "REFUND"] } }, select: { amount: true, type: true, paymentDate: true, currency: true, exchangeRate: true } }),
      this.prisma.bankAccount.findMany({ select: { currentBalance: true } }),
    ]);

    const ar = r2(invoices.reduce((s, i) => s + invoiceTotals(i).balanceBdt, 0));
    const ap = r2(
      expenses
        .filter((e) => e.isPayable)
        .reduce((s, e) => s + (Number(e.amount) - Number(e.paidAmount ?? 0)), 0)
    );
    const revenue = r2(
      invoices
        .filter((i) => i.issueDate >= from && i.issueDate <= to)
        .reduce((s, i) => s + i.lineItems.reduce((x, l) => x + toBdt(Number(l.amount), i), 0), 0)
    );
    const purchases = r2(expenses.filter((e) => e.date >= from && e.date <= to).reduce((s, e) => s + toBdt(Number(e.amount), e), 0));
    const collections = r2(
      payments
        .filter((p) => p.paymentDate >= from && p.paymentDate <= to)
        .reduce((s, p) => s + (p.type === "REFUND" ? -1 : 1) * toBdt(Number(p.amount), p), 0)
    );

    const dso = revenue > 0 ? r2((ar / revenue) * window) : null;
    const dpo = purchases > 0 ? r2((ap / purchases) * window) : null;
    const ccc = dso != null && dpo != null ? r2(dso - dpo) : null;
    return {
      windowDays: window,
      receivable: ar,
      payable: ap,
      cash: r2(banks.reduce((s, b) => s + Number(b.currentBalance), 0)),
      revenueWindow: revenue,
      purchasesWindow: purchases,
      collectionsWindow: collections,
      dso,
      dpo,
      ccc,
      workingCapital: r2(ar - ap),
    };
  }

  /** 13-week rolling cash forecast from open receivables and payables. */
  async forecast(weeks = 13) {
    const horizon = Math.min(Math.max(Number(weeks) || 13, 4), 52);
    const today = startOfTodayUtc();
    const [invoices, payables, engagements, banks] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { in: ACTIVE_STATUSES as any } },
        include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE },
      }),
      this.prisma.expense.findMany({
        where: { isPayable: true, approvalStatus: "APPROVED" },
        select: { amount: true, paidAmount: true, dueDate: true, date: true, currency: true, exchangeRate: true },
      }),
      this.prisma.vendorEngagement.findMany({
        where: { status: "ACTIVE" },
        include: { payments: true },
      }),
      this.prisma.bankAccount.findMany({ select: { currentBalance: true } }),
    ]);

    const buckets = Array.from({ length: horizon }, (_, i) => ({
      index: i,
      weekStart: new Date(today.getTime() + i * 7 * DAY),
      inflow: 0,
      outflow: 0,
    }));
    const bucketFor = (date: Date | null) => {
      if (!date) return 0;
      const diff = Math.floor((utcDayNumber(date) - utcDayNumber(today)) / 7);
      if (diff < 0) return 0; // overdue → this week
      return diff < horizon ? diff : -1;
    };

    let beyond = 0;
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      if (t.balanceBdt <= 0.01) continue;
      const idx = bucketFor(inv.dueDate ?? null);
      if (idx < 0) { beyond = r2(beyond + t.balanceBdt); continue; }
      buckets[idx].inflow = r2(buckets[idx].inflow + t.balanceBdt);
    }
    for (const e of payables) {
      const open = r2(Number(e.amount) - Number(e.paidAmount ?? 0));
      if (open <= 0.01) continue;
      const idx = bucketFor(e.dueDate ?? e.date);
      if (idx < 0) { beyond = r2(beyond - open); continue; }
      buckets[idx].outflow = r2(buckets[idx].outflow + open);
    }
    for (const eng of engagements) {
      const paid = eng.payments.reduce((s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0);
      const open = r2(Math.max(Number(eng.totalAmount) - paid, 0));
      if (open <= 0.01) continue;
      const idx = bucketFor(eng.dueDate ?? null);
      if (idx < 0) { beyond = r2(beyond - open); continue; }
      buckets[idx].outflow = r2(buckets[idx].outflow + open);
    }

    let running = r2(banks.reduce((s, b) => s + Number(b.currentBalance), 0));
    const opening = running;
    const rows = buckets.map((b) => {
      running = r2(running + b.inflow - b.outflow);
      return { week: `W${b.index + 1}`, weekStart: b.weekStart, inflow: b.inflow, outflow: b.outflow, net: r2(b.inflow - b.outflow), closing: running };
    });
    return {
      opening,
      weeks: rows,
      horizonWeeks: horizon,
      totalInflow: r2(rows.reduce((s, r) => s + r.inflow, 0)),
      totalOutflow: r2(rows.reduce((s, r) => s + r.outflow, 0)),
      closing: running,
      beyondHorizon: beyond,
    };
  }

  // ── Petty cash ────────────────────────────────────────────────────────

  async pettyCash() {
    const [entries, gl] = await Promise.all([
      this.prisma.pettyCashEntry.findMany({ orderBy: { date: "desc" }, take: 200 }),
      this.prisma.journalEntryLine.aggregate({
        where: { account: { code: PETTY_ACCOUNT.code } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    return {
      balance: r2(Number(gl._sum.debit ?? 0) - Number(gl._sum.credit ?? 0)),
      entries,
      totals: {
        in: r2(entries.filter((e) => e.direction === "IN").reduce((s, e) => s + Number(e.amount), 0)),
        out: r2(entries.filter((e) => e.direction === "OUT").reduce((s, e) => s + Number(e.amount), 0)),
      },
    };
  }

  /** Add cash to the float (from the bank) or record a spend. */
  async createPettyCash(body: any, actorId?: string) {
    const amount = r2(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("Amount must be greater than zero");
    const direction = String(body?.direction ?? "OUT").toUpperCase();
    if (!["IN", "OUT"].includes(direction)) throw new BadRequestException("direction must be IN or OUT");
    const date = body?.date ? new Date(body.date) : startOfTodayUtc();
    if (Number.isNaN(date.getTime())) throw new BadRequestException("Invalid date");
    if (!body?.description?.trim()) throw new BadRequestException("Description is required");

    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pettyCashEntry.create({
        data: {
          date,
          description: body.description.trim(),
          direction,
          amount,
          category: body.category ?? null,
          receiptUrl: body.receiptUrl ?? null,
          createdById: actorId ?? null,
        },
      });
      const acctPetty = await this.ledger.ensureAccount(PETTY_ACCOUNT.code, PETTY_ACCOUNT.name, PETTY_ACCOUNT.category, tx);
      let counterparty = await this.ledger.accountByCode("1200", tx);
      if (direction === "OUT" && body.category) {
        const def = await tx.expenseCategoryDef.findUnique({ where: { key: String(body.category) } }).catch(() => null);
        if (def?.accountId) {
          const acct = await tx.account.findUnique({ where: { id: def.accountId } });
          if (acct) counterparty = acct;
        }
      }
      const lines =
        direction === "IN"
          ? [
              { accountId: acctPetty.id, debit: amount, credit: 0, memo: created.description },
              { accountId: counterparty.id, debit: 0, credit: amount, memo: "Petty cash top-up" },
            ]
          : [
              { accountId: counterparty.id, debit: amount, credit: 0, memo: created.description },
              { accountId: acctPetty.id, debit: 0, credit: amount, memo: "Petty cash spend" },
            ];
      const journal = await this.ledger.postGL(
        "PETTY_CASH",
        `Petty cash ${direction}`,
        date,
        created.id,
        created.description,
        lines,
        actorId,
        tx
      );
      await tx.pettyCashEntry.update({ where: { id: created.id }, data: { journalId: journal?.id ?? null } });
      if (direction === "IN") {
        const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
        if (bankId) await this.ledger.debitBankAccount(bankId, amount, tx);
      }
      await logAudit(tx, "PettyCashEntry", created.id, direction === "IN" ? "topped_up" : "spent", { amount }, actorId);
      return created;
    }, { timeout: 15000 });
    return entry;
  }

  async deletePettyCash(id: string, actorId?: string) {
    const entry = await this.prisma.pettyCashEntry.findUnique({ where: { id } });
    if (!entry) throw new BadRequestException("Petty cash entry not found");
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseGL(id, actorId, tx, ["PETTY_CASH"]);
      if (entry.direction === "IN") {
        const bankId = await this.ledger.defaultBankAccount(tx);
        if (bankId) await this.ledger.creditBankAccount(bankId, Number(entry.amount), tx);
      }
      await tx.pettyCashEntry.delete({ where: { id } });
      await logAudit(tx, "PettyCashEntry", id, "deleted", { amount: Number(entry.amount) }, actorId);
    }, { timeout: 15000 });
    return { ok: true };
  }
}
