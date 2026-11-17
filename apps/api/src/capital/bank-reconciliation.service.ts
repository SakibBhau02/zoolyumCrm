import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { logAudit } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 86400000;

type StatementRow = { date: Date; description: string; reference?: string; debit: number; credit: number };

/**
 * Bank statement import + reconciliation.
 *
 * The GL is only trustworthy if it matches the bank. This imports statement
 * rows (JSON or CSV), auto-matches them against client receipts, vendor
 * payments and cash expenses by amount + date window, and leaves everything
 * else in an explicit unmatched queue.
 */
@Injectable()
export class BankReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDate(value: any) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid statement date: ${value}`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /** Minimal CSV parser: date,description,reference,debit,credit (header optional). */
  private parseCsv(csv: string): StatementRow[] {
    const lines = String(csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const split = (line: string) => {
      const out: string[] = [];
      let cur = "";
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const first = split(lines[0]).map((c) => c.toLowerCase());
    const hasHeader = first.some((c) => ["date", "description", "debit", "credit"].includes(c));
    const rows = hasHeader ? lines.slice(1) : lines;
    const idx = (name: string, fallback: number) => (hasHeader ? Math.max(first.indexOf(name), 0) : fallback);
    const iDate = idx("date", 0);
    const iDesc = idx("description", 1);
    const iRef = idx("reference", 2);
    const iDebit = idx("debit", 3);
    const iCredit = idx("credit", 4);
    return rows.map((line, n) => {
      const c = split(line);
      const debit = Number(String(c[iDebit] ?? "0").replace(/,/g, "") || 0);
      const credit = Number(String(c[iCredit] ?? "0").replace(/,/g, "") || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
        throw new BadRequestException(`Row ${n + 1}: debit/credit must be numbers`);
      }
      return {
        date: this.parseDate(c[iDate]),
        description: String(c[iDesc] ?? "Bank transaction").slice(0, 300),
        reference: c[iRef] ? String(c[iRef]).slice(0, 120) : undefined,
        debit: Math.max(debit, 0),
        credit: Math.max(credit, 0),
      };
    });
  }

  /** OFX / QFX (SGML or XML) statement parser. */
  private parseOfx(ofx: string): StatementRow[] {
    const text = String(ofx);
    const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
    if (!blocks.length) throw new BadRequestException("No <STMTTRN> entries found in the OFX file");
    const tag = (block: string, name: string) => {
      const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
      return m ? m[1].trim() : "";
    };
    return blocks.map((block, i) => {
      const rawDate = tag(block, "DTPOSTED");
      const y = rawDate.slice(0, 4), m = rawDate.slice(4, 6), d = rawDate.slice(6, 8);
      if (!/^\d{8}$/.test(`${y}${m}${d}`)) throw new BadRequestException(`OFX row ${i + 1}: invalid DTPOSTED`);
      const amount = Number(tag(block, "TRNAMT").replace(/,/g, ""));
      if (!Number.isFinite(amount)) throw new BadRequestException(`OFX row ${i + 1}: invalid TRNAMT`);
      const description = tag(block, "NAME") || tag(block, "MEMO") || "Bank transaction";
      return {
        date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))),
        description: description.slice(0, 300),
        reference: tag(block, "FITID") || tag(block, "CHECKNUM") || undefined,
        debit: amount > 0 ? r2(amount) : 0,
        credit: amount < 0 ? r2(Math.abs(amount)) : 0,
      };
    });
  }

  async importStatement(bankAccountId: string, body: any, actorId?: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!account) throw new NotFoundException("Bank account not found");

    let rows: StatementRow[] = [];
    if (Array.isArray(body?.lines)) {
      rows = body.lines.map((l: any, i: number) => {
        const debit = r2(Number(l.debit ?? 0));
        const credit = r2(Number(l.credit ?? l.out ?? 0));
        if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
          throw new BadRequestException(`Row ${i + 1}: amounts must be zero or greater`);
        }
        if (debit > 0 && credit > 0) throw new BadRequestException(`Row ${i + 1}: a row is either money in or money out`);
        return {
          date: this.parseDate(l.date),
          description: String(l.description ?? "Bank transaction").slice(0, 300),
          reference: l.reference ? String(l.reference).slice(0, 120) : undefined,
          debit,
          credit,
        };
      });
    } else if (typeof body?.csv === "string") {
      rows = this.parseCsv(body.csv);
    } else if (typeof body?.ofx === "string") {
      rows = this.parseOfx(body.ofx);
    }
    if (!rows.length) throw new BadRequestException("No statement rows to import");

    // Re-importing the same file must not duplicate rows.
    let imported = 0;
    for (const row of rows) {
      const dupe = await this.prisma.bankStatementLine.findFirst({
        where: {
          bankAccountId,
          statementDate: row.date,
          description: row.description,
          debit: row.debit,
          credit: row.credit,
        },
      });
      if (dupe) continue;
      await this.prisma.bankStatementLine.create({
        data: {
          bankAccountId,
          statementDate: row.date,
          description: row.description,
          reference: row.reference ?? null,
          debit: row.debit,
          credit: row.credit,
          importedById: actorId ?? null,
        },
      });
      imported += 1;
    }

    const matched = await this.autoMatch(bankAccountId, actorId);
    await logAudit(this.prisma as any, "BankAccount", bankAccountId, "statement_imported", { imported, matched: matched.matched }, actorId);
    return { imported, skipped: rows.length - imported, matched: matched.matched };
  }

  /**
   * Match statement rows to ledger documents: same cash amount, within a
   * 5-day window, and the document not already claimed by another row.
   */
  async autoMatch(bankAccountId: string, actorId?: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { bankAccountId, status: "UNMATCHED" },
      orderBy: { statementDate: "asc" },
    });
    if (!lines.length) return { matched: 0, remaining: 0 };

    const [payments, expenses, vendorPayments, claimed] = await Promise.all([
      this.prisma.payment.findMany({
        where: { type: { in: ["IN", "REFUND"] }, bankAccountId },
        select: { id: true, amount: true, paymentDate: true },
      }),
      this.prisma.expense.findMany({
        where: { isPayable: false, approvalStatus: "APPROVED" },
        select: { id: true, amount: true, date: true, bankAccountId: true },
      }),
      this.prisma.vendorPayment.findMany({
        select: { id: true, amount: true, paymentDate: true, taxWithheld: true, bankAccountId: true },
      }),
      this.prisma.bankStatementLine.findMany({
        where: { status: "MATCHED" },
        select: { matchedPaymentId: true, matchedExpenseId: true, matchedVendorPaymentId: true },
      }),
    ]);
    const usedPayments = new Set(claimed.map((c) => c.matchedPaymentId).filter(Boolean) as string[]);
    const usedExpenses = new Set(claimed.map((c) => c.matchedExpenseId).filter(Boolean) as string[]);
    const usedVendor = new Set(claimed.map((c) => c.matchedVendorPaymentId).filter(Boolean) as string[]);
    const near = (a: Date, b: Date) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 5 * DAY;
    const eq = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 0.01;

    let matched = 0;
    for (const line of lines) {
      const inflow = Number(line.debit);
      const outflow = Number(line.credit);
      let patch: any = null;
      if (inflow > 0) {
        const hit = payments.find((p) => !usedPayments.has(p.id) && eq(Number(p.amount), inflow) && near(p.paymentDate, line.statementDate));
        if (hit) {
          usedPayments.add(hit.id);
          patch = { matchedPaymentId: hit.id };
        }
      } else if (outflow > 0) {
        const cashHit = expenses.find(
          (e) => !usedExpenses.has(e.id) && eq(Number(e.amount), outflow) && near(e.date, line.statementDate) && (!e.bankAccountId || e.bankAccountId === bankAccountId)
        );
        if (cashHit) {
          usedExpenses.add(cashHit.id);
          patch = { matchedExpenseId: cashHit.id };
        } else {
          const vendorHit = vendorPayments.find((v) => {
            const net = Number(v.amount) - Number(v.taxWithheld ?? 0);
            return !usedVendor.has(v.id) && eq(net, outflow) && near(v.paymentDate, line.statementDate) && (!v.bankAccountId || v.bankAccountId === bankAccountId);
          });
          if (vendorHit) {
            usedVendor.add(vendorHit.id);
            patch = { matchedVendorPaymentId: vendorHit.id };
          }
        }
      }
      if (patch) {
        await this.prisma.bankStatementLine.update({ where: { id: line.id }, data: { ...patch, status: "MATCHED" } });
        matched += 1;
      }
    }
    if (matched && actorId) {
      await logAudit(this.prisma as any, "BankAccount", bankAccountId, "statement_auto_matched", { matched }, actorId);
    }
    const remaining = await this.prisma.bankStatementLine.count({ where: { bankAccountId, status: "UNMATCHED" } });
    return { matched, remaining };
  }

  async list(bankAccountId: string, status?: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!account) throw new NotFoundException("Bank account not found");
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { bankAccountId, ...(status ? { status } : {}) },
      orderBy: { statementDate: "desc" },
      take: 500,
    });
    const unmatched = lines.filter((l) => l.status === "UNMATCHED");
    return {
      account: { id: account.id, accountName: account.accountName, currentBalance: Number(account.currentBalance), currency: account.currency },
      lines,
      summary: {
        total: lines.length,
        matched: lines.filter((l) => l.status === "MATCHED").length,
        unmatched: unmatched.length,
        ignored: lines.filter((l) => l.status === "IGNORED").length,
        statementIn: r2(lines.reduce((s, l) => s + Number(l.debit), 0)),
        statementOut: r2(lines.reduce((s, l) => s + Number(l.credit), 0)),
      },
    };
  }

  async match(lineId: string, body: any, actorId?: string) {
    const line = await this.prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundException("Statement line not found");
    const patch: any = { status: "MATCHED", note: body?.note ?? line.note };
    if (body?.paymentId) patch.matchedPaymentId = body.paymentId;
    if (body?.expenseId) patch.matchedExpenseId = body.expenseId;
    if (body?.vendorPaymentId) patch.matchedVendorPaymentId = body.vendorPaymentId;
    if (!body?.paymentId && !body?.expenseId && !body?.vendorPaymentId) {
      throw new BadRequestException("Provide paymentId, expenseId or vendorPaymentId");
    }
    const updated = await this.prisma.bankStatementLine.update({ where: { id: lineId }, data: patch });
    if (actorId) await logAudit(this.prisma as any, "BankStatementLine", lineId, "matched", patch, actorId);
    return updated;
  }

  async unmatch(lineId: string, actorId?: string) {
    const updated = await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: "UNMATCHED", matchedPaymentId: null, matchedExpenseId: null, matchedVendorPaymentId: null },
    });
    if (actorId) await logAudit(this.prisma as any, "BankStatementLine", lineId, "unmatched", {}, actorId);
    return updated;
  }

  /** Remove a statement row imported by mistake. Matched rows must be unmatched first. */
  async removeLine(lineId: string, actorId?: string) {
    const line = await this.prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundException("Statement line not found");
    if (line.status === "MATCHED") throw new BadRequestException("Unmatch this row before deleting it.");
    await this.prisma.bankStatementLine.delete({ where: { id: lineId } });
    if (actorId) await logAudit(this.prisma as any, "BankStatementLine", lineId, "deleted", {}, actorId);
    return { ok: true };
  }

  async ignore(lineId: string, body: any, actorId?: string) {    const updated = await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: "IGNORED", note: body?.note ?? "Ignored" },
    });
    if (actorId) await logAudit(this.prisma as any, "BankStatementLine", lineId, "ignored", {}, actorId);
    return updated;
  }

  /** Imported statement totals vs the GL cash movement for the same window. */
  async summary(bankAccountId: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!account) throw new NotFoundException("Bank account not found");
    const lines = await this.prisma.bankStatementLine.findMany({ where: { bankAccountId } });
    return {
      account: { id: account.id, accountName: account.accountName, currentBalance: Number(account.currentBalance) },
      statementIn: r2(lines.reduce((s, l) => s + Number(l.debit), 0)),
      statementOut: r2(lines.reduce((s, l) => s + Number(l.credit), 0)),
      unmatched: lines.filter((l) => l.status === "UNMATCHED").length,
      matched: lines.filter((l) => l.status === "MATCHED").length,
    };
  }
}
