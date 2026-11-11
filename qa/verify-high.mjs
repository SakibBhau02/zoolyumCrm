/** Verifies the HIGH-severity fixes that are observable over HTTP. */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000/api").replace(/\/$/, "");
const out = [];
const rec = (ok, label, detail = "") => {
  out.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const login = async () =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
  })).json()).accessToken;

const get = async (t, p) => {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${t}` } });
  let b = null;
  try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};

(async () => {
  const t = await login();

  // users projection
  const users = await get(t, "/users");
  const u = users.body?.[0] ?? {};
  rec(users.status === 200 && !("passwordHash" in u) && !("lastLoginIp" in u) && !("tokenVersion" in u), "users: sensitive columns removed", Object.keys(u).join(","));

  // statements after the groupBy rewrite
  const tb = await get(t, "/capital/statements/trial-balance");
  rec(tb.status === 200 && Array.isArray(tb.body?.rows) && Math.abs(Number(tb.body.totalDebit) - Number(tb.body.totalCredit)) < 0.05, "statements: trial balance still balances", `${tb.body?.rows?.length ?? 0} accounts`);
  const pl = await get(t, "/capital/statements/profit-loss");
  rec(pl.status === 200 && Array.isArray(pl.body?.revenue), "statements: profit & loss grouped", `revenue ${pl.body?.totalRevenue ?? "-"}`);
  const bs = await get(t, "/capital/statements/balance-sheet");
  rec(bs.status === 200 && Array.isArray(bs.body?.assets), "statements: balance sheet grouped");

  // profitability aggregates
  const prof = await get(t, "/capital/profitability");
  rec(prof.status === 200 && Array.isArray(prof.body?.projects) && Array.isArray(prof.body?.monthly), "profitability: aggregate shape", `${prof.body?.projects?.length ?? 0} projects`);

  // task stats + list
  const stats = await get(t, "/tasks/stats");
  rec(stats.status === 200 && typeof stats.body?.total === "number", "tasks: stats counts", JSON.stringify(stats.body));

  // accounts overview carries tier config
  const ov = await get(t, "/accounts/overview");
  rec(ov.status === 200 && Array.isArray(ov.body?.clientTiers), "accounts: overview returns clientTiers");

  // lead audit (batched writes)
  const audit = await fetch(`${API}/pulse/audit`, { method: "POST", headers: { Authorization: `Bearer ${t}` } });
  const auditBody = await audit.json().catch(() => null);
  rec(audit.status < 400, "pulse: auditAll runs", `scanned ${auditBody?.scanned ?? "-"}`);

  // SSE token must not work as an API bearer
  const sse = await get(t, "/notifications/sse-token").catch(() => null);
  if (sse?.body?.token) {
    const wrong = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${sse.body.token}` } });
    rec(wrong.status === 401, "auth: SSE token rejected on staff routes", `status ${wrong.status}`);
  }

  const failed = out.filter((x) => !x).length;
  console.log(`\n${out.length - failed}/${out.length} checks passed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
