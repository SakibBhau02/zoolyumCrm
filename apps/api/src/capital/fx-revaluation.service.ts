import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";
import { ACTIVE_STATUSES, INVOICE_CREDIT_INCLUDE, invoiceTotals, logAudit } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const GAIN = { code: "4460", name: "Unrealized FX Gain", category: "REVENUE" };
const LOSS = { code: "6660", name: "Unrealized FX Loss", category: "OPEX" };

/**
 * Period-end revaluation of open foreign-currency receivables.
 *
 * An invoice is booked once at its issue-date rate. Until it is settled its BDT
 * value moves with the rate, and a balance sheet that ignores that is wrong.
 * Revaluation restates the receivable and books the difference as unrealized
 * FX gain/loss — one entry per currency per as-of date, re-runnable.
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService
  ) {}

  private parseRates(raw: any): Record<string, number> {
    if (!raw || typeof raw !== "object") throw new BadRequestException("rates is required, e.g. { \"USD\": 122.5 }");
    const out: Record<string, number> = {};
    for (const [code, value] of Object.entries(raw)) {
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException(`Invalid rate for ${code}`);
      out[String(code).toUpperCase()] = rate;
    }
    if (!Object.keys(out).length) throw new BadRequestException("At least one currency rate is required");
    return out;
  }

  private async compute(asOf: Date, rates: Record<string, number>) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        currency: { not: "BDT" },
        status: { in: ACTIVE_STATUSES as any },
      },
      include: { lineItems: true, payments: true, ...INVOICE_CREDIT_INCLUDE },
    });
    const byCurrency = new Map<string, { currency: string; bookValue: number; revalued: number; invoices: number }>();
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      if (t.balance <= 0.01) continue;
      const rate = rates[String(inv.currency).toUpperCase()];
      if (!rate) continue;
      const bookRate = Number(inv.exchangeRate ?? 1) || 1;
      const entry = byCurrency.get(inv.currency) ?? { currency: inv.currency, bookValue: 0, revalued: 0, invoices: 0 };
      const balance = Number(inv.payments.reduce((s: number, p: any) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)), 0));
      // Revalue only the unsettled portion, at document currency.
      const openForeign = Math.max(t.balance - 0, 0);
      entry.bookValue += openForeign * bookRate;
      entry.revalued += openForeign * rate;
      entry.invoices += 1;
      byCurrency.set(inv.currency, entry);
      void balance;
    }
    return Array.from(byCurrency.values()).map((row) => {
      const delta = r2(row.revalued - row.bookValue);
      return {
        currency: row.currency,
        invoices: row.invoices,
        bookValue: r2(row.bookValue),
        revaluedValue: r2(row.revalued),
        delta,
        gain: delta > 0 ? delta : 0,
        loss: delta < 0 ? Math.abs(delta) : 0,
      };
    });
  }

  async preview(asOfStr: string | undefined, ratesRaw: any) {
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException("Invalid asOf date");
    const rates = this.parseRates(ratesRaw);
    const rows = await this.compute(asOf, rates);
    return {
      asOf: new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())),
      rates,
      rows,
      gain: r2(rows.reduce((s, r) => s + r.gain, 0)),
      loss: r2(rows.reduce((s, r) => s + r.loss, 0)),
    };
  }

  async post(asOfStr: string | undefined, ratesRaw: any, actorId?: string) {
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException("Invalid asOf date");
    const asOfDate = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
    const rates = this.parseRates(ratesRaw);
    const rows = await this.compute(asOfDate, rates);
    if (!rows.length) return { posted: 0, message: "No open foreign-currency receivables to revalue", rows };

    const [acctAR, acctGain, acctLoss] = await Promise.all([
      this.ledger.accountByCode("1100"),
      this.ledger.ensureAccount(GAIN.code, GAIN.name, GAIN.category),
      this.ledger.ensureAccount(LOSS.code, LOSS.name, LOSS.category),
    ]);

    const posted: any[] = [];
    for (const row of rows) {
      const existing = await this.prisma.fxRevaluation.findFirst({ where: { asOfDate, currency: row.currency } });
      if (existing) {
        // Re-running the same date replaces the previous estimate — including
        // when the new delta is zero, which unwinds an earlier revaluation.
        const live = await this.prisma.journalEntry.findFirst({
          where: { sourceId: existing.id, entryType: "FX_REVALUATION", reversedEntryId: null },
        });
        if (live) await this.ledger.reverseJournalEntry(live.id, actorId);
        await this.prisma.fxRevaluation.delete({ where: { id: existing.id } }).catch(() => null);
      }
      if (Math.abs(row.delta) < 0.01) continue;
      const record = await this.prisma.fxRevaluation.create({
        data: {
          asOfDate,
          currency: row.currency,
          rate: rates[row.currency.toUpperCase()],
          gain: row.gain,
          loss: row.loss,
          invoiceCount: row.invoices,
          createdById: actorId ?? null,
        },
      });
      const lines =
        row.delta > 0
          ? [
              { accountId: acctAR.id, debit: row.delta, credit: 0, memo: `Revalue ${row.currency} receivable` },
              { accountId: acctGain.id, debit: 0, credit: row.delta, memo: "Unrealized FX gain" },
            ]
          : [
              { accountId: acctLoss.id, debit: Math.abs(row.delta), credit: 0, memo: "Unrealized FX loss" },
              { accountId: acctAR.id, debit: 0, credit: Math.abs(row.delta), memo: `Revalue ${row.currency} receivable` },
            ];
      const entry = await this.ledger.postGL(
        "FX_REVALUATION",
        `FX revaluation ${row.currency} @ ${asOfDate.toISOString().slice(0, 10)}`,
        asOfDate,
        record.id,
        `Unrealized FX on ${row.invoices} open ${row.currency} invoice(s)`,
        lines,
        actorId
      );
      await this.prisma.fxRevaluation.update({ where: { id: record.id }, data: { journalId: entry?.id ?? null } });
      await logAudit(this.prisma as any, "FxRevaluation", record.id, "posted", { currency: row.currency, delta: row.delta }, actorId);
      posted.push({ currency: row.currency, delta: row.delta });
    }
    return { posted: posted.length, rows: posted, gain: r2(rows.reduce((s, r) => s + r.gain, 0)), loss: r2(rows.reduce((s, r) => s + r.loss, 0)) };
  }

  async history() {
    return this.prisma.fxRevaluation.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }
}
