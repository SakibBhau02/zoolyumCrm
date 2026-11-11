import { Injectable } from "@nestjs/common";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InvoiceService } from "./invoice.service";
import { ExpenseService } from "./expense.service";
import { ReportingService } from "./reporting.service";
import { BillingService } from "./billing.service";
import { MastersService } from "./masters.service";
import { ApprovalPolicyService } from "./approval-policy.service";
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
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly wa: WhatsappTriggersService
  ) {}

  async invalidateFinance() {
    return invalidateFinance(this.cache);
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


  async trialBalance() {
    return this.reportingService.trialBalance();
  }


  async profitLoss() {
    return this.reportingService.profitLoss();
  }


  async balanceSheet() {
    return this.reportingService.balanceSheet();
  }


  async cashFlow() {
    return this.reportingService.cashFlow();
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
}
