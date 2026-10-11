import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LedgerService, CapitalDb } from "./ledger.service";
import { InvoiceService } from "./invoice.service";
import { invalidateFinance, logAudit, notifyRole } from "./finance-kernel";

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly invoiceService: InvoiceService
  ) {}


  async expenses(query: { status?: string; clientId?: string; q?: string; category?: string }) {
    return this.prisma.expense.findMany({
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
    });
  }


  async createExpense(body: any, submittedById?: string) {
    if (!body.description?.trim()) {
      throw new BadRequestException("Expense description is required");
    }
    if (body.amount === undefined || body.amount === null || Number.isNaN(Number(body.amount))) {
      throw new BadRequestException("Valid expense amount is required");
    }
    // Role-gated direct posting: only finance-privileged actors may create
    // pre-approved expenses (immediate bank + ledger hit). Everyone else's
    // APPROVED request is downgraded to PENDING (admin approval flow).
    let status = body.approvalStatus ?? "PENDING";
    if (status === "APPROVED" && submittedById) {
      const actor = await this.prisma.user.findUnique({ where: { id: submittedById }, select: { role: { select: { name: true } } } }).catch(() => null);
      const roleName = String((actor as any)?.role?.name ?? "");
      if (!["Owner", "Finance", "Admin", "HR/Admin", "CONTROL"].includes(roleName)) status = "PENDING";
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
        paidAmount: body.isPayable ? 0 : body.amount,
        isClientBillable: body.isClientBillable ?? false,
        clientId: body.clientId ?? null,
        projectId: body.projectId ?? null,
        paymentMethod: body.paymentMethod ?? "CASH",
        vendorId: body.vendorId ?? null,
        receiptUrl: body.receiptUrl ?? null,
        isRecurring: body.isRecurring ?? false,
        recurrenceSchedule: body.recurrenceSchedule ?? null,
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
        await this.ledger.debitBankAccount(bankId, Number(expense.amount), tx);
        await tx.expense.update({ where: { id: expense.id }, data: { balanceDeducted: true } });
      }
      return tx.expense.findUnique({ where: { id: expense.id } }).then((s) => s ?? expense);
    }, { timeout: 15000 });
    await this.invoiceService.syncProjectBilling(body.projectId ?? null);
    await invalidateFinance(this.cache);
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
    if (expense.isPayable) {
      await this.ledger.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        { accountId: expenseAcct.id, debit: Number(expense.amount), credit: 0, memo: expense.description },
        { accountId: acctAP.id, debit: 0, credit: Number(expense.amount) },
      ], actorId, db);
    } else {
      await this.ledger.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        { accountId: expenseAcct.id, debit: Number(expense.amount), credit: 0, memo: expense.description },
        { accountId: acctBank.id, debit: 0, credit: Number(expense.amount) },
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
    const data: any = {};
    for (const f of ["description", "date", "dueDate", "isClientBillable", "clientId", "projectId", "paymentMethod", "vendorId", "receiptUrl", "isRecurring", "recurrenceSchedule", "approvalStatus", "amount", "category", "subcategory", "isPayable", "accountId", "currency", "exchangeRate"]) {
      if (body[f] === undefined || body[f] === null || body[f] === "") continue;
      data[f] = f === "date" || f === "dueDate" ? new Date(body[f]) : body[f];
    }
    if (body.approvalStatus === "APPROVED" || body.approvalStatus === "REJECTED") {
      data.approvedBy = actorId ? { connect: { id: actorId } } : undefined;
    }
    const wasApproved = existing.approvalStatus === "APPROVED";
    const willBeApproved = body.approvalStatus !== undefined ? body.approvalStatus === "APPROVED" : wasApproved;
    const wasPayable = body.isPayable !== undefined ? body.isPayable : existing.isPayable;
    const result = await this.prisma.$transaction(async (tx) => {
      if (wasApproved && !willBeApproved) {
        await this.ledger.reverseGL(id, actorId, tx);
      }
      if (wasApproved && willBeApproved && (body.amount !== undefined || body.category !== undefined || body.isPayable !== undefined || body.accountId !== undefined)) {
        await this.ledger.reverseGL(id, actorId, tx);
      }
      if (!wasPayable && willBeApproved && !existing.balanceDeducted) {
        const bankId = body.bankAccountId ?? existing.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
        if (bankId) {
          await this.ledger.debitBankAccount(bankId, Number(body.amount ?? existing.amount), tx);
          data.bankAccount = { connect: { id: bankId } };
          data.balanceDeducted = true;
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
      if (willBeApproved) await this.postExpenseGL(next, actorId, tx);
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
            if (existing.balanceDeducted && existing.bankAccountId) {
              const diff = newAmount - oldAmount;
              if (diff !== 0) {
                await tx.bankAccount.update({ where: { id: existing.bankAccountId }, data: { currentBalance: { decrement: diff } } });
              }
            }
          }
        }
      }
      return next;
    }, { timeout: 15000 });
    if (body.projectId !== undefined && body.projectId !== existing.projectId) await this.invoiceService.syncProjectBilling(existing.projectId);
    await this.invoiceService.syncProjectBilling(body.projectId ?? existing.projectId);
    await invalidateFinance(this.cache);
    return result;
  }


  async deleteExpense(id: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense not found");
    if (existing.payrollRecordId) {
      throw new BadRequestException("This salary is posted from payroll — reopen it there (or edit the amount) instead of deleting");
    }
    await this.prisma.$transaction(async (tx) => {
      if (existing.approvalStatus === "APPROVED") await this.ledger.reverseGL(id, undefined, tx);
      if (existing.balanceDeducted && existing.bankAccountId && !existing.isPayable) {
        await this.ledger.creditBankAccount(existing.bankAccountId, Number(existing.amount), tx);
      }
      await tx.expense.delete({ where: { id } });
    }, { timeout: 15000 });
    await this.invoiceService.syncProjectBilling(existing.projectId);
    await invalidateFinance(this.cache);
    return { ok: true };
  }

  // ── Pay a vendor expense (clears AP) ─────────────────────────────────


  async payExpense(id: string, body: { amount: number; paymentMethod: string; bankAccountId?: string; referenceId?: string; paymentDate?: string; notes?: string }, actorId?: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } }).catch(() => null);
    if (!expense) throw new NotFoundException("Expense not found");
    const remaining = Math.max(Number(expense.amount) - Number(expense.paidAmount ?? 0), 0);
    const amount = Math.min(Number(body.amount), remaining);
    if (amount <= 0) throw new Error("Nothing left to pay on this expense");
    const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
      data: {
        expenseId: id,
        amount,
        paymentMethod: body.paymentMethod as any,
        referenceId: body.referenceId ?? `EXP-${id.slice(-8)}/pay`,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
        notes: body.notes,
        recordedById: actorId,
      },
    });
    if (bankId) {
      await this.ledger.debitBankAccount(bankId, amount, tx);
      await tx.payment.update({ where: { id: created.id }, data: { bankAccountId: bankId, balanceCredited: true } });
    }
    const [acctAP, acctBank] = await Promise.all([this.ledger.accountByCode("2000", tx), this.ledger.accountByCode("1200", tx)]);
    await this.ledger.postGL(
      "EXPENSE_PAYMENT",
      `Pay ${expense.description} / ${created.referenceId}`,
      body.paymentDate ? new Date(body.paymentDate) : new Date(),
      id,
      null,
      [
        { accountId: acctAP.id, debit: amount, credit: 0 },
        { accountId: acctBank.id, debit: 0, credit: amount },
      ],
      actorId,
      tx
    );
    const newPaid = Number(expense.paidAmount ?? 0) + amount;
    await tx.expense.update({ where: { id }, data: { paidAmount: newPaid, balanceDeducted: newPaid >= Number(expense.amount) } });
    await logAudit(tx, "Expense", id, "payment_recorded", { amount, remaining: Math.max(Number(expense.amount) - newPaid, 0) }, actorId);
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
