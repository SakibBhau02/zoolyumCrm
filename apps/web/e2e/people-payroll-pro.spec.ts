import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email = "sakib@zoolyum.com", password = "zoolyum123") {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

test("attendance: kiosk check-in, punch import + mapping, monthly report", async ({ page }) => {
  await login(page);
  await page.goto("/people/attendance");
  await page.waitForURL(/\/people\/attendance/);
  await expect(page.getByText("Attendance + hours")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Kiosk in" }).click();
  // The API refuses a second punch within a few minutes, which is correct.
  // Either outcome proves the kiosk round-trip works.
  await expect(page.getByText(/Checked in|Already punched/)).toBeVisible({ timeout: 10000 });

  const dev = "9" + Math.floor(Math.random() * 100000);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("textarea").fill(`${dev}\t${today} 09:05:12\t2\t1`);
  await page.getByRole("button", { name: "Import punches" }).last().click();
  // The modal closes only when the API accepts the import (errors stay inline).
  await expect(page.getByRole("button", { name: "Import punches" })).toBeHidden({ timeout: 10000 });

  await page.getByRole("button", { name: /^Punches/ }).click();
  await expect(page.getByText("Raw device punches")).toBeVisible();
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByText(/Recomputed/)).toBeVisible({ timeout: 10000 });

  await page.locator('input[placeholder^="Search"]').last().fill(dev);
  const row = page.locator("tr").filter({ hasText: dev }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole("combobox").selectOption({ index: 1 });
  // The status cell flips to "Mapped" once the API confirms the assignment.
  await expect(page.getByText("Mapped").first()).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Late", exact: true }).click();
  await expect(page.getByText("Late arrivals")).toBeVisible();
  await page.getByRole("button", { name: /^Punches/ }).click();
  await expect(page.getByText("Raw device punches")).toBeVisible();
});

test("payroll: run payroll, deduction columns, payslip page, policy settings", async ({ page }) => {
  await login(page);
  await page.goto("/people/payroll");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByRole("button", { name: /Run payroll/i }).last().click();
  await expect(page.getByText("Payroll generated")).toBeVisible({ timeout: 15000 });

  await expect(page.getByText("Half-day", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Absent", { exact: false }).first()).toBeVisible();

  const payslipLink = page.locator('a:has-text("Payslip")').first();
  await expect(payslipLink).toBeVisible();
  await payslipLink.click();
  await expect(page.getByText("Salary slip")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Net pay")).toBeVisible();
  await expect(page.getByText("Basic salary").first()).toBeVisible();

  await page.goto("/people/settings");
  await expect(page.getByText("Attendance policy")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Wed", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Attendance policy saved")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Wed", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Attendance policy saved")).toBeVisible({ timeout: 10000 });
});

test("role gate: non-HR blocked from attendance policy settings", async ({ page }) => {
  await login(page, "rahim@zoolyum.com", "zoolyum123");
  await page.goto("/people/settings");
  await expect(page.getByText("Owner / HR/Admin only")).toBeVisible({ timeout: 15000 });
});