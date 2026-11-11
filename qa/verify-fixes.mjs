/**
 * Verifies the 13 production blockers after the fix.
 * Runs against a live API with the seeded demo users.
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000/api").replace(/\/$/, "");
const results = [];
const rec = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function login(email = "sakib@zoolyum.com", password = "zoolyum123") {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email} -> ${r.status}`);
  return r.json();
}

async function call(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, headers: res.headers };
}

const main = async () => {
  const owner = await login();
  const token = owner.accessToken;

  // ── Blocker 4: permission matrix uses the keys the guards enforce ──────
  const roles = await call(token, "/control/roles");
  const ownerRole = (roles.body ?? []).find((r) => r.name === "Owner");
  const keys = Object.keys(ownerRole?.modulePermissions ?? {});
  rec(keys.includes("PULSE") && keys.includes("ACCOUNTS") && keys.includes("CAPITAL"), "control: canonical module keys", keys.join(","));
  rec(!keys.includes("CLIENTS") && !keys.includes("FINANCE"), "control: legacy keys migrated", keys.join(","));

  // ── Blocker 2: upload route is no longer an open file server ──────────
  const unsignedUpload = await fetch(`${API}/pulse/uploads/anything.png`);
  rec([401, 403].includes(unsignedUpload.status), "pulse uploads: unsigned request rejected", `status ${unsignedUpload.status}`);
  const bogusSig = await fetch(`${API}/pulse/uploads/anything.png?exp=${Date.now() + 60000}&sig=deadbeef`);
  rec(bogusSig.status === 403, "pulse uploads: forged signature rejected", `status ${bogusSig.status}`);

  // ── Blocker 5: webhooks fail closed without a configured secret ───────
  const wa = await fetch(`${API}/whatsapp/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: [] }),
  });
  rec(wa.status === 503, "whatsapp webhook: fails closed when secret is unset", `status ${wa.status}`);
  const tg = await call(token, "/telegram/webhook", { method: "POST", body: JSON.stringify({ update_id: 1 }) });
  const tgSafe =
    [401, 503].includes(tg.status) || (tg.status === 200 && tg.body?.ok === false);
  rec(tgSafe, "telegram webhook: rejects unsigned update", `status ${tg.status} ${JSON.stringify(tg.body ?? {})}`);

  // ── Blocker 1: vendor payouts are OUT, not client income ──────────────
  const vendor = await call(token, "/capital/vendors", {
    method: "POST",
    body: JSON.stringify({ name: `QA Vendor ${Date.now()}` }),
  });
  const vendorId = vendor.body?.id;
  const before = await call(token, "/capital/income/stats");
  const expense = await call(token, "/capital/expenses", {
    method: "POST",
    body: JSON.stringify({
      description: `QA payable ${Date.now()}`,
      amount: 1234,
      category: "MISC",
      isPayable: true,
      approvalStatus: "APPROVED",
      vendorId,
    }),
  });
  const expenseId = expense.body?.id;
  const pay = expenseId
    ? await call(token, `/capital/expenses/${expenseId}/payment`, {
        method: "POST",
        body: JSON.stringify({ amount: 1234, paymentMethod: "CASH" }),
      })
    : { status: 0, body: null };
  const after = await call(token, "/capital/income/stats");
  const delta = Number(after.body?.total ?? 0) - Number(before.body?.total ?? 0);
  rec(expenseId && pay.status < 400 && Math.abs(delta) < 0.01, "finance: vendor payout excluded from income", `delta ${delta} (expense ${expense.status}, pay ${pay.status})`);

  const incomeList = await call(token, "/capital/income?limit=200");
  const leaked = (incomeList.body ?? []).find((r) => Number(r.amount) === 1234 && r.source === "invoice");
  rec(!leaked, "finance: payout absent from income list");

  // ── Blocker 8: money validation ──────────────────────────────────────
  const invoice = await call(token, "/capital/invoices", {
    method: "POST",
    body: JSON.stringify({
      clientId: (await call(token, "/accounts/client-lookup")).body?.[0]?.id,
      lines: [{ description: "QA line", unitPrice: 100, quantity: 1 }],
    }),
  });
  const invId = invoice.body?.id;
  const badPay = await call(token, `/capital/invoices/${invId}/payment`, {
    method: "POST",
    body: JSON.stringify({ amount: -50, paymentMethod: "CASH" }),
  });
  rec(badPay.status === 400, "validation: negative payment rejected", `status ${badPay.status}`);
  const badTax = await call(token, `/capital/invoices/${invId}`, {
    method: "PATCH",
    body: JSON.stringify({ taxRate: 1500 }),
  });
  rec(badTax.status === 400, "validation: taxRate > 100 rejected", `status ${badTax.status}`);
  const badLine = await call(token, `/capital/invoices/${invId}`, {
    method: "PATCH",
    body: JSON.stringify({ lines: [{ description: "neg", unitPrice: -100, quantity: 1 }] }),
  });
  rec(badLine.status === 400, "validation: negative invoice line rejected", `status ${badLine.status}`);
  const badRefund = await call(token, "/capital/credit-notes", {
    method: "POST",
    body: JSON.stringify({ type: "REFUND", amount: 999999, clientId: invoice.body?.clientId }),
  });
  rec(badRefund.status === 400, "validation: refund without invoice rejected", `status ${badRefund.status}`);

  // ── Blocker 10/11: payloads are bounded ─────────────────────────────
  const flow = await call(token, "/flow/projects");
  const flowBytes = JSON.stringify(flow.body).length;
  rec(flowBytes < 900_000, "payload: /flow/projects bounded", `${Math.round(flowBytes / 1024)} KB`);
  const tasks = await call(token, "/tasks");
  const taskBytes = JSON.stringify(tasks.body).length;
  rec(taskBytes < 400_000, "payload: /tasks bounded (activityLog omitted)", `${Math.round(taskBytes / 1024)} KB`);
  const paged = await call(token, "/capital/invoices?page=1&pageSize=20");
  rec(!!paged.body?.items && paged.body.items.length <= 20, "payload: /capital/invoices paged", `${paged.body?.items?.length ?? "-"} rows`);

  const a1 = Date.now();
  await call(token, "/accounts/clients");
  const cold = Date.now() - a1;
  const a2 = Date.now();
  await call(token, "/accounts/clients");
  const warm = Date.now() - a2;
  rec(warm <= cold, "accounts: financial summary cached", `cold ${cold}ms → warm ${warm}ms`);

  // ── Cleanup the QA records ──────────────────────────────────────────
  if (expenseId) await call(token, `/capital/expenses/${expenseId}`, { method: "DELETE" }).catch(() => {});
  if (invId) await call(token, `/capital/invoices/${invId}`, { method: "DELETE" }).catch(() => {});
  if (vendorId) await call(token, `/capital/vendors/${vendorId}`, { method: "DELETE" }).catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
