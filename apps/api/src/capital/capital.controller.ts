import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { basename } from "path";
import { existsSync } from "fs";
import { findUploadedFile, sanitizeFilename, uploadsDir } from "../common/file-storage";
import { CapitalService } from "./capital.service";
import { LiabilitiesService } from "./liabilities.service";
import { DollarService } from "./dollar.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

const receiptDir = () => uploadsDir("receipts");

@RequirePermission("CAPITAL")
@Controller("capital")
export class CapitalController {
  constructor(
    private readonly capital: CapitalService,
    private readonly liabilities: LiabilitiesService,
    private readonly dollar: DollarService
  ) {}

  // ── Dollar Desk (client FX sales) ────────────────────────────────────

  @Get("dollar/rate")
  dollarRate() {
    return this.dollar.getRate();
  }

  @Get("dollar/sales")
  dollarSales(@Query() query: any) {
    return this.dollar.list(query);
  }

  @Get("dollar/summary")
  dollarSummary() {
    return this.dollar.summary();
  }

  @Post("dollar/sales")
  createDollarSale(@Body() body: any, @CurrentUser() user: any) {
    return this.dollar.create(body, user?.sub);
  }

  @Delete("dollar/sales/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deleteDollarSale(@Param("id") id: string, @CurrentUser() user: any) {
    return this.dollar.remove(id, user?.sub);
  }

  // ── Liabilities (vendor commitments / payables) ──────────────────────

  @Get("engagements")
  engagements(@Query() query: any) {
    return this.liabilities.list(query);
  }

  @Get("engagements/summary")
  engagementSummary() {
    return this.liabilities.summary();
  }

  @Get("engagements/:id")
  engagement(@Param("id") id: string) {
    return this.liabilities.get(id);
  }

  @Post("engagements")
  createEngagement(@Body() body: any, @CurrentUser() user: any) {
    return this.liabilities.create(body, user?.sub);
  }

  @Patch("engagements/:id")
  updateEngagement(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.liabilities.update(id, body, user?.sub);
  }

  @Post("engagements/:id/payments")
  payEngagement(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.liabilities.pay(id, body, user?.sub);
  }

  @Post("engagements/:id/complete")
  completeEngagement(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.liabilities.complete(id, body, user?.sub);
  }

  @Post("engagements/:id/cancel")
  cancelEngagement(@Param("id") id: string, @CurrentUser() user: any) {
    return this.liabilities.cancel(id, user?.sub);
  }

  @Delete("engagements/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deleteEngagement(@Param("id") id: string, @CurrentUser() user: any) {
    return this.liabilities.remove(id, user?.sub);
  }

  @Get("overview")
  overview() {
    return this.capital.overview();
  }

  @Get("invoices")
  invoices(@Query() query: any) {
    return this.capital.invoices(query);
  }

  @Get("invoices/next-number")
  nextInvoiceNumber() {
    return this.capital.nextInvoiceNumberPreview();
  }

  @Get("invoices/:id")
  invoiceDetail(@Param("id") id: string) {
    return this.capital.invoiceDetail(id);
  }

  @Get("invoices/:id/project-balance")
  projectBalance(@Param("id") id: string) {
    return this.capital.projectBalance(id);
  }

  @Post("invoices")
  createInvoice(@Body() body: any, @CurrentUser() user: any) {
    return this.capital.createInvoice(body, user?.sub);
  }

  @Patch("invoices/:id")
  updateInvoice(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.updateInvoice(id, body, user?.sub);
  }

  @Post("invoices/:id/duplicate")
  duplicateInvoice(@Param("id") id: string) {
    return this.capital.duplicateInvoice(id);
  }

  @Delete("invoices/:id")
  @RequirePermission("CAPITAL", "edit")
  deleteInvoice(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.deleteInvoice(id, actorId);
  }

  @Post("invoices/:id/payment")
  recordPayment(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.recordPayment(id, body, user?.sub);
  }

  /** Undo a single payment (wrong amount / duplicate entry). */
  @Delete("invoices/:id/payments/:paymentId")
  @Roles("Owner", "Finance", "CONTROL")
  deletePayment(@Param("id") id: string, @Param("paymentId") paymentId: string, @CurrentUser() user: any) {
    return this.capital.deletePayment(id, paymentId, user?.sub);
  }

  @Get("invoices/:id/reminders")
  listReminders(@Param("id") id: string) {
    return this.capital.listReminders(id);
  }

  @Post("invoices/:id/reminders")
  logReminder(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.logReminder(id, body, user?.sub);
  }

  @Get("invoices/:id/share")
  shareInfo(@Param("id") id: string) {
    return this.capital.shareInfo(id);
  }

  @Post("invoices/:id/share")
  rotateShare(@Param("id") id: string) {
    return this.capital.rotateShareToken(id);
  }

  @Post("invoices/:id/share/ensure")
  ensureShare(@Param("id") id: string) {
    return this.capital.ensureShareToken(id);
  }

  @Delete("invoices/:id/share")
  revokeShare(@Param("id") id: string) {
    return this.capital.revokeShareToken(id);
  }

  @Get("invoices/:id/whatsapp")
  whatsappLogs(@Param("id") id: string) {
    return this.capital.whatsappLogs(id);
  }

  @Post("invoices/:id/whatsapp")
  sendWhatsapp(@Param("id") id: string, @Body() body: { template?: string; force?: boolean }) {
    return this.capital.sendInvoiceWhatsapp(id, body?.template, body?.force);
  }

  @Get("expenses")
  expenses(@Query() query: any, @CurrentUser() user: any) {
    return this.capital.expenses(query, user?.sub);
  }

  // ── Expense approval matrix ───────────────────────────────────────────
  @Get("approval-policy")
  approvalPolicy() {
    return this.capital.approvalPolicy();
  }

  @Patch("approval-policy")
  @Roles("Owner", "Finance", "CONTROL")
  updateApprovalPolicy(@Body() body: any) {
    return this.capital.updateApprovalPolicy(body);
  }

  @Post("expenses")
  createExpense(@Body() body: any, @CurrentUser() user: any) {
    return this.capital.createExpense(body, user?.sub);
  }

  @Patch("expenses/:id")
  updateExpense(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.updateExpense(id, body, user?.sub);
  }

  @Delete("expenses/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deleteExpense(@Param("id") id: string) {
    return this.capital.deleteExpense(id);
  }

  @Post("expenses/:id/payment")
  payExpense(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.payExpense(id, body, user?.sub);
  }

