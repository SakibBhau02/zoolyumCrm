import { test, expect } from "@playwright/test";

test("client can download an invoice PDF from the portal", async ({ page }) => {
  await page.goto("/portal-login");
  await page.getByPlaceholder("you@company.com").fill("principal@gvs.edu.bd");
  await page.getByPlaceholder("••••••••").fill("portal123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal-client/);

  await page.getByRole("button", { name: "Invoices" }).first().click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page.getByText("Download PDF", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByText("Download PDF", { exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(await download.failure()).toBeNull();
});