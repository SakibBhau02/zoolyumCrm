/**
 * Control module QA harness.
 * Run: node scripts/qa-control.mjs
 */
const BASE = "http://localhost:4000/api";
const results = [];
let failures = 0;

function ok(name, detail = "") {
  results.push({ status: "PASS", name, detail });
}
function fail(name, detail) {
  failures++;
  results.push({ status: "FAIL", name, detail: String(detail).slice(0, 400) });
}
async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e?.message ?? e);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function req(path, { method = "GET", body, token, timeout = 15000 } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
async function expectStatus(p, status, label) {
  if (p.status !== status) throw new Error(`${label}: expected ${status}, got ${p.status} ${JSON.stringify(p.body).slice(0, 200)}`);
  return p.body;
}

const ownerLogin = await req("/auth/login", { method: "POST", body: { email: "sakib@zoolyum.com", password: "zoolyum123" } });
const owner = ownerLogin.body?.accessToken;
if (!owner) {
  console.error("Cannot log in as owner:", ownerLogin);
  process.exit(1);
}
const financeLogin = await req("/auth/login", { method: "POST", body: { email: "sadia@zoolyum.com", password: "zoolyum123" } });
const finance = financeLogin.body?.accessToken;

const created = { roleIds: [], userIds: [], integrationIds: [], stageIds: [] };
let originalSettings = null;
let originalWhatsapp = null;
let originalTelegram = null;

// ── Settings ─────────────────────────────────────────────────────────────
await test("settings: read includes security/system/email", async () => {
  const s = await expectStatus(await req("/control/settings", { token: owner }), 200, "GET settings");
  originalSettings = s;
  assert(s.companyProfile, "companyProfile missing");
  assert(s.security?.passwordMinLength >= 6, "security policy missing");
  assert(s.system?.featureFlags, "system flags missing");
  assert(typeof s.email === "object", "email config missing");
  assert(s.companyProfile.companyName, "company name missing");
});

await test("settings: empty payload rejected", async () => {
  const r = await req("/control/settings", { method: "PATCH", body: {}, token: owner });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test("settings: unknown key rejected", async () => {
  const r = await req("/control/settings", { method: "PATCH", body: { notARealSection: 1 }, token: owner });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

const sectionCases = [
  ["companyProfile", { ...originalSettings.companyProfile, phone: "+880 1999-QA-TEST" }, (s) => s.companyProfile.phone],
  ["regional", { ...originalSettings.regional, timezone: "utc+0" }, (s) => s.regional.timezone],
  ["invoiceTemplate", { ...originalSettings.invoiceTemplate, defaultNotes: "QA note" }, (s) => s.invoiceTemplate.defaultNotes],
  ["financeConfig", { ...originalSettings.financeConfig, latePaymentFee: 1.6 }, (s) => s.financeConfig.latePaymentFee],
  ["leadCategories", originalSettings.leadCategories, (s) => s.leadCategories.length],
  ["clientTiers", originalSettings.clientTiers, (s) => s.clientTiers.length],
  ["taskStatuses", originalSettings.taskStatuses, (s) => s.taskStatuses.length],
  ["notifications", originalSettings.notifications, (s) => s.notifications.length],
  ["emailTemplates", originalSettings.emailTemplates, (s) => s.emailTemplates.length],
  ["appearance", { ...originalSettings.appearance, compactMode: !originalSettings.appearance.compactMode }, (s) => s.appearance.compactMode],
  ["taskAutomation", !originalSettings.taskAutomation, (s) => s.taskAutomation],
];
for (const [key, value, get] of sectionCases) {
  await test(`settings: save ${key}`, async () => {
    const saved = await expectStatus(
      await req("/control/settings", { method: "PATCH", body: { [key]: value }, token: owner }),
      200,
      `PATCH ${key}`
    );
    assert(get(saved) !== undefined, `${key} not returned`);
    const again = await expectStatus(await req("/control/settings", { token: owner }), 200, "GET");
    assert(JSON.stringify(get(again)) === JSON.stringify(get(saved)), `${key} not persisted`);
    // restore
    await req("/control/settings", { method: "PATCH", body: { [key]: originalSettings[key] }, token: owner });
  });
}

await test("settings: security policy clamps bad values", async () => {
  const s = await expectStatus(
    await req("/control/settings", { method: "PATCH", body: { security: { passwordMinLength: 9999, maxLoginAttempts: 999 } }, token: owner }),
    200,
    "PATCH security"
  );
  assert(s.security.passwordMinLength <= 64, "min length not clamped");
  assert(s.security.maxLoginAttempts <= 50, "attempts not clamped");
  await req("/control/settings", { method: "PATCH", body: { security: originalSettings.security }, token: owner });
});

await test("settings: system flags merge without wiping", async () => {
  const s = await expectStatus(
    await req("/control/settings", { method: "PATCH", body: { system: { featureFlags: { payroll: false } } }, token: owner }),
    200,
    "PATCH system"
  );
  assert(s.system.featureFlags.payroll === false, "payroll flag not applied");
  assert(s.system.featureFlags.clientPortal !== undefined, "other flags wiped");
  await req("/control/settings", { method: "PATCH", body: { system: originalSettings.system }, token: owner });
});

await test("settings: staff cannot read the admin document", async () => {
  const r = await req("/control/settings", { token: finance });
  assert(r.status === 403, `finance GET expected 403, got ${r.status}`);
});

// ── RBAC ─────────────────────────────────────────────────────────────────
await test("rbac: finance blocked from admin-only endpoints", async () => {
  for (const p of ["/control/health", "/control/roles", "/control/audit-logs", "/control/integrations"]) {
    const r = await req(p, { token: finance });
    assert(r.status === 403, `${p} expected 403, got ${r.status}`);
  }
});

await test("rbac: finance cannot create users", async () => {
  const r = await req("/control/users", { method: "POST", token: finance, body: { name: "X", email: "x@x.com", password: "Password123", roleId: "x" } });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

// ── Roles ────────────────────────────────────────────────────────────────
let qaRoleId = null;
await test("roles: create with normalised permissions", async () => {
  const r = await expectStatus(
    await req("/control/roles", {
      method: "POST",
      token: owner,
      body: {
        name: "QA Role",
        description: "created by QA",
        modulePermissions: { CLIENTS: { view: true, edit: false, approve: true }, TASKS: { edit: true } },
      },
    }),
    201,
    "create role"
  );
  qaRoleId = r.id;
  created.roleIds.push(r.id);
  // CLIENTS is the legacy label: the service migrates it to ACCOUNTS.
  assert(r.modulePermissions.ACCOUNTS.view === true, "legacy CLIENTS alias not migrated");
  assert(r.modulePermissions.ACCOUNTS.approve === true, "approve not stored");
  assert(r.modulePermissions.TASKS.view === true, "edit without view should force view");
});

await test("roles: duplicate name rejected", async () => {
  const r = await req("/control/roles", { method: "POST", token: owner, body: { name: "QA Role", modulePermissions: {} } });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test("roles: update description and permissions", async () => {
  const r = await expectStatus(
    await req(`/control/roles/${qaRoleId}`, { method: "PATCH", token: owner, body: { description: "updated", modulePermissions: { PEOPLE: { view: true } } } }),
    200,
    "update role"
  );
  assert(r.description === "updated", "description not updated");
  assert(r.modulePermissions.PEOPLE.view === true, "permissions not updated");
});

await test("roles: Owner cannot be deleted or renamed", async () => {
  const roles = await expectStatus(await req("/control/roles", { token: owner }), 200, "list");
  const ownerRole = roles.find((x) => x.name === "Owner");
  const del = await req(`/control/roles/${ownerRole.id}`, { method: "DELETE", token: owner });
  assert(del.status === 400, `owner delete expected 400, got ${del.status}`);
  const rename = await req(`/control/roles/${ownerRole.id}`, { method: "PATCH", token: owner, body: { name: "Boss" } });
  assert(rename.status === 400, `owner rename expected 400, got ${rename.status}`);
});

await test("roles: delete empty role", async () => {
  await expectStatus(await req(`/control/roles/${qaRoleId}`, { method: "DELETE", token: owner }), 200, "delete role");
  created.roleIds = created.roleIds.filter((id) => id !== qaRoleId);
});

// ── Users ────────────────────────────────────────────────────────────────
const stamp = String(Date.now()).slice(-6);
const qaEmail = `qa${stamp}@example.test`;
let qaUserId = null;
let qaToken = null;
let qaTempPassword = null;

await test("users: weak password rejected", async () => {
  const sales = (await expectStatus(await req("/control/roles", { token: owner }), 200, "roles")).find((r) => r.name.includes("Sales"));
  const r = await req("/control/users", { method: "POST", token: owner, body: { name: "QA User", email: `weak${stamp}@example.test`, password: "abc", roleId: sales.id } });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test("users: create, login and filter list", async () => {
  const sales = (await expectStatus(await req("/control/roles", { token: owner }), 200, "roles")).find((r) => r.name.includes("Sales"));
  const r = await expectStatus(
    await req("/control/users", { method: "POST", token: owner, body: { name: "QA User", email: qaEmail, password: "QaPass1234", roleId: sales.id } }),
    201,
    "create user"
  );
  qaUserId = r.id;
  created.userIds.push(r.id);
  assert(r.email === qaEmail, "email mismatch");
  assert(!("passwordHash" in r), "password hash leaked");
  const login = await expectStatus(await req("/auth/login", { method: "POST", body: { email: qaEmail, password: "QaPass1234" } }), 201, "login");
  qaToken = login.accessToken;
  assert(login.user.role.includes("Sales"), "role mismatch");
});

await test("users: duplicate email rejected", async () => {
  const roles = await expectStatus(await req("/control/roles", { token: owner }), 200, "roles");
  const r = await req("/control/users", { method: "POST", token: owner, body: { name: "Dup", email: qaEmail, password: "QaPass1234", roleId: roles[0].id } });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test("users: update role and audit entry", async () => {
  const roles = await expectStatus(await req("/control/roles", { token: owner }), 200, "roles");
  const financeRole = roles.find((r) => r.name.includes("Finance"));
  const r = await expectStatus(await req(`/control/users/${qaUserId}`, { method: "PATCH", token: owner, body: { roleId: financeRole.id } }), 200, "update role");
  assert(r.role.name === financeRole.name, "role not updated");
  const audit = await expectStatus(await req("/control/audit-logs?action=user.update&pageSize=10", { token: owner }), 200, "audit");
  assert(audit.rows.some((x) => x.entityId === qaUserId), "user.update not audited");
});

await test("users: reset generates one-time password and revokes old session", async () => {
  const r = await expectStatus(await req(`/control/users/${qaUserId}/reset-password`, { method: "POST", token: owner, body: {} }), 201, "reset");
  assert(r.temporaryPassword && r.temporaryPassword.length >= 8, "no temporary password returned");
  qaTempPassword = r.temporaryPassword;
  const old = await req("/auth/me", { token: qaToken });
  assert(old.status === 401, `old session should be revoked, got ${old.status}`);
  const login = await expectStatus(await req("/auth/login", { method: "POST", body: { email: qaEmail, password: qaTempPassword } }), 201, "login temp");
  qaToken = login.accessToken;
});

await test("users: deactivate blocks login and revokes token", async () => {
  await expectStatus(await req(`/control/users/${qaUserId}`, { method: "PATCH", token: owner, body: { isActive: false } }), 200, "deactivate");
  const me = await req("/auth/me", { token: qaToken });
  assert(me.status === 401, `token should be revoked, got ${me.status}`);
  const login = await req("/auth/login", { method: "POST", body: { email: qaEmail, password: qaTempPassword } });
  assert(login.status === 401, `disabled account should not log in, got ${login.status}`);
});

await test("users: self and last-owner protection", async () => {
  const me = await expectStatus(await req("/auth/me", { token: owner }), 200, "me");
  const self = await req(`/control/users/${me.id}`, { method: "PATCH", token: owner, body: { isActive: false } });
  assert(self.status === 400, `self-deactivate expected 400, got ${self.status}`);
  const del = await req(`/control/users/${me.id}`, { method: "DELETE", token: owner });
  assert(del.status === 400, `self-delete expected 400, got ${del.status}`);
});

await test("users: delete temp user", async () => {
  await expectStatus(await req(`/control/users/${qaUserId}`, { method: "DELETE", token: owner }), 200, "delete user");
  created.userIds = created.userIds.filter((id) => id !== qaUserId);
});

// ── Integrations ─────────────────────────────────────────────────────────
let integrationId = null;
await test("integrations: create encrypts credentials", async () => {
  const r = await expectStatus(
    await req("/control/integrations", { method: "POST", token: owner, body: { providerName: "QA Provider", type: "MESSAGING", credentials: { apiKey: "secret-qwerty", region: "bd" } } }),
    201,
    "create integration"
  );
  integrationId = r.id;
  created.integrationIds.push(r.id);
  assert(r.credentialsEnc === undefined, "credentials leaked");
  assert(r.hasCredentials === true, "hasCredentials missing");
  const list = await expectStatus(await req("/control/integrations", { token: owner }), 200, "list");
  const row = list.find((x) => x.id === r.id);
  assert(row.hasCredentials === true, "list missing hasCredentials");
  assert(row.credentialKeys.includes("apiKey"), "credential keys missing");
  assert(!JSON.stringify(list).includes("secret-qwerty"), "plaintext secret in list response");
});

await test("integrations: test validates stored config", async () => {
  const r = await expectStatus(await req(`/control/integrations/${integrationId}/test`, { method: "POST", token: owner }), 201, "test");
  assert(r.ok === true, `expected ok, got ${JSON.stringify(r)}`);
});

await test("integrations: connect/disconnect", async () => {
  const c = await expectStatus(await req(`/control/integrations/${integrationId}`, { method: "PATCH", token: owner, body: { status: "CONNECTED" } }), 200, "connect");
  assert(c.status === "CONNECTED", "not connected");
  const d = await expectStatus(await req(`/control/integrations/${integrationId}`, { method: "PATCH", token: owner, body: { status: "DISCONNECTED" } }), 200, "disconnect");
  assert(d.status === "DISCONNECTED", "not disconnected");
});

await test("integrations: delete", async () => {
  await expectStatus(await req(`/control/integrations/${integrationId}`, { method: "DELETE", token: owner }), 200, "delete");
  created.integrationIds = created.integrationIds.filter((id) => id !== integrationId);
});

// ── Audit ────────────────────────────────────────────────────────────────
await test("audit: filters, pagination and actor names", async () => {
  const all = await expectStatus(await req("/control/audit-logs?page=1&pageSize=5", { token: owner }), 200, "audit");
  assert(Array.isArray(all.rows) && all.rows.length <= 5, "page size not applied");
  assert(all.total >= all.rows.length, "total missing");
  assert(all.pages >= 1, "pages missing");
  assert(all.actions.length > 0, "actions facet missing");
  assert(all.entityTypes.length > 0, "entity facet missing");
  assert(all.rows.some((r) => r.actor?.name), "actor names missing");
  const filtered = await expectStatus(await req("/control/audit-logs?action=settings.update&pageSize=5", { token: owner }), 200, "audit filter");
  assert(filtered.rows.every((r) => r.action === "settings.update"), "action filter failed");
  const search = await expectStatus(await req("/control/audit-logs?q=role&pageSize=5", { token: owner }), 200, "audit search");
  assert(search.rows.length > 0, "search returned nothing");
});

// ── Pipeline stages ──────────────────────────────────────────────────────
let stageId = null;
await test("pipeline: create, update, delete", async () => {
  const c = await expectStatus(await req("/control/pipeline-stages", { method: "POST", token: owner, body: { name: "QA Stage", slaDays: 3 } }), 201, "create stage");
  stageId = c.id;
  created.stageIds.push(c.id);
  const u = await expectStatus(await req(`/control/pipeline-stages/${stageId}`, { method: "PATCH", token: owner, body: { name: "QA Stage 2" } }), 200, "update stage");
  assert(u.name === "QA Stage 2", "stage not updated");
  await expectStatus(await req(`/control/pipeline-stages/${stageId}`, { method: "DELETE", token: owner }), 200, "delete stage");
  created.stageIds = created.stageIds.filter((id) => id !== stageId);
});

await test("pipeline: empty name rejected", async () => {
  const r = await req("/control/pipeline-stages", { method: "POST", token: owner, body: { name: "  " } });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

// ── Health ───────────────────────────────────────────────────────────────
await test("health: reports db/cache/counts", async () => {
  const h = await expectStatus(await req("/control/health", { token: owner }), 200, "health");
  assert(h.ok === true, "health not ok");
  assert(typeof h.database.latencyMs === "number", "db latency missing");
  assert(["redis", "memory", "down"].includes(h.cache), "cache status invalid");
  assert(h.counts.users > 0, "user count missing");
  assert(typeof h.storage.uploadsMb === "number", "storage missing");
});

// ── WhatsApp ─────────────────────────────────────────────────────────────
await test("whatsapp: config load/save/test-send in mock mode", async () => {
  const cfg = await expectStatus(await req("/control/whatsapp/config", { token: owner }), 200, "wa config");
  originalWhatsapp = cfg;
  assert(typeof cfg.enabled === "boolean", "enabled missing");
  const saved = await expectStatus(
    await req("/control/whatsapp/config", { method: "PATCH", token: owner, body: { enabled: true, mode: "mock", displayNumber: "+8801700000000" } }),
    200,
    "wa save"
  );
  assert(saved.mode === "mock", "mode not saved");
  const conn = await expectStatus(await req("/control/whatsapp/test-connection", { method: "POST", token: owner }), 201, "wa test conn");
  assert(conn.ok === true, `mock connection should be ok: ${JSON.stringify(conn)}`);
  const send = await expectStatus(
    await req("/control/whatsapp/test-send", { method: "POST", token: owner, body: { to: "+8801700000000", templateName: "invoice_ready", params: ["QA"] } }),
    201,
    "wa test send"
  );
  assert(send.ok === true && send.mocked === true, `expected mocked send: ${JSON.stringify(send)}`);
  const logs = await expectStatus(await req("/control/whatsapp/logs?take=5", { token: owner }), 200, "wa logs");
  assert(Array.isArray(logs), "logs not an array");
  // restore
  await req("/control/whatsapp/config", { method: "PATCH", token: owner, body: { enabled: originalWhatsapp.enabled, mode: originalWhatsapp.mode, displayNumber: originalWhatsapp.displayNumber } });
});

// ── Telegram ─────────────────────────────────────────────────────────────
await test("telegram: config load/save/link-code/logs", async () => {
  const cfg = await expectStatus(await req("/control/telegram/config", { token: owner }), 200, "tg config");
  originalTelegram = cfg;
  assert(typeof cfg.enabled === "boolean", "enabled missing");
  const saved = await expectStatus(await req("/control/telegram/config", { method: "PATCH", token: owner, body: { enabled: false } }), 200, "tg save");
  assert(saved.enabled === false, "enabled not saved");
  const me = await expectStatus(await req("/auth/me", { token: owner }), 200, "me");
  const link = await expectStatus(await req("/control/telegram/link-code", { method: "POST", token: owner, body: { userId: me.id } }), 201, "link code");
  assert(link.code && link.code.length >= 4, "link code missing");
  // A link code requires a target: empty body must be rejected, not silently minted.
  const bad = await req("/control/telegram/link-code", { method: "POST", token: owner, body: {} });
  assert(bad.status === 400, `empty target expected 400, got ${bad.status}`);
  const links = await expectStatus(await req("/control/telegram/links", { token: owner }), 200, "links");
  assert(Array.isArray(links), "links not array");
  const logs = await expectStatus(await req("/control/telegram/logs?take=5", { token: owner }), 200, "tg logs");
  assert(Array.isArray(logs), "logs not array");
  await req("/control/telegram/config", { method: "PATCH", token: owner, body: { enabled: originalTelegram.enabled } });
});

// ── Export ───────────────────────────────────────────────────────────────
await test("export: JSON snapshot has counts and data", async () => {
  const e = await expectStatus(await req("/control/export", { token: owner, timeout: 30000 }), 200, "export");
  assert(e.exportDate, "exportDate missing");
  assert(e.counts.invoices >= 0, "counts missing");
  assert(e.data.clients && e.data.invoices, "data missing");
});

// ── Branding ─────────────────────────────────────────────────────────────
await test("branding: read and update round-trip", async () => {
  const b = await expectStatus(await req("/control/branding", { token: owner }), 200, "branding");
  const color = b.primaryColor ?? "#7C3AED";
  const upd = await expectStatus(await req("/control/branding", { method: "PATCH", token: owner, body: { primaryColor: color } }), 200, "branding update");
  assert(upd.primaryColor === color, "branding color mismatch");
});

// ── Cleanup ──────────────────────────────────────────────────────────────
for (const id of created.userIds) await req(`/control/users/${id}`, { method: "DELETE", token: owner }).catch(() => {});
for (const id of created.roleIds) await req(`/control/roles/${id}`, { method: "DELETE", token: owner }).catch(() => {});
for (const id of created.integrationIds) await req(`/control/integrations/${id}`, { method: "DELETE", token: owner }).catch(() => {});
for (const id of created.stageIds) await req(`/control/pipeline-stages/${id}`, { method: "DELETE", token: owner }).catch(() => {});

// ── Report ───────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.status === "PASS").length;
console.log(JSON.stringify({ passed, failed: failures, results }, null, 2));
process.exit(failures ? 1 : 0);
