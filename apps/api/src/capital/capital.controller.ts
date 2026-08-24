import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CapitalService } from "./capital.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("capital")
export class CapitalController {
  constructor(private readonly capital: CapitalService) {}

  @Get("overview")
  overview() {
    return this.capital.overview();
  }

  @Get("invoices")
  invoices(@Query() query: any) {
    return this.capital.invoices(query);
  }

  @Get("invoices/:id")
  invoiceDetail(@Param("id") id: string) {
    return this.capital.invoiceDetail(id);
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
  deleteInvoice(@Param("id") id: string) {
    return this.capital.deleteInvoice(id);
  }

  @Post("invoices/:id/payment")
  recordPayment(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.recordPayment(id, body, user?.sub);
  }

  @Get("expenses")
  expenses(@Query() query: any) {
    return this.capital.expenses(query);
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
  deleteExpense(@Param("id") id: string) {
    return this.capital.deleteExpense(id);
  }

  @Post("expenses/:id/payment")
  payExpense(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.capital.payExpense(id, body, user?.sub);
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
}