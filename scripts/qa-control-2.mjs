/** Control QA part 2: permission-based access, WhatsApp extras, Telegram extras, maintenance. */
const BASE = "http://localhost:4000/api";
const results = [];
let failures = 0;
const ok = (n, d = "") => results.push({ status: "PASS", name: n, detail: d });
const fail = (n, d) => { failures++; results.push({ status: "FAIL", name: n, detail: String(d).slice(0, 400) }); };
async function test(n, fn) { try { await fn(); ok(n); } catch (e) { fail(n, e?.message ?? e); } }
const assert = (c, m) => { if (!c) throw new Error(m); };
async function req(path, { method = "GET", body, token, timeout = 15000 } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const st = async (p, s, label) => { if (p.status !== s) throw new Error(`${label}: expected ${s}, got ${p.status} ${JSON.stringify(p.body).slice(0, 200)}`); return p.body; };

const owner = (await req("/auth/login", { method: "POST", body: { email: "sakib@zoolyum.com", password: "zoolyum123" } })).body.accessToken;
const finance = (await req("/auth/login", { method: "POST", body: { email: "sadia@zoolyum.com", password: "zoolyum123" } })).body.accessToken;
const ids = { roles: [], users: [] };

await test("permissions: CONTROL view grants admin workspace (not destructive)", async () => {
  const role = await st(await req("/control/roles", { method: "POST", token: owner, body: { name: "QA Control", modulePermissions: { CONTROL: { view: true }, CLIENTS: { view: true } } } }), 201, "role");
  ids.roles.push(role.id);
  const email = `qacontrol${Date.now().toString().slice(-6)}@example.test`;
  const user = await st(await req("/control/users", { method: "POST", token: owner, body: { name: "QA Control", email, password: "QaPass1234", roleId: role.id } }), 201, "user");
  ids.users.push(user.id);
  const login = await st(await req("/auth/login", { method: "POST", body: { email, password: "QaPass1234" } }), 201, "login");
  const t = login.accessToken;
  await st(await req("/control/health", { token: t }), 200, "health");
  await st(await req("/control/roles", { token: t }), 200, "roles");
  const wipe = await req("/control/delete-all", { method: "POST", token: t });
  assert(wipe.status === 403, `delete-all should be Owner-only, got ${wipe.status}`);
});

await test("whatsapp: template toggle + simulate + sweep", async () => {
  const cfg = await st(await req("/control/whatsapp/config", { token: owner }), 200, "config");
  const tpl = cfg.templates?.[0];
  assert(tpl, "no templates");
  const off = await st(await req(`/control/whatsapp/templates/${tpl.id}`, { method: "PATCH", token: owner, body: { isActive: !tpl.isActive } }), 200, "toggle");
  assert(off.isActive === !tpl.isActive, "template not toggled");
  await req(`/control/whatsapp/templates/${tpl.id}`, { method: "PATCH", token: owner, body: { isActive: tpl.isActive } });
  const send = await st(await req("/control/whatsapp/test-send", { method: "POST", token: owner, body: { to: "+8801700000000", templateName: "invoice_ready", params: ["QA"] } }), 201, "send");
  if (send.ok && send.wamid) {
    const sim = await st(await req("/control/whatsapp/simulate", { method: "POST", token: owner, body: { wamid: send.wamid, status: "delivered" } }), 201, "simulate");
    assert(sim.ok !== false, "simulate failed");
  }
  const sweep = await st(await req("/control/whatsapp/sweep", { method: "POST", token: owner }), 201, "sweep");
  assert(typeof sweep === "object", "sweep response invalid");
});

await test("telegram: test-connection degrades gracefully without token", async () => {
  const r = await req("/control/telegram/test-connection", { method: "POST", token: owner });
  assert([200, 201].includes(r.status), `expected 200/201, got ${r.status}`);
  assert(typeof r.body === "object", "invalid response");
  const info = await st(await req("/control/telegram/webhook-info", { token: owner }), 200, "webhook-info");
  assert(info !== undefined, "webhook-info empty");
});

await test("telegram: test-send without recipients is rejected gracefully", async () => {
  const r = await req("/control/telegram/test-send", { method: "POST", token: owner, body: {} });
  assert([200, 201, 400].includes(r.status), `unexpected ${r.status}`);
  if (r.status === 400) assert(r.body?.message, "missing error message");
});

await test("maintenance: blocks non-owner writes, allows reads, owner writes", async () => {
  const before = await st(await req("/control/settings", { token: owner }), 200, "settings");
  await st(await req("/control/settings", { method: "PATCH", token: owner, body: { system: { maintenanceMode: true } } }), 200, "enable");
  const w = await req("/capital/recurring/run", { method: "POST", token: finance });
  assert(w.status === 503, `finance write expected 503, got ${w.status}`);
  const r = await req("/capital/overview", { token: finance });
  assert(r.status === 200, `finance read expected 200, got ${r.status}`);
  const ow = await req("/capital/recurring/run", { method: "POST", token: owner });
  assert(ow.status === 200 || ow.status === 201, `owner write expected 2xx, got ${ow.status}`);
  await st(await req("/control/settings", { method: "PATCH", token: owner, body: { system: before.system } }), 200, "restore");
});

// cleanup
for (const id of ids.users) await req(`/control/users/${id}`, { method: "DELETE", token: owner }).catch(() => {});
for (const id of ids.roles) await req(`/control/roles/${id}`, { method: "DELETE", token: owner }).catch(() => {});

const passed = results.filter((r) => r.status === "PASS").length;
console.log(JSON.stringify({ passed, failed: failures, results }, null, 2));
process.exit(failures ? 1 : 0);
