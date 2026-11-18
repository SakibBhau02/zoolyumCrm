import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LedgerService, CapitalDb } from "./ledger.service";
import { InvoiceService } from "./invoice.service";
import { ApprovalPolicyService } from "./approval-policy.service";
import { invalidateFinance, logAudit, notifyRole, toBdt } from "./finance-kernel";
import { recomputeProjectStats } from "../common/project-stats";
import { writeSystemAudit } from "../common/system-audit";
import { parseOptionalDate, parseStrictDate } from "../common/strict-date";

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


  async expenses(query: { status?: string; clientId?: string; q?: string; category?: string; limit?: string }, actorId?: string) {
    // Cached per viewer: each row carries *this* caller's approval capability,
    // so two roles must never share an entry. The capital context asks for this
    // list on every tab mount and after every write; it was a fresh read of
    // 300 rows (plus client/project/vendor joins) each time.
    return this.cache.wrapQuery(
      "capital:expenses",
      { ...query, actorId: actorId ?? "anon" },
      20,
      () => this.computeExpenses(query, actorId)
    );
  }

  private async computeExpenses(query: { status?: string; clientId?: string; q?: string; category?: string; limit?: string }, actorId?: string) {
    const take = Math.min(500, Math.max(1, Number(query.limit) || 300));
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
      take,
    });
    if (!rows.length) return rows;

    // Attach the caller's approval capability so the UI cannot offer a button
    // the server will refuse. The policy is read ONCE and evaluated in memory;
    // the previous per-amount cache meant 500 distinct amounts = 500 queries.
    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: { select: { name: true } } } }).catch(() => null)
      : null;
    const roleName = String((actor as any)?.role?.name ?? "");
    const policy = await this.approvalPolicy.policy();
    return rows.map((r) => ({
      ...r,
      approval: this.approvalPolicy.capabilityWith(policy, roleName, Number(r.amount), r.submittedById, actorId),
    }));
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
    if (body.description.trim().length > 2000) {
      throw new BadRequestException("Expense description must be 2000 characters or fewer");
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("Expense amount must be greater than zero");
    }
    if (body.exchangeRate !== undefined && body.exchangeRate !== null && body.exchangeRate !== "") {
      const rate = Number(body.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException("exchangeRate must be greater than zero");
    }
    // Same rule as invoices: a foreign-currency bill without a rate would be
    // booked 1:1 against a BDT cash account.
    const expenseCurrency = body.currency ?? "BDT";
    if (expenseCurrency !== "BDT" && (body.exchangeRate === undefined || body.exchangeRate === null || body.exchangeRate === "")) {
      throw new BadRequestException(`An exchange rate is required for ${expenseCurrency} expenses`);
    }
    if (body.markupPct !== undefined && body.markupPct !== null && body.markupPct !== "") {
      const pct = Number(body.markupPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 1000) throw new BadRequestException("markupPct must be between 0 and 1000");
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
        date: body.date ? parseStrictDate(body.date, "Expense date") : new Date(),
        dueDate: parseOptionalDate(body.dueDate, "Due date"),
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
        vendorBillDate: parseOptionalDate(body.vendorBillDate, "Vendor bill date"),
        notes: body.notes ?? null,
        department: body.department ?? null,
        markupPct: body.markupPct != null ? Number(body.markupPct) : 0,
        vatRate: body.vatRate != null && body.vatRate !== "" ? Number(body.vatRate) : 0,
        vatRecoverable: Boolean(body.vatRecoverable),
        inputVatAmount: this.resolveInputVat(body, amount),
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


  /** VAT carried on a vendor bill. An explicit amount wins; otherwise extract
   *  it from a VAT-inclusive total using the rate. */
  private resolveInputVat(body: any, gross: number) {
    const explicit = Number(body.inputVatAmount ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, gross);
    const rate = Number(body.vatRate ?? 0);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    return Math.round(((gross * rate) / (100 + rate)) * 100) / 100;
  }

  /**
   * Budget control: an expense may not push its project/department over the
   * approved budget unless the workspace has turned enforcement off.
   */
  private async assertWithinBudget(expenseId: string, projectId: string | null, department: string | null, amount: number) {
    const settings = await this.prisma.settings.findFirst({ select: { financeConfig: true } }).catch(() => null);
    const enforce = (settings?.financeConfig as any)?.enforceBudget !== false;
    if (!enforce) return;
    const budgets = await this.prisma.budget.findMany({
      where: {
        OR: [
          ...(projectId ? [{ scopeType: "PROJECT" as const, projectId }] : []),
          ...(department ? [{ scopeType: "DEPARTMENT" as const, departmentId: department }] : []),
        ],
      },
    });
    if (!budgets.length) return;
    for (const budget of budgets) {
      const spent = await this.prisma.expense.aggregate({
        where: {
          approvalStatus: "APPROVED",
          id: { not: expenseId },
          ...(budget.scopeType === "PROJECT" ? { projectId: budget.projectId } : { department: budget.departmentId }),
          ...(budget.periodStart || budget.periodEnd
            ? { date: { ...(budget.periodStart ? { gte: budget.periodStart } : {}), ...(budget.periodEnd ? { lte: budget.periodEnd } : {}) } }
            : {}),
        },
        _sum: { amount: true },
      });
      const used = Number(spent._sum.amount ?? 0);
      const limit = Number(budget.budgetAmount);
      if (used + amount > limit + 0.01) {
        throw new BadRequestException(
          `Budget exceeded: ${budget.scopeType === "PROJECT" ? "project" : "department"} budget is ৳${limit.toLocaleString("en-US")}, already spent ৳${used.toLocaleString("en-US")}. This expense of ৳${amount.toLocaleString("en-US")} would go over by ৳${Math.round(used + amount - limit).toLocaleString("en-US")}.`
        );
      }
    }
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
    const gross = toBdt(Number(expense.amount), expense);
    // Recoverable input VAT is not a cost: it sits in a receivable until the
    // return is filed, so only the net value hits the expense account.
    const cappedVat = Math.min(Number(expense.inputVatAmount ?? 0), Number(expense.amount));
    const vat = expense.vatRecoverable ? toBdt(cappedVat, expense) : 0;
    const net = Math.round((gross - vat) * 100) / 100;
    const acctVat = vat > 0 ? await this.ledger.ensureAccount("1300", "Input VAT Receivable", "ASSET", db) : null;
    const debitLegs: { accountId: string; debit: number; credit: number; memo?: string }[] = [
      { accountId: expenseAcct.id, debit: net, credit: 0, memo: expense.description },
    ];
    if (acctVat) debitLegs.push({ accountId: acctVat.id, debit: vat, credit: 0, memo: `Input VAT — ${expense.description}` });
    if (expense.isPayable) {
      await this.ledger.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        ...debitLegs,
        { accountId: acctAP.id, debit: 0, credit: gross },
      ], actorId, db);
    } else {
      await this.ledger.postGL("EXPENSE", `EXP-${expense.id.slice(-8)}`, expense.date, expense.id, null, [
        ...debitLegs,
        { accountId: acctBank.id, debit: 0, credit: gross },
      ], actorId, db);
    }
  }

  /** Public entry for other modules (e.g. payroll finalize) to journal an approved expense. */


  async postExpenseLedger(expenseId: string, actorId?: string) {    const expense = await this.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new NotFoundException("Expense not found");
    await this.prisma.$transaction(async (tx) => {
      await this.postExpenseGL(expense, actorId, tx);
    }, { timeout: 15000 });
  }

  /**
   * Journal an expense inside a caller-owned transaction.
   *
   * Payroll finalize creates the salary expense, posts the journal, moves the
   * bank and flags the expense. Doing that in separate transactions left
   * partial states (expense without journal, or cash moved with the flag off).
   */
  async postExpenseLedgerWithin(tx: CapitalDb, expense: any, actorId?: string) {
    await this.postExpenseGL(expense, actorId, tx);
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
    for (const f of ["description", "date", "dueDate", "isClientBillable", "clientId", "projectId", "paymentMethod", "vendorId", "receiptUrl", "isRecurring", "recurrenceSchedule", "approvalStatus", "amount", "category", "subcategory", "isPayable", "accountId", "currency", "exchangeRate", "vendorBillNumber", "vendorBillDate", "notes", "department", "markupPct", "vatRate", "vatRecoverable", "inputVatAmount"]) {
      if (body[f] === undefined || body[f] === null || body[f] === "") continue;
      data[f] = f === "date" || f === "dueDate" || f === "vendorBillDate" ? parseStrictDate(body[f], f) : body[f];
    }
    if (body.approvalStatus === "APPROVED" || body.approvalStatus === "REJECTED") {
      data.approvedBy = actorId ? { connect: { id: actorId } } : undefined;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("Expense amount must be greater than zero");
    }
    if (body.exchangeRate !== undefined && body.exchangeRate !== null && body.exchangeRate !== "") {
      const rate = Number(body.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException("exchangeRate must be greater than zero");
    }
    if (body.markupPct !== undefined && body.markupPct !== null && body.markupPct !== "") {
      const pct = Number(body.markupPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 1000) throw new BadRequestException("markupPct must be between 0 and 1000");
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
      // Approving is the moment the cost becomes real — check the budget here,
      // not at creation (a PENDING request must not consume budget).
      await this.assertWithinBudget(
        id,
        body.projectId !== undefined ? body.projectId : existing.projectId,
        body.department !== undefined ? body.department : existing.department,
        newAmount
      );
    }
    const ledgerFieldsChanged =
      amountChanged ||
      body.category !== undefined ||
      body.isPayable !== undefined ||
      body.accountId !== undefined ||
      body.vatRate !== undefined ||
      body.vatRecoverable !== undefined ||
      body.inputVatAmount !== undefined;
    // Keep the VAT component in step with an edited amount / rate.
    if (ledgerFieldsChanged && (body.amount !== undefined || body.vatRate !== undefined || body.inputVatAmount !== undefined)) {
      data.inputVatAmount = this.resolveInputVat(
        {
          vatRate: body.vatRate !== undefined ? body.vatRate : existing.vatRate,
          inputVatAmount: body.inputVatAmount !== undefined ? body.inputVatAmount : undefined,
        },
        newAmount
      );
    }
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
        // Direction is explicit: this row is cash leaving the business. Without
        // it the default IN made every vendor payout look like client income
        // in the income, cash-flow and bank-statement reports.
        type: "OUT",
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
    // Optimistic concurrency guard: two "Pay" clicks (or a retried request)
    // used to both read the same paidAmount and both debit the bank. Comparing
    // the previous value makes the second writer fail and roll back instead.
    const claimed = await tx.expense.updateMany({
      where: { id, paidAmount: expense.paidAmount ?? 0 },
      data: { paidAmount: newPaid, balanceDeducted: newPaid >= Number(expense.amount) },
    });
    if (claimed.count === 0) {
      throw new ConflictException("This expense was paid by another request. Refresh and try again.");
    }
    await logAudit(tx, "Expense", id, "payment_recorded", { amount, taxWithheld, net, remaining: Math.max(Number(expense.amount) - newPaid, 0) }, actorId);
    return created;
    }, { timeout: 15000 });
    await invalidateFinance(this.cache);
    return payment;
  }


  async apAging() {
    return this.cache.wrap("capital:aging-ap", 60, () => this.computeApAging());
  }

  /**
   * Client-billable expenses that have not been re-billed yet, priced with the
   * configured markup. This is what the pass-through billing flow needs: the
   * invoice line stores `linkedExpenseId`, so an expense disappears from this
   * list the moment it lands on an invoice.
   */
  async unbilledExpenses() {
    const rows = await this.prisma.expense.findMany({
      where: { isClientBillable: true, approvalStatus: "APPROVED" },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        linkedInvoiceLine: { select: { id: true, invoiceId: true } },
      },
      orderBy: { date: "desc" },
    });
    return rows
      .filter((e) => !e.linkedInvoiceLine)
      .map((e) => {
        const markup = Number(e.markupPct ?? 0);
        return {
          ...e,
          markupPct: markup,
          billableAmount: Math.round(Number(e.amount) * (1 + markup / 100) * 100) / 100,
        };
      });
  }


  private async computeApAging() {
    const [expenses, paidRows] = await Promise.all([
      this.prisma.expense.findMany({
        where: { isPayable: true, approvalStatus: "APPROVED" },
        select: { id: true, amount: true, date: true, dueDate: true, vendorId: true, vendor: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: 5000,
      }),
      // Sum payments once per expense instead of shipping every payment row.
      this.prisma.payment.groupBy({
        by: ["expenseId"],
        where: { expenseId: { not: null } },
        _sum: { amount: true },
      }),
    ]);
    const paidById = new Map(paidRows.map((r) => [r.expenseId as string, Number(r._sum.amount ?? 0)]));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buckets: Record<string, number> = { CURRENT: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const byVendor = new Map<string, { vendorId: string | null; vendorName: string; total: number; paid: number; due: number }>();
    let totalPayable = 0;
    for (const e of expenses) {
      const paid = paidById.get(e.id) ?? 0;
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
