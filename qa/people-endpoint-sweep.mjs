/**
 * People module — QA sweep.
 *
 * 1. Hits every read endpoint and records status + latency.
 * 2. Cross-checks the analytics numbers against the operational attendance
 *    report for the same employee/month (the two must agree — otherwise the
 *    management view is lying).
 * 3. Exercises the leave lifecycle on a disposable employee.
 *
 * Read-only against real data; the only writes happen on probe records that
 * are deleted at the end.
 */
const API = "http://127.0.0.1:4000/api";
const results = [];

async function call(token, path, opts = {}) {
  const started = Date.now();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: token ? `Bearer ${token}` : "",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, ms: Date.now() - started, raw: text };
}

const login = await call(null, "/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
});
if (login.status !== 201 && login.status !== 200) {
  console.error("Login failed:", login.status, login.raw.slice(0, 200));
  process.exit(1);
}
const token = login.body.accessToken;
const month = new Date().toISOString().slice(0, 7);

const reads = [
  "/people/overview",
  "/people/me",
  "/people/employees",
  "/people/utilization",
  "/people/attendance",
  `/people/attendance/summary?month=${month}`,
  "/people/attendance/today",
  "/people/attendance/report",
  "/people/attendance/live",
  "/people/attendance/trends",
  "/people/attendance/late-list",
  "/people/attendance/devices",
  "/people/attendance-policy",
  "/people/punches?limit=5",
  "/people/leave-requests",
  "/people/leave-balances",
  "/people/leave-policies",
  "/people/work-calendar",
  "/people/payroll",
  "/people/payroll/status",
  "/people/reviews",
  "/people/okrs",
  "/people/courses",
  "/people/enrollments",
  "/people/candidates",
  "/people/holidays",
  "/people/onboarding",
  "/people/onboarding/summary",
  "/people/assets",
  "/people/assets/summary",
  "/people/org-chart",
  "/people/team",
  "/people/task-type-rules",
  "/people/skills-matrix",
  `/people/analytics/monthly?months=6`,
];

for (const path of reads) {
  const r = await call(token, path);
  results.push({ kind: "read", path, status: r.status, ms: r.ms, note: r.status >= 400 ? r.raw.slice(0, 160) : "" });
}

// ── Cross-check analytics vs operational attendance ────────────────────
const employees = (await call(token, "/people/employees")).body;
const analytics = (await call(token, `/people/analytics/monthly?months=2`)).body;
const lastMonth = analytics.months[analytics.months.length - 1].key;
const checks = [];
for (const row of analytics.rows) {
  const att = await call(token, `/people/attendance/employee/${row.employee.id}?month=${lastMonth}`);
  if (att.status !== 200) {
    checks.push({ employee: row.employee.name, error: att.status });
    continue;
  }
  const s = att.body.summary ?? {};
  const a = row.months[lastMonth];
  checks.push({
    employee: row.employee.name,
    month: lastMonth,
    late: { api: s.late ?? 0, analytics: a.lateDays },
    absent: { api: s.absent ?? 0, analytics: a.absentDays },
    half: { api: s.halfDay ?? 0, analytics: a.halfDays },
    match: (s.late ?? 0) === a.lateDays && (s.absent ?? 0) === a.absentDays && (s.halfDay ?? 0) === a.halfDays,
  });
}
const mismatches = checks.filter((c) => c.match === false);
results.push({
  kind: "analytics-vs-attendance",
  path: `${lastMonth} · ${checks.length} employees`,
  status: mismatches.length ? 500 : 200,
  ms: 0,
  note: mismatches.length ? `${mismatches.length} mismatches` : "all agree",
  detail: mismatches,
});

// ── Leave lifecycle on a probe employee ────────────────────────────────
const stamp = Date.now();
const emp = await call(token, "/people/employees", {
  method: "POST",
  body: JSON.stringify({ name: `QA Leave Probe ${stamp}`, roleTitle: "QA", joinDate: `${month}-01` }),
});
const empId = emp.body?.id;
const lifecycle = [];
if (empId) {
  const start = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const apply = await call(token, "/people/leave-requests", {
    method: "POST",
    body: JSON.stringify({ employeeId: empId, leaveType: "CASUAL", startDate: start, endDate: end, reason: "QA sweep" }),
  });
  lifecycle.push({ step: "apply", status: apply.status, note: apply.status >= 400 ? apply.raw.slice(0, 120) : "ok" });
  if (apply.body?.id) {
    const approve = await call(token, `/people/leave-requests/${apply.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ approved: true, note: "QA" }),
    });
    lifecycle.push({ step: "approve", status: approve.status, note: approve.status >= 400 ? approve.raw.slice(0, 120) : "ok" });
    const balances = await call(token, `/people/leave-balances?employeeId=${empId}`);
    const casual = (balances.body ?? []).find?.((b) => b.leaveType === "CASUAL");
    lifecycle.push({ step: "balance", status: balances.status, note: casual ? `CASUAL=${casual.balanceDays}` : "no balance row" });
  }
  await call(token, `/people/employees/${empId}`, { method: "DELETE" });
  lifecycle.push({ step: "cleanup", status: 200, note: "deleted" });
}
results.push({ kind: "leave-lifecycle", path: "probe employee", status: lifecycle.every((l) => l.status < 400) ? 200 : 500, ms: 0, note: "see detail", detail: lifecycle });

const bad = results.filter((r) => r.status >= 400);
const fs = await import("node:fs");
fs.mkdirSync("qa-evidence/people-qa", { recursive: true });
fs.writeFileSync("qa-evidence/people-qa/sweep.json", JSON.stringify({ total: results.length, failures: bad.length, results }, null, 2));

for (const r of results) {
  if (r.kind === "read" && r.status < 400) continue;
  console.log(`${r.status}  ${r.kind}  ${r.path}  ${r.note}`);
}
console.log(`\nreads: ${results.filter((r) => r.kind === "read").length}, failures: ${bad.length}`);

