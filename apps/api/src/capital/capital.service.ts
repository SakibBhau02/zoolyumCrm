import { Injectable } from "@nestjs/common";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InvoiceService } from "./invoice.service";
import { ExpenseService } from "./expense.service";
import { ReportingService } from "./reporting.service";
import { BillingService } from "./billing.service";
import { MastersService } from "./masters.service";
import { ApprovalPolicyService } from "./approval-policy.service";
import { LedgerService } from "./ledger.service";
import { PeriodsService } from "./periods.service";
import { ManualJournalService } from "./manual-journal.service";
import { FixedAssetsService } from "./fixed-assets.service";
import { VatService } from "./vat.service";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { FxRevaluationService } from "./fx-revaluation.service";
import { RevenueRecognitionService } from "./revenue-recognition.service";
import { ProvisionService } from "./provision.service";
import { TreasuryService } from "./treasury.service";
import { AuditExportService } from "./audit-export.service";
import { WhatsappTriggersService } from "../whatsapp/whatsapp-triggers.service";
import { invalidateFinance, notifyRole } from "./finance-kernel";

/**
 * CapitalService — stable facade over the Capital domain services.
 * The controller and cross-module callers (Flow, Payroll) keep talking to
 * this class; behaviour lives in Invoice/Expense/Reporting/Billing/Masters
 * services plus the shared LedgerService.
 */
