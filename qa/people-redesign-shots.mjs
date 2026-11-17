import { chromium, request as pwRequest } from "playwright";

const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:4000/api/";
const OUT = "qa-evidence/people-redesign";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

await page.goto(`${BASE}/login`);
await page.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
await page.locator('input[type="password"]').fill("zoolyum123");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL(/\/dashboard/);

await page.goto(`${BASE}/people`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Overview" }).waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/command-center.png`, fullPage: true });

await page.goto(`${BASE}/people/directory`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Add", exact: true }).first().waitFor();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/directory-v2.png`, fullPage: true });
await page.getByRole("button", { name: "Late today" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/directory-filtered.png` });

await page.getByRole("button", { name: "Add", exact: true }).first().click();
const dialog = page.getByRole("dialog");
await dialog.getByRole("heading", { name: "Add employee" }).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/wizard-step1.png` });

const stamp = Date.now();
const name = `Redesign Probe ${stamp}`;
await dialog.getByLabel("Full name").fill(name);
await dialog.getByLabel("Role / title").fill("Product Designer");
await dialog.getByLabel("Department").fill("Design");
await dialog.getByLabel("Photo").setInputFiles({
  name: "avatar.png",
  mimeType: "image/png",
  // 1x1 transparent PNG
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
});
await dialog.getByRole("button", { name: "Continue" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/wizard-step2.png` });
await dialog.getByRole("button", { name: "Continue" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/wizard-step3.png` });

const created = page.waitForResponse((r) => r.url().endsWith("/people/employees") && r.request().method() === "POST");
await dialog.getByRole("button", { name: "Create employee" }).click();
const res = await created;
await dialog.getByRole("heading", { name: "Employee created" }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/wizard-success.png` });

// cleanup through the API with the browser token
const token = await page.evaluate(() => localStorage.getItem("zoolyum-token"));
const api = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
const rows = await (await api.get("people/employees")).json();
const row = Array.isArray(rows) ? rows.find((r) => r.name === name) : null;
if (row && res.ok()) await api.delete(`people/employees/${row.id}`);
await api.dispose();

// mobile command centre + wizard
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(`${BASE}/login`);
await mobile.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
await mobile.locator('input[type="password"]').fill("zoolyum123");
await mobile.getByRole("button", { name: "Sign in", exact: true }).click();
await mobile.waitForURL(/\/dashboard/);
await mobile.goto(`${BASE}/people`);
await mobile.waitForTimeout(1600);
await mobile.screenshot({ path: `${OUT}/command-center-mobile.png`, fullPage: true });
await mobile.goto(`${BASE}/people/directory`);
await mobile.getByRole("button", { name: "Add", exact: true }).first().click();
await mobile.getByRole("heading", { name: "Add employee" }).waitFor();
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${OUT}/wizard-step1-mobile.png` });
await mobile.close();

console.log("screenshots written; probe cleaned:", !!row);
await browser.close();
