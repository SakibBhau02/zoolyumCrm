#!/usr/bin/env node
/**
 * Flow module regression probe.
 *
 * Talks to a running API, creates throwaway projects, and removes every record
 * it creates. Exits non-zero when a check fails, so it can run in CI after the
 * smoke test.
 *
 *   npm run test:flow
 *   FLOW_QA_EMAIL=... FLOW_QA_PASSWORD=... API_URL=http://host:4000/api npm run test:flow
 */
const BASE = process.env.API_URL ?? "http://localhost:4000/api";
const ORIGIN = BASE.replace(/\/api\/?$/, "");
const EMAIL = process.env.FLOW_QA_EMAIL ?? "sakib@zoolyum.com";
const PASSWORD = process.env.FLOW_QA_PASSWORD ?? "zoolyum123";

const results = [];
let failed = 0;
const check = (id, name, ok, detail) => {
  results.push({ id, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}${ok ? "" : `\n        ${detail}`}`);
};

async function req(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const day = (n) => new Date(Date.now() + n * 86400000).toISOString();
const short = (n) => day(n).slice(0, 10);
const stamp = Date.now().toString(36);
const png = () => Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const created = { projects: [], invoices: [], tasks: [], files: [], reports: [], uploads: [] };

async function cleanup(token) {
  for (const id of created.invoices) await req(`/capital/invoices/${id}`, { method: "DELETE", token }).catch(() => {});
  for (const id of created.files) await req(`/flow/files/${id}`, { method: "DELETE", token }).catch(() => {});
  for (const id of created.reports) await req(`/flow/reports/${id}`, { method: "DELETE", token }).catch(() => {});
  for (const id of created.tasks) await req(`/tasks/${id}`, { method: "DELETE", token }).catch(() => {});
  for (const id of created.projects) {
    // Template tasks belong to the project but are not in created.tasks.
    const d = await req(`/flow/projects/${id}`, { token }).catch(() => null);
    for (const t of d?.data?.tasks ?? []) await req(`/tasks/${t.id}`, { method: "DELETE", token }).catch(() => {});
    await req(`/flow/projects/${id}`, { method: "DELETE", token }).catch(() => {});
  }
}

async function main() {
  const login = await req("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  const token = login.data?.accessToken;
  if (!token) throw new Error(`login failed (${login.status})`);
  console.log(`API ${BASE} · signed in as ${login.data?.user?.name ?? EMAIL}\n`);

  const list = await req("/flow/projects", { token });
  const projects = Array.isArray(list.data) ? list.data : list.data?.items ?? [];
  if (!projects.length) throw new Error("no projects to read a client from — seed the database first");
  const clientId = projects[0].client.id;
  const clientName = projects[0].client.companyName;

  // ── 1. template creates starter tasks and a benchmark timeline ──────────
  const templates = await req("/flow/templates", { token });
  const template = Array.isArray(templates.data) ? templates.data[0] : null;
  const bulk = await req("/flow/projects", {
    method: "POST", token,
    body: { name: `QA-${stamp} flow`, clientId, amount: 5000, currency: "BDT", status: "PLANNING", startDate: short(0), templateId: template?.id },
  });
  const projectId = bulk.data?.id;
  if (!projectId) throw new Error(`project create failed (${bulk.status})`);
  created.projects.push(projectId);

  const detail = await req(`/flow/projects/${projectId}`, { token });
  const expectedTasks = Array.isArray(template?.defaultTaskList) ? template.defaultTaskList.length : 0;
  check("template", "template creates its starter tasks", (detail.data?.tasks?.length ?? -1) === expectedTasks,
    `expected ${expectedTasks}, got ${detail.data?.tasks?.length}`);

  // ── 2. report cadence round-trips ───────────────────────────────────────
  await req(`/flow/projects/${projectId}`, { method: "PATCH", token, body: { reportMode: "AUTOMATIC", reportFrequency: "15-days" } });
  const scheduled = await req(`/flow/projects/${projectId}`, { token });
  check("report-schedule", "AUTOMATIC cadence persists",
    scheduled.data?.reportMode === "AUTOMATIC" && scheduled.data?.reportFrequency === "15-days" && !!scheduled.data?.nextReportDate,
    JSON.stringify({ mode: scheduled.data?.reportMode, freq: scheduled.data?.reportFrequency, next: scheduled.data?.nextReportDate }));

  // ── 3. file upload metadata + signed link ──────────────────────────────
  const bytes = png();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "qa-flow.png");
  const up = await req("/flow/upload", { method: "POST", token, body: form });
  created.uploads.push(up.data?.fileUrl);
  const added = await req(`/flow/projects/${projectId}/files`, {
    method: "POST", token,
    body: { fileUrl: up.data?.fileUrl, fileName: "qa-flow.png", size: bytes.length, mimeType: "image/png" },
  });
  if (added.data?.id) created.files.push(added.data.id);
  const withFile = await req(`/flow/projects/${projectId}`, { token });
  const file = withFile.data?.files?.find((f) => f.id === added.data?.id);
  check("file-metadata", "upload keeps name, size and a signed link",
    file?.fileName === "qa-flow.png" && file?.size === bytes.length && !!file?.downloadUrl,
    JSON.stringify({ fileName: file?.fileName, size: file?.size, signed: !!file?.downloadUrl }));

  const unsigned = await fetch(ORIGIN + up.data?.fileUrl);
  const signedUrl = ORIGIN + file?.downloadUrl;
  const signed = await fetch(signedUrl);
  check("file-signature", "unsigned link is refused, signed link works",
    unsigned.status === 403 && signed.status === 200, `unsigned=${unsigned.status}, signed=${signed.status}`);

  // ── 4. approval payload ────────────────────────────────────────────────
  await req(`/flow/files/${added.data?.id}/approval`, { method: "PATCH", token, body: { approvalStatus: "APPROVED" } });
  const approved = await req(`/flow/projects/${projectId}`, { token });
  check("file-approval", "UI payload changes approvalStatus",
    approved.data?.files?.find((f) => f.id === added.data?.id)?.approvalStatus === "APPROVED",
    `status=${approved.data?.files?.find((f) => f.id === added.data?.id)?.approvalStatus}`);

  // ── 5. report billing is period-scoped ─────────────────────────────────
  const inv = await req("/capital/invoices", {
    method: "POST", token,
    body: {
      clientId, projectId, invoiceType: "ONE_TIME", status: "DRAFT",
      issueDate: day(-60), dueDate: day(-30), currency: "BDT",
      lines: [{ description: "QA out-of-period", quantity: 1, unitPrice: 1000, amount: 1000 }],
    },
  });
  if (inv.data?.id) created.invoices.push(inv.data.id);
  const report = await req(`/flow/projects/${projectId}/reports/generate`, {
    method: "POST", token, body: { periodStart: short(-7), periodEnd: short(0) },
  });
  if (report.data?.id) created.reports.push(report.data.id);
  check("report-period", "7-day report ignores a 60-day-old invoice",
    Number(report.data?.billing?.invoiced ?? -1) === 0, `invoiced=${report.data?.billing?.invoiced}`);

  // ── 6. archived tasks excluded consistently ────────────────────────────
  const taskId = withFile.data?.tasks?.[0]?.id;
  if (taskId) {
    await req(`/tasks/${taskId}`, { method: "PATCH", token, body: { archivedAt: true } });
    const d = await req(`/flow/projects/${projectId}`, { token });
    const l = await req("/flow/projects", { token });
    const row = (Array.isArray(l.data) ? l.data : l.data?.items ?? []).find((p) => p.id === projectId);
    check("progress-authority", "detail and list agree after archiving a task",
      d.data?.tasksTotal === row?.tasksTotal && d.data?.progress === row?.progress,
      `detail=${d.data?.tasksTotal}/${d.data?.progress}%, list=${row?.tasksTotal}/${row?.progress}%`);
  }

  // ── 7. capacity carries its own window ────────────────────────────────
  const cap = await req(`/flow/capacity?from=${short(-14)}&to=${short(0)}`, { token });
  const person = Array.isArray(cap.data) ? cap.data[0] : null;
  check("capacity", "capacity returns a bounded window and utilisation",
    !!person && Math.abs(Number(person.capacityHours) - 80) < 1 && person.utilizationPct != null,
    `capacityHours=${person?.capacityHours}, utilizationPct=${person?.utilizationPct}`);

  // ── 8. delete guard + clean delete ────────────────────────────────────
  const blocked = await req(`/flow/projects/${projectId}`, { method: "DELETE", token });
  check("delete-guard", "delete is refused while dependants exist",
    blocked.status === 409 && /task|invoice/i.test(blocked.data?.message ?? ""),
    `HTTP ${blocked.status} ${blocked.data?.message ?? ""}`);

  await cleanup(token);
  const gone = await req(`/flow/projects/${projectId}`, { token });
  const blob = await fetch(signedUrl).catch(() => null);
  check("delete-clean", "after clearing dependants the project and its blob are gone",
    gone.status === 404 && !!blob && blob.status >= 400, `project=${gone.status}, blob=${blob?.status}`);
  created.projects = created.projects.filter((id) => id !== projectId);

  // ── 9. CSV import: quoted comma + unknown client ──────────────────────
  const csv = `name,client,status,budget\n"QA,${stamp} comma",${clientName},planning,1200\nUnknown client,Nope Corp,active,10\n`;
  const csvForm = new FormData();
  csvForm.append("file", new Blob([csv], { type: "text/csv" }), "qa-flow.csv");
  const imported = await req("/flow/import", { method: "POST", token, body: csvForm });
  const found = await req(`/flow/projects?q=QA,${stamp}`, { token });
  const rows = Array.isArray(found.data) ? found.data : found.data?.items ?? [];
  const importedRow = rows.find((p) => p.name === `QA,${stamp} comma`);
  if (importedRow) created.projects.push(importedRow.id);
  check("csv-import", "quoted commas survive and unknown clients are skipped",
    imported.data?.imported === 1 && imported.data?.skipped?.length === 1 && !!importedRow,
    JSON.stringify({ imported: imported.data?.imported, skipped: imported.data?.skipped, found: !!importedRow }));

  await cleanup(token);
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(`\nflow probe crashed: ${err?.message ?? err}`);
  try {
    const login = await req("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
    if (login.data?.accessToken) await cleanup(login.data.accessToken);
  } catch {}
  process.exitCode = 1;
});
