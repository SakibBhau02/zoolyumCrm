/**
 * API latency benchmark. Logs in as Owner, hits GET endpoints, records
 * status / latency (p50 over N runs) / payload bytes / query count proxy.
 * Usage: node qa/bench.mjs [baseUrl]
 */
import fs from "node:fs";

const BASE = (process.argv[2] ?? "http://127.0.0.1:4100/api").replace(/\/$/, "");
const RUNS = Number(process.env.RUNS ?? 5);
const WARM = 1;
const PASSWORD = "zoolyum123";

const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sakib@zoolyum.com", password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed ${r.status}`);
  return (await r.json()).accessToken;
};

const state = { ids: {} };

const pick = async (token, url, extract) => {
  try {
    const r = await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const j = await r.json();
    return extract(j);
  } catch {
    return null;
  }
};

const seedIds = async (token) => {
  state.ids.lead = await pick(token, "/pulse/leads?limit=1", (j) => (j.items ?? j.leads ?? j)?.[0]?.id ?? null);
  state.ids.client = await pick(token, "/accounts/clients", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
  state.ids.project = await pick(token, "/flow/projects", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
  state.ids.task = await pick(token, "/tasks?limit=1", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
  state.ids.employee = await pick(token, "/people/employees", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
  state.ids.invoice = await pick(token, "/capital/invoices", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
  state.ids.expense = await pick(token, "/capital/expenses", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
  state.ids.user = await pick(token, "/control/users", (j) => (j.items ?? j)?.[0]?.id ?? j?.[0]?.id);
};

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

/** Curated GET endpoints: the ones a real user hits while working. */
const PATHS = [
  "/health",
  "/dashboard/overview",
  "/dashboard/home",
  "/dashboard/my-day",
  "/dashboard/command-center",
  "/pulse/leads",
  "/pulse/overview",
  "/pulse/funnel",
  "/pulse/forecast",
  "/pulse/targets",
  "/pulse/lead-sources",
  "/pulse/leads?stage=NEW&limit=20",
  "/accounts/clients",
  "/accounts/overview",
  "/accounts/health",
  "/accounts/renewals",
  "/accounts/contacts",
  "/flow/projects",
  "/flow/overview",
  "/flow/templates",
  "/flow/health",
  "/tasks",
  "/tasks/stats",
  "/tasks/my-day",
  "/tasks/setup",
  "/tasks?status=TODO&limit=20",
  "/people/employees",
  "/people/overview",
  "/people/attendance?month=" + month,
  "/people/attendance/summary?month=" + month,
  "/people/leave",
  "/people/leave/balances",
  "/people/payroll",
  "/people/payroll/status",
  "/people/team",
  "/people/org-chart",
  "/people/directory",
  "/people/onboarding",
  "/people/assets",
  "/people/holidays",
  "/people/reviews",
  "/people/okrs",
  "/people/candidates",
  "/people/courses",
  "/people/enrollments",
  "/people/skills-matrix",
  "/people/task-type-rules",
  "/capital/invoices",
  "/capital/expenses",
  "/capital/overview",
  "/capital/reports",
  "/capital/statements",
  "/capital/liabilities",
  "/capital/vendors",
  "/capital/accounts",
  "/capital/dollar",
  "/capital/profitability",
  "/capital/activity",
  "/insight/metrics",
  "/insight/correlations",
  "/insight/digests",
  "/insight/reports",
  "/insight/report/overview",
  "/insight/report/client-health",
  "/insight/report/tax",
  "/insight/report/performance",
  "/insight/reports/executive",
  "/insight/reports/campaigns",
  "/insight/reports/adsets",
  "/insight/reports/ads",
  "/insight/reports/creatives",
  "/insight/reports/audience",
  "/insight/reports/spend-budget",
  "/insight/reports/roas-roi",
  "/insight/reports/metrics",
  "/insight/reports/cross-platform",
  "/insight/reports/funnel",
  "/insight/reports/runs",
  "/insight/datasource/health",
  "/insight/datasource/accounts",
  "/insight/datasource/sync-logs",
  "/insight/settings",
  "/insight/automation/schedules",
  "/insight/automation/alerts",
  "/insight/automation/deliveries",
  "/insight/presentation/dashboard",
  "/insight/presentation/white-label",
  "/insight/presentation/ai-summary",
  "/calendar/feed?from=" + today + "&to=" + today,
  "/calendar/summary?month=" + month,
  "/calendar/day/" + today,
  "/calendar/workload",
  "/calendar/conflicts",
  "/calendar/gaps",
  "/calendar/clients",
  "/calendar/people",
  "/calendar/plans",
  "/calendar/audit",
  "/calendar/campaigns",
  "/calendar/flights",
  "/calendar/timeline?from=" + today + "&to=" + today,
  "/calendar/settings/platform-accounts",
  "/calendar/settings/pillars",
  "/calendar/views",
  "/portal/users",
  "/portal/activity",
  "/portal/comments",
  "/portal/approvals",
  "/portal/clients",
  "/control/settings",
  "/control/roles",
  "/control/integrations",
  "/control/audit-logs",
  "/control/pipeline-stages",
  "/control/health",
  "/control/branding",
  "/notifications",
  "/notifications/summary",
  "/notifications/unread-count",
  "/search?q=a",
  "/auth/me",
];

const stat = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return { min: s[0], p50: q(50), p95: q(95), max: s[s.length - 1], avg: s.reduce((a, b) => a + b, 0) / s.length };
};

const main = async () => {
  const token = await login();
  await seedIds(token);
  const withIds = PATHS.map((p) =>
    p.replace(/:(\w+)/g, (_, k) => state.ids[k] ?? "__missing__").replace("/__missing__", "/missing-id")
  );
  const rows = [];
  for (const p of withIds) {
    const times = [];
    let status = 0,
      bytes = 0,
      err = "";
    for (let i = 0; i < WARM + RUNS; i++) {
      const t0 = performance.now();
      try {
        const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
        const buf = Buffer.from(await r.arrayBuffer());
        const dt = performance.now() - t0;
        status = r.status;
        bytes = buf.length;
        if (i >= WARM) times.push(dt);
      } catch (e) {
        err = e.message;
        if (i >= WARM) times.push(performance.now() - t0);
      }
    }
    const s = stat(times);
    rows.push({ path: p, status, err, kb: +(bytes / 1024).toFixed(1), p50: +s.p50.toFixed(1), p95: +s.p95.toFixed(1), max: +s.max.toFixed(1) });
    console.log(`${String(status).padEnd(4)} ${s.p50.toFixed(0).padStart(6)}ms  ${(bytes / 1024).toFixed(1).padStart(8)}KB  ${p}${err ? "  ERR " + err : ""}`);
  }
  fs.mkdirSync("qa", { recursive: true });
  fs.writeFileSync("qa/bench-results.json", JSON.stringify(rows, null, 2));
  const slow = [...rows].sort((a, b) => b.p50 - a.p50).slice(0, 20);
  console.log("\n=== SLOWEST (p50) ===");
  for (const r of slow) console.log(`${r.p50.toFixed(0).padStart(6)}ms ${String(r.status).padEnd(4)} ${(r.kb + "KB").padStart(8)}  ${r.path}`);
  const big = [...rows].sort((a, b) => b.kb - a.kb).slice(0, 15);
  console.log("\n=== LARGEST PAYLOADS ===");
  for (const r of big) console.log(`${r.kb.toFixed(0).padStart(7)}KB ${r.p50.toFixed(0).padStart(5)}ms  ${r.path}`);
  const bad = rows.filter((r) => r.status >= 400);
  console.log(`\n=== NON-2xx (${bad.length}) ===`);
  for (const r of bad) console.log(`${r.status} ${r.path} ${r.err}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