@Injectable()
export class CapitalService {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly expenseService: ExpenseService,
    private readonly reportingService: ReportingService,
    private readonly billingService: BillingService,
    private readonly mastersService: MastersService,
    private readonly approvalPolicyService: ApprovalPolicyService,
    private readonly ledgerService: LedgerService,
    private readonly periodsService: PeriodsService,
    private readonly manualJournalService: ManualJournalService,
    private readonly fixedAssetsService: FixedAssetsService,
    private readonly vatService: VatService,
    private readonly bankService: BankReconciliationService,
    private readonly fxService: FxRevaluationService,
    private readonly revenueService: RevenueRecognitionService,
    private readonly provisionService: ProvisionService,
    private readonly treasuryService: TreasuryService,
    private readonly auditExportService: AuditExportService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly wa: WhatsappTriggersService
  ) {}

  async invalidateFinance() {
    return invalidateFinance(this.cache);
  }

  /**
   * Reverse every journal entry whose source document no longer exists.
   * Safe to re-run: an entry that is already reversed is skipped.
   */
  async repairOrphanJournals(actorId?: string) {
    const result = await this.ledgerService.reverseOrphanJournals(actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async notifyRole(role: string, type: string, title: string, message: string, link?: string | null, actorId?: string) {
    return notifyRole(this.notifications, role, type, title, message, link, actorId);
  }


  async invoices(query: { status?: string; clientId?: string; q?: string; page?: string; pageSize?: string; quick?: string; min?: string; max?: string }) {
    // A requested page switches to the paged contract; without it the legacy
    // array response is kept so existing callers (context, reports) still work.
    if (query.page || query.pageSize || query.quick) return this.invoiceService.invoicesPage(query);
    return this.invoiceService.invoices(query);
  }


  async invoiceDetail(id: string) {
    return this.invoiceService.invoiceDetail(id);
  }

  async projectBalance(id: string) {
    return this.invoiceService.projectBalance(id);
  }


  async listReminders(invoiceId: string) {
    return this.invoiceService.listReminders(invoiceId);
  }


  async logReminder(invoiceId: string, body: { type: string; channel?: string; recipientEmail?: string; recipientName?: string; subject?: string; notes?: string }, actorId?: string) {
    return this.invoiceService.logReminder(invoiceId, body, actorId);
  }

  async deleteReminder(invoiceId: string, reminderId: string) {
    return this.invoiceService.deleteReminder(invoiceId, reminderId);
  }


  async shareInfo(id: string) {
    return this.invoiceService.shareInfo(id);
  }


  async rotateShareToken(id: string) {
    return this.invoiceService.rotateShareToken(id);
  }


  async revokeShareToken(id: string) {
    return this.invoiceService.revokeShareToken(id);
  }


  async ensureShareToken(id: string) {
    return this.invoiceService.ensureShareToken(id);
  }


  async whatsappLogs(id: string) {
    return this.invoiceService.whatsappLogs(id);
  }


  async sendInvoiceWhatsapp(id: string, template?: string, force?: boolean) {
    return this.wa.sendInvoiceTemplate(id, template || "invoice_ready", { force });
  }


  async nextInvoiceNumberPreview() {
    return this.invoiceService.nextInvoiceNumberPreview();
  }


  async createInvoice(body: any, createdById?: string) {
    return this.invoiceService.createInvoice(body, createdById);
  }


  async updateInvoice(id: string, body: any, actorId?: string) {
    return this.invoiceService.updateInvoice(id, body, actorId);
  }


  async duplicateInvoice(id: string) {
    return this.invoiceService.duplicateInvoice(id);
  }


  async deleteInvoice(id: string, actorId?: string) {
    return this.invoiceService.deleteInvoice(id, actorId);
  }


  async recordPayment(invoiceId: string, body: { amount: number; paymentMethod: string; referenceId?: string; paymentDate?: string; notes?: string; bankAccountId?: string; installmentId?: string }, recordedById?: string) {
    return this.invoiceService.recordPayment(invoiceId, body, recordedById);
  }


  async deletePayment(invoiceId: string, paymentId: string, actorId?: string) {
    return this.invoiceService.deletePayment(invoiceId, paymentId, actorId);
  }


  async deleteIncome(id: string, actorId?: string) {
    return this.invoiceService.deleteIncome(id, actorId);
  }


  async income(query: { q?: string }) {
    return this.invoiceService.income(query);
  }


  async createIncome(body: any, actorId?: string) {
    return this.invoiceService.createIncome(body, actorId);
  }


  async creditNotes() {
    return this.invoiceService.creditNotes();
  }


  async createCreditNote(body: any, actorId?: string) {
    return this.invoiceService.createCreditNote(body, actorId);
  }


  async expenses(query: { status?: string; clientId?: string; q?: string; category?: string }, actorId?: string) {
    return this.expenseService.expenses(query, actorId);
  }


  async createExpense(body: any, submittedById?: string) {
    return this.expenseService.createExpense(body, submittedById);
  }


  async postExpenseLedger(expenseId: string, actorId?: string) {
    return this.expenseService.postExpenseLedger(expenseId, actorId);
  }

  /** Journal an expense inside a caller-owned transaction (payroll finalize). */
  async postExpenseLedgerWithin(tx: any, expense: any, actorId?: string) {
    return this.expenseService.postExpenseLedgerWithin(tx, expense, actorId);
  }


  async reverseLedger(sourceId: string, actorId?: string) {
    return this.expenseService.reverseLedger(sourceId, actorId);
  }


  async updateExpense(id: string, body: any, actorId?: string, opts?: { skipPayrollSync?: boolean }) {
    return this.expenseService.updateExpense(id, body, actorId, opts);
  }

  async approvalPolicy() {
    return this.approvalPolicyService.get();
  }

  async updateApprovalPolicy(body: any) {
    this.approvalPolicyService.validate(body);
    return this.approvalPolicyService.update(body);
  }


  async deleteExpense(id: string) {
    return this.expenseService.deleteExpense(id);
  }


  async payExpense(id: string, body: { amount: number; paymentMethod: string; bankAccountId?: string; referenceId?: string; paymentDate?: string; notes?: string }, actorId?: string) {
    return this.expenseService.payExpense(id, body, actorId);
  }


  async apAging() {
    return this.expenseService.apAging();
  }

  async unbilledExpenses() {
    return this.expenseService.unbilledExpenses();
  }


  async overview() {
    return this.reportingService.overview();
  }


  async aging() {
    return this.reportingService.aging();
  }


  async forecast() {
    return this.reportingService.forecast();
  }


  async projectFinance(projectId: string) {
    return this.reportingService.projectFinance(projectId);
  }


  async trialBalance(from?: string, to?: string) {
    return this.reportingService.trialBalance(from, to);
  }


  async profitLoss(from?: string, to?: string) {
    return this.reportingService.profitLoss(from, to);
  }


  async balanceSheet(asOf?: string) {
    return this.reportingService.balanceSheet(asOf);
  }


  async cashFlow(from?: string, to?: string) {
    return this.reportingService.cashFlow(from, to);
  }


  async reportsData() {
    return this.reportingService.reportsData();
  }


  /** Monthly / custom-range report used by the downloadable report PDFs. */
  async reportPeriod(from?: string, to?: string) {
    return this.reportingService.reportPeriod(from, to);
  }


  async profitability() {
    return this.reportingService.profitability();
  }


  async activityLog() {
    return this.reportingService.activityLog();
  }


  async incomeStats() {
    return this.reportingService.incomeStats();
  }


  async installmentsDue() {
    return this.billingService.installmentsDue();
  }


  async runRecurringBilling() {
    return this.billingService.runRecurringBilling();
  }


  async vendors() {
    return this.mastersService.vendors();
  }


  async createVendor(body: any) {
    return this.mastersService.createVendor(body);
  }


  async updateVendor(id: string, body: any) {
    return this.mastersService.updateVendor(id, body);
  }


  async deleteVendor(id: string) {
    return this.mastersService.deleteVendor(id);
  }


  async accounts() {
    return this.mastersService.accounts();
  }


  async createAccount(body: any) {
    return this.mastersService.createAccount(body);
  }


  async updateAccount(id: string, body: any) {
    return this.mastersService.updateAccount(id, body);
  }


  async deleteAccount(id: string) {
    return this.mastersService.deleteAccount(id);
  }


  async bankAccounts() {
    return this.mastersService.bankAccounts();
  }


  async createBankAccount(body: any) {
    return this.mastersService.createBankAccount(body);
  }


  async updateBankAccount(id: string, body: any) {
    return this.mastersService.updateBankAccount(id, body);
  }


  async bankTransactions(bankAccountId: string) {
    return this.mastersService.bankTransactions(bankAccountId);
  }


  async reconcile(body: { bankAccountId: string; statementDate: string; statementAmount: number; statementReference?: string; matchedPaymentId?: string; matchStatus?: string }) {
    return this.mastersService.reconcile(body);
  }


  async updateReconciliation(id: string, body: any) {
    return this.mastersService.updateReconciliation(id, body);
  }


  async budgets() {
    return this.mastersService.budgets();
  }


  async createBudget(body: any) {
    return this.mastersService.createBudget(body);
  }


  async updateBudget(id: string, body: any) {
    return this.mastersService.updateBudget(id, body);
  }


  async deleteBudget(id: string) {
    return this.mastersService.deleteBudget(id);
  }


  async expenseCategories() {
    return this.mastersService.expenseCategories();
  }


  async createExpenseCategory(body: any) {
    return this.mastersService.createExpenseCategory(body);
  }


  async updateExpenseCategory(id: string, body: any) {
    return this.mastersService.updateExpenseCategory(id, body);
  }

  // ── Period close ──────────────────────────────────────────────────────

  async periods(year?: string) {
    return this.periodsService.list(year);
  }

  async generatePeriods(year: number) {
    return this.periodsService.generateYear(year);
  }

  async createPeriod(body: any) {
    return this.periodsService.create(body);
  }

  async closePeriod(id: string, actorId?: string) {
    const result = await this.periodsService.close(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async reopenPeriod(id: string, actorId?: string) {
    const result = await this.periodsService.reopen(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async lockPeriod(id: string, actorId?: string) {
    return this.periodsService.lock(id, actorId);
  }

  async unlockPeriod(id: string, actorId?: string) {
    return this.periodsService.unlock(id, actorId);
  }

  async periodChecklist(id: string) {
    return this.periodsService.closeChecklist(id);
  }

  // ── Manual journals ───────────────────────────────────────────────────

  async manualJournals(query: any) {
    return this.manualJournalService.list(query);
  }

  async manualJournal(id: string) {
    return this.manualJournalService.get(id);
  }

  async manualJournalAccounts() {
    return this.manualJournalService.accounts();
  }

  async createManualJournal(body: any, actorId?: string) {
    return this.manualJournalService.create(body, actorId);
  }

  async updateManualJournal(id: string, body: any, actorId?: string) {
    return this.manualJournalService.update(id, body, actorId);
  }

  async postManualJournal(id: string, actorId?: string) {
    const result = await this.manualJournalService.post(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async voidManualJournal(id: string, actorId?: string) {
    const result = await this.manualJournalService.void(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async deleteManualJournal(id: string, actorId?: string) {
    return this.manualJournalService.remove(id, actorId);
  }

  // ── Fixed assets ──────────────────────────────────────────────────────

  async fixedAssets() {
    return this.fixedAssetsService.list();
  }

  async fixedAsset(id: string) {
    return this.fixedAssetsService.get(id);
  }

  async createFixedAsset(body: any, actorId?: string) {
    const result = await this.fixedAssetsService.create(body, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async updateFixedAsset(id: string, body: any, actorId?: string) {
    return this.fixedAssetsService.update(id, body, actorId);
  }

  async runDepreciation(period: string, actorId?: string) {
    const result = await this.fixedAssetsService.runDepreciation(period, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async disposeFixedAsset(id: string, body: any, actorId?: string) {
    const result = await this.fixedAssetsService.dispose(id, body, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  // ── VAT / withholding ─────────────────────────────────────────────────

  async vatSalesRegister(from?: string, to?: string) {
    return this.vatService.salesRegister(from, to);
  }

  async vatPurchaseRegister(from?: string, to?: string) {
    return this.vatService.purchaseRegister(from, to);
  }

  async vatReturn(from?: string, to?: string) {
    return this.vatService.returnSummary(from, to);
  }

  async withholdingRegister(from?: string, to?: string) {
    return this.vatService.withholdingRegister(from, to);
  }

  // ── Bank statement import / reconciliation ────────────────────────────

  async importBankStatement(bankAccountId: string, body: any, actorId?: string) {
    const result = await this.bankService.importStatement(bankAccountId, body, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async bankStatement(bankAccountId: string, status?: string) {
    return this.bankService.list(bankAccountId, status);
  }

  async autoMatchBank(bankAccountId: string, actorId?: string) {
    return this.bankService.autoMatch(bankAccountId, actorId);
  }

  async matchBankLine(lineId: string, body: any, actorId?: string) {
    return this.bankService.match(lineId, body, actorId);
  }

  async unmatchBankLine(lineId: string, actorId?: string) {
    return this.bankService.unmatch(lineId, actorId);
  }

  async ignoreBankLine(lineId: string, body: any, actorId?: string) {
    return this.bankService.ignore(lineId, body, actorId);
  }

  async deleteBankLine(lineId: string, actorId?: string) {
    return this.bankService.removeLine(lineId, actorId);
  }

  // ── FX revaluation ────────────────────────────────────────────────────

  async previewFxRevaluation(asOf: string | undefined, rates: any) {
    return this.fxService.preview(asOf, rates);
  }

  async postFxRevaluation(asOf: string | undefined, rates: any, actorId?: string) {
    const result = await this.fxService.post(asOf, rates, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async fxRevaluationHistory() {
    return this.fxService.history();
  }

  // ── Invoice approval ──────────────────────────────────────────────────

  async approveInvoice(id: string, actorId?: string) {
    const result = await this.invoiceService.approveInvoice(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async rejectInvoice(id: string, body: any, actorId?: string) {
    return this.invoiceService.rejectInvoice(id, body, actorId);
  }

  // ── Revenue recognition ───────────────────────────────────────────────

  async revenueSchedules(status?: string) {
    return this.revenueService.list(status);
  }

  async createRevenueSchedule(body: any, actorId?: string) {
    const result = await this.revenueService.create(body, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async runRevenueRecognition(period: string, actorId?: string) {
    const result = await this.revenueService.runRecognition(period, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async cancelRevenueSchedule(id: string, actorId?: string) {
    const result = await this.revenueService.cancel(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  // ── Bad-debt provision ────────────────────────────────────────────────

  async previewProvision(asOf?: string, rates?: Record<string, number>) {
    return this.provisionService.preview(asOf, rates);
  }

  async postProvision(asOf: string | undefined, rates: Record<string, number> | undefined, actorId?: string) {
    const result = await this.provisionService.post(asOf, rates, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async provisionHistory() {
    return this.provisionService.history();
  }

  // ── Treasury ──────────────────────────────────────────────────────────

  async treasuryRatios(days?: number) {
    return this.treasuryService.ratios(days);
  }

  async cashForecast(weeks?: number) {
    return this.treasuryService.forecast(weeks);
  }

  async pettyCash() {
    return this.treasuryService.pettyCash();
  }

  async createPettyCash(body: any, actorId?: string) {
    const result = await this.treasuryService.createPettyCash(body, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async deletePettyCash(id: string, actorId?: string) {
    const result = await this.treasuryService.deletePettyCash(id, actorId);
    await invalidateFinance(this.cache);
    return result;
  }

  async costByDepartment(from?: string, to?: string) {
    return this.reportingService.costByDepartment(from, to);
  }

  // ── Auditor export pack ───────────────────────────────────────────────

  async exportPack(from?: string, to?: string) {
    return this.auditExportService.pack(from, to);
  }

  async exportGeneralLedger(from?: string, to?: string) {
    return this.auditExportService.generalLedger(from, to);
  }

  async exportJournalListing(from?: string, to?: string) {
    return this.auditExportService.journalListing(from, to);
  }

  async exportAccountLedger(accountId: string, from?: string, to?: string) {
    return this.auditExportService.accountLedger(accountId, from, to);
  }

  async exportTrialBalance(from?: string, to?: string) {
    return this.auditExportService.trialBalanceCsv(from, to);
  }
}
