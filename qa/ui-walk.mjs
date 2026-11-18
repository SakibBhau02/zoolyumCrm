/**
 * Full UI walk: every app route, signed in as the demo owner.
 *
 * For each page it records console errors, unhandled page errors, failed
 * network calls, the rendered heading/text sample and a screenshot, so a
 * non-working module is visible without clicking through the CRM by hand.
 *
 *   node qa/ui-walk.mjs                 # desktop 1440x900
 *   node qa/ui-walk.mjs --mobile        # 390x844
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.WEB_BASE ?? "http://localhost:3000";
const MOBILE = process.argv.includes("--mobile");
const OUT = path.join("qa-evidence", "audit", MOBILE ? "mobile" : "desktop");
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["Dashboard", "/dashboard"],
  ["Pulse", "/pulse"],
  ["Accounts", "/accounts"],
  ["Flow", "/flow"],
  ["Tasks", "/tasks"],
  ["Tasks setup", "/tasks/setup"],
  ["People", "/people"],
  ["People directory", "/people/directory"],
  ["People team", "/people/team"],
  ["People attendance", "/people/attendance"],
  ["People leave", "/people/leave"],
  ["People payroll", "/people/payroll"],
  ["People performance", "/people/performance"],
  ["People OKRs", "/people/okrs"],
  ["People skills", "/people/skills"],
  ["People training", "/people/training"],
  ["People candidates", "/people/candidates"],
  ["People onboarding", "/people/onboarding"],
  ["People assets", "/people/assets"],
  ["People holidays", "/people/holidays"],
  ["People analytics", "/people/analytics"],
  ["People org chart", "/people/org-chart"],
  ["People settings", "/people/settings"],
  ["People me", "/people/me"],
  ["Capital", "/capital"],
  ["Capital invoices", "/capital/invoices"],
  ["Capital expenses", "/capital/expenses"],
  ["Capital income", "/capital/income"],
  ["Capital vendors", "/capital/vendors"],
  ["Capital accounts", "/capital/accounts"],
  ["Capital accounting", "/capital/accounting"],
  ["Capital liabilities", "/capital/liabilities"],
  ["Capital dollar", "/capital/dollar"],
  ["Capital profitability", "/capital/profitability"],
  ["Capital reports", "/capital/reports"],
  ["Capital activity", "/capital/activity"],
  ["Insight", "/insight"],
  ["Calendar", "/calendar"],
  ["Portal", "/portal"],
  ["Control", "/control"],
  ["Control scoring", "/control/scoring"],
  ["Notifications", "/notifications"],
  ["Public landing", "/"],
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const badRequests = [];
let current = "login";
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push({ page: current, text: m.text().slice(0, 300) });
});
page.on("pageerror", (e) => pageErrors.push({ page: current, text: String(e?.message ?? e).slice(0, 300) }));
page.on("response", (r) => {
  const url = r.url();
  if (url.includes("/_next/") && r.status() === 404) return;
  if (r.status() >= 400) badRequests.push({ page: current, status: r.status(), url: url.replace(BASE, "") });
});

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
for (let attempt = 0; attempt < 3; attempt += 1) {
  await page.fill('input[type="email"]', "sakib@zoolyum.com");
  await page.fill('input[type="password"]', "zoolyum123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForTimeout(5000);
  const ok = await page.evaluate(() => !!localStorage.getItem("zoolyum-token"));
  if (ok || !/\/login/.test(page.url())) break;
}

const results = [];
for (const [name, route] of ROUTES) {
  current = route;
  const ce0 = consoleErrors.length;
  const pe0 = pageErrors.length;
  const br0 = badRequests.length;
  let status = 0;
  try {
    const res = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res?.status() ?? 0;
    await page.waitForTimeout(MOBILE ? 1800 : 2200);
  } catch (e) {
    results.push({ name, route, status: -1, error: String(e?.message ?? e).slice(0, 200) });
    continue;
  }
  const main = page.locator("main").first();
  let text = "";
  try {
    text = (await main.innerText({ timeout: 8000 })).replace(/\s+/g, " ").trim();
  } catch {
    text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  }
  const errorBoundary = /Something went wrong|Application error|Unhandled Runtime Error|Failed to load/i.test(text);
  const stuckLoading = /^(Loading|Loadingâ€¦|Loading\.\.\.)/.test(text) || text.length < 40;
  await page.screenshot({
    path: path.join(OUT, `${name.replace(/[^\w]+/g, "-").toLowerCase()}.png`),
    fullPage: false,
  });
  results.push({
    name,
    route,
    status,
    chars: text.length,
    sample: text.slice(0, 140),
    errorBoundary,
    stuckLoading,
    console: consoleErrors.slice(ce0),
    pageErrors: pageErrors.slice(pe0),
    badRequests: badRequests.slice(br0),
  });
  process.stdout.write(`. ${name} (${text.length})\n`);
}

// Dark mode pass on the main modules (theme parity check).
if (!MOBILE) {
  await page.evaluate(() => localStorage.setItem("zoolyum-theme", "dark"));
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  for (const [name, route] of ROUTES.filter(([, r]) =>
    ["/dashboard", "/pulse", "/accounts", "/flow", "/tasks", "/people", "/capital", "/insight", "/calendar", "/portal", "/control"].includes(r)
  )) {
    current = `${route} (dark)`;
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(OUT, `dark-${name.replace(/[^\w]+/g, "-").toLowerCase()}.png`),
      fullPage: false,
    });
  }
  await page.evaluate(() => localStorage.removeItem("zoolyum-theme"));
}

await browser.close();
const summary = {
  mode: MOBILE ? "mobile" : "desktop",
  pages: results.length,
  ok: results.filter((r) => !r.errorBoundary && !r.stuckLoading && r.status < 400 && !r.error).length,
  errorBoundary: results.filter((r) => r.errorBoundary).map((r) => r.route),
  stuckLoading: results.filter((r) => r.stuckLoading).map((r) => `${r.route} (${r.chars} chars)`),
  httpErrors: results.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.route}`),
  consoleErrorPages: [...new Set(consoleErrors.map((e) => e.page))],
  pageErrorPages: [...new Set(pageErrors.map((e) => e.page))],
  failingPages: results
    .filter((r) => r.errorBoundary || r.stuckLoading || r.status >= 400 || r.error)
    .map((r) => ({ route: r.route, sample: r.sample, status: r.status })),
  details: results,
  consoleErrors: consoleErrors.slice(0, 120),
  pageErrors: pageErrors.slice(0, 60),
  badRequests: badRequests.slice(0, 120),
};
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, details: undefined, consoleErrors: summary.consoleErrors.length }, null, 2));

