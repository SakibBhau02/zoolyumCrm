import { test, expect } from "@playwright/test";

test("staff can view an invoice from the capital Invoices tab", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
  await page.getByPlaceholder("••••••••").fill("zoolyum123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto("/capital/invoices");
  await expect(page.locator("tbody tr").first()).toBeVisible();

  const firstRow = page.locator("tbody tr").first();
  const rowText = (await firstRow.innerText()).trim();
  const invoiceNumber = (rowText.match(/ZLM-\d{4}-\d{4}/) ?? [""])[0];
  expect(invoiceNumber).not.toBe("");
  await firstRow.click();

  await expect(page.getByText(invoiceNumber, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Line items", { exact: true })).toBeVisible();
  await expect(page.getByText("Download PDF", { exact: true })).toBeVisible();
});