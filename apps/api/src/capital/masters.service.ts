import { ConflictException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { invalidateFinance, logAudit, toBdt } from "./finance-kernel";

@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService
  ) {}


  async vendors() {
    return this.prisma.vendor.findMany({
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: "asc" },
    });
  }


  async createVendor(body: any) {
    return this.prisma.vendor.create({
      data: {
        name: body.name,
        contactInfo: body.contactInfo ?? null,
        category: body.category ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        paymentTerms: body.paymentTerms ?? null,
        bankDetails: body.bankDetails ?? null,
        isActive: body.isActive ?? true,
      },
    });
  }


  async updateVendor(id: string, body: any) {
    const existing = await this.prisma.vendor.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Vendor not found");
    return this.prisma.vendor.update({ where: { id }, data: body });
  }


  async deleteVendor(id: string) {
    const existing = await this.prisma.vendor.findUnique({ where: { id }, include: { _count: { select: { expenses: true } } } }).catch(() => null);
    if (!existing) throw new NotFoundException("Vendor not found");
    if (existing._count.expenses > 0) throw new ConflictException("Vendor has expenses - deactivate instead of deleting");
    return this.prisma.vendor.delete({ where: { id } });
  }


  async accounts() {
    return this.prisma.account.findMany({
      include: { _count: { select: { expenses: true } } },
      orderBy: { code: "asc" },
    });
  }


  async createAccount(body: any) {
    const valid = ["REVENUE", "DIRECT_COST", "OPEX", "ASSET", "LIABILITY"];
    return this.prisma.account.create({ data: { name: body.name, code: body.code ?? null, category: valid.includes(body.category) ? body.category : "OPEX" } as any });
  }


  async updateAccount(id: string, body: any) {
    const existing = await this.prisma.account.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Account not found");
    return this.prisma.account.update({ where: { id }, data: body });
  }


  async deleteAccount(id: string) {
    const existing = await this.prisma.account.findUnique({ where: { id }, include: { _count: { select: { expenses: true } } } }).catch(() => null);
    if (!existing) throw new NotFoundException("Account not found");
    if (existing._count.expenses > 0) throw new ConflictException("Account has transactions - deactivate instead of deleting");
    return this.prisma.account.update({ where: { id }, data: { isActive: false } });
  }


  async bankAccounts() {
    // Primary first, then active, then by type — the invoice "Pay via" box and
    // every payment picker consume this order directly.
    return this.prisma.bankAccount.findMany({
      orderBy: [{ isPrimary: "desc" }, { isActive: "desc" }, { accountType: "asc" }, { accountName: "asc" }],
    });
  }


  /** Only these fields may be written from the API; the rest are managed by the ledger. */
  private bankAccountData(body: any, { creating = false } = {}) {
    const TYPES = ["BANK", "BKASH", "NAGAD", "ROCKET", "UPAY", "CASH"];
    const data: any = {};
    const text = (key: string, max = 120) => {
      if (body[key] === undefined) return;
      const value = typeof body[key] === "string" ? body[key].trim() : "";
      data[key] = value ? value.slice(0, max) : null;
    };
    if (body.accountName !== undefined || creating) {
      const name = String(body.accountName ?? "").trim();
      if (!name) throw new BadRequestException("Account name is required");
      data.accountName = name.slice(0, 120);
    }
    if (body.accountType !== undefined || creating) {
      const type = String(body.accountType ?? "").toUpperCase();
      if (!TYPES.includes(type)) throw new BadRequestException("Pick a valid account type");
      data.accountType = type;
    }
    text("accountHolder");
    text("bankName");
    text("accountNumber", 40);
    text("branch");
    text("routingNumber", 40);
    if (body.currency !== undefined) data.currency = String(body.currency).toUpperCase().slice(0, 3) || "BDT";
    if (body.showOnInvoice !== undefined) data.showOnInvoice = !!body.showOnInvoice;
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    if (body.isPrimary !== undefined) data.isPrimary = !!body.isPrimary;
    if (creating && body.currentBalance !== undefined) data.currentBalance = Number(body.currentBalance) || 0;
    return data;
  }


  async createBankAccount(body: any) {
    const data = this.bankAccountData(body, { creating: true });
    return this.prisma.$transaction(async (tx) => {
      if (data.isPrimary) await tx.bankAccount.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
      await invalidateFinance(this.cache);
      return tx.bankAccount.create({ data });
    });
  }


  async updateBankAccount(id: string, body: any) {
    const existing = await this.prisma.bankAccount.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Bank account not found");
    const data = this.bankAccountData(body);
    return this.prisma.$transaction(async (tx) => {
      if (data.isPrimary) await tx.bankAccount.updateMany({ where: { isPrimary: true, id: { not: id } }, data: { isPrimary: false } });
      await invalidateFinance(this.cache);
      return tx.bankAccount.update({ where: { id }, data });
    });
  }


  /**
   * Money already moved through this account, so deleting it would orphan
   * ledger rows: deactivate it instead and say why. With `force`, the caller has
   * confirmed that history may be detached: payments/expenses/income keep their
   * amounts but lose the bank-account link, reconciliation rows are removed.
   */
  async deleteBankAccount(id: string, force = false) {
    const existing = await this.prisma.bankAccount.findUnique({
      where: { id },
      include: {
        _count: { select: { payments: true, expenses: true, manualIncome: true, statementLines: true } },
      },
    }).catch(() => null);
    if (!existing) throw new NotFoundException("Bank account not found");
    const used = existing._count.payments + existing._count.expenses + existing._count.manualIncome + existing._count.statementLines;
    if (used > 0 && !force) {
      await this.prisma.bankAccount.update({ where: { id }, data: { isActive: false, isPrimary: false } });
      await invalidateFinance(this.cache);
      return { deleted: false, deactivated: true, used };
    }
    await this.prisma.$transaction(async (tx) => {
      if (used > 0) {
        await tx.payment.updateMany({ where: { bankAccountId: id }, data: { bankAccountId: null } });
        await tx.expense.updateMany({ where: { bankAccountId: id }, data: { bankAccountId: null } });
        await tx.manualIncome.updateMany({ where: { bankAccountId: id }, data: { bankAccountId: null } });
        await tx.reconciliationRecord.deleteMany({ where: { bankAccountId: id } });
        await tx.bankStatementLine.deleteMany({ where: { bankAccountId: id } });
      }
      await tx.bankAccount.delete({ where: { id } });
    });
    await invalidateFinance(this.cache);
    return { deleted: true, deactivated: false, used };
  }

  // ── Expense category definitions (user-managed hierarchy) ────────────


  async bankTransactions(bankAccountId: string) {
    const [payments, expenses, manualIncome, records] = await Promise.all([
      this.prisma.payment.findMany({ where: { bankAccountId }, include: { invoice: { select: { invoiceNumber: true, client: { select: { companyName: true } } } } }, orderBy: { paymentDate: "desc" } }),
      this.prisma.expense.findMany({ where: { bankAccountId }, orderBy: { date: "desc" } }),
      this.prisma.manualIncome.findMany({ where: { bankAccountId }, orderBy: { date: "desc" } }),
      this.prisma.reconciliationRecord.findMany({ where: { bankAccountId }, orderBy: { statementDate: "desc" } }),
    ]);
    const paymentDirection = (p: { type: string; expenseId?: string | null }) =>
      p.type === "REFUND" || p.type === "OUT" || p.expenseId ? "OUT" : "IN";
    const txns = [
      ...payments.map((p) => {
        const dir = paymentDirection(p);
        return {
          id: p.id,
          date: p.paymentDate,
          ref: p.invoice?.invoiceNumber ?? p.referenceId ?? p.id,
          type: dir,
          amount: dir === "OUT" ? -toBdt(Number(p.amount), p) : toBdt(Number(p.amount), p),
          kind: dir === "OUT" ? "PAYMENT_OUT" : "PAYMENT",
          client: p.invoice?.client.companyName ?? null,
          note: p.notes,
        };
      }),
      ...expenses.map((e) => ({ id: e.id, date: e.date, ref: e.description, type: "OUT" as const, amount: -toBdt(Number(e.amount), e), kind: "EXPENSE", client: null, note: e.subcategory ?? null })),
      ...manualIncome.map((m) => ({ id: m.id, date: m.date, ref: m.description, type: "IN" as const, amount: toBdt(Number(m.amount), m), kind: "MANUAL_INCOME", client: null, note: m.notes })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { transactions: txns, records, bank: await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } }) };
  }


  async reconcile(body: { bankAccountId: string; statementDate: string; statementAmount: number; statementReference?: string; matchedPaymentId?: string; matchStatus?: string }) {
    if (!body.bankAccountId) throw new BadRequestException("Pick the bank account this statement line belongs to");
    const amount = Number(body.statementAmount);
    if (!Number.isFinite(amount)) throw new BadRequestException("Statement amount must be a number");
    if (!body.statementDate || Number.isNaN(new Date(body.statementDate).getTime())) {
      throw new BadRequestException("A valid statement date is required");
    }
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: body.bankAccountId }, select: { id: true } });
    if (!bank) throw new NotFoundException("Bank account not found");
    return this.prisma.reconciliationRecord.create({
      data: { bankAccountId: body.bankAccountId, statementDate: new Date(body.statementDate), statementAmount: amount, statementReference: body.statementReference ?? null, matchedPaymentId: body.matchedPaymentId ?? null, matchStatus: (body.matchStatus as any) ?? "UNMATCHED" },
    }).then(async (record) => {
      await invalidateFinance(this.cache);
      return record;
    });
  }


  async updateReconciliation(id: string, body: any) {
    return this.prisma.reconciliationRecord.update({ where: { id }, data: body });
  }

  // ── Income (payments + manual entries) ───────────────────────────────


  async budgets() {
    const [budgets, projectBudgetOnly] = await Promise.all([
      this.prisma.budget.findMany({
        include: { project: { select: { id: true, name: true } } },
        orderBy: { periodStart: "asc" },
      }),
      // A project carries its own planned amount on `Project.budgetAmount`.
      // Profitability reads that field while the Reports tab read only the
      // Budget table, so the two never agreed. Expose the project figure as a
      // synthetic row when no Budget record exists for it.
      this.prisma.project.findMany({
        where: {
          budgetAmount: { gt: 0 },
          NOT: { id: { in: (await this.prisma.budget.findMany({ where: { scopeType: "PROJECT", projectId: { not: null } }, select: { projectId: true } })).map((b) => b.projectId as string) } },
        },
        select: { id: true, name: true, budgetAmount: true, currency: true, startDate: true, targetEndDate: true },
      }),
    ]);
    // Only read expenses inside the budgets' own window instead of every
    // approved expense the workspace has ever recorded.
    const starts = budgets.map((b) => b.periodStart).filter((d): d is Date => !!d);
    const ends = budgets.map((b) => b.periodEnd).filter((d): d is Date => !!d);
    const from = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const to = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
    const expenses = await this.prisma.expense.findMany({
      where: {
        approvalStatus: "APPROVED",
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      select: { category: true, projectId: true, amount: true, date: true },
    });
    const rows = budgets.map((b) => {
      const spent = expenses
        .filter((e) => (b.scopeType === "PROJECT" ? e.projectId === b.projectId : !b.category || e.category === b.category))
        .filter((e) => (b.periodStart && b.periodEnd ? e.date >= b.periodStart && e.date <= b.periodEnd : true))
        .reduce((s, e) => s + Number(e.amount), 0);
      return { ...b, spent: Math.round(spent * 100) / 100 };
    });
    for (const p of projectBudgetOnly) {
      const spent = expenses.filter((e) => e.projectId === p.id).reduce((s, e) => s + Number(e.amount), 0);
      rows.push({
        id: `project:${p.id}`,
        scopeType: "PROJECT",
        projectId: p.id,
        departmentId: null,
        category: null,
        budgetAmount: p.budgetAmount,
        currency: p.currency ?? "BDT",
        periodStart: p.startDate ?? null,
        periodEnd: p.targetEndDate ?? null,
        project: { id: p.id, name: p.name },
        spent: Math.round(spent * 100) / 100,
        source: "project",
      } as any);
    }
    return rows;
  }


  async createBudget(body: any) {
    return this.prisma.budget.create({ data: { scopeType: body.scopeType, projectId: body.projectId ?? null, departmentId: body.departmentId ?? null, category: body.category ?? null, budgetAmount: body.budgetAmount, currency: body.currency ?? "BDT", periodStart: body.periodStart ? new Date(body.periodStart) : null, periodEnd: body.periodEnd ? new Date(body.periodEnd) : null } });
  }


  async updateBudget(id: string, body: any) {
    const existing = await this.prisma.budget.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Budget not found");
    const data: any = {};
    for (const f of ["scopeType", "projectId", "departmentId", "category", "budgetAmount", "currency"]) if (body[f] !== undefined) data[f] = body[f];
    if (body.periodStart !== undefined) data.periodStart = body.periodStart ? new Date(body.periodStart) : null;
    if (body.periodEnd !== undefined) data.periodEnd = body.periodEnd ? new Date(body.periodEnd) : null;
    return this.prisma.budget.update({ where: { id }, data });
  }


  async deleteBudget(id: string) {
    const existing = await this.prisma.budget.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Budget not found");
    return this.prisma.budget.delete({ where: { id } });
  }

  // ── Bank reconciliation ──────────────────────────────────────────────


  async expenseCategories() {
    return this.prisma.expenseCategoryDef.findMany({
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    });
  }


  async createExpenseCategory(body: any) {
    return this.prisma.expenseCategoryDef.create({
      data: { key: body.key, name: body.name, accountId: body.accountId ?? null, subcategories: body.subcategories ?? [] },
    });
  }


  async updateExpenseCategory(id: string, body: any) {
    const existing = await this.prisma.expenseCategoryDef.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException("Expense category not found");
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.accountId !== undefined) data.accountId = body.accountId;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.subcategories !== undefined) data.subcategories = body.subcategories;
    return this.prisma.expenseCategoryDef.update({ where: { id }, data });
  }

  // ── Budgets ──────────────────────────────────────────────────────────
}
