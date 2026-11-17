import { test, expect, request as pwRequest, type Page } from "@playwright/test";

const API = "http://127.0.0.1:4000/api/";

async function login(page: Page, email = "sakib@zoolyum.com", password = "zoolyum123") {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

/** API client authenticated with the browser session's own token. */
async function api(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem("zoolyum-token"));
  const ctx = await pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  return ctx;
}

/** Remove a probe employee by exact name, so a failed assertion cannot leave litter. */
async function cleanup(page: Page, name: string) {
  const ctx = await api(page);
  const res = await ctx.get("people/employees");
  const rows = await res.json();
  if (Array.isArray(rows)) {
    for (const row of rows.filter((r: any) => r.name === name)) {
      await ctx.delete(`people/employees/${row.id}`);
    }
  }
  await ctx.dispose();
}

test("directory: add an employee through the wizard and open the new profile", async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const name = `QA Employee ${stamp}`;
  await page.goto("/people/directory");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(page.getByRole("heading", { name: "Add employee" })).toBeVisible();

  // Step 1 — the four required fields. Department is now mandatory.
  await dialog.getByLabel("Full name").fill(name);
  await dialog.getByLabel("Role / title").fill("QA Engineer");
  await dialog.getByLabel("Department").fill("Quality");
  await dialog.getByRole("button", { name: "Continue" }).click();

  // Step 2 — optional job details; the manager picker must be present.
  await expect(dialog.getByText("Reporting manager")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();

  // Step 3 — HR-only pay block, then create.
  await expect(dialog.getByText("Monthly salary (BDT)")).toBeVisible();
  const createResponse = page.waitForResponse(
    (r) => r.url().endsWith("/people/employees") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create employee" }).click();
  const res = await createResponse;
  expect(res.status(), await res.text()).toBe(201);

  // Success card instead of a silent close — the flow now ends somewhere.
  await expect(dialog.getByRole("heading", { name: "Employee created" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(`Employee added — ${name}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Open profile" }).click();
  await expect(page).toHaveURL(/\/people\/directory\/[^/]+$/);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("QA Engineer").first()).toBeVisible();

  await cleanup(page, name);
});

test("directory: required fields block the step, not the whole form", async ({ page }) => {
  await login(page);
  await page.goto("/people/directory");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add employee" })).toBeVisible();

  // Empty step 1 must show inline errors and stay on step 1.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Name is required")).toBeVisible();
  await expect(page.getByText("Role is required")).toBeVisible();
  await expect(page.getByText("Department is required")).toBeVisible();
  await expect(page.getByText("Reporting manager")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("directory: edit an employee and persist the change", async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const name = `QA Editable ${stamp}`;
  const ctx = await api(page);
  const created = await (
    await ctx.post("people/employees", {
      data: { name, roleTitle: "Junior QA", joinDate: "2026-11-01" },
    })
  ).json();

  try {
    await page.goto(`/people/directory/${created.id}`);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15000 });

    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Edit profile" }).first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Role").fill("Senior QA");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Employee updated")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page.getByText("Senior QA").first()).toBeVisible({ timeout: 15000 });
  } finally {
    await ctx.delete(`people/employees/${created.id}`);
    await ctx.dispose();
  }
});

test("analytics: monthly matrix renders and the metric switch changes values", async ({ page }) => {
  await login(page);
  await page.goto("/people/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Monthly matrix")).toBeVisible();
  await expect(page.getByText("Team totals by month")).toBeVisible();

  const matrix = page.locator("table").first();
  await expect(matrix.getByRole("row").nth(1)).toBeVisible();
  const cellsBefore = await matrix.getByRole("row").nth(1).locator("td").allInnerTexts();

  await page.getByRole("combobox").filter({ hasText: "Tasks completed" }).selectOption({ label: "Shoots" });
  await expect(page.getByText(/Showing shoots per month/i)).toBeVisible();
  const cellsAfter = await matrix.getByRole("row").nth(1).locator("td").allInnerTexts();
  // Same employee row, different metric — at least one cell must change.
  expect(cellsAfter.join("|")).not.toBe(cellsBefore.join("|"));
});

test("team 360: shoots tab and add button are present", async ({ page }) => {
  await login(page);
  const ctx = await api(page);
  const roster = await (await ctx.get("people/team")).json();
  const person = roster.rows?.[0];
  expect(person, "roster must contain at least one employee").toBeTruthy();
  await ctx.dispose();

  await page.goto(`/people/team?id=${person.id}`);
  await expect(page.getByRole("heading", { name: "Team 360" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();

  const shootsTab = page.getByRole("button", { name: /^Shoots/ });
  await expect(shootsTab).toBeVisible({ timeout: 15000 });
  await shootsTab.click();
  await expect(page.getByText("On set")).toBeVisible();
});
