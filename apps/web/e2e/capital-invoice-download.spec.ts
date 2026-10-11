import { test, expect } from "@playwright/test";

async function openFirstInvoice(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
  await page.getByPlaceholder("••••••••").fill("zoolyum123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto("/capital/invoices");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page.getByText("Download PDF", { exact: true })).toBeVisible();
}

test("staff can download an invoice PDF from the capital invoice popup", async ({ page }) => {
  await openFirstInvoice(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByText("Download PDF", { exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(await download.failure()).toBeNull();
});