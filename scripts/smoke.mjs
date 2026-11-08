#!/usr/bin/env node
/**
 * API smoke + authorization gate.
 *
 * Runs against a live API (default http://localhost:4000/api, override with
 * API_URL) and the seeded demo users. Fails the process on:
 *   - any 5xx from a route the Owner is allowed to read
 *   - any write that a role without the module permission is still allowed
 *
 * This is the regression test for the two bugs that matter most in this repo:
 * an endpoint that 500s because a required query parameter was missing, and a
 * module that ignored the role matrix on writes.
 *
 * Usage: node scripts/smoke.mjs
 */

const API = (process.env.API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");
const PASSWORD = process.env.SEED_PASSWORD ?? "zoolyum123";

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} -> ${res.status}`);
  return res.json();
}

async function call(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  return res;
}

const ownerRoutes = [
  "/dashboard/overview",
  "/flow/projects",
  "/flow/overview",
  "/accounts/clients",
  "/pulse/leads",
  "/tasks",
  "/tasks/stats",
  "/people/employees",
  "/people/attendance?month=2026-11",
  "/capital/invoices",
  "/capital/expenses",
  "/capital/overview",
  "/insight/metrics",
  "/control/settings",
  "/notifications/summary",
  "/search?q=test",
];

// Routes that legitimately need a parameter return 400 (not 500) when it is
// missing. This is the exact regression the audit found.
const missingParamRoutes = [
  ["/people/attendance/summary", 400],
  ["/capital/reconciliation", 400],
  ["/insight/reports/comparison", 400],
  ["/control/telegram/link", 400],
];

// Writes that must never succeed for a role without the module permission.
// Invalid ids keep them non-destructive: a blocked call is 403, an allowed one
// would be 404, which is exactly how we tell them apart.
const forbiddenWrites = [
  // PM has CAPITAL view but not edit, so a write must be blocked.
  ["karim@zoolyum.com", "PATCH", "/capital/invoices/does-not-exist", { status: "PAID" }, 403],
  ["rahim@zoolyum.com", "PATCH", "/capital/invoices/does-not-exist", { status: "PAID" }, 403],
  ["nusrat@zoolyum.com", "PATCH", "/capital/invoices/does-not-exist", { status: "PAID" }, 403],
  // HR owns PEOPLE but not CAPITAL; BD owns neither.
  ["sadia@zoolyum.com", "PATCH", "/people/payroll/does-not-exist", { status: "FINALIZED" }, 403],
  ["karim@zoolyum.com", "PATCH", "/people/payroll/does-not-exist", { status: "FINALIZED" }, 403],
  ["nusrat@zoolyum.com", "DELETE", "/accounts/clients/does-not-exist", undefined, 403],
];

// Positive control: Finance must still be able to write Capital (and HR to
// write People). If these 404, the guard is over-blocking rather than fixing.
const allowedWrites = [
  ["sadia@zoolyum.com", "PATCH", "/capital/invoices/does-not-exist", { status: "PAID" }, 404],
  ["nusrat@zoolyum.com", "PATCH", "/people/payroll/does-not-exist", { status: "FINALIZED" }, 404],
];

const main = async () => {
  let owner;
  try {
    owner = await login("sakib@zoolyum.com");
  } catch (err) {
    console.error(`Cannot reach ${API}: ${err.message}`);
    process.exit(1);
  }

  for (const path of ownerRoutes) {
    const res = await call(owner.accessToken, path);
    record(res.status < 500, `GET ${path}`, `${res.status}`);
  }

  for (const [path, expected] of missingParamRoutes) {
    const res = await call(owner.accessToken, path);
    record(res.status === expected, `GET ${path} (missing param)`, `${res.status} expected ${expected}`);
  }

  const tokens = new Map();
  for (const [email, method, path, body, expected] of [...forbiddenWrites, ...allowedWrites]) {
    if (!tokens.has(email)) {
      const session = await login(email);
      tokens.set(email, session.accessToken);
    }
    const res = await call(tokens.get(email), path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    record(res.status === expected, `${method} ${path} as ${email}`, `${res.status} expected ${expected}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
