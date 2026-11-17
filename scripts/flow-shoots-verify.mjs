#!/usr/bin/env node
/**
 * Flow shoots + deliverables + campaign-report regression probe.
 *
 * Talks to a running API, creates throwaway records and removes everything it
 * created. Exits non-zero when a check fails, so it can run after the smoke
 * test in CI.
 *
 *   npm run test:shoots
 *   FLOW_QA_EMAIL=... FLOW_QA_PASSWORD=... API_URL=http://host:4000/api npm run test:shoots
 */
const BASE = process.env.API_URL ?? "http://localhost:4000/api";
const EMAIL = process.env.FLOW_QA_EMAIL ?? "sakib@zoolyum.com";
const PASSWORD = process.env.FLOW_QA_PASSWORD ?? "zoolyum123";

let failed = 0;
let passed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n        ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
  }
};

let token = "";
async function req(path, { method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const created = { shootId: null, deliverableIds: [], reportIds: [], taskIds: [] };
const short = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function main() {
  // ── auth + fixtures ────────────────────────────────────────────────
  const login = await req("/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  token = login.data?.accessToken ?? "";
  check("owner login", login.status < 300 && !!token, login.data);
  if (!token) return;

  const projects = (await req("/flow/projects")).data ?? [];
  const allCampaigns = (await req("/calendar/campaigns")).data ?? [];
  const campaigns = Array.isArray(allCampaigns) ? allCampaigns : allCampaigns.items ?? [];
  const campaign =
    campaigns.find((c) => projects.some((p) => p.status === "ACTIVE" && p.client?.id === c.clientId)) ??
    campaigns[0];
  const project =
    projects.find((p) => p.status === "ACTIVE" && campaign && p.client?.id === campaign.clientId) ??
    projects.find((p) => p.status === "ACTIVE") ??
    projects[0];
  check("fixture: project found", !!project);
  if (!project) return;
  const projectCampaign = campaigns.find((c) => c.clientId === project.client?.id) ?? null;
  const employees = (await req("/people/employees")).data ?? [];
  check("fixture: employees found", employees.length > 0);
  if (!employees.length) return;
  const emp = employees[0];

  // ── shoot create ───────────────────────────────────────────────────
  const shoot = await req(`/flow/projects/${project.id}/shoots`, {
    method: "POST",
    body: {
      title: "QA — call sheet",
      shootDate: short(21),
      endDate: short(22),
      durationType: "HALF_DAY",
      callTime: "10:00",
      wrapTime: "14:30",
      location: "QA Studio",
      locationNote: "Gate 2",
      description: "Regression probe",
      equipment: ["Sony FX3 ×2", "Aputure 300D", "  sony fx3 ×2  "],
      campaignId: projectCampaign?.id,
      status: "CONFIRMED",
    },
  });
  created.shootId = shoot.data?.id ?? null;
  check("shoot created", shoot.status === 201 && !!created.shootId, shoot.data);
  check("equipment de-duplicated + trimmed", shoot.data?.equipment?.length === 2, shoot.data?.equipment);
  check("half-day duration stored", shoot.data?.durationType === "HALF_DAY");
  check("calendar event linked", !!shoot.data?.calendarEventId);
  if (projectCampaign) {
    check("shoot campaign linked", shoot.data?.campaign?.id === projectCampaign.id, shoot.data?.campaign);
  }

  // ── shoot validation ───────────────────────────────────────────────
  const badEnd = await req(`/flow/projects/${project.id}/shoots`, {
    method: "POST",
    body: { title: "bad", shootDate: short(10), endDate: short(9) },
  });
  check("end date before shoot date rejected", badEnd.status === 400, badEnd.data);
  const badTime = await req(`/flow/projects/${project.id}/shoots`, {
    method: "POST",
    body: { title: "bad", shootDate: short(10), callTime: "25:99" },
  });
  check("invalid call time rejected", badTime.status === 400, badTime.data);

  // ── crew ───────────────────────────────────────────────────────────
  const crewEmp = await req(`/flow/shoots/${created.shootId}/crew`, {
    method: "POST",
    body: { role: "DOP", source: "EMPLOYEE", employeeId: emp.id, isConfirmed: true, callTime: "09:30" },
  });
  check(
    "employee crew resolved with a name snapshot",
    crewEmp.status === 201 && crewEmp.data?.name === emp.name && crewEmp.data?.source === "EMPLOYEE",
    crewEmp.data
  );
  const crewExt = await req(`/flow/shoots/${created.shootId}/crew`, {
    method: "POST",
    body: { role: "CAMERAMAN", source: "EXTERNAL", name: "QA External", phone: "+8801700000000", fee: 5000 },
  });
  check("external crew stored", crewExt.status === 201 && crewExt.data?.source === "EXTERNAL", crewExt.data);
  const crewBad = await req(`/flow/shoots/${created.shootId}/crew`, {
    method: "POST",
    body: { role: "GAFFER", source: "EXTERNAL" },
  });
  check("external crew without a name rejected", crewBad.status === 400, crewBad.data);
  const crewPatch = await req(`/flow/shoots/${created.shootId}/crew/${crewExt.data?.id}`, {
    method: "PATCH",
    body: { isConfirmed: true, callTime: "08:45" },
  });
  check(
    "crew confirm + call time updated",
    crewPatch.data?.isConfirmed === true && crewPatch.data?.callTime === "08:45",
    crewPatch.data
  );

  const detail = await req(`/flow/shoots/${created.shootId}`);
  check("shoot detail returns both crew rows", detail.data?.crew?.length === 2, detail.data?.crew?.length);

  // ── calendar mirror ────────────────────────────────────────────────
  const dayBefore = short(21);
  const dayAfter = short(24);
  const dayItems = (d) => {
    const items = (d ?? {}).items ?? [];
    return Array.isArray(items) ? items : [];
  };
  const onDay = dayItems((await req(`/calendar/day/${dayBefore}`)).data);
  check("shoot appears on the calendar day", onDay.some((i) => i.title === "QA — call sheet"));

  const moved = await req(`/flow/shoots/${created.shootId}`, {
    method: "PATCH",
    body: {
      title: "QA — call sheet (v2)",
      shootDate: dayAfter,
      endDate: null,
      status: "WRAPPED",
      equipment: ["Sony FX3 ×2", "DJI RS4"],
      isDateLocked: true,
    },
  });
  check(
    "shoot update applied",
    moved.data?.title?.endsWith("(v2)") && moved.data?.status === "WRAPPED",
    moved.data
  );
  check("equipment replaced + date locked", moved.data?.equipment?.length === 2 && moved.data?.isDateLocked === true);
  check("same calendar event reused (no duplicate)", moved.data?.calendarEventId === shoot.data?.calendarEventId);
  const oldDay = dayItems((await req(`/calendar/day/${dayBefore}`)).data);
  check(
    "old day no longer carries the moved shoot",
    !oldDay.some((i) => i.title === "QA — call sheet (v2)")
  );
  const newDay = dayItems((await req(`/calendar/day/${dayAfter}`)).data);
  check("new day carries the moved shoot", newDay.some((i) => i.title === "QA — call sheet (v2)"));

  // ── deliverables ───────────────────────────────────────────────────
  const dv = await req(`/flow/projects/${project.id}/deliverables`, {
    method: "POST",
    body: {
      title: "QA — Eid post",
      kind: "GRAPHIC",
      topic: "Eid greeting post — peacock motif",
      objective: "Awareness",
      campaignId: projectCampaign?.id,
      dueDate: short(30),
      clientVisible: true,
      description: "Square 1080",
    },
  });
  if (dv.data?.id) created.deliverableIds.push(dv.data.id);
  check("deliverable kind + topic stored", dv.data?.kind === "GRAPHIC" && String(dv.data?.topic).includes("peacock"));
  if (projectCampaign) {
    check("deliverable campaign linked", dv.data?.campaign?.id === projectCampaign.id, dv.data?.campaign);
  }

  const bulk = await req(`/flow/projects/${project.id}/deliverables/bulk`, {
    method: "POST",
    body: {
      items: [
        { title: "QA — bulk graphic 1", kind: "GRAPHIC", campaignId: projectCampaign?.id },
        { title: "QA — bulk graphic 2", kind: "GRAPHIC", campaignId: projectCampaign?.id },
        { title: "QA — bulk video 1", kind: "VIDEO", topic: "QA reel", campaignId: projectCampaign?.id },
      ],
    },
  });
  check("bulk paste creates three deliverables", bulk.data?.count === 3, bulk.data);
  for (const row of bulk.data?.items ?? []) created.deliverableIds.push(row.id);

  const otherClientCampaign = campaigns.find((c) => c.clientId && c.clientId !== project.client?.id);
  if (otherClientCampaign) {
    const cross = await req(`/flow/projects/${project.id}/deliverables`, {
      method: "POST",
      body: { title: "QA cross client", campaignId: otherClientCampaign.id },
    });
    check("campaign from another client rejected", cross.status === 400, cross.data);
  }

  // ── one-click assign ───────────────────────────────────────────────
  const assign = await req(`/flow/projects/${project.id}/deliverables/assign-tasks`, {
    method: "POST",
    body: { deliverableIds: created.deliverableIds, assigneeId: emp.id, priority: "HIGH" },
  });
  check("tasks created for the selection", assign.status === 201 && assign.data?.created >= 1, assign.data);
  for (const r of assign.data?.results ?? []) if (r.taskId) created.taskIds.push(r.taskId);
  check(
    "every selection is accounted for",
    (assign.data?.created ?? 0) + (assign.data?.skipped ?? 0) + (assign.data?.failed ?? 0) ===
      created.deliverableIds.length,
    assign.data
  );
  const assignAgain = await req(`/flow/projects/${project.id}/deliverables/assign-tasks`, {
    method: "POST",
    body: { deliverableIds: created.deliverableIds, assigneeId: emp.id },
  });
  check(
    "second assign is a no-op (skip)",
    assignAgain.data?.created === 0 && assignAgain.data?.skipped === created.deliverableIds.length,
    assignAgain.data
  );
  const projectDetail = await req(`/flow/projects/${project.id}`);
  const linked = (projectDetail.data?.deliverables ?? []).filter(
    (d) => d.id === created.deliverableIds[0]
  )[0];
  check("deliverable is linked to its task", (linked?.tasks?.length ?? 0) === 1, linked?.tasks);

  // ── campaign report ────────────────────────────────────────────────
  const report = await req(`/flow/projects/${project.id}/reports/generate`, {
    method: "POST",
    body: {
      periodStart: short(-30),
      periodEnd: short(40),
      campaignId: projectCampaign?.id,
      groupBy: "CAMPAIGN",
      pmNotes: "QA generated report",
    },
  });
  if (report.data?.id) created.reportIds.push(report.data.id);
  const summary = report.data?.summary;
  check("report carries a numeric summary", !!summary && typeof summary.total === "number", summary);
  check("summary breaks the scope down by kind", !!summary?.byKind && Object.keys(summary.byKind).length > 0);
  check("report snapshots the period's shoots", Array.isArray(report.data?.shoots), report.data?.shoots?.length);
  const shootSnap = (report.data?.shoots ?? []).find((s) => String(s.title).startsWith("QA — call sheet"));
  check("shoot snapshot freezes crew + equipment", (shootSnap?.crew?.length ?? 0) === 2 && (shootSnap?.equipment?.length ?? 0) === 2, shootSnap);
  if (projectCampaign) {
    check(
      "report is scoped + titled by campaign",
      report.data?.campaignId === projectCampaign.id && String(report.data?.title).startsWith("Campaign report"),
      report.data?.title
    );
  }

  await req(`/flow/shoots/${created.shootId}`, {
    method: "PATCH",
    body: { title: "QA — mutated after report" },
  });
  const reports = (await req(`/flow/projects/${project.id}/reports`)).data ?? [];
  const stored = reports.find((r) => r.id === report.data?.id);
  check(
    "stored report keeps the original snapshot",
    (stored?.shoots ?? []).some((s) => String(s.title).startsWith("QA — call sheet")) &&
      !(stored?.shoots ?? []).some((s) => String(s.title).includes("mutated"))
  );
}

async function cleanup() {
  if (!token) return;
  for (const id of created.taskIds) await req(`/tasks/${id}`, { method: "DELETE" });
  for (const id of created.reportIds) await req(`/flow/reports/${id}`, { method: "DELETE" });
  for (const id of created.deliverableIds) await req(`/flow/deliverables/${id}`, { method: "DELETE" });
  if (created.shootId) await req(`/flow/shoots/${created.shootId}`, { method: "DELETE" });
}

main()
  .catch((e) => {
    failed++;
    console.log(`FAIL  probe crashed: ${e?.stack ?? e}`);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${passed} passed · ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
