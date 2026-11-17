import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";import { PrismaService } from "../prisma/prisma.service";
import { POSTABLE_STATUSES, invoiceTotals, toBdt } from "./finance-kernel";

/** Database handle: the shared client, or a transaction client inside $transaction. */
export type CapitalDb = Prisma.TransactionClient;

/**
 * LedgerService — the double-entry core. Owns GL accounts, journal posting /
 * reversal, invoice GL, bank balance moves and document numbering.
 *
 * Every mutating method accepts an optional `db` handle so multi-step money
 * flows can run atomically: callers open `prisma.$transaction(tx => ...)`
 * and pass `tx` down; standalone calls default to the shared client.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async nextInvoiceNumber(db: CapitalDb = this.prisma) {
    const year = new Date().getFullYear();
    const existing = await db.invoice.findMany({
      where: { invoiceNumber: { startsWith: `ZLM-${year}-` } },
      select: { invoiceNumber: true },
    });
    const maxSeq = existing.reduce((m, i) => {
      const seq = parseInt(i.invoiceNumber.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `ZLM-${year}-${String(maxSeq + 1).padStart(4, "0")}`;
  }

  async nextCreditNoteNumber(db: CapitalDb = this.prisma) {
    const year = new Date().getFullYear();
    const existing = await db.creditNote.findMany({ select: { referenceNumber: true } });
    const maxSeq = existing.reduce((m, c) => {
      const seq = parseInt(c.referenceNumber.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `CRN-${year}-${String(maxSeq + 1).padStart(4, "0")}`;
  }

  // ── General ledger (double-entry) ────────────────────────────────────
  async accountByCode(code: string, db: CapitalDb = this.prisma) {
    const a = await db.account.findFirst({ where: { code } });
    if (!a) throw new Error(`GL account ${code} not found — run the seed`);
    return a;
  }

  /** Current balance of a GL account (debit − credit) in BDT. */
  async accountBalance(accountId: string, db: CapitalDb = this.prisma) {
    const agg = await db.journalEntryLine.aggregate({ where: { accountId }, _sum: { debit: true, credit: true } });
    return Math.round((Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0)) * 100) / 100;
  }

  /** Get-or-create a GL account (used for discount/shipping on older databases). */
  async ensureAccount(code: string, name: string, category: any, db: CapitalDb = this.prisma) {
    const existing = await db.account.findFirst({ where: { code } });
    if (existing) return existing;
    return db.account.create({ data: { code, name, category } });
  }

  async postGL(
    entryType: string,
    reference: string,
    entryDate: Date,
    sourceId: string | null,
    notes: string | null,
    lines: { accountId: string; debit: number; credit: number; memo?: string }[],
    actorId?: string,
    db: CapitalDb = this.prisma
  ) {
    const rounded = lines.map((l) => ({ ...l, debit: Math.round(l.debit * 100) / 100, credit: Math.round(l.credit * 100) / 100 }));
    if (!rounded.length) return;
    if (Math.abs(rounded.reduce((s, l) => s + l.debit - l.credit, 0)) > 0.01) throw new Error("Unbalanced journal entry");
    // Period lock: a closed or locked month must never receive a new posting,
    // otherwise last month's P&L / VAT return keeps changing after it was filed.
    const day = new Date(Date.UTC(entryDate.getUTCFullYear(), entryDate.getUTCMonth(), entryDate.getUTCDate()));
    const period = await db.fiscalPeriod.findFirst({
      where: { startDate: { lte: day }, endDate: { gte: day } },
      select: { name: true, status: true },
    });
    if (period && period.status !== "OPEN") {
      throw new BadRequestException(
        `${period.name} is ${period.status.toLowerCase()} — ${reference} cannot be posted into it.`
      );
    }
    return db.journalEntry.create({
      data: { entryType, reference, entryDate, sourceId, notes, createdById: actorId, lines: { create: rounded.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })) } },
    });
  }

  /**
   * Post the mirrored journal for an existing entry.
   *
   * An entity can own several journals under one `sourceId` (an invoice holds
   * its INVOICE journal plus one PAYMENT journal per payment; an expense holds
   * EXPENSE plus EXPENSE_PAYMENT). Reversing "the newest entry for this source"
   * therefore reversed the wrong document. Callers that know the document type
   * pass `entryTypes`; selection also skips entries a reversal already points at,
   * so the same journal can never be reversed twice.
   */
  async reverseGL(sourceId: string, actorId?: string, db: CapitalDb = this.prisma, entryTypes?: string[]) {
    const scope = entryTypes?.length ? { entryType: { in: entryTypes } } : {};
    const [entries, reversals] = await Promise.all([
      db.journalEntry.findMany({ where: { sourceId, ...scope }, include: { lines: true }, orderBy: { createdAt: "desc" } }),
      db.journalEntry.findMany({ where: { sourceId, ...scope, reversedEntryId: { not: null } }, select: { reversedEntryId: true } }),
    ]);
    const alreadyReversed = new Set(reversals.map((entry) => entry.reversedEntryId).filter(Boolean));
    // Skip entries that are themselves reversals (reversedEntryId set) — without
    // this, reversing in a loop kept reversing the reversal it had just posted.
    const entry = entries.find((candidate) => !candidate.reversedEntryId && !alreadyReversed.has(candidate.id));
    if (!entry) return;
    const reversal = await this.postGL(
      entry.entryType,
      `${entry.reference} (reversed)`,
      new Date(),
      entry.sourceId,
      entry.notes ? `${entry.notes} — reversed` : "Reversed",
      entry.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit), memo: l.memo ?? undefined })),
      actorId,
      db
    );
    if (reversal) await db.journalEntry.update({ where: { id: reversal.id }, data: { reversedEntryId: entry.id } });
    return reversal;
  }

  /** Reverse one specific journal entry (used when a single payment is undone). */
  async reverseJournalEntry(entryId: string, actorId?: string, db: CapitalDb = this.prisma) {    const entry = await db.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
    if (!entry || entry.reversedEntryId) return;
    const existing = await db.journalEntry.findFirst({ where: { reversedEntryId: entry.id }, select: { id: true } });
    if (existing) return;
    const reversal = await this.postGL(
      entry.entryType,
      `${entry.reference} (reversed)`,
      new Date(),
      entry.sourceId,
      entry.notes ? `${entry.notes} — reversed` : "Reversed",
      entry.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit), memo: l.memo ?? undefined })),
      actorId,
      db
    );
    if (reversal) await db.journalEntry.update({ where: { id: reversal.id }, data: { reversedEntryId: entry.id } });
    return reversal;
  }

  /**
   * Find journal entries whose source document no longer exists and reverse
   * them.
   *
   * `JournalEntry.sourceId` is a plain string — there is no foreign key — so any
   * delete path that misses its reversal (or a database reseed) leaves entries
   * behind that no report can trace to a document. They distort AR, VAT and the
   * P&L silently. This sweep reverses them so the books self-correct while the
   * originals stay for the audit trail.
   *
   * Bank balances are a denormalised mirror of the GL cash account, so any cash
   * movement undone here is mirrored onto the default bank account too — that
   * keeps `GL 1200 == Σ BankAccount.currentBalance` true after the repair.
   */
  async reverseOrphanJournals(actorId?: string) {
    const db = this.prisma;
    const entries = await db.journalEntry.findMany({
      select: { id: true, entryType: true, sourceId: true, reversedEntryId: true },
    });
    const [invoices, payments, expenses, creditNotes, manualIncome, engagements, vendorPayments, dollarSales, payrolls, manualJournals, fixedAssets, depreciationRuns, fxRevaluations] = await Promise.all([
      db.invoice.findMany({ select: { id: true } }),
      db.payment.findMany({ select: { id: true } }),
      db.expense.findMany({ select: { id: true } }),
      db.creditNote.findMany({ select: { id: true } }),
      db.manualIncome.findMany({ select: { id: true } }),
      db.vendorEngagement.findMany({ select: { id: true } }),
      db.vendorPayment.findMany({ select: { id: true } }),
      db.dollarSale.findMany({ select: { id: true } }),
      db.payrollRecord.findMany({ select: { id: true } }),
      db.manualJournal.findMany({ select: { id: true } }),
      db.fixedAsset.findMany({ select: { id: true } }),
      db.depreciationRun.findMany({ select: { id: true } }),
      db.fxRevaluation.findMany({ select: { id: true } }),
    ]);
    const known = new Set<string>();
    for (const rows of [invoices, payments, expenses, creditNotes, manualIncome, engagements, vendorPayments, dollarSales, payrolls, manualJournals, fixedAssets, depreciationRuns, fxRevaluations]) {
      for (const row of rows) known.add(row.id);
    }
    // A reversal entry points at the entry it reverses; that entry must not be
    // reversed a second time.
    const alreadyReversed = new Set(entries.filter((e) => e.reversedEntryId).map((e) => e.reversedEntryId as string));
    const targets = entries.filter((e) => {
      if (!e.sourceId || e.reversedEntryId) return false;
      if (alreadyReversed.has(e.id)) return false;
      // Dollar-desk opening entries use `<saleId>:opening` as their source.
      // `OPENING-*` / `SYSTEM-*` are reserved synthetic references with no document.
      const base = e.sourceId.replace(/:opening$/, "");
      if (/^(OPENING|SYSTEM)[-_]/i.test(base)) return false;
      return !known.has(base);
    });

    const details: { entryType: string; sourceId: string; cash: number }[] = [];
    let reversed = 0;
    let cashAdjusted = 0;
    for (const target of targets) {
      const lines = await db.journalEntryLine.findMany({ where: { entryId: target.id }, include: { account: { select: { code: true } } } });
      const cash = Math.round(lines.filter((l) => l.account.code === "1200").reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
      const reversal = await this.reverseJournalEntry(target.id, actorId);
      if (!reversal) continue;
      reversed += 1;
      if (Math.abs(cash) > 0.005) {
        const bankId = await this.defaultBankAccount();
        if (bankId) {
          if (cash > 0) await this.debitBankAccount(bankId, cash);
          else await this.creditBankAccount(bankId, Math.abs(cash));
          cashAdjusted = Math.round((cashAdjusted + cash) * 100) / 100;
        }
      }
      details.push({ entryType: target.entryType, sourceId: target.sourceId as string, cash });
    }
    return { checked: entries.length, orphans: targets.length, reversed, cashAdjusted, details };
  }

  /**
   * Invoice GL, always in BDT. Line amounts are stored in the invoice currency,
   * so every leg is converted with the invoice exchange rate; the AR leg is the
   * balancing figure so a rounded FX conversion can never unbalance the entry.
   */
  async postInvoiceGL(invoice: any, actorId?: string, db: CapitalDb = this.prisma) {
    if (!invoice || !POSTABLE_STATUSES.includes(invoice.status)) return;
    const [acctAR, acctRevenue, acctMgmt, acctVat] = await Promise.all([
      this.accountByCode("1100", db),
      this.accountByCode("4000", db),
      this.accountByCode("4100", db),
      this.accountByCode("2100", db),
    ]);
    const acctDiscount = await this.ensureAccount("4300", "Discounts Allowed", "REVENUE", db);
    const t = invoiceTotals(invoice);
    const lines: { accountId: string; debit: number; credit: number; memo?: string }[] = [];
    let creditTotal = 0;
    let debitTotal = 0;
    for (const l of invoice.lineItems ?? []) {
      const amt = toBdt(Number(l.amount), invoice);
      lines.push({ accountId: l.revenueTag === "MANAGEMENT_FEE" ? acctMgmt.id : acctRevenue.id, debit: 0, credit: amt, memo: l.description });
      creditTotal += amt;
    }
    if (t.tax > 0) {
      const amt = toBdt(t.tax, invoice);
      lines.push({ accountId: acctVat.id, debit: 0, credit: amt, memo: `VAT ${invoice.taxRate}%` });
      creditTotal += amt;
    }
    if (t.discount > 0) {
      const amt = toBdt(t.discount, invoice);
      lines.push({ accountId: acctDiscount.id, debit: amt, credit: 0, memo: `Discount ${invoice.discountRate}% on ${invoice.invoiceNumber}` });
      debitTotal += amt;
    }
    if (t.shipping > 0) {
      const amt = toBdt(t.shipping, invoice);
      lines.push({ accountId: acctRevenue.id, debit: 0, credit: amt, memo: `Shipping / delivery on ${invoice.invoiceNumber}` });
      creditTotal += amt;
    }
    const receivable = Math.round((creditTotal - debitTotal) * 100) / 100;
    if (receivable > 0.005) {
      await this.postGL("INVOICE", invoice.invoiceNumber, invoice.issueDate, invoice.id, null, [{ accountId: acctAR.id, debit: receivable, credit: 0, memo: invoice.client?.companyName }, ...lines], actorId, db);
    }
  }

  // ── Bank account ledger ──────────────────────────────────────────────
  async defaultBankAccount(db: CapitalDb = this.prisma): Promise<string | null> {
    const a = await db.bankAccount.findFirst({ orderBy: { accountType: "asc" } });
    return a?.id ?? null;
  }

  async creditBankAccount(bankAccountId: string, amount: number, db: CapitalDb = this.prisma) {
    await db.bankAccount.update({ where: { id: bankAccountId }, data: { currentBalance: { increment: amount } } });
  }

  async debitBankAccount(bankAccountId: string, amount: number, db: CapitalDb = this.prisma) {
    await db.bankAccount.update({ where: { id: bankAccountId }, data: { currentBalance: { decrement: amount } } });
  }
}
