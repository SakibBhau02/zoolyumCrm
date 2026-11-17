import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";
import { logAudit } from "./finance-kernel";

/**
 * Manual journal entries — depreciation adjustments, accruals, prepayments,
 * opening balances, auditor reclasses. Without this the only way to touch the
 * GL was a database script.
 *
 * A journal is a DRAFT until posted; posting writes a normal double-entry
 * JournalEntry (entryType MANUAL, sourceId = journal id) so it obeys the period
 * lock and shows up in every statement. Voiding reverses that entry.
 */
@Injectable()
export class ManualJournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService
  ) {}

  async list(query: { from?: string; to?: string; status?: string } = {}) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.entryDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const rows = await this.prisma.manualJournal.findMany({
      where,
      include: { lines: true },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  /** Attach the GL account to each line (no relation on the join table). */
  private async hydrate(journal: any) {
    const ids = [...new Set((journal.lines ?? []).map((l: any) => l.accountId))] as string[];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true, category: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return { ...journal, lines: (journal.lines ?? []).map((l: any) => ({ ...l, account: byId.get(l.accountId) ?? null })) };
  }

  async get(id: string) {
    const journal = await this.prisma.manualJournal.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!journal) throw new NotFoundException("Journal not found");
    return this.hydrate(journal);
  }

  /** Validate + normalise the lines of a manual journal. */
  private normalize(body: any) {
    const raw = body?.lines;
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new BadRequestException("A journal needs at least two lines (one debit and one credit)");
    }
    const lines = raw.map((l: any, i: number) => {
      if (!l?.accountId) throw new BadRequestException(`Line ${i + 1} needs an account`);
      const debit = Math.round(Number(l.debit ?? 0) * 100) / 100;
      const credit = Math.round(Number(l.credit ?? 0) * 100) / 100;
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        throw new BadRequestException(`Line ${i + 1}: amounts must be zero or greater`);
      }
      if (debit > 0 && credit > 0) throw new BadRequestException(`Line ${i + 1}: put the amount in debit or credit, not both`);
      if (debit === 0 && credit === 0) throw new BadRequestException(`Line ${i + 1}: amount is zero`);
      return { accountId: String(l.accountId), debit, credit, memo: l.memo ? String(l.memo) : undefined };
    });
    const debit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const credit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    if (Math.abs(debit - credit) > 0.01) {
      throw new BadRequestException(`Journal is not balanced: debits ৳${debit} vs credits ৳${credit}`);
    }
    if (debit <= 0) throw new BadRequestException("A journal must move a non-zero amount");
    return lines;
  }

  private async assertAccounts(lines: { accountId: string }[]) {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const found = await this.prisma.account.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException("One or more accounts do not exist");
  }

  private async nextReference() {
    const year = new Date().getFullYear();
    const rows = await this.prisma.manualJournal.findMany({
      where: { reference: { startsWith: `MJ-${year}-` } },
      select: { reference: true },
    });
    const max = rows.reduce((m, r) => {
      const seq = parseInt(r.reference.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `MJ-${year}-${String(max + 1).padStart(4, "0")}`;
  }

  async create(body: any, actorId?: string) {
    const lines = this.normalize(body);
    await this.assertAccounts(lines);
    const entryDate = body.entryDate ? new Date(body.entryDate) : new Date();
    if (Number.isNaN(entryDate.getTime())) throw new BadRequestException("Invalid entry date");
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = await this.nextReference();
      try {
        const journal = await this.prisma.manualJournal.create({
          data: {
            reference,
            entryDate,
            memo: body.memo ?? null,
            attachmentUrl: body.attachmentUrl ?? null,
            status: "DRAFT",
            createdById: actorId ?? null,
            lines: { create: lines },
          },
          include: { lines: true },
        });
        await logAudit(this.prisma as any, "ManualJournal", journal.id, "created", { reference, entryDate }, actorId);
        return this.hydrate(journal);
      } catch (error: any) {
        if (error?.code === "P2002") continue;
        throw error;
      }
    }
    throw new ConflictException("Could not allocate a journal reference — retry");
  }

  async update(id: string, body: any, actorId?: string) {
    const existing = await this.get(id);
    if (existing.status !== "DRAFT") throw new BadRequestException("Only a draft journal can be edited — void and re-create a posted one.");
    const data: any = {};
    if (body.memo !== undefined) data.memo = body.memo || null;
    if (body.attachmentUrl !== undefined) data.attachmentUrl = body.attachmentUrl || null;
    if (body.entryDate !== undefined) {
      const d = new Date(body.entryDate);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid entry date");
      data.entryDate = d;
    }
    if (body.lines) {
      const lines = this.normalize(body);
      await this.assertAccounts(lines);
      data.lines = { deleteMany: {}, create: lines };
    }
    const updated = await this.prisma.manualJournal.update({
      where: { id },
      data,
      include: { lines: true },
    });
    await logAudit(this.prisma as any, "ManualJournal", id, "updated", { reference: existing.reference }, actorId);
    return this.hydrate(updated);
  }

  async post(id: string, actorId?: string) {
    const journal = await this.get(id);
    if (journal.status === "POSTED") return journal;
    if (journal.status === "VOID") throw new BadRequestException("A void journal cannot be posted.");
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.postGL(
        "MANUAL",
        journal.reference,
        journal.entryDate,
        journal.id,
        journal.memo,
        journal.lines.map((l: any) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo ?? undefined })),
        actorId,
        tx
      );
      await tx.manualJournal.update({ where: { id }, data: { status: "POSTED", postedAt: new Date() } });
      await logAudit(tx, "ManualJournal", id, "posted", { reference: journal.reference }, actorId);
    }, { timeout: 15000 });
    return this.get(id);
  }

  async void(id: string, actorId?: string) {
    const journal = await this.get(id);
    if (journal.status !== "POSTED") throw new BadRequestException("Only a posted journal can be voided.");
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseGL(id, actorId, tx, ["MANUAL"]);
      await tx.manualJournal.update({ where: { id }, data: { status: "VOID" } });
      await logAudit(tx, "ManualJournal", id, "voided", { reference: journal.reference }, actorId);
    }, { timeout: 15000 });
    return this.get(id);
  }

  async remove(id: string, actorId?: string) {
    const journal = await this.get(id);
    if (journal.status !== "DRAFT") throw new BadRequestException("Only a draft journal can be deleted.");
    await this.prisma.manualJournal.delete({ where: { id } });
    await logAudit(this.prisma as any, "ManualJournal", id, "deleted", { reference: journal.reference }, actorId);
    return { ok: true };
  }

  /** Accounts the manual-journal form can pick from. */
  async accounts() {
    return this.prisma.account.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, category: true },
      orderBy: { code: "asc" },
    });
  }
}
