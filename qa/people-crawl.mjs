import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const routes = [
  "/people",
  "/people/me",
  "/people/team",
  "/people/directory",
  "/people/analytics",
  "/people/org-chart",
  "/people/skills",
  "/people/onboarding",
  "/people/assets",
  "/people/attendance",
  "/people/leave",
  "/people/holidays",
  "/people/settings",
  "/people/payroll",
  "/people/performance",
  "/people/okrs",
  "/people/training",
  "/people/candidates",
];

fs.mkdirSync("qa-evidence/people-qa", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`);
await page.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
await page.locator('input[type="password"]').fill("zoolyum123");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL(/\/dashboard/);

const report = [];
for (const route of routes) {
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  const onConsole = (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); };
  const onPageError = (e) => pageErrors.push(String(e.message).slice(0, 300));
  const onResponse = (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    if (r.status() >= 400) badResponses.push(`${r.request().method()} ${r.status()} ${u.replace(BASE, "")}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const h1 = await page.locator("h1").first().textContent().catch(() => null);
    const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
    const crashed = /Application error|Unhandled Runtime Error|Something went wrong/i.test(bodyText);
    const name = route.replace(/\//g, "_") || "_root";
    await page.screenshot({ path: `qa-evidence/people-qa/${name}.png`, fullPage: true });
    report.push({ route, h1: (h1 ?? "").trim(), crashed, consoleErrors, pageErrors, badResponses });
  } catch (e) {
    report.push({ route, fatal: String(e.message).slice(0, 300) });
  }
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponse);
}

fs.writeFileSync("qa-evidence/people-qa/report.json", JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`\n=== ${r.route}  h1=${JSON.stringify(r.h1)}  crashed=${r.crashed ?? "?"}${r.fatal ? " FATAL " + r.fatal : ""}`);
  for (const e of r.consoleErrors ?? []) console.log("  console:", e);
  for (const e of r.pageErrors ?? []) console.log("  pageerror:", e);
  for (const e of [...new Set(r.badResponses ?? [])]) console.log("  api:", e);
}
await browser.close();
