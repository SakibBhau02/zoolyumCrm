import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { LedgerService, CapitalDb } from "./ledger.service";
import { invalidateFinance, logAudit } from "./finance-kernel";

/**
 * Liabilities — vendor commitments and what is still owed.
 *
 * The important separation (and the reason this is not just another expense):
 *
 *   commitment  = total agreed with the vendor (e.g. DOP ৳7,000)
 *   advance     = cash already paid before delivery (e.g. ৳3,000)
 *   balance     = liability still owed (৳4,000)
 *
 * A commitment is only expensed when the work is delivered / the bill arrives.
 * Advances sit in Prepaid Vendor Costs (1400) until then, so the P&L is not
 * inflated by work that has not happened yet. Once completed, the full amount
 * moves to Accounts Payable (2000) and every later payment clears AP.
 */
@Injectable()
export class LiabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly ledger: LedgerService
  ) {}

  // ── Public API ───────────────────────────────────────────────────────

  async list(query: {
    status?: string;
    vendorId?: string;
    projectId?: string;
    q?: string;
  } = {}) {
    const [engagements, expensePayable] = await Promise.all([
      this.prisma.vendorEngagement.findMany({
        where: {
          ...(query.vendorId ? { vendorId: query.vendorId } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
        },
        include: {
          vendor: { select: { id: true, name: true, category: true } },
          project: { select: { id: true, name: true } },
          client: { select: { id: true, companyName: true } },
          payments: { orderBy: { paymentDate: "asc" } },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        // Safety cap: a mature workspace has thousands of historical
        // commitments and the list view never renders them all.
        take: 500,
      }),
      this.expensePayables(),
    ]);

    const all = engagements.map((e) => this.compute(e));
    const summary = this.summarise(all, expensePayable);

    let rows = all;
    if (query.status) {
      const s = query.status.toUpperCase();
      rows = ["OPEN", "OVERDUE", "PAID", "UNPAID", "PARTIALLY_PAID"].includes(s)
        ? rows.filter((r) =>
            s === "OPEN"
              ? r.balance > 0 && r.status !== "CANCELLED"
              : s === "OVERDUE"
                ? r.overdue
                : s === "PAID"
                  ? r.balance <= 0
                  : r.paymentState === s
          )
        : rows.filter((r) => r.status === s);
    }
    if (query.vendorId) rows = rows.filter((r) => r.vendorId === query.vendorId);
    if (query.projectId) rows = rows.filter((r) => r.projectId === query.projectId);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q) ||
          (r.vendor?.name ?? "").toLowerCase().includes(q) ||
          (r.project?.name ?? "").toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => {
      if (a.status === "CANCELLED" && b.status !== "CANCELLED") return 1;
      if (b.status === "CANCELLED" && a.status !== "CANCELLED") return -1;
      if (a.balance > 0 && b.balance <= 0) return -1;
      if (b.balance > 0 && a.balance <= 0) return 1;
      return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
    });

    return {
      rows,
      summary,
      aging: this.aging(rows),
      byVendor: this.group(rows, "vendor"),
      byProject: this.group(rows, "project"),
      otherPayables: expensePayable,
      generatedAt: new Date().toISOString(),
    };
  }

  async summary() {
    const data = await this.list();
    return data.summary;
  }

  async get(id: string) {
    const engagement = await this.prisma.vendorEngagement.findUnique({
      where: { id },
      include: {
        vendor: true,
        project: { select: { id: true, name: true, clientId: true } },
        client: { select: { id: true, companyName: true } },
        payments: { orderBy: { paymentDate: "desc" } },
      },
    });
    if (!engagement) throw new NotFoundException("Engagement not found");
    return this.compute(engagement);
  }

  async create(body: any, actorId?: string) {
    const total = Number(body.totalAmount);
    if (!Number.isFinite(total) || total <= 0) throw new BadRequestException("Agreed amount must be greater than zero");
    if (!body.vendorId) throw new BadRequestException("Vendor is required");
    if (!body.title?.trim()) throw new BadRequestException("What are you hiring for? Add a title");

    const vendor = await this.prisma.vendor.findUnique({ where: { id: body.vendorId } }).catch(() => null);
    if (!vendor) throw new BadRequestException("Vendor not found");

    let clientId: string | null = body.clientId ?? null;
    let projectId: string | null = body.projectId ?? null;
    if (projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, clientId: true, name: true },
      });
      if (!project) throw new BadRequestException("Project not found");
      if (clientId && clientId !== project.clientId) {
        throw new BadRequestException(`Project "${project.name}" belongs to another client`);
      }
      clientId = project.clientId;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx);
      const engagement = await tx.vendorEngagement.create({
        data: {
          reference,
          vendorId: body.vendorId,
          projectId,
          clientId,
          title: body.title.trim(),
          category: body.category ?? "OTHER",
          description: body.description ?? null,
          totalAmount: total,
          status: body.status === "DRAFT" ? "DRAFT" : "ACTIVE",
          startDate: body.startDate ? new Date(body.startDate) : null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          retentionPct: body.retentionPct != null ? Number(body.retentionPct) : 0,
          paymentTerms: body.paymentTerms ?? null,
          notes: body.notes ?? null,
          attachmentUrl: body.attachmentUrl ?? null,
          createdById: actorId ?? null,
          approvedById: actorId ?? null,
        },
      });
      await logAudit(tx, "VendorEngagement", engagement.id, "created", { total, vendor: vendor.name }, actorId);
      return engagement;
    }, { timeout: 15000 });

    // Recording the advance at creation is the common agency flow:
    // "deal 7,000, paid 3,000 now, rest on delivery".
    if (body.initialPayment?.amount != null && Number(body.initialPayment.amount) > 0) {
      await this.pay(
        created.id,
        {
          ...body.initialPayment,
          amount: Number(body.initialPayment.amount),
          type: body.initialPayment.type ?? "ADVANCE",
        },
        actorId
      );
    }

    await this.invalidate();
    return this.get(created.id);
  }

  async update(id: string, body: any, actorId?: string) {
    const existing = await this.prisma.vendorEngagement.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!existing) throw new NotFoundException("Engagement not found");
    if (existing.status === "COMPLETED" && body.totalAmount != null && Number(body.totalAmount) !== Number(existing.totalAmount)) {
      throw new BadRequestException("A completed engagement cannot change its agreed amount — reverse the accrual first");
    }

    const paid = this.paidOf(existing.payments);
    if (body.totalAmount != null && Number(body.totalAmount) < paid) {
      throw new BadRequestException(
        `Agreed amount cannot be below what is already paid (৳${paid.toLocaleString("en-US")})`
      );
    }
    if (body.status && !["DRAFT", "ACTIVE"].includes(body.status)) {
      throw new BadRequestException("Use the complete or cancel action to change lifecycle status");
    }

    const data: any = {};
    for (const f of [
      "title", "category", "description", "paymentTerms", "notes", "attachmentUrl", "billNumber",
    ]) {
      if (body[f] !== undefined) data[f] = body[f] === "" ? null : body[f];
    }
    for (const f of ["totalAmount", "retentionPct"]) {
      if (body[f] !== undefined) data[f] = Number(body[f]);
    }
    for (const f of ["startDate", "dueDate", "deliveredAt", "billReceivedAt"]) {
      if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null;
    }
    if (body.projectId !== undefined) {
      data.projectId = body.projectId || null;
      if (body.projectId) {
        const project = await this.prisma.project.findUnique({ where: { id: body.projectId }, select: { clientId: true } });
        data.clientId = project?.clientId ?? null;
      } else data.clientId = body.clientId || null;
    }
    if (body.vendorId !== undefined) data.vendorId = body.vendorId;
    if (body.status !== undefined) data.status = body.status;

    await this.prisma.vendorEngagement.update({ where: { id }, data });
    await this.prisma.$transaction((tx) =>
      logAudit(tx, "VendorEngagement", id, "updated", { fields: Object.keys(data) }, actorId)
    );
    await this.invalidate();
    return this.get(id);
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.prisma.vendorEngagement.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!existing) throw new NotFoundException("Engagement not found");
    if (existing.payments.length > 0) {
      throw new BadRequestException("This engagement has payments. Record a refund before deleting it, so the cash trail stays intact.");
    }
    if (existing.status === "COMPLETED") {
      throw new BadRequestException("Completed engagements are part of the ledger and cannot be deleted.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.vendorEngagement.delete({ where: { id } });
      await logAudit(tx, "VendorEngagement", id, "deleted", { reference: existing.reference }, actorId);
    });
    await this.invalidate();
    return { ok: true };
  }

  // ── Payments ─────────────────────────────────────────────────────────

  async pay(id: string, body: any, actorId?: string) {
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("Payment amount must be greater than zero");

    const taxWithheld = Math.max(0, Number(body.taxWithheld ?? 0));
    const net = Math.round((amount - taxWithheld) * 100) / 100;
    const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();
    const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());

    const payment = await this.prisma.$transaction(async (tx) => {
      // Lock the engagement row, then recompute the balance from the payments
      // visible inside this transaction. Two concurrent "record payment" calls
      // used to read the same stale balance and both pass the cap check.
      await tx.$queryRaw`SELECT id FROM "VendorEngagement" WHERE id = ${id} FOR UPDATE`;
      const engagement = await tx.vendorEngagement.findUnique({
        where: { id },
        include: { payments: true },
      });
      if (!engagement) throw new NotFoundException("Engagement not found");
      if (engagement.status === "CANCELLED") throw new BadRequestException("Cancelled engagements cannot receive payments");

      const paid = this.paidOf(engagement.payments);
      const balance = Math.round((Number(engagement.totalAmount) - paid) * 100) / 100;
      const type = (body.type ?? (paid === 0 ? "ADVANCE" : balance <= amount ? "FINAL" : "PARTIAL")) as
        | "ADVANCE" | "PARTIAL" | "FINAL" | "REFUND";

      if (type === "REFUND") {
        if (amount > paid + 0.01) throw new BadRequestException("Refund cannot exceed the amount already paid");
      } else if (amount > balance + 0.01) {
        throw new BadRequestException(
          `Only ৳${balance.toLocaleString("en-US")} is left on this engagement. Reduce the amount or record the extra as a separate expense.`
        );
      }
      if (taxWithheld > amount) throw new BadRequestException("Tax withheld cannot exceed the payment amount");

      const row = await tx.vendorPayment.create({
        data: {
          engagementId: id,
          amount,
          type: type as any,
          paymentDate,
          paymentMethod: (body.paymentMethod ?? "BANK_TRANSFER") as any,
          referenceId: body.referenceId ?? null,
          bankAccountId: bankId ?? null,
          taxWithheld,
          notes: body.notes ?? null,
          recordedById: actorId ?? null,
        },
      });

      const acctBank = await this.ledger.accountByCode("1200", tx);
      const completed = engagement.status === "COMPLETED";
      const target = completed
        ? await this.ledger.accountByCode("2000", tx)
        : await this.ledger.ensureAccount("1400", "Prepaid Vendor Costs", "ASSET", tx);
      const lines: { accountId: string; debit: number; credit: number; memo?: string }[] = [];

      if (type === "REFUND") {
        lines.push({ accountId: acctBank.id, debit: amount, credit: 0, memo: `Refund from ${engagement.reference}` });
        lines.push({ accountId: target.id, debit: 0, credit: amount, memo: engagement.title });
      } else {
        lines.push({ accountId: target.id, debit: amount, credit: 0, memo: engagement.title });
        lines.push({ accountId: acctBank.id, debit: 0, credit: net, memo: engagement.reference });
        if (taxWithheld > 0) {
          const acctTds = await this.ledger.ensureAccount("2200", "TDS / VDS Payable", "LIABILITY", tx);
          lines.push({ accountId: acctTds.id, debit: 0, credit: taxWithheld, memo: "Tax withheld" });
        }
      }

      await this.ledger.postGL(
        type === "REFUND" ? "VENDOR_REFUND" : "VENDOR_PAYMENT",
        `${engagement.reference} / ${type}`,
        paymentDate,
        row.id,
        body.notes ?? null,
        lines,
        actorId,
        tx
      );

      if (bankId) {
        if (type === "REFUND") await this.ledger.creditBankAccount(bankId, amount, tx);
        else if (net > 0) await this.ledger.debitBankAccount(bankId, net, tx);
      }

      await logAudit(tx, "VendorPayment", row.id, type === "REFUND" ? "refunded" : "paid", {
        engagement: engagement.reference,
        amount,
        taxWithheld,
        net,
      }, actorId);

      return row;
    }, { timeout: 15000 });

    await this.invalidate();
    return { ...payment, engagement: await this.get(id) };
  }

  /** Mark work delivered / bill received — the moment a commitment becomes AP. */
  async complete(id: string, body: any, actorId?: string) {
    const engagement = await this.prisma.vendorEngagement.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!engagement) throw new NotFoundException("Engagement not found");
    if (engagement.status === "CANCELLED") throw new BadRequestException("Cancelled engagements cannot be completed");

    const total = Number(engagement.totalAmount);
    const prepaidPaid = this.paidOf(engagement.payments);
    const deliveredAt = body.deliveredAt ? new Date(body.deliveredAt) : new Date();
    const billReceivedAt = body.billReceivedAt ? new Date(body.billReceivedAt) : new Date();

    await this.prisma.$transaction(async (tx) => {
      const already = await tx.journalEntry.findFirst({
        where: { sourceId: id, entryType: "VENDOR_ACCRUAL", reversedEntryId: null },
      });
      if (!already) {
        const acctCost = await this.ledger.accountByCode(this.costCode(engagement.category), tx);
        const acctAP = await this.ledger.accountByCode("2000", tx);
        await this.ledger.postGL(
          "VENDOR_ACCRUAL",
          `${engagement.reference} / delivered`,
          deliveredAt,
          id,
          engagement.title,
          [
            { accountId: acctCost.id, debit: total, credit: 0, memo: engagement.title },
            { accountId: acctAP.id, debit: 0, credit: total, memo: engagement.reference },
          ],
          actorId,
          tx
        );
      }

      if (prepaidPaid > 0) {
        const acctPrepaid = await this.ledger.ensureAccount("1400", "Prepaid Vendor Costs", "ASSET", tx);
        const acctAP = await this.ledger.accountByCode("2000", tx);
        await this.ledger.postGL(
          "VENDOR_RECLASS",
          `${engagement.reference} / advance applied`,
          deliveredAt,
          id,
          "Prepaid advance applied to accounts payable",
          [
            { accountId: acctAP.id, debit: prepaidPaid, credit: 0 },
            { accountId: acctPrepaid.id, debit: 0, credit: prepaidPaid },
          ],
          actorId,
          tx
        );
      }

      await tx.vendorEngagement.update({
        where: { id },
        data: {
          status: "COMPLETED",
          deliveredAt,
          billReceivedAt,
          billNumber: body.billNumber ?? engagement.billNumber ?? null,
        },
      });
      await logAudit(tx, "VendorEngagement", id, "completed", { total, prepaidPaid }, actorId);
    }, { timeout: 15000 });

    await this.invalidate();
    return this.get(id);
  }

  /** Cancel an untouched commitment (no cash, no accrual). */
  async cancel(id: string, actorId?: string) {
    const engagement = await this.prisma.vendorEngagement.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!engagement) throw new NotFoundException("Engagement not found");
    if (engagement.payments.length > 0 || engagement.status === "COMPLETED") {
      throw new BadRequestException(
        "This engagement has money or costs attached. Refund the payments (and reverse the accrual) before cancelling."
      );
    }
    await this.prisma.vendorEngagement.update({ where: { id }, data: { status: "CANCELLED" } });
    await this.prisma.$transaction((tx) => logAudit(tx, "VendorEngagement", id, "cancelled", {}, actorId));
    await this.invalidate();
    return this.get(id);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private paidOf(payments: { amount: any; type: string }[]) {
    const sum = (types: string[]) =>
      payments.filter((p) => types.includes(p.type)).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    return Math.round((sum(["ADVANCE", "PARTIAL", "FINAL"]) - sum(["REFUND"])) * 100) / 100;
  }

  private compute(e: any) {
    const payments = e.payments ?? [];
    const total = Number(e.totalAmount);
    const paid = this.paidOf(payments);
    const balance = e.status === "CANCELLED" ? 0 : Math.round(Math.max(total - paid, 0) * 100) / 100;
    const taxWithheld = Math.round(
      payments.reduce((s: number, p: any) => s + Number(p.taxWithheld ?? 0), 0) * 100
    ) / 100;
    const retention = Math.round(((total * Number(e.retentionPct ?? 0)) / 100) * 100) / 100;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = balance > 0 && !!e.dueDate && new Date(e.dueDate) < today && e.status !== "CANCELLED";
    const daysOverdue = overdue
      ? Math.max(0, Math.floor((today.getTime() - new Date(e.dueDate).getTime()) / 86400000))
      : 0;
    const paymentState = balance <= 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "UNPAID";
    const unbilledPaid = e.status !== "COMPLETED" && e.status !== "CANCELLED" ? paid : 0;

    return {
      ...e,
      totalAmount: total,
      paid,
      balance,
      retention,
      taxWithheld,
      overdue,
      daysOverdue,
      paymentState,
      unbilledPaid,
      paymentCount: payments.length,
    };
  }

  private summarise(rows: any[], other: any) {
    const live = rows.filter((r) => r.status !== "CANCELLED");
    const totalCommitted = live.reduce((s, r) => s + r.totalAmount, 0);
    const totalPaid = live.reduce((s, r) => s + r.paid, 0);
    const totalPayable = live.reduce((s, r) => s + r.balance, 0);
    const overdueRows = live.filter((r) => r.overdue);
    const overdueAmount = overdueRows.reduce((s, r) => s + r.balance, 0);
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    const dueWeekRows = live.filter(
      (r) => r.balance > 0 && r.dueDate && !r.overdue && new Date(r.dueDate) <= soon
    );
    const advanceOutstanding = live.reduce((s, r) => s + r.unbilledPaid, 0);
    const retentionHeld = live.reduce((s, r) => s + r.retention, 0);

    // AP KPI: of the engagements already settled, how many were paid by the due date?
    const settled = live.filter((r) => r.balance <= 0 && (r.payments?.length ?? 0) > 0);
    let onTime = 0;
    for (const r of settled) {
      const last = (r.payments ?? []).reduce(
        (d: number, p: any) => Math.max(d, new Date(p.paymentDate).getTime()),
        0
      );
      const due = r.dueDate ? new Date(r.dueDate).getTime() + 86400000 : Infinity;
      if (last <= due) onTime += 1;
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      totalCommitted: r2(totalCommitted),
      totalPaid: r2(totalPaid),
      totalPayable: r2(totalPayable),
      overdueAmount: r2(overdueAmount),
      overdueCount: overdueRows.length,
      dueWeekAmount: r2(dueWeekRows.reduce((s, r) => s + r.balance, 0)),
      dueWeekCount: dueWeekRows.length,
      advanceOutstanding: r2(advanceOutstanding),
      retentionHeld: r2(retentionHeld),
      openCount: live.filter((r) => r.balance > 0).length,
      vendorCount: new Set(live.map((r) => r.vendorId)).size,
      settledCount: settled.length,
      onTimeRate: settled.length ? Math.round((onTime / settled.length) * 100) : null,
      otherPayables: other.total,
      otherPayablesOverdue: other.overdue,
      otherPayablesCount: other.count,
      combinedPayable: r2(totalPayable + other.total),
      combinedOverdue: r2(overdueAmount + other.overdue),
    };
  }

  /** Payable expenses already in the ledger (bills entered before this module existed). */
  private async expensePayables() {
    const rows = await this.prisma.expense.findMany({
      where: { isPayable: true, approvalStatus: "APPROVED" },
      select: { amount: true, paidAmount: true, dueDate: true, date: true },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let total = 0;
    let overdue = 0;
    let count = 0;
    for (const e of rows) {
      const bal = Math.max(Number(e.amount) - Number(e.paidAmount ?? 0), 0);
      if (bal <= 0) continue;
      total += bal;
      count += 1;
      const due = e.dueDate ?? e.date;
      if (due && new Date(due) < today) overdue += bal;
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { total: r2(total), overdue: r2(overdue), count };
  }

  private aging(rows: any[]) {
    const buckets: Record<string, number> = { CURRENT: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const r of rows) {
      if (r.balance <= 0 || r.status === "CANCELLED") continue;
      const key =
        !r.dueDate || r.daysOverdue <= 0
          ? "CURRENT"
          : r.daysOverdue <= 30
            ? "1-30"
            : r.daysOverdue <= 60
              ? "31-60"
              : r.daysOverdue <= 90
                ? "61-90"
                : "90+";
      buckets[key] += r.balance;
    }
    for (const k of Object.keys(buckets)) buckets[k] = Math.round(buckets[k] * 100) / 100;
    return buckets;
  }

  private group(rows: any[], by: "vendor" | "project") {
    const map = new Map<string, { id: string; name: string; total: number; paid: number; balance: number; overdue: number }>();
    for (const r of rows) {
      if (r.status === "CANCELLED") continue;
      const id = by === "vendor" ? r.vendorId : r.projectId ?? "unassigned";
      const name = by === "vendor" ? r.vendor?.name ?? "Unassigned" : r.project?.name ?? "Unassigned";
      const cur = map.get(id) ?? { id, name, total: 0, paid: 0, balance: 0, overdue: 0 };
      cur.total += r.totalAmount;
      cur.paid += r.paid;
      cur.balance += r.balance;
      if (r.overdue) cur.overdue += r.balance;
      map.set(id, cur);
    }
    return Array.from(map.values())
      .map((v) => ({
        ...v,
        total: Math.round(v.total * 100) / 100,
        paid: Math.round(v.paid * 100) / 100,
        balance: Math.round(v.balance * 100) / 100,
        overdue: Math.round(v.overdue * 100) / 100,
      }))
      .sort((a, b) => b.balance - a.balance);
  }

  private costCode(category: string) {
    if (["CREW", "FREELANCE", "TALENT"].includes(category)) return "5010";
    if (["EQUIPMENT", "STUDIO", "LOCATION", "POST_PRODUCTION", "TRANSPORT", "CATERING"].includes(category)) return "5020";
    return "5100";
  }

  private async nextReference(db: CapitalDb) {
    const year = new Date().getFullYear();
    const rows = await db.vendorEngagement.findMany({
      where: { reference: { startsWith: `LIA-${year}-` } },
      select: { reference: true },
    });
    const max = rows.reduce((m, r) => {
      const seq = parseInt(r.reference.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `LIA-${year}-${String(max + 1).padStart(4, "0")}`;
  }

  private async invalidate() {
    await invalidateFinance(this.cache);
    await this.cache.del("dashboard:overview");
  }
}