  /**
   * Receipt upload for an expense. Images and PDFs up to 8 MB; the file is
   * served back from an unguessable UUID path so <img>/<a> can render it
   * without an auth header (the name is the capability).
   */
  @Post("expenses/:id/receipt")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, receiptDir()),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}-${sanitizeFilename(file.originalname)}`),
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.mimetype);
        cb(ok ? null : new BadRequestException("Only PNG, JPEG, WebP or PDF receipts are allowed"), ok);
      },
    })
  )
  async uploadReceipt(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    const url = `/api/capital/receipts/${file.filename}`;
    try {
      await this.capital.updateExpense(id, { receiptUrl: url });
    } catch (error) {
      // The interceptor writes the file before the handler runs; if the expense
      // does not exist (or the update fails) remove it instead of leaving an
      // orphan receipt on disk.
      const { unlink } = await import("fs/promises");
      await unlink(file.path).catch(() => null);
      throw error;
    }
    return { url, name: file.originalname };
  }

  @Get("receipts/:filename")
  @Public()
  serveReceipt(@Param("filename") filename: string, @Res() res: any) {
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new BadRequestException("Invalid filename");
    }
    const safe = basename(sanitizeFilename(filename));
    const file = findUploadedFile("receipts", safe);
    if (!existsSync(file)) throw new NotFoundException("Receipt not found");
    return res.sendFile(file);
  }

  @Get("vendors")
  vendors() {
    return this.capital.vendors();
  }

  @Post("vendors")
  createVendor(@Body() body: any) {
    return this.capital.createVendor(body);
  }

  @Patch("vendors/:id")
  updateVendor(@Param("id") id: string, @Body() body: any) {
    return this.capital.updateVendor(id, body);
  }

  @Delete("vendors/:id")
  deleteVendor(@Param("id") id: string) {
    return this.capital.deleteVendor(id);
  }

  @Get("accounts")
  accounts() {
    return this.capital.accounts();
  }

  @Post("accounts")
  createAccount(@Body() body: any) {
    return this.capital.createAccount(body);
  }

  @Patch("accounts/:id")
  updateAccount(@Param("id") id: string, @Body() body: any) {
    return this.capital.updateAccount(id, body);
  }

  @Delete("accounts/:id")
  deleteAccount(@Param("id") id: string) {
    return this.capital.deleteAccount(id);
  }

  @Get("bank-accounts")
  bankAccounts() {
    return this.capital.bankAccounts();
  }

  @Post("bank-accounts")
  createBankAccount(@Body() body: any) {
    return this.capital.createBankAccount(body);
  }

  @Patch("bank-accounts/:id")
  updateBankAccount(@Param("id") id: string, @Body() body: any) {
    return this.capital.updateBankAccount(id, body);
  }

  @Get("bank-accounts/:id/transactions")
  bankTransactions(@Param("id") id: string) {
    return this.capital.bankTransactions(id);
  }

  @Get("expense-categories")
  expenseCategories() {
    return this.capital.expenseCategories();
  }

  @Post("expense-categories")
  createExpenseCategory(@Body() body: any) {
    return this.capital.createExpenseCategory(body);
  }

  @Patch("expense-categories/:id")
  updateExpenseCategory(@Param("id") id: string, @Body() body: any) {
    return this.capital.updateExpenseCategory(id, body);
  }

  @Get("budgets")
  budgets() {
    return this.capital.budgets();
  }

  @Post("budgets")
  createBudget(@Body() body: any) {
    return this.capital.createBudget(body);
  }

  @Patch("budgets/:id")
  updateBudget(@Param("id") id: string, @Body() body: any) {
    return this.capital.updateBudget(id, body);
  }

  @Delete("budgets/:id")
  deleteBudget(@Param("id") id: string) {
    return this.capital.deleteBudget(id);
  }

  @Get("reconciliation")
  reconciliation(@Query("bankAccountId") bankAccountId: string) {
    if (!bankAccountId) {
      throw new BadRequestException("bankAccountId is required (pick a bank account first)");
    }
    return this.capital.bankTransactions(bankAccountId);
  }

  @Post("reconciliation")
  reconcile(@Body() body: any) {
    return this.capital.reconcile(body);
  }

  @Patch("reconciliation/:id")
  updateReconciliation(@Param("id") id: string, @Body() body: any) {
    return this.capital.updateReconciliation(id, body);
  }

  @Get("income")
  income(@Query() query: any) {
    return this.capital.income(query);
  }

  @Post("income")
  createIncome(@Body() body: any, @CurrentUser() user: any) {
    return this.capital.createIncome(body, user?.sub);
  }

  @Delete("income/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deleteIncome(@Param("id") id: string, @CurrentUser() user: any) {
    return this.capital.deleteIncome(id, user?.sub);
  }

  @Get("income/stats")
  incomeStats() {
    return this.capital.incomeStats();
  }

  @Get("credit-notes")
  creditNotes() {
    return this.capital.creditNotes();
  }

  @Post("credit-notes")
  createCreditNote(@Body() body: any, @CurrentUser() user: any) {
    return this.capital.createCreditNote(body, user?.sub);
  }

  @Get("statements/trial-balance")
  trialBalance() {
    return this.capital.trialBalance();
  }

  @Get("statements/profit-loss")
  profitLoss() {
    return this.capital.profitLoss();
  }

  @Get("statements/balance-sheet")
  balanceSheet() {
    return this.capital.balanceSheet();
  }

  @Get("statements/cash-flow")
  cashFlow() {
    return this.capital.cashFlow();
  }

  @Get("aging/ap")
  apAging() {
    return this.capital.apAging();
  }

  @Get("reports")
  reportsData() {
    return this.capital.reportsData();
  }

  /** Monthly / custom-range totals for the downloadable report PDFs. */
  @Get("reports/period")
  reportPeriod(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.reportPeriod(from, to);
  }

  @Get("profitability")
  profitability() {
    return this.capital.profitability();
  }

  @Get("activity")
  activityLog() {
    return this.capital.activityLog();
  }

  @Get("aging")
  aging() {
    return this.capital.aging();
  }

  @Get("forecast")
  forecast() {
    return this.capital.forecast();
  }

  @Get("projects/:projectId/finance")
  projectFinance(@Param("projectId") projectId: string) {
    return this.capital.projectFinance(projectId);
  }

  @Post("recurring/run")
  runRecurringBilling() {
    return this.capital.runRecurringBilling();
  }

  @Get("installments/due")
  installmentsDue() {
    return this.capital.installmentsDue();
  }
}