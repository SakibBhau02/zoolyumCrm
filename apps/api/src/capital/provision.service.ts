import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";
import { ACTIVE_STATUSES, INVOICE_CREDIT_INCLUDE, invoiceTotals, logAudit, startOfTodayUtc, utcDayNumber } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Default provision rates per ageing bucket (%). */
const DEFAULT_RATES: Record<string, number> = {
  CURRENT: 1,
  "1-30": 5,
  "31-60": 10,
  "61-90": 25,
  "90+": 50,
};

const ALLOWANCE = { code: "1515", name: "Allowance for Doubtful Debts", category: "ASSET" };
const EXPENSE = { code: "6510", name: "Bad Debt Provision", category: "OPEX" };

/**
 * Bad-debt provision from AR ageing.
 *
 * Provisioning is a balance-sheet adjustment, not a write-off: the receivable
 * stays, an allowance is raised against it. Each run compares the *required*
 * allowance with what is already booked and posts only the difference, so it is
 * safe to run every month.
 */
@Injectable()
export class ProvisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService
  ) {}

  private async agingRows(asOf: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ACTIVE_STATUSES as any } },
      include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE },
    });
    const buckets = new Map<string, number>();
    let total = 0;
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      if (t.balanceBdt <= 0.01) continue;
      const days = inv.dueDate ? Math.max(0, utcDayNumber(asOf) - utcDayNumber(inv.dueDate)) : 0;
      const key = !inv.dueDate || days <= 0 ? "CURRENT" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      buckets.set(key, r2((buckets.get(key) ?? 0) + t.balanceBdt));
      total = r2(total + t.balanceBdt);
    }
    return { buckets, total };
  }

  private async bookedAllowance() {
    const agg = await this.prisma.journalEntryLine.aggregate({
      where: { account: { code: ALLOWANCE.code } },
      _sum: { debit: true, credit: true },
    });
    // Contra-asset: credit balance is the allowance.
    return r2(Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0));
  }

  async preview(asOfStr?: string, rateOverrides?: Record<string, number>) {
    const asOf = asOfStr ? new Date(asOfStr) : startOfTodayUtc();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException("Invalid as-of date");
    const { buckets, total } = await this.agingRows(asOf);
    const rates = { ...DEFAULT_RATES, ...(rateOverrides ?? {}) };
    const rows = Object.keys(DEFAULT_RATES).map((bucket) => {
      const amount = r2(buckets.get(bucket) ?? 0);
      const rate = Number(rates[bucket] ?? 0);
      return { bucket, amount, rate, provision: r2((amount * rate) / 100) };
    });
    const required = r2(rows.reduce((s, r) => s + r.provision, 0));
    const booked = await this.bookedAllowance();
    return {
      asOf,
      rows,
      totalReceivable: total,
      requiredAllowance: required,
      bookedAllowance: booked,
      adjustment: r2(required - booked),
    };
  }

  async post(asOfStr: string | undefined, rateOverrides: Record<string, number> | undefined, actorId?: string) {
    const preview = await this.preview(asOfStr, rateOverrides);
    const adjustment = preview.adjustment;
    if (Math.abs(adjustment) < 0.01) {
      return { posted: false, ...preview, message: "Allowance already matches the ageing" };
    }
    const [acctAllowance, acctExpense] = await Promise.all([
      this.ledger.ensureAccount(ALLOWANCE.code, ALLOWANCE.name, ALLOWANCE.category),
      this.ledger.ensureAccount(EXPENSE.code, EXPENSE.name, EXPENSE.category),
    ]);
    const lines =
      adjustment > 0
        ? [
            { accountId: acctExpense.id, debit: adjustment, credit: 0, memo: "Increase provision" },
            { accountId: acctAllowance.id, debit: 0, credit: adjustment, memo: "Allowance for doubtful debts" },
          ]
        : [
            { accountId: acctAllowance.id, debit: Math.abs(adjustment), credit: 0, memo: "Release provision" },
            { accountId: acctExpense.id, debit: 0, credit: Math.abs(adjustment), memo: "Release provision" },
          ];
    const run = await this.prisma.provisionRun.create({
      data: {
        asOfDate: preview.asOf,
        basis: "AGING",
        rate: 0,
        amount: adjustment,
        createdById: actorId ?? null,
      },
    });
    const entry = await this.ledger.postGL(
      "BAD_DEBT_PROVISION",
      `Provision ${preview.asOf.toISOString().slice(0, 10)}`,
      preview.asOf,
      run.id,
      "AR ageing provision",
      lines,
      actorId
    );
    await this.prisma.provisionRun.update({ where: { id: run.id }, data: { journalId: entry?.id ?? null } });
    await logAudit(this.prisma as any, "ProvisionRun", run.id, "posted", { adjustment }, actorId);
    return { posted: true, ...preview, adjustment };
  }

  async history() {
    return this.prisma.provisionRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }
}
