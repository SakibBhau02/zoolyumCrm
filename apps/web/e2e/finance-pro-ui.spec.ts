import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
  await page.locator('input[type="password"]').fill("zoolyum123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

test("staff sees finance-pro UI on expenses & reports tabs", async ({ page }) => {
  await login(page);

  await page.goto("/capital?tab=expenses");
  await expect(page.getByText("Add Vendor", { exact: true })).toBeVisible();
  await expect(page.getByText("Record Expense", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Record Expense" }).last().click();
  await expect(page.getByText("Unpaid (accounts payable)", { exact: true })).toBeVisible();
  await expect(page.getByText("Subcategory", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto("/capital?tab=reports");
  await expect(page.getByText("GL Statements", { exact: true })).toBeVisible();
  await expect(page.getByText("Balanced:", { exact: false })).toBeVisible();
  await expect(page.getByText("Trial Balance", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Accounts Payable Aging", { exact: true })).toBeVisible();
  await expect(page.getByText("Budget Plans", { exact: true })).toBeVisible();
  await expect(page.getByText("Bank Reconciliation", { exact: true })).toBeVisible();

  await page.goto("/capital?tab=income");
  await expect(page.getByRole("button", { name: "Record Income" })).toBeVisible();
  await expect(page.getByText("MANUAL", { exact: true }).first()).toBeVisible();

  await page.goto("/capital?tab=profitability");
  await expect(page.getByText("Project Profitability", { exact: true })).toBeVisible();
});

test("staff manages vendors & accounts", async ({ page }) => {
  await login(page);

  await page.goto("/capital?tab=vendors");
  await expect(page.getByText("Add Vendor", { exact: true })).toBeVisible();
  await expect(page.getByText("Payment terms", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Vendor" }).last().click();
  await expect(page.getByText("Vendor name *", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto("/capital?tab=accounts");
  await expect(page.getByText("Add Account", { exact: true })).toBeVisible();
  await expect(page.getByText("Ledger balance", { exact: true })).toBeVisible();
  await expect(page.getByText("Accounts Receivable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Account" }).click();
  await expect(page.getByText("Account name *", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("staff sees credit notes and custom installments in invoice drawer", async ({ page }) => {
  await login(page);

  await page.goto("/capital?tab=invoices");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page.getByRole("button", { name: "Installments" })).toBeVisible();
  await expect(page.getByText("Credit notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Installments" }).click();
  await expect(page.getByText("Custom amounts & dates", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});