/**
 * Read-only API sweep: every GET route in the app is called with the demo owner
 * token. A 5xx response (or an unhandled timeout) is a defect: the endpoint
 * should validate and answer 400/404 instead of exploding.
 *
 *   node qa/api-sweep.mjs
 */
const BASE = process.env.API_BASE ?? "http://localhost:4000/api";
const routes = (await import("./routes.json", { with: { type: "json" } })).default;

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
  });
  const json = await res.json();
  if (!json.accessToken) throw new Error("login failed: " + JSON.stringify(json));
  return json.accessToken;
}

const token = await login();
const gets = routes.filter((r) => r.method === "GET");

// A couple of real ids so the ":id" routes are exercised against live rows
// instead of only the malformed-id path.
const probe = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return Array.isArray(json) ? json[0] : json?.rows?.[0] ?? json?.items?.[0] ?? null;
};
const ids = {
  client: (await probe("/accounts/clients"))?.id,
  project: (await probe("/flow/projects"))?.id,
  employee: (await probe("/people/employees"))?.id,
  invoice: (await probe("/capital/invoices"))?.id,
  lead: (await probe("/pulse/leads"))?.id,
  user: (await probe("/control/users"))?.id,
  supplier: (await probe("/capital/suppliers"))?.id,
  account: (await probe("/capital/accounts"))?.id,
};

const paramFor = (name) => {
  const key = name.toLowerCase();
  if (key.includes("clientid") || key.includes("client")) return ids.client;
  if (key.includes("projectid") || key.includes("project")) return ids.project;
  if (key.includes("employee")) return ids.employee;
  if (key.includes("invoice")) return ids.invoice;
  if (key.includes("lead")) return ids.lead;
  if (key.includes("user")) return ids.user;
  if (key.includes("vendor") || key.includes("supplier")) return ids.supplier;
  if (key.includes("account")) return ids.account;
  return null;
};

const rows = [];
for (const route of gets) {
  const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  let path = route.path;
  for (const p of params) {
    const id = paramFor(p);
    path = path.replace(`:${p}`, id ?? "00000000-0000-0000-0000-000000000000");
  }
  const started = Date.now();
  let status = 0;
  let detail = "";
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    if (status >= 400) {
      const text = await res.text().catch(() => "");
      detail = text.slice(0, 220);
    }
  } catch (e) {
    status = -1;
    detail = String(e?.message ?? e).slice(0, 220);
  }
  rows.push({
    module: route.path.split("/")[1] ?? "root",
    method: "GET",
    path,
    raw: route.path,
    params: params.length,
    status,
    ms: Date.now() - started,
    detail,
  });
}

const bad = rows.filter((r) => r.status === -1 || r.status >= 500);
const forbidden = rows.filter((r) => r.status === 403);
const notFound = rows.filter((r) => r.status === 404);
const ok = rows.filter((r) => r.status >= 200 && r.status < 300);
const slow = rows.filter((r) => r.status < 400 && r.ms > 2500);

const byModule = {};
for (const r of rows) {
  byModule[r.module] ??= { total: 0, ok: 0, bad: 0 };
  byModule[r.module].total += 1;
  if (r.status >= 200 && r.status < 300) byModule[r.module].ok += 1;
  if (r.status === -1 || r.status >= 500) byModule[r.module].bad += 1;
}

console.log(
  JSON.stringify(
    {
      total: rows.length,
      ok: ok.length,
      serverErrors: bad.length,
      forbidden: forbidden.length,
      notFound: notFound.length,
      slow: slow.length,
      byModule,
      failures: bad,
      forbiddenRows: forbidden,
      notFoundRows: notFound,
      slowest: [...rows].sort((a, b) => b.ms - a.ms).slice(0, 12),
    },
    null,
    2
  )
);
