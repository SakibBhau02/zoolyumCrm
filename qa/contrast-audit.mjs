/**
 * Contrast audit with axe-core on the branded build (light + dark).
 *   node qa/contrast-audit.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const AXE = path.resolve("node_modules/axe-core/axe.min.js");
const OUT = path.join("qa-evidence", "contrast");
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["dashboard", "/dashboard"],
  ["pulse", "/pulse"],
  ["accounts", "/accounts"],
  ["flow", "/flow"],
  ["tasks", "/tasks"],
  ["people", "/people"],
  ["capital", "/capital"],
  ["insight", "/insight"],
  ["calendar", "/calendar"],
  ["portal", "/portal"],
  ["control", "/control"],
  ["control-scoring", "/control/scoring"],
];

const token = await fetch("http://localhost:4000/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
})
  .then((r) => r.json())
  .then((j) => j.accessToken);

const browser = await chromium.launch();
const report = {};

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("zoolyum-theme", t), theme);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("zoolyum-token", t), token);
  const rows = [];
  for (const [name, route] of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    await page.addScriptTag({ path: AXE });
    const res = await page.evaluate(async () => {
      const out = await window.axe.run(document, { runOnly: ["color-contrast"] });
      return out.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 8).map((n) => ({
          target: n.target,
          summary: n.failureSummary?.replace(/\n/g, " ").slice(0, 260),
          html: n.html?.slice(0, 160),
        })),
        count: v.nodes.length,
      }));
    });
    const nodes = res.reduce((s, v) => s + v.count, 0);
    rows.push({ page: name, route, violations: res, nodes });
    process.stdout.write(`${theme} ${name}: ${nodes} contrast issue(s)\n`);
  }
  report[theme] = rows;
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
const total = Object.values(report).flat().reduce((s, r) => s + r.nodes, 0);
console.log("TOTAL contrast nodes:", total);
