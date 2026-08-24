import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email = "sakib@zoolyum.com", password = "zoolyum123") {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

test("attendance: kiosk check-in, punch import + mapping, monthly report", async ({ page }) => {
  await login(page);
  await page.goto("/people");
  await page.getByRole("link", { name: "Attendance" }).click();
  await expect(page.getByText("Monthly report")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Check in (kiosk)" }).click();
  await expect(page.getByText(/Checked in/)).toBeVisible({ timeout: 10000 });

  const dev = "9" + Math.floor(Math.random() * 100000);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole("button", { name: "Import punches" }).click();
  await page.locator("textarea").fill(`${dev}\t${today} 09:05:12\t2\t1`);
  await page.getByRole("button", { name: "Import punches" }).last().click();
  await expect(page.getByText(/Imported 1 punches/)).toBeVisible({ timeout: 10000 });

  await expect(page.getByText("Raw device punches")).toBeVisible();
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByText(/Recomputed/)).toBeVisible({ timeout: 10000 });

  const row = page.locator("tr", { has: page.getByText(dev) });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole("combobox").selectOption({ index: 1 });
  await expect(page.getByText("Punch mapped to employee")).toBeVisible({ timeout: 10000 });

  await expect(page.getByText("Late arrivals")).toBeVisible();
  await expect(page.getByText("Raw device punches")).toBeVisible();
});

test("payroll: run payroll, deduction columns, payslip page, policy settings", async ({ page }) => {
  await login(page);
  await page.goto("/people");
  await page.getByRole("link", { name: "Payroll" }).click();
  await expect(page.getByText("Run Payroll")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Run Payroll" }).click();
  await page.getByRole("button", { name: /Run payroll/ }).last().click();
  await expect(page.getByText("Payroll generated")).toBeVisible({ timeout: 15000 });

  await expect(page.getByText("Half-day", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Absent", { exact: false }).first()).toBeVisible();

  const payslipLink = page.locator('a:has-text("Payslip")').first();
  await expect(payslipLink).toBeVisible();
  await payslipLink.click();
  await expect(page.getByText("Salary slip")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Net pay")).toBeVisible();
  await expect(page.getByText("Basic salary").first()).toBeVisible();

  await page.goto("/people");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Attendance policy")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Wed", exact: true }).click();
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Attendance policy saved")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Wed", exact: true }).click();
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Attendance policy saved")).toBeVisible({ timeout: 10000 });
});

test("role gate: non-HR blocked from attendance policy settings", async ({ page }) => {
  await login(page, "rahim@zoolyum.com", "zoolyum123");
  await page.goto("/people");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Owner / HR/Admin only")).toBeVisible({ timeout: 15000 });
});