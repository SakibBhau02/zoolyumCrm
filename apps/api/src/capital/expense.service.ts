import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LedgerService, CapitalDb } from "./ledger.service";
import { InvoiceService } from "./invoice.service";
import { ApprovalPolicyService } from "./approval-policy.service";
import { invalidateFinance, logAudit, notifyRole, toBdt } from "./finance-kernel";
import { recomputeProjectStats } from "../common/project-stats";
import { writeSystemAudit } from "../common/system-audit";

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly invoiceService: InvoiceService,
    private readonly approvalPolicy: ApprovalPolicyService
  ) {}


  async expenses(query: { status?: string; clientId?: string; q?: string; category?: string }, actorId?: string) {
    const rows = await this.prisma.expense.findMany({
      where: {
        ...(query.status ? { approvalStatus: query.status as any } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { OR: [{ description: { contains: query.q, mode: "insensitive" } }, { vendor: { name: { contains: query.q, mode: "insensitive" } } }] } : {}),
      },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      // Safety cap so an export-sized table can never arrive in one response.
      take: 500,
    });
    if (!rows.length) return rows;

    // Attach the caller's approval capability so the UI cannot offer a button
    // the server will refuse. Computed once per role+amount pair.
    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: { select: { name: true } } } }).catch(() => null)
      : null;
    const roleName = String((actor as any)?.role?.name ?? "");
    const cache = new Map<string, { canApprove: boolean; reason: string | null; limit: number | null }>();
    return Promise.all(
      rows.map(async (r) => {
        const key = `${r.amount}|${r.submittedById ?? ""}`;
        let cap = cache.get(key);
        if (!cap) {
          cap = await this.approvalPolicy.capability(roleName, Number(r.amount), r.submittedById, actorId);
          cache.set(key, cap);
        }
        return { ...r, approval: cap };
      })
    );
  }


  /**
   * A project expense always belongs to the project's client. Deriving the
   * client (instead of trusting an optional field) is what makes project spend
   * show up in the client's Accounts profitability.
   */
  private async resolveExpenseTarget(clientId?: string | null, projectId?: string | null) {
    if (!projectId) return { clientId: clientId || null, projectId: null as string | null };
    const project = await this.prisma.project
      .findUnique({ where: { id: projectId }, select: { id: true, clientId: true, name: true } })
      .catch(() => null);
    if (!project) throw new NotFoundException("Project not found");
    if (clientId && clientId !== project.clientId) {
      throw new BadRequestException(
        `Project "${project.name}" belongs to another client — the expense must use the project's own client.`
      );
    }
    return { clientId: project.clientId, projectId: project.id };
  }

  async createExpense(body: any, submittedById?: string) {
    if (!body.description?.trim()) {
      throw new BadRequestException("Expense description is required");
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("Expense amount must be greater than zero");
    }
    const target = await this.resolveExpenseTarget(body.clientId, body.projectId);
    body = { ...body, clientId: target.clientId, projectId: target.projectId };
    // Role-gated direct posting: only finance-privileged actors may create
    // pre-approved expenses (immediate bank + ledger hit). Everyone else's
    // APPROVED request is downgraded to PENDING (admin approval flow).
    let status = body.approvalStatus ?? "PENDING";
    if (status === "APPROVED" && submittedById) {
      const actor = await this.prisma.user.findUnique({ where: { id: submittedById }, select: { role: { select: { name: true } } } }).catch(() => null);
      const roleName = String((actor as any)?.role?.name ?? "");
      if (!["Owner", "Finance", "Admin", "HR/Admin", "CONTROL"].includes(roleName)) status = "PENDING";
      // The approval matrix applies to creation too (role + limit), but the
      // "different approver" rule is about approving *someone else's* pending
      // claim — it must not block a privileged actor's own direct posting,
      // which used to make "Record expense" impossible for Owner/Finance.
      if (status === "APPROVED") {
        await this.approvalPolicy.assertCanApprove({ actorId: submittedById, amount, submittedById: null });
      }
    }
    const isApproved = status === "APPROVED";
    const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());
    const savedExpense = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
      data: {
        description: body.description,
        amount: body.amount,
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        category: body.category ?? "MISC",
        subcategory: body.subcategory ?? null,
        date: body.date ? new Date(body.date) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        isPayable: body.isPayable ?? false,
        // A non-payable expense only becomes "paid" once it is actually
        // approved and the cash leaves the bank.
        paidAmount: body.isPayable ? 0 : isApproved ? amount : 0,
        isClientBillable: body.isClientBillable ?? false,
        clientId: body.clientId ?? null,
        projectId: body.projectId ?? null,
        paymentMethod: body.paymentMethod ?? "CASH",
        vendorId: body.vendorId ?? null,
        receiptUrl: body.receiptUrl ?? null,
        isRecurring: body.isRecurring ?? false,
        recurrenceSchedule: body.recurrenceSchedule ?? null,
        vendorBillNumber: body.vendorBillNumber ?? null,
        vendorBillDate: body.vendorBillDate ? new Date(body.vendorBillDate) : null,
        notes: body.notes ?? null,
        department: body.department ?? null,
        markupPct: body.markupPct != null ? Number(body.markupPct) : 0,
        approvalStatus: status,
        submittedById,
        approvedById: isApproved ? submittedById ?? undefined : undefined,
        accountId: body.accountId ?? null,
        bankAccountId: isApproved && !(body.isPayable ?? false) ? bankId : null,
        balanceDeducted: false,
      },
    });
    if (isApproved) await this.postExpenseGL(expense, submittedById, tx);
      // Direct-approved (non-payable) expenses hit the bank balance immediately,
      // mirroring the approve-transition path in updateExpense.
      if (isApproved && !expense.isPayable && bankId) {
        await this.ledger.debitBankAccount(bankId, toBdt(Number(expense.amount), expense), tx);
        await tx.expense.update({ where: { id: expense.id }, data: { balanceDeducted: true } });
      }
      return tx.expense.findUnique({ where: { id: expense.id } }).then((s) => s ?? expense);
    }, { timeout: 15000 });
    await this.invoiceService.syncProjectBilling(body.projectId ?? null);
    await invalidateFinance(this.cache);
    await recomputeProjectStats(this.prisma, savedExpense.projectId).catch(() => {});
    await writeSystemAudit(this.prisma, {
      actorId: submittedById,
      action: isApproved ? "expense.approved_on_create" : "expense.created",
      entityType: "Expense",
      entityId: savedExpense.id,
      after: { amount: Number(savedExpense.amount), projectId: savedExpense.projectId, status },
    });
    return savedExpense;
  }


  private async postExpenseGL(expense: any, actorId?: string, db: CapitalDb = this.prisma) {
    const [acctExp, acctAP, acctBank] = await Promise.all([
      db.account.findUnique({ where: { id: expense.accountId ?? "" } }).catch(() => null),
      this.ledger.accountByCode("2000", db),
      this.ledger.accountByCode("1200", db),
    ]);
    const def = await db.expenseCategoryDef.findUnique({ where: { key: expense.category } }).catch(() => null);
    const expenseAcct = acctExp ?? (def?.accountId ? await db.account.findUnique({ where: { id: def.accountId } }).catch(() => null) : null) ?? (await this.ledger.accountByCode("5070", db));
    // Book in BDT so a foreign-currency expense matches the cash it moved.
    const amount = toBdt(Number(expense.amount), expense);
    if (expense.isPayable) {
      await this.ledger.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        { accountId: expenseAcct.id, debit: amount, credit: 0, memo: expense.description },
        { accountId: acctAP.id, debit: 0, credit: amount },
      ], actorId, db);
    } else {
      await this.ledger.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        { accountId: expenseAcct.id, debit: amount, credit: 0, memo: expense.description },
        { accountId: acctBank.id, debit: 0, credit: amount },
      ], actorId, db);
    }
  }

  /** Public entry for other modules (e.g. payroll finalize) to journal an approved expense. */


  async postExpenseLedger(expenseId: string, actorId?: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new NotFoundException("Expense not found");
    await this.prisma.$transaction(async (tx) => {
      await this.postExpenseGL(expense, actorId, tx);
    }, { timeout: 15000 });
  }

  /** Public entry to reverse a posted journal (e.g. payroll reopen). */


  async reverseLedger(sourceId: string, actorId?: string) {
    await this.ledger.reverseGL(sourceId, actorId);
  }

  /** Role broadcast helper for sibling modules (payroll finalize, reminders). */


  async updateExpense(id: string, body: any, actorId?: string, opts?: { skipPayrollSync?: boolean }) {
    const existing = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense not found");
    if (body.projectId !== undefined || body.clientId !== undefined) {
      const target = await this.resolveExpenseTarget(
        body.clientId === undefined ? existing.clientId : body.clientId,
        body.projectId === undefined ? existing.projectId : body.projectId || null
      );
      body = { ...body, clientId: target.clientId };
      if (body.projectId !== undefined) body.projectId = target.projectId ?? undefined;
    }
    const data: any = {};
    for (const f of ["description", "date", "dueDate", "isClientBillable", "clientId", "projectId", "paymentMethod", "vendorId", "receiptUrl", "isRecurring", "recurrenceSchedule", "approvalStatus", "amount", "category", "subcategory", "isPayable", "accountId", "currency", "exchangeRate", "vendorBillNumber", "vendorBillDate", "notes", "department", "markupPct"]) {
      if (body[f] === undefined || body[f] === null || body[f] === "") continue;
      data[f] = f === "date" || f === "dueDate" || f === "vendorBillDate" ? new Date(body[f]) : body[f];
    }
    if (body.approvalStatus === "APPROVED" || body.approvalStatus === "REJECTED") {
      data.approvedBy = actorId ? { connect: { id: actorId } } : undefined;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("Expense amount must be greater than zero");
    }
    const wasApproved = existing.approvalStatus === "APPROVED";
    const willBeApproved = body.approvalStatus !== undefined ? body.approvalStatus === "APPROVED" : wasApproved;
    const wasPayable = existing.isPayable;
    const willBePayable = body.isPayable !== undefined ? Boolean(body.isPayable) : wasPayable;
    const newAmount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
    const newRate = body.exchangeRate !== undefined ? Number(body.exchangeRate) : Number(existing.exchangeRate ?? 1) || 1;
    const amountChanged =
      Math.abs(newAmount - Number(existing.amount)) > 0.001 || newRate !== (Number(existing.exchangeRate ?? 1) || 1);
    // Approval matrix applies when the expense enters APPROVED, and whenever an
    // already-approved amount is changed. A pure metadata edit (notes, vendor,
    // receipt) must not be blocked by the approver rule.
    if (willBeApproved && (!wasApproved || amountChanged)) {
      await this.approvalPolicy.assertCanApprove({
        actorId,
        amount: newAmount,
        submittedById: existing.submittedById,
      });
    }
    const ledgerFieldsChanged =
      amountChanged || body.category !== undefined || body.isPayable !== undefined || body.accountId !== undefined;
    // A non-payable expense is settled in cash, so its paid amount follows the
    // (possibly edited) total; a payable one is settled by vendor payments.
    if (willBeApproved && !willBePayable) data.paidAmount = newAmount;
    const result = await this.prisma.$transaction(async (tx) => {
      // Reverse only the EXPENSE journal — never the payment journals that share
      // the same sourceId — and only when the financial facts really changed.
      if (wasApproved && (!willBeApproved || ledgerFieldsChanged)) {
        await this.ledger.reverseGL(id, actorId, tx, ["EXPENSE"]);
      }
      if (!wasApproved && willBeApproved && !willBePayable && !existing.balanceDeducted) {
        const bankId = body.bankAccountId ?? existing.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
        if (bankId) {
          await this.ledger.debitBankAccount(bankId, toBdt(newAmount, { exchangeRate: newRate }), tx);
          data.bankAccount = { connect: { id: bankId } };
          data.balanceDeducted = true;
        }
      }
      // Editing the amount of an already-paid expense must move the same cash
      // that the ledger just re-posted, otherwise GL cash and the bank drift.
      if (wasApproved && willBeApproved && !willBePayable && existing.balanceDeducted && amountChanged) {
        const delta =
          toBdt(newAmount, { exchangeRate: newRate }) - toBdt(Number(existing.amount), existing);
        if (Math.abs(delta) > 0.001) {
          const bankId = existing.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
          if (bankId) {
            if (delta > 0) await this.ledger.debitBankAccount(bankId, delta, tx);
            else await this.ledger.creditBankAccount(bankId, Math.abs(delta), tx);
          }
        }
      }
      // Prisma checked inputs reject raw FK scalars whenever a to-one relation
      // op (e.g. approvedBy.connect) is present in the same payload — so always
      // translate FK scalars to relation ops here (null = disconnect).
      for (const [scalar, rel] of Object.entries({ accountId: "account", vendorId: "vendor", clientId: "client", projectId: "project" })) {
        if (data[scalar] !== undefined) {
          const v = data[scalar];
          delete data[scalar];
          data[rel] = v ? { connect: { id: v } } : { disconnect: true };
        }
      }
      const next = await tx.expense.update({ where: { id }, data });
      if (willBeApproved && (!wasApproved || ledgerFieldsChanged)) await this.postExpenseGL(next, actorId, tx);
      // Payroll sync-back: a finance-side edit of a posted salary expense flows
      // back into the linked payroll record (single source of truth + audit).
      if (existing.payrollRecordId && !opts?.skipPayrollSync && body.amount !== undefined) {
        const newAmount = Math.round(Number(body.amount) * 100) / 100;
        const oldAmount = Number(existing.amount);
        if (newAmount !== oldAmount) {
          const rec = await tx.payrollRecord.findUnique({ where: { id: existing.payrollRecordId } }).catch(() => null);
          if (rec) {
            const trail = Array.isArray((rec as any).auditTrail) ? (rec as any).auditTrail : [];
            await tx.payrollRecord.update({
              where: { id: rec.id },
              data: {
                netPay: newAmount,
                auditTrail: [...trail, { action: "finance-adjusted", at: new Date().toISOString(), by: actorId ?? "staff", before: { netPay: oldAmount }, after: { netPay: newAmount } }],
              },
            });
            // The bank delta for a paid salary expense is handled once, above,
            // by the general "amount changed" branch — not twice here.
          }
        }
      }
      return next;
    }, { timeout: 15000 });
    if (body.projectId !== undefined && body.projectId !== existing.projectId) await this.invoiceService.syncProjectBilling(existing.projectId);
    await this.invoiceService.syncProjectBilling(body.projectId ?? existing.projectId);
    await invalidateFinance(this.cache);
    await recomputeProjectStats(this.prisma, result.projectId).catch(() => {});
    await writeSystemAudit(this.prisma, {
      actorId,
      action: !wasApproved && willBeApproved ? "expense.approved" : wasApproved && !willBeApproved ? "expense.unapproved" : "expense.updated",
      entityType: "Expense",
      entityId: id,
      before: { amount: Number(existing.amount), approvalStatus: existing.approvalStatus },
      after: { amount: Number(result.amount), approvalStatus: result.approvalStatus },
    });
    return result;
  }


  async deleteExpense(id: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id }, include: { payments: true } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense not found");
    if (existing.payrollRecordId) {
      throw new BadRequestException("This salary is posted from payroll — reopen it there (or edit the amount) instead of deleting");
    }
    const payments = existing.payments ?? [];
    // Cash that vendor payments actually took out of the bank.
    const paidBack = payments
      .filter((p) => p.balanceCredited)
      .reduce((s, p) => s + (Number(p.amount) - Number(p.taxWithheld ?? 0)), 0);
    await this.prisma.$transaction(async (tx) => {
      if (existing.approvalStatus === "APPROVED") {
        // Reverse every journal this expense owns — the EXPENSE posting and each
        // vendor payment. The old code reversed only the newest one, leaving the
        // expense and half the payments booked after deletion.
        for (let guard = 0; guard < 20; guard++) {
          const reversal = await this.ledger.reverseGL(id, undefined, tx, ["EXPENSE", "EXPENSE_PAYMENT"]);
          if (!reversal) break;
        }
      }
      if (existing.balanceDeducted && existing.bankAccountId && !existing.isPayable) {
        await this.ledger.creditBankAccount(existing.bankAccountId, toBdt(Number(existing.amount), existing), tx);
      } else if (existing.isPayable && paidBack > 0.001) {
        const bankId = payments.find((p) => p.bankAccountId)?.bankAccountId ?? null;
        if (bankId) await this.ledger.creditBankAccount(bankId, paidBack, tx);
      }
      await tx.expense.delete({ where: { id } });
    }, { timeout: 15000 });
    await this.invoiceService.syncProjectBilling(existing.projectId);
    await invalidateFinance(this.cache);
    await recomputeProjectStats(this.prisma, existing.projectId).catch(() => {});
    await writeSystemAudit(this.prisma, {
      action: "expense.deleted",
      entityType: "Expense",
      entityId: id,
      before: { amount: Number(existing.amount), approvalStatus: existing.approvalStatus, projectId: existing.projectId },
    });
    return { ok: true };
  }

  // ── Pay a vendor expense (clears AP) ─────────────────────────────────


  async payExpense(id: string, body: { amount: number; paymentMethod: string; bankAccountId?: string; referenceId?: string; paymentDate?: string; notes?: string; taxWithheld?: number }, actorId?: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!expense) throw new NotFoundException("Expense not found");
    if (expense.approvalStatus !== "APPROVED") {
      throw new BadRequestException("Approve this expense before paying the vendor.");
    }
    const requested = Number(body.amount);
    if (!Number.isFinite(requested) || requested <= 0) throw new BadRequestException("Payment amount must be greater than zero");
    const remaining = Math.max(Number(expense.amount) - Number(expense.paidAmount ?? 0), 0);
    const amount = Math.min(requested, remaining);
    if (amount <= 0) throw new BadRequestException("Nothing left to pay on this expense");
    const taxWithheld = Math.max(0, Math.min(Number(body.taxWithheld ?? 0), amount));
    const net = Math.round((amount - taxWithheld) * 100) / 100;
    const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
      data: {
        expenseId: id,
        amount,
        currency: expense.currency,
        exchangeRate: expense.exchangeRate ?? 1,
        paymentMethod: body.paymentMethod as any,
        referenceId: body.referenceId ?? `EXP-${id.slice(-8)}/pay`,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
        notes: body.notes,
        recordedById: actorId,
        taxWithheld,
      },
    });
    // Cash in BDT: a foreign-currency bill is settled at its own rate.
    const netBdt = toBdt(net, expense);
    if (bankId) {
      if (netBdt > 0) await this.ledger.debitBankAccount(bankId, netBdt, tx);
      await tx.payment.update({ where: { id: created.id }, data: { bankAccountId: bankId, balanceCredited: true } });
    }
    const [acctAP, acctBank] = await Promise.all([this.ledger.accountByCode("2000", tx), this.ledger.accountByCode("1200", tx)]);
    const lines = [
      { accountId: acctAP.id, debit: toBdt(amount, expense), credit: 0 },
      { accountId: acctBank.id, debit: 0, credit: netBdt },
    ];
    if (taxWithheld > 0) {
      const acctTds = await this.ledger.ensureAccount("2200", "TDS / VDS Payable", "LIABILITY", tx);
      lines.push({ accountId: acctTds.id, debit: 0, credit: toBdt(taxWithheld, expense) });
    }
    await this.ledger.postGL(
      "EXPENSE_PAYMENT",
      `Pay ${expense.description} / ${created.referenceId}`,
      body.paymentDate ? new Date(body.paymentDate) : new Date(),
      id,
      null,
      lines,
      actorId,
      tx
    );
    const newPaid = Number(expense.paidAmount ?? 0) + amount;
    await tx.expense.update({ where: { id }, data: { paidAmount: newPaid, balanceDeducted: newPaid >= Number(expense.amount) } });
    await logAudit(tx, "Expense", id, "payment_recorded", { amount, taxWithheld, net, remaining: Math.max(Number(expense.amount) - newPaid, 0) }, actorId);
    return created;
    }, { timeout: 15000 });
    await invalidateFinance(this.cache);
    return payment;
  }


  async apAging() {
    return this.cache.wrap("capital:aging-ap", 60, () => this.computeApAging());
  }


  private async computeApAging() {
    const expenses = await this.prisma.expense.findMany({
      where: { isPayable: true, approvalStatus: "APPROVED" },
      include: { vendor: true, payments: { select: { amount: true, paymentDate: true } } },
      orderBy: { dueDate: "asc" },
    });
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buckets: Record<string, number> = { CURRENT: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const byVendor = new Map<string, { vendorId: string | null; vendorName: string; total: number; paid: number; due: number }>();
    let totalPayable = 0;
    for (const e of expenses) {
      const paid = e.payments.reduce((s, p) => s + Number(p.amount), 0);
      const bal = Math.max(Number(e.amount) - paid, 0);
      if (bal <= 0) continue;
      totalPayable += bal;
      const due = e.dueDate ?? e.date;
      const days = Math.floor((now.getTime() - due.getTime()) / 86400000);
      const key = days <= 0 ? "CURRENT" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      buckets[key] += bal;
      const v = byVendor.get(e.vendorId ?? "none") ?? { vendorId: e.vendorId, vendorName: e.vendor?.name ?? "Unassigned", total: 0, paid: 0, due: 0 };
      v.total += Number(e.amount);
      v.paid += paid;
      v.due += bal;
      byVendor.set(e.vendorId ?? "none", v);
    }
    for (const b of Object.keys(buckets)) buckets[b] = Math.round(buckets[b] * 100) / 100;
    return { totalPayable: Math.round(totalPayable * 100) / 100, buckets, byVendor: Array.from(byVendor.values()).map((v) => ({ ...v, total: Math.round(v.total * 100) / 100, paid: Math.round(v.paid * 100) / 100, due: Math.round(v.due * 100) / 100 })).sort((a, b) => b.due - a.due) };
  }

  // ── Vendors & accounts ───────────────────────────────────────────────
}
