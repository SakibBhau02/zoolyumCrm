import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "crypto";
import { basename } from "path";
import { existsSync } from "fs";
import { findUploadedFile, sanitizeFilename, uploadsDir } from "../common/file-storage";
import { isConvertibleImage, optimizeUploadedImage } from "../common/image-pipeline";
import { CapitalService } from "./capital.service";
import { LiabilitiesService } from "./liabilities.service";
import { DollarService } from "./dollar.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { CreateCreditNoteDto, PayExpenseDto, RecordPaymentDto } from "./dto/payment.dto";

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

  /** Undo a vendor payment (wrong amount / duplicate) instead of refunding it. */
  @Delete("engagements/:id/payments/:paymentId")
  @Roles("Owner", "Finance", "CONTROL")
  deleteEngagementPayment(
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @CurrentUser("sub") actorId: string
  ) {
    return this.liabilities.deletePayment(id, paymentId, actorId);
  }

  @Post("engagements/:id/complete")
  completeEngagement(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.liabilities.complete(id, body, user?.sub);
  }

  /** Pay the withheld retention on a completed engagement. */
  @Post("engagements/:id/release-retention")
  @Roles("Owner", "Finance", "CONTROL")
  releaseRetention(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.liabilities.releaseRetention(id, body, actorId);
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
  recordPayment(@Param("id") id: string, @Body() body: RecordPaymentDto, @CurrentUser() user: any) {
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

  /** Undo a reminder logged from the dashboard (logged in error). */
  @Delete("invoices/:id/reminders/:reminderId")
  deleteReminder(
    @Param("id") id: string,
    @Param("reminderId") reminderId: string
  ) {
    return this.capital.deleteReminder(id, reminderId);
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

  /** Approved client-billable expenses that are not on an invoice yet. */
  @Get("expenses/unbilled")
  unbilledExpenses() {
    return this.capital.unbilledExpenses();
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
  payExpense(@Param("id") id: string, @Body() body: PayExpenseDto, @CurrentUser() user: any) {
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
    // Photos of receipts are the biggest uploads in the app; re-encode images
    // (WebP + optional JXL). PDFs pass through untouched.
    const image = isConvertibleImage(file.mimetype)
      ? await optimizeUploadedImage(file, { kind: "document", urlPrefix: "/api/capital/receipts" })
      : null;
    const url = image ? image.url : `/api/capital/receipts/${file.filename}`;
    try {
      await this.capital.updateExpense(id, { receiptUrl: url });
    } catch (error) {
      // The interceptor writes the file before the handler runs; if the expense
      // does not exist (or the update fails) remove it instead of leaving an
      // orphan receipt on disk.
      const { unlink } = await import("fs/promises");
      await unlink(image ? findUploadedFile("receipts", image.fileName) : file.path).catch(() => null);
      throw error;
    }
    return { url, jxlUrl: image?.jxlUrl ?? null, name: file.originalname };
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
  createCreditNote(@Body() body: CreateCreditNoteDto, @CurrentUser() user: any) {
    return this.capital.createCreditNote(body, user?.sub);
  }

  @Get("statements/trial-balance")
  trialBalance(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.trialBalance(from, to);
  }

  @Get("statements/profit-loss")
  profitLoss(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.profitLoss(from, to);
  }

  @Get("statements/balance-sheet")
  balanceSheet(@Query("asOf") asOf?: string) {
    return this.capital.balanceSheet(asOf);
  }

  @Get("statements/cash-flow")
  cashFlow(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.cashFlow(from, to);
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

  /**
   * Maintenance: reverse journal entries whose source document was deleted.
   * Financial records are never hard-deleted, so this is the only way to bring
   * AR / VAT / P&L back in line after a bad delete or a reseed.
   */
  @Post("maintenance/reverse-orphan-journals")
  @Roles("Owner", "Finance", "CONTROL")
  reverseOrphanJournals(@CurrentUser("sub") actorId: string) {
    return this.capital.repairOrphanJournals(actorId);
  }

  // ── Fiscal periods ────────────────────────────────────────────────────

  @Get("periods")
  periods(@Query("year") year?: string) {
    return this.capital.periods(year);
  }

  @Post("periods/generate")
  @Roles("Owner", "Finance", "CONTROL")
  generatePeriods(@Body() body: { year?: number }) {
    const year = Number(body?.year ?? new Date().getFullYear());
    return this.capital.generatePeriods(year);
  }

  @Post("periods")
  @Roles("Owner", "Finance", "CONTROL")
  createPeriod(@Body() body: any) {
    return this.capital.createPeriod(body);
  }

  @Get("periods/:id/checklist")
  periodChecklist(@Param("id") id: string) {
    return this.capital.periodChecklist(id);
  }

  @Post("periods/:id/close")
  @Roles("Owner", "Finance", "CONTROL")
  closePeriod(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.closePeriod(id, actorId);
  }

  @Post("periods/:id/reopen")
  @Roles("Owner", "Finance", "CONTROL")
  reopenPeriod(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.reopenPeriod(id, actorId);
  }

  @Post("periods/:id/lock")
  @Roles("Owner", "CONTROL")
  lockPeriod(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.lockPeriod(id, actorId);
  }

  @Post("periods/:id/unlock")
  @Roles("Owner", "CONTROL")
  unlockPeriod(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.unlockPeriod(id, actorId);
  }

  // ── Manual journals ───────────────────────────────────────────────────

  @Get("journals/accounts")
  journalAccounts() {
    return this.capital.manualJournalAccounts();
  }

  @Get("journals")
  journals(@Query() query: any) {
    return this.capital.manualJournals(query);
  }

  @Get("journals/:id")
  journal(@Param("id") id: string) {
    return this.capital.manualJournal(id);
  }

  @Post("journals")
  @Roles("Owner", "Finance", "CONTROL")
  createJournal(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.createManualJournal(body, actorId);
  }

  @Patch("journals/:id")
  @Roles("Owner", "Finance", "CONTROL")
  updateJournal(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.updateManualJournal(id, body, actorId);
  }

  @Post("journals/:id/post")
  @Roles("Owner", "Finance", "CONTROL")
  postJournal(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.postManualJournal(id, actorId);
  }

  @Post("journals/:id/void")
  @Roles("Owner", "Finance", "CONTROL")
  voidJournal(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.voidManualJournal(id, actorId);
  }

  @Delete("journals/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deleteJournal(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.deleteManualJournal(id, actorId);
  }

  // ── Fixed assets ──────────────────────────────────────────────────────

  @Get("assets")
  fixedAssets() {
    return this.capital.fixedAssets();
  }

  @Get("assets/:id")
  fixedAsset(@Param("id") id: string) {
    return this.capital.fixedAsset(id);
  }

  @Post("assets")
  @Roles("Owner", "Finance", "CONTROL")
  createFixedAsset(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.createFixedAsset(body, actorId);
  }

  @Patch("assets/:id")
  @Roles("Owner", "Finance", "CONTROL")
  updateFixedAsset(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.updateFixedAsset(id, body, actorId);
  }

  @Post("assets/:id/dispose")
  @Roles("Owner", "Finance", "CONTROL")
  disposeFixedAsset(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.disposeFixedAsset(id, body, actorId);
  }

  @Post("depreciation/run")
  @Roles("Owner", "Finance", "CONTROL")
  runDepreciation(@Body() body: { period?: string }, @CurrentUser("sub") actorId: string) {
    const period = body?.period ?? new Date().toISOString().slice(0, 7);
    return this.capital.runDepreciation(period, actorId);
  }

  // ── VAT / withholding ─────────────────────────────────────────────────

  @Get("vat/sales-register")
  vatSalesRegister(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.vatSalesRegister(from, to);
  }

  @Get("vat/purchase-register")
  vatPurchaseRegister(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.vatPurchaseRegister(from, to);
  }

  @Get("vat/return")
  vatReturn(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.vatReturn(from, to);
  }

  @Get("vat/withholding")
  withholdingRegister(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.withholdingRegister(from, to);
  }

  // ── Bank statement import / reconciliation ────────────────────────────

  @Post("bank-accounts/:id/statement/import")
  @Roles("Owner", "Finance", "CONTROL")
  importStatement(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.importBankStatement(id, body, actorId);
  }

  @Get("bank-accounts/:id/statement")
  bankStatement(@Param("id") id: string, @Query("status") status?: string) {
    return this.capital.bankStatement(id, status);
  }

  @Post("bank-accounts/:id/statement/auto-match")
  @Roles("Owner", "Finance", "CONTROL")
  autoMatchBank(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.autoMatchBank(id, actorId);
  }

  @Patch("statement-lines/:id/match")
  @Roles("Owner", "Finance", "CONTROL")
  matchBankLine(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.matchBankLine(id, body, actorId);
  }

  @Patch("statement-lines/:id/unmatch")
  @Roles("Owner", "Finance", "CONTROL")
  unmatchBankLine(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.unmatchBankLine(id, actorId);
  }

  @Patch("statement-lines/:id/ignore")
  @Roles("Owner", "Finance", "CONTROL")
  ignoreBankLine(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.ignoreBankLine(id, body, actorId);
  }

  @Delete("statement-lines/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deleteBankLine(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.deleteBankLine(id, actorId);
  }

  // ── FX revaluation ────────────────────────────────────────────────────

  @Post("fx/revaluation/preview")
  previewFxRevaluation(@Body() body: { asOf?: string; rates?: Record<string, number> }) {
    return this.capital.previewFxRevaluation(body?.asOf, body?.rates);
  }

  @Post("fx/revaluation")
  @Roles("Owner", "Finance", "CONTROL")
  postFxRevaluation(@Body() body: { asOf?: string; rates?: Record<string, number> }, @CurrentUser("sub") actorId: string) {
    return this.capital.postFxRevaluation(body?.asOf, body?.rates, actorId);
  }

  @Get("fx/revaluation/history")
  fxRevaluationHistory() {
    return this.capital.fxRevaluationHistory();
  }

  // ── Invoice approval workflow ─────────────────────────────────────────

  @Post("invoices/:id/approve")
  @Roles("Owner", "Finance", "CONTROL")
  approveInvoice(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.approveInvoice(id, actorId);
  }

  @Post("invoices/:id/reject")
  @Roles("Owner", "Finance", "CONTROL")
  rejectInvoice(@Param("id") id: string, @Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.rejectInvoice(id, body, actorId);
  }

  // ── Revenue recognition ───────────────────────────────────────────────

  @Get("revenue-schedules")
  revenueSchedules(@Query("status") status?: string) {
    return this.capital.revenueSchedules(status);
  }

  @Post("revenue-schedules")
  @Roles("Owner", "Finance", "CONTROL")
  createRevenueSchedule(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.createRevenueSchedule(body, actorId);
  }

  @Post("revenue-schedules/recognize")
  @Roles("Owner", "Finance", "CONTROL")
  runRevenueRecognition(@Body() body: { period?: string }, @CurrentUser("sub") actorId: string) {
    const period = body?.period ?? new Date().toISOString().slice(0, 7);
    return this.capital.runRevenueRecognition(period, actorId);
  }

  @Post("revenue-schedules/:id/cancel")
  @Roles("Owner", "Finance", "CONTROL")
  cancelRevenueSchedule(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.cancelRevenueSchedule(id, actorId);
  }

  // ── Bad-debt provision ────────────────────────────────────────────────

  @Post("provision/preview")
  previewProvision(@Body() body: { asOf?: string; rates?: Record<string, number> }) {
    return this.capital.previewProvision(body?.asOf, body?.rates);
  }

  @Post("provision")
  @Roles("Owner", "Finance", "CONTROL")
  postProvision(@Body() body: { asOf?: string; rates?: Record<string, number> }, @CurrentUser("sub") actorId: string) {
    return this.capital.postProvision(body?.asOf, body?.rates, actorId);
  }

  @Get("provision/history")
  provisionHistory() {
    return this.capital.provisionHistory();
  }

  // ── Treasury ──────────────────────────────────────────────────────────

  @Get("treasury/ratios")
  treasuryRatios(@Query("days") days?: string) {
    return this.capital.treasuryRatios(days ? Number(days) : undefined);
  }

  @Get("treasury/forecast")
  cashForecast(@Query("weeks") weeks?: string) {
    return this.capital.cashForecast(weeks ? Number(weeks) : undefined);
  }

  @Get("petty-cash")
  pettyCash() {
    return this.capital.pettyCash();
  }

  @Post("petty-cash")
  @Roles("Owner", "Finance", "CONTROL")
  createPettyCash(@Body() body: any, @CurrentUser("sub") actorId: string) {
    return this.capital.createPettyCash(body, actorId);
  }

  @Delete("petty-cash/:id")
  @Roles("Owner", "Finance", "CONTROL")
  deletePettyCash(@Param("id") id: string, @CurrentUser("sub") actorId: string) {
    return this.capital.deletePettyCash(id, actorId);
  }

  @Get("reports/by-department")
  costByDepartment(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.costByDepartment(from, to);
  }

  // ── Auditor export ────────────────────────────────────────────────────

  @Get("export/pack")
  exportPack(@Query("from") from?: string, @Query("to") to?: string) {
    return this.capital.exportPack(from, to);
  }

  @Get("export/general-ledger")
  async exportGeneralLedger(@Res() res: any, @Query("from") from?: string, @Query("to") to?: string) {
    const file = await this.capital.exportGeneralLedger(from, to);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    return res.send("\uFEFF" + file.csv);
  }

  @Get("export/journal-listing")
  async exportJournalListing(@Res() res: any, @Query("from") from?: string, @Query("to") to?: string) {
    const file = await this.capital.exportJournalListing(from, to);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    return res.send("\uFEFF" + file.csv);
  }

  @Get("export/trial-balance")
  async exportTrialBalance(@Res() res: any, @Query("from") from?: string, @Query("to") to?: string) {
    const file = await this.capital.exportTrialBalance(from, to);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    return res.send("\uFEFF" + file.csv);
  }

  @Get("export/ledger/:accountId")
  async exportAccountLedger(
    @Res() res: any,
    @Param("accountId") accountId: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    const file = await this.capital.exportAccountLedger(accountId, from, to);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    return res.send("\uFEFF" + file.csv);
  }
}