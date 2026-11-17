import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const cell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const line = (cells: any[]) => cells.map(cell).join(",");

/**
 * Auditor export pack: plain CSV that opens in Excel/Sheets and can be handed
 * to a CA without screenshots. Every figure is the same data the statements use.
 */
@Injectable()
export class AuditExportService {
  constructor(private readonly prisma: PrismaService) {}

  private range(fromStr?: string, toStr?: string) {
    const parse = (v: string, end: boolean) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${v}`);
      return end
        ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
        : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };
    const now = new Date();
    const to = toStr ? parse(toStr, true) : new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
    const from = fromStr ? parse(fromStr, false) : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from > to) throw new BadRequestException("`from` must be before `to`");
    return { from, to };
  }

  async generalLedger(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const entries = await this.prisma.journalEntry.findMany({
      where: { entryDate: { gte: from, lte: to } },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    });
    const rows = [line(["Date", "Entry type", "Reference", "Account code", "Account", "Debit", "Credit", "Memo"])];
    for (const e of entries) {
      for (const l of e.lines) {
        rows.push(
          line([
            e.entryDate.toISOString().slice(0, 10),
            e.entryType,
            e.reference,
            l.account.code ?? "",
            l.account.name,
            r2(Number(l.debit)),
            r2(Number(l.credit)),
            l.memo ?? "",
          ])
        );
      }
    }
    return { filename: `general-ledger-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, csv: rows.join("\n") };
  }

  async journalListing(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const entries = await this.prisma.journalEntry.findMany({
      where: { entryDate: { gte: from, lte: to } },
      include: { lines: { select: { debit: true, credit: true } } },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    });
    const rows = [line(["Date", "Entry type", "Reference", "Lines", "Debit", "Credit", "Reversed"])];
    for (const e of entries) {
      const debit = r2(e.lines.reduce((s, l) => s + Number(l.debit), 0));
      const credit = r2(e.lines.reduce((s, l) => s + Number(l.credit), 0));
      rows.push(line([e.entryDate.toISOString().slice(0, 10), e.entryType, e.reference, e.lines.length, debit, credit, e.reversedEntryId ? "yes" : ""]));
    }
    return { filename: `journal-listing-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, csv: rows.join("\n") };
  }

  async accountLedger(accountId: string, fromStr?: string, toStr?: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException("Account not found");
    const { from, to } = this.range(fromStr, toStr);
    const opening = await this.prisma.journalEntryLine.aggregate({
      where: { accountId, entry: { entryDate: { lt: from } } },
      _sum: { debit: true, credit: true },
    });
    const lines = await this.prisma.journalEntryLine.findMany({
      where: { accountId, entry: { entryDate: { gte: from, lte: to } } },
      include: { entry: { select: { entryDate: true, entryType: true, reference: true } } },
      orderBy: [{ entry: { entryDate: "asc" } }, { id: "asc" }],
    });
    let running = r2(Number(opening._sum.debit ?? 0) - Number(opening._sum.credit ?? 0));
    const rows = [line([`${account.code ?? ""} — ${account.name}`, account.category]), line(["Date", "Entry type", "Reference", "Memo", "Debit", "Credit", "Balance"])];
    rows.push(line(["", "Opening balance", "", "", "", "", running]));
    for (const l of lines) {
      running = r2(running + Number(l.debit) - Number(l.credit));
      rows.push(
        line([
          l.entry.entryDate.toISOString().slice(0, 10),
          l.entry.entryType,
          l.entry.reference,
          l.memo ?? "",
          r2(Number(l.debit)),
          r2(Number(l.credit)),
          running,
        ])
      );
    }
    rows.push(line(["", "Closing balance", "", "", "", "", running]));
    return { filename: `ledger-${account.code ?? account.id}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, csv: rows.join("\n") };
  }

  async trialBalanceCsv(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const totals = await this.prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: { entry: { entryDate: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    });
    const accounts = await this.prisma.account.findMany({ select: { id: true, code: true, name: true, category: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const rows = [line(["Code", "Account", "Category", "Debit", "Credit", "Balance"])];
    const sorted = totals
      .map((t) => ({ account: byId.get(t.accountId), debit: r2(Number(t._sum.debit ?? 0)), credit: r2(Number(t._sum.credit ?? 0)) }))
      .filter((t) => t.account)
      .sort((a, b) => String(a.account!.code).localeCompare(String(b.account!.code)));
    for (const t of sorted) {
      rows.push(line([t.account!.code ?? "", t.account!.name, t.account!.category, t.debit, t.credit, r2(t.debit - t.credit)]));
    }
    rows.push(line(["", "TOTAL", "", r2(sorted.reduce((s, t) => s + t.debit, 0)), r2(sorted.reduce((s, t) => s + t.credit, 0)), ""]));
    return { filename: `trial-balance-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, csv: rows.join("\n") };
  }

  /** Everything an auditor asks for, in one bundle of file names + CSVs. */
  async pack(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const [gl, journals, tb] = await Promise.all([
      this.generalLedger(fromStr, toStr),
      this.journalListing(fromStr, toStr),
      this.trialBalanceCsv(fromStr, toStr),
    ]);
    return {
      from,
      to,
      files: [
        { name: "Trial balance", filename: tb.filename, csv: tb.csv },
        { name: "General ledger", filename: gl.filename, csv: gl.csv },
        { name: "Journal listing", filename: journals.filename, csv: journals.csv },
      ],
    };
  }
}
