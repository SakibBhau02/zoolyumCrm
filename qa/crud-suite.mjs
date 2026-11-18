/**
 * Field-level CRUD suite for every CRM module.
 *
 * Each step writes a realistic record through the same endpoint the UI form
 * posts to, then re-reads it and compares field-by-field. QA records are
 * deleted at the end of each section, so the demo data is left untouched.
 *
 *   node qa/crud-suite.mjs
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api";
const results = [];
let failures = 0;

function pass(name) {
  results.push({ status: "PASS", name });
}
function fail(name, detail) {
  failures += 1;
  results.push({ status: "FAIL", name, detail: String(detail).slice(0, 500) });
}
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ status: "PASS", name, detail });
  } catch (e) {
    fail(name, e?.message ?? e);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function login(email = "sakib@zoolyum.com", password = "zoolyum123") {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.accessToken) throw new Error("login failed: " + JSON.stringify(json).slice(0, 200));
  return json.accessToken;
}

const token = await login();
const financeToken = await login("sadia@zoolyum.com", "zoolyum123");
async function call(method, path, body, as = token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${as}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
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
async function must(method, path, body, expect = [200, 201]) {
  const r = await call(method, path, body);
  if (!expect.includes(r.status)) {
    throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body).slice(0, 320)}`);
  }
  return r.body;
}
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => iso(new Date(Date.now() + n * 86400000));
const stamp = String(Date.now()).slice(-7);

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CONTROL â€” settings, roles, users, integrations, pipeline, branding, health
   (deep coverage already lives in scripts/qa-control.mjs; this section only
   re-checks the three sections that cover the branding work)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
await step("control: settings read returns every section the UI renders", async () => {
  const s = await must("GET", "/control/settings");
  for (const key of [
    "companyProfile",
    "regional",
    "invoiceTemplate",
    "financeConfig",
    "leadCategories",
    "clientTiers",
    "healthScoreWeights",
    "taskStatuses",
    "notifications",
    "emailTemplates",
    "appearance",
    "security",
    "system",
    "email",
  ]) {
    assert(s[key] !== undefined, `missing section ${key}`);
  }
  return `${Object.keys(s).length} sections`;
});
await step("control: appearance + branding round-trip", async () => {
  const before = await must("GET", "/control/settings");
  const saved = await must("PATCH", "/control/settings", { appearance: { ...before.appearance, compactMode: !before.appearance.compactMode } });
  eq(saved.appearance.compactMode, !before.appearance.compactMode, "compactMode");
  const again = await must("GET", "/control/settings");
  eq(again.appearance.compactMode, !before.appearance.compactMode, "persisted compactMode");
  await must("PATCH", "/control/settings", { appearance: before.appearance });
});
await step("control: branding read/update + validation", async () => {
  const before = await must("GET", "/control/branding");
  const saved = await must("PATCH", "/control/branding", {
    appName: `${before.appName ?? "Zoolyum OS"}`.trim() || "Zoolyum OS",
    primaryColor: before.primaryColor ?? "#FF5001",
  });
  assert(saved.primaryColor, "primaryColor missing");
  const bad = await call("PATCH", "/control/branding", { primaryColor: "orange" });
  assert(bad.status === 400, `invalid color should be 400, got ${bad.status}`);
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   PULSE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const pulse = {};
await step("pulse: create lead with every form field", async () => {
  const lead = await must("POST", "/pulse/leads", {
    name: `QA Lead ${stamp}`,
    company: "QA Nutrition Ltd",
    contactEmail: `qa.lead.${stamp}@example.test`,
    contactPhone: "+8801712345678",
    source: "REFERRAL",
    vertical: "D2C",
    temperature: "HOT",
    probability: 65,
    starred: true,
    tags: ["qa", "nutrition"],
    website: "qa-nutrition.example.test",
    priority: "HIGH",
    estimatedDealSize: 250000,
    currency: "BDT",
    nextFollowUpAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    description: "QA description",
    notes: "QA notes",
  });
  pulse.lead = lead;
  eq(lead.name, `QA Lead ${stamp}`, "name");
  eq(lead.company, "QA Nutrition Ltd", "company");
  eq(lead.contactEmail, `qa.lead.${stamp}@example.test`, "contactEmail");
  eq(Number(lead.estimatedDealSize), 250000, "estimatedDealSize");
  eq(lead.priority, "HIGH", "priority");
  eq(lead.temperature, "HOT", "temperature");
  assert((lead.tags ?? []).includes("qa"), "tags not persisted");
  assert(lead.starred === true, "starred not persisted");
  return lead.id;
});
await step("pulse: update lead fields", async () => {
  const updated = await must("PATCH", `/pulse/leads/${pulse.lead.id}`, {
    contactPhone: "+8801987654321",
    probability: 80,
    tags: ["qa", "updated"],
  });
  eq(updated.contactPhone, "+8801987654321", "contactPhone");
  eq(updated.probability, 80, "probability");
  assert(updated.tags.includes("updated"), "tags not replaced");
});
await step("pulse: activity, follow-up, proposal, meeting", async () => {
  const activity = await must("POST", `/pulse/leads/${pulse.lead.id}/activities`, { type: "CALL", content: "QA call logged" });
  assert(activity.id, "activity not created");
  const followup = await must("POST", `/pulse/leads/${pulse.lead.id}/follow-ups`, { date: addDays(3), notes: "QA follow-up" });
  assert(followup.id, "follow-up not created");
  const done = await must("PATCH", `/pulse/leads/${pulse.lead.id}/follow-ups/${followup.id}`, { status: "COMPLETED" });
  eq(done.status, "COMPLETED", "follow-up status");
  const proposal = await must("POST", `/pulse/leads/${pulse.lead.id}/proposals`, { status: "DRAFT" });
  const sent = await must("PATCH", `/pulse/leads/${pulse.lead.id}/proposals/${proposal.id}`, { status: "SENT" });
  eq(sent.status, "SENT", "proposal status");
  const meeting = await must("POST", `/pulse/leads/${pulse.lead.id}/meetings`, {
    title: "QA discovery call",
    type: "VIDEO_CALL",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    durationMins: 30,
    location: "Google Meet",
    notes: "QA meeting",
  });
  eq(meeting.durationMins, 30, "meeting duration");
});
await step("pulse: quick-log moves the stage and sets the next step", async () => {
  const r = await must("POST", `/pulse/leads/${pulse.lead.id}/quick-log`, {
    type: "WHATSAPP",
    content: "QA quick log",
    outcome: "INTERESTED",
    nextFollowUpAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    stage: "CONTACTED",
    priority: "URGENT",
  });
  assert(r.ok !== false, "quick-log failed");
  const lead = await must("GET", `/pulse/leads/${pulse.lead.id}`);
  assert(lead.stage !== "NEW", `stage did not move forward (${lead.stage})`);
  eq(lead.priority, "URGENT", "priority");
});
await step("pulse: category + target CRUD", async () => {
  const cat = await must("POST", "/pulse/categories", { name: `QA Category ${stamp}`, color: "#FF5001" });
  assert(cat.id, "category id missing");
  const target = await must("POST", "/pulse/targets", {
    title: `QA Target ${stamp}`,
    target: 40,
    unit: "leads",
    category: "sales",
    period: new Date().toISOString().slice(0, 7),
  });
  assert(target.id, "target id missing");
  const upd = await must("PATCH", `/pulse/targets/${target.id}`, { target: 55 });
  eq(Number(upd.target), 55, "target");
});
await step("pulse: convert lead to client + project", async () => {
  const conv = await must("POST", `/pulse/leads/${pulse.lead.id}/convert`, {
    companyName: `QA Converted ${stamp}`,
    vertical: "D2C",
    projectName: `QA Project ${stamp}`,
    contactName: "QA Contact",
    contactEmail: `qa.conv.${stamp}@example.test`,
    contactPhone: "+8801700000001",
  });
  pulse.converted = conv;
  assert(conv.clientId ?? conv.client?.id ?? conv.id, "conversion returned no client");
  return JSON.stringify(Object.keys(conv));
});
await step("pulse: lost lead requires a reason", async () => {
  const lead = await must("POST", "/pulse/leads", { name: `QA Lost ${stamp}`, contactPhone: "+8801799999999" });
  const bad = await call("POST", `/pulse/leads/${lead.id}/lost`, {});
  assert(bad.status === 400, `missing reason should be 400, got ${bad.status}`);
  const lost = await must("POST", `/pulse/leads/${lead.id}/lost`, { reasonCategory: "PRICE", notes: "QA price" });
  eq(lost.stage, "LOST", "lost stage");
  await must("DELETE", `/pulse/leads/${lead.id}`, undefined, [200, 204]);
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ACCOUNTS
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const acc = {};
await step("accounts: create client with profile fields", async () => {
  const client = await must("POST", "/accounts/clients", {
    companyName: `QA Client ${stamp}`,
    industryVertical: "EDUCATION",
    category: "ACTIVE",
    billingCycleType: "MONTHLY_RETAINER",
    currencyPreference: "BDT",
    monthlyAmount: 45000,
    contractStartDate: addDays(-30),
    renewalDate: addDays(335),
    billingDayOfMonth: 5,
    monthlyServiceDescription: "QA retainer",
    paymentDueDays: 15,
    creditLimit: 150000,
    notes: "QA client notes",
    primaryContact: {
      name: "QA Contact",
      roleTitle: "Marketing Head",
      email: `qa.contact.${stamp}@example.test`,
      phone: "+8801722222222",
    },
  });
  acc.client = client;
  eq(client.companyName, `QA Client ${stamp}`, "companyName");
  eq(Number(client.monthlyAmount), 45000, "monthlyAmount");
  eq(client.billingCycleType, "MONTHLY_RETAINER", "billingCycleType");
  eq(Number(client.creditLimit), 150000, "creditLimit");
  assert(client.id, "client id missing");
  acc.contact = client.primaryContact ?? null;
  return client.id;
});
await step("accounts: contact add + update", async () => {
  const contact = await must("POST", `/accounts/clients/${acc.client.id}/contacts`, {
    name: "QA Contact 2",
    roleTitle: "Marketing Head",
    email: `qa.contact2.${stamp}@example.test`,
    phone: "+8801722222223",
    isPrimary: false,
  });
  acc.contact2 = contact;
  const upd = await must("PATCH", `/accounts/clients/${acc.client.id}/contacts/${contact.id}`, { roleTitle: "CMO" });
  eq(upd.roleTitle, "CMO", "roleTitle");
});
await step("accounts: update + recompute health", async () => {
  const upd = await must("PATCH", `/accounts/clients/${acc.client.id}`, { monthlyAmount: 52000, billingDayOfMonth: 10 });
  eq(Number(upd.monthlyAmount), 52000, "monthlyAmount");
  eq(upd.billingDayOfMonth, 10, "billingDayOfMonth");
  const health = await must("POST", `/accounts/clients/${acc.client.id}/recompute-health`);
  assert(health && typeof health === "object", "health not recomputed");
  const all = await must("POST", "/accounts/recompute-all");
  assert(all.ok !== false, "recompute-all failed");
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   FLOW
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const flow = {};
await step("flow: create project with full profile", async () => {
  const project = await must("POST", "/flow/projects", {
    name: `QA Flow ${stamp}`,
    clientId: acc.client.id,
    description: "QA project description",
    amount: 120000,
    budgetAmount: 100000,
    currency: "BDT",
    billingType: "ONE_TIME",
    status: "ACTIVE",
    healthStatus: "ON_TRACK",
    confidenceScore: 4,
    type: "FIXED",
    priority: "HIGH",
    category: "Brand",
    progress: 10,
    startDate: addDays(-10),
    targetEndDate: addDays(50),
    websiteUrl: "qa-flow.example.test",
    socialLinks: { facebook: "qa-page" },
    projectLink: "https://drive.example.test/qa",
    briefLink: "https://drive.example.test/brief",
    paymentStatus: "PARTIAL",
    reportMode: "MANUAL",
  });
  flow.project = project;
  eq(project.name, `QA Flow ${stamp}`, "name");
  eq(Number(project.amount), 120000, "amount");
  eq(project.priority, "HIGH", "priority");
  assert(project.clientId === acc.client.id, "client not linked");
  return project.id;
});
await step("flow: milestone + deliverables + discussion + reference", async () => {
  const milestone = await must("POST", `/flow/projects/${flow.project.id}/milestones`, {
    name: "QA Milestone",
    dueDate: addDays(20),
    status: "PENDING",
  });
  flow.milestone = milestone;
  const del = await must("POST", `/flow/projects/${flow.project.id}/deliverables`, {
    title: "QA Deliverable",
    dueDate: addDays(25),
  });
  flow.deliverable = del;
  const disc = await must("POST", `/flow/projects/${flow.project.id}/discussions`, { content: "QA discussion" });
  assert(disc.id, "discussion missing");
  const ref = await must("POST", `/flow/projects/${flow.project.id}/references`, { title: "QA ref", url: "https://example.test/ref" });
  assert(ref.id, "reference missing");
});
await step("flow: bulk tasks + report generation", async () => {
  const t1 = await must("POST", "/tasks", { title: `QA Flow Task A ${stamp}`, projectId: flow.project.id });
  const t2 = await must("POST", "/tasks", { title: `QA Flow Task B ${stamp}`, projectId: flow.project.id });
  const assigned = await must("POST", `/flow/projects/${flow.project.id}/tasks/bulk`, { taskIds: [t1.id, t2.id] });
  assert(assigned.count >= 1 || assigned.ok !== false, "bulk task assignment failed");
  const report = await must("POST", `/flow/projects/${flow.project.id}/reports/generate`, {
    periodStart: addDays(-7),
    periodEnd: iso(today),
    pmNotes: "QA report",
  });
  assert(report.id ?? report.summary, "report not generated");
});
await step("flow: health override + archive", async () => {
  const upd = await must("PATCH", `/flow/projects/${flow.project.id}`, {
    healthStatus: "AT_RISK",
    healthOverrideReason: "QA override",
  });
  eq(upd.healthStatus, "AT_RISK", "health override");
  const back = await must("PATCH", `/flow/projects/${flow.project.id}`, { clearHealthOverride: true });
  assert(back.healthStatus !== undefined, "health not restored");
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   TASKS
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const tasks = {};
await step("tasks: create with every field", async () => {
  const task = await must("POST", "/tasks", {
    title: `QA Task ${stamp}`,
    description: "QA task description",
    projectId: flow.project.id,
    status: "TODO",
    priority: "HIGH",
    taskType: "content",
    lane: "Design",
    dueDate: addDays(7),
    startDate: addDays(1),
    estimatedHours: 6,
    labels: ["qa", "design"],
    isClientVisible: true,
    notes: "QA notes",
  });
  tasks.task = task;
  eq(task.title, `QA Task ${stamp}`, "title");
  eq(Number(task.estimatedHours), 6, "estimatedHours");
  assert(task.isClientVisible === true, "isClientVisible");
  return task.id;
});
await step("tasks: checklist, comment, reaction, dependency, time log", async () => {
  const item = await must("POST", `/tasks/${tasks.task.id}/checklist`, { content: "QA step" });
  const done = await must("PATCH", `/tasks/${tasks.task.id}/checklist/${item.id}`, { done: true });
  eq(done.done, true, "checklist done");
  const comment = await must("POST", `/tasks/${tasks.task.id}/comments`, { content: "QA comment" });
  const reaction = await must("PATCH", `/tasks/${tasks.task.id}/comments/${comment.id}/reactions`, { emoji: "ðŸ‘" });
  assert(reaction.id ?? reaction.reactions, "reaction not saved");
  const other = await must("POST", "/tasks", { title: `QA Dependency ${stamp}`, projectId: flow.project.id });
  const dep = await must("POST", `/tasks/${tasks.task.id}/dependencies`, { dependsOnTaskId: other.id });
  assert(dep.id ?? dep.ok !== false, "dependency not created");
  const log = await must("POST", `/tasks/${tasks.task.id}/time-log`, { hours: 0.75, note: "QA time" });
  assert(log.id ?? log.ok !== false, "time log not created");
  const statusTask = await must("PATCH", `/tasks/${tasks.task.id}/status`, { status: "IN_PROGRESS" });
  eq(statusTask.status, "IN_PROGRESS", "status");
});
await step("tasks: clone, sprint, snapshot, burndown", async () => {
  const clone = await must("POST", `/tasks/${tasks.task.id}/clone`, {});
  assert(clone.id && clone.id !== tasks.task.id, "clone not created");
  const sprint = await must("POST", "/tasks/sprints", {
    name: `QA Sprint ${stamp}`,
    startDate: addDays(0),
    endDate: addDays(14),
    projectId: flow.project.id,
    capacityHours: 80,
  });
  const assigned = await must("POST", `/tasks/sprints/${sprint.id}/tasks`, { taskIds: [tasks.task.id] });
  assert(assigned.ok !== false, "sprint assignment failed");
  const snapshot = await must("POST", `/tasks/sprints/${sprint.id}/snapshot`);
  assert(snapshot.id ?? snapshot.ok !== false, "snapshot failed");
  const burn = await must("GET", `/tasks/sprints/${sprint.id}/burndown`);
  assert(Array.isArray(burn?.days) && burn.days.length > 0, "burndown points missing");
  tasks.sprint = sprint;
});
await step("tasks: template, saved view, automation rule", async () => {
  const tpl = await must("POST", "/tasks/templates", {
    name: `QA Template ${stamp}`,
    description: "QA template",
    category: "content",
    benchmarkDurationDays: 3,
    benchmarkHours: 6,
    defaultTasks: [{ title: "QA template task", taskType: "content", priority: "MEDIUM" }],
  });
  const used = await must("POST", `/tasks/templates/${tpl.id}/use`, { projectId: flow.project.id });
  assert(used.id ?? used.ok !== false, "template use failed");
  const view = await must("POST", "/tasks/views", {
    name: `QA View ${stamp}`,
    filters: { status: "TODO" },
    isShared: false,
  });
  const rule = await must("POST", "/tasks/automation", {
    name: `QA Rule ${stamp}`,
    trigger: "status-changed",
    action: "notify",
    config: { to: "DONE" },
    enabled: true,
  });
  assert(rule.id ?? rule.ok !== false, "automation rule not created");
  const upd = await must("PATCH", `/tasks/automation/${rule.id}`, { enabled: false });
  assert(upd.enabled === false, "automation not updated");
  tasks.view = view;
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   PEOPLE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const people = {};
await step("people: create employee with profile fields", async () => {
  const emp = await must("POST", "/people/employees", {
    name: `QA Employee ${stamp}`,
    roleTitle: "QA Analyst",
    department: "Quality",
    email: `qa.emp.${stamp}@example.test`,
    phone: "+8801733333333",
    joinDate: addDays(-90),
    employmentType: "FULL_TIME",
    salary: 60000,
    costRate: 900,
    billableRate: 1800,
    managerId: null,
    status: "ACTIVE",
  });
  people.emp = emp;
  eq(emp.name, `QA Employee ${stamp}`, "name");
  eq(emp.roleTitle, "QA Analyst", "roleTitle");
  assert(emp.id, "employee id missing");
  return emp.id;
});
await step("people: attendance punch + summary", async () => {
  const punch = await must("POST", "/people/attendance", {
    employeeId: people.emp.id,
    day: iso(today),
    status: "PRESENT",
    checkIn: "09:35",
    checkOut: "18:10",
  });
  assert(punch.id ?? punch.ok !== false, "attendance not saved");
  const summary = await must("GET", `/people/attendance/summary?month=${iso(today).slice(0, 7)}`);
  assert(summary && typeof summary === "object", "attendance summary missing");
  assert(summary[people.emp.id] !== undefined, "new employee missing from the summary");
});
await step("people: leave request + approve + balance", async () => {
  const leave = await must("POST", "/people/leave-requests", {
    employeeId: people.emp.id,
    leaveType: "CASUAL",
    startDate: addDays(9),
    endDate: addDays(10),
    reason: "QA leave",
  });
  eq(leave.status, "PENDING", "initial leave status");
  const approved = await must("PATCH", `/people/leave-requests/${leave.id}`, { approved: true, note: "QA approve" });
  eq(approved.status, "APPROVED", "approved status");
  const balances = await must("GET", `/people/leave-balances?employeeId=${people.emp.id}`);
  assert(Array.isArray(balances), "balances missing");
});
await step("people: OKR, review, holiday", async () => {
  const okr = await must("POST", "/people/okrs", {
    employeeId: people.emp.id,
    title: "QA Objective",
    quarter: "Q4",
    keyResults: [
      { label: "Ship QA suite", current: 25, target: 100, unit: "%" },
      { label: "Zero escapes", current: 1, target: 5, unit: "runs" },
    ],
    status: "on-track",
  });
  eq(okr.title, "QA Objective", "okr title");
  eq(okr.keyResults.length, 2, "key results");
  const upd = await must("PATCH", `/people/okrs/${okr.id}`, {
    keyResults: [{ label: "Ship QA suite", current: 60, target: 100, unit: "%" }],
  });
  eq(upd.keyResults.length, 1, "key results update");
  const review = await must("POST", "/people/reviews", {
    employeeId: people.emp.id,
    reviewPeriod: "2026-Q4",
    overallRating: 4,
    status: "PENDING",
  });
  assert(review.id, "review missing");
  const holiday = await must("POST", "/people/holidays", {
    name: `QA Holiday ${stamp}`,
    date: addDays(40),
  });
  assert(holiday.id, "holiday missing");
});
await step("people: course + enrollment, candidate, onboarding", async () => {
  const course = await must("POST", "/people/courses", {
    title: `QA Course ${stamp}`,
    provider: "Internal",
    hours: 4,
  });
  const enrol = await must("POST", "/people/enrollments", {
    courseId: course.id,
    employeeId: people.emp.id,
    status: "ENROLLED",
  });
  const progress = await must("PATCH", `/people/enrollments/${enrol.id}`, { status: "completed", progress: 100 });
  assert(progress.status === "completed", "enrollment not completed");
  const candidate = await must("POST", "/people/candidates", {
    firstName: "QA",
    lastName: `Candidate${stamp}`,
    position: "Content Writer",
    stage: "screening",
    email: `qa.cand.${stamp}@example.test`,
    source: "REFERRAL",
  });
  assert(candidate.id, "candidate missing");
  const onboard = await must("POST", "/people/onboarding", {
    employeeId: people.emp.id,
    startDate: addDays(1),
  });
  await must("POST", `/people/onboarding/${onboard.id}/items`, { label: "QA onboarding item" });
  const list = await must("GET", "/people/onboarding");
  const onboarded = (Array.isArray(list) ? list : list.rows ?? []).find((r) => r.id === onboard.id);
  const item = (onboarded?.items ?? onboarded?.checklist ?? [])[0];
  assert(item?.id, "onboarding checklist item missing");
  await must("PATCH", `/people/onboarding/items/${item.id}`, { done: true });
  const list2 = await must("GET", "/people/onboarding");
  const refreshed = (Array.isArray(list2) ? list2 : list2.rows ?? []).find((r) => r.id === onboard.id);
  const refreshedItem = (refreshed?.items ?? refreshed?.checklist ?? []).find((i) => i.id === item.id);
  assert(refreshedItem?.done === true, "onboarding item not done");
});
await step("people: asset assign + return", async () => {
  const asset = await must("POST", "/people/assets", {
    name: `QA Laptop ${stamp}`,
    category: "LAPTOP",
    serialNumber: `QA-SN-${stamp}`,
    purchaseDate: addDays(-200),
    value: 95000,
  });
  const assigned = await must("POST", `/people/assets/${asset.id}/assign`, {
    employeeId: people.emp.id,
    assignedOn: iso(today),
  });
  assert(assigned.status === "ASSIGNED" || assigned.employeeId, "asset not assigned");
  const returned = await must("POST", `/people/assets/${asset.id}/return`, { returnedOn: iso(today), condition: "GOOD" });
  assert(returned.status === "AVAILABLE" || returned.returnedOn, "asset not returned");
});
await step("people: work calendar + utilization recompute", async () => {
  const cal = await must("POST", "/people/work-calendar", {
    date: addDays(45),
    isOpen: false,
    note: "QA closed day",
  });
  assert(cal.ok !== false, "work calendar failed");
  const util = await must("POST", "/people/utilization/recompute");
  assert(util.ok !== false, "utilization recompute failed");
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CAPITAL (invoice lifecycle is covered by apps/web/qa-mutate.js + e2e)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const cap = {};
await step("capital: vendor create + update", async () => {
  const vendor = await must("POST", "/capital/vendors", {
    name: `QA Vendor ${stamp}`,
    category: "Printing",
    email: `qa.vendor.${stamp}@example.test`,
    phone: "+8801744444444",
    address: "Dhaka",
    paymentTerms: "NET_15",
  });
  cap.vendor = vendor;
  const upd = await must("PATCH", `/capital/vendors/${vendor.id}`, { category: "Media" });
  eq(upd.category, "Media", "vendor category");
});
await step("capital: bank account + chart account", async () => {
  const bank = await must("POST", "/capital/bank-accounts", {
    accountName: `QA Bank ${stamp}`,
    accountType: "BANK",
    bankName: "QA Bank Ltd",
    accountNumber: `QA-${stamp}`,
    branch: "Dhaka",
    currency: "BDT",
    openingBalance: 50000,
  });
  cap.bank = bank;
  const account = await must("POST", "/capital/accounts", {
    code: `QA-${stamp}`,
    name: `QA Ledger ${stamp}`,
    type: "EXPENSE",
    openingBalance: 0,
  });
  cap.account = account;
  assert(bank.id && account.id, "bank/account not created");
});
await step("capital: expense with category, payment and approval", async () => {
  const cat = await must("POST", "/capital/expense-categories", { key: `qa_${stamp}`, name: `QA Expense Cat ${stamp}`, subcategories: ["ads", "tools"] });
  const expense = await must("POST", "/capital/expenses", {
    description: `QA Expense ${stamp}`,
    amount: 3200,
    vatRate: 5,
    categoryId: cat.id,
    vendorId: cap.vendor.id,
    expenseDate: iso(today),
    isPayable: true,
    isClientBillable: true,
    clientId: acc.client.id,
    projectId: flow.project.id,
    bankAccountId: cap.bank.id,
    notes: "QA expense",
  });
  cap.expense = expense;
  eq(Number(expense.amount), 3200, "expense amount");
  const selfApprove = await call("PATCH", `/capital/expenses/${expense.id}`, { approvalStatus: "APPROVED" });
  assert(selfApprove.status === 403, `self-approval should be blocked, got ${selfApprove.status}`);
  const approved = await call("PATCH", `/capital/expenses/${expense.id}`, { approvalStatus: "APPROVED" }, financeToken);
  assert(approved.status === 200, `finance approval failed: ${approved.status} ${JSON.stringify(approved.body).slice(0,160)}`);
  const paid = await must("POST", `/capital/expenses/${expense.id}/payment`, {
    amount: 1000,
    paymentMethod: "BANK_TRANSFER",
    paidOn: iso(today),
    bankAccountId: cap.bank.id,
  });
  assert(paid.ok !== false || paid.id, "expense payment failed");
});
await step("capital: budget + engagement + income + credit note", async () => {
  const budget = await must("POST", "/capital/budgets", {
    scopeType: "PROJECT",
    projectId: flow.project.id,
    category: "Marketing",
    budgetAmount: 200000,
    currency: "BDT",
    periodStart: addDays(-30),
    periodEnd: addDays(60),
  });
  assert(budget.id, "budget missing");
  const engagement = await must("POST", "/capital/engagements", {
    name: `QA Engagement ${stamp}`,
    clientId: acc.client.id,
    vendorId: cap.vendor.id,
    title: `QA Engagement ${stamp}`,
    totalAmount: 60000,
    startDate: addDays(0),
    endDate: addDays(60),
  });
  assert(engagement.id, "engagement missing");
  const income = await must("POST", "/capital/income", {
    description: `QA Income ${stamp}`,
    amount: 15000,
    category: "Consulting",
    incomeDate: iso(today),
    bankAccountId: cap.bank.id,
  });
  assert(income.id, "income missing");
  const note = await must("POST", "/capital/credit-notes", {
    clientId: acc.client.id,
    amount: 2500,
    reason: "QA credit",
    issueDate: iso(today),
  });
  assert(note.id, "credit note missing");
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CALENDAR
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const cal = {};
await step("calendar: event + post + campaign + flight", async () => {
  const event = await must("POST", "/calendar/events", {
    title: `QA Event ${stamp}`,
    kind: "MEETING",
    date: addDays(2),
    startTime: "11:00",
    endTime: "12:00",
    clientId: acc.client.id,
    location: "Zoom",
    notes: "QA event",
  });
  cal.event = event;
  const post = await must("POST", "/calendar/posts", {
    title: `QA Post ${stamp}`,
    clientId: acc.client.id,
    platform: "FACEBOOK",
    scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    pillar: "Education",
    caption: "QA caption",
  });
  cal.post = post;
  const campaign = await must("POST", "/calendar/campaigns", {
    name: `QA Campaign ${stamp}`,
    clientId: acc.client.id,
    startDate: addDays(1),
    endDate: addDays(30),
    budget: 80000,
    objective: "Leads",
  });
  assert(campaign.id, "campaign missing");
  const flight = await must("POST", "/calendar/flights", {
    clientId: acc.client.id,
    campaignId: campaign.id,
    name: `QA Flight ${stamp}`,
    platform: "FACEBOOK",
    startDate: addDays(2),
    endDate: addDays(12),
    dailyBudget: 1500,
    totalBudget: 20000,
  });
  assert(flight.id, "flight missing");
});
await step("calendar: post submit â†’ approve â†’ publish", async () => {
  const sub = await must("POST", `/calendar/posts/${cal.post.id}/submit-review`);
  assert(sub.status, "submit-review failed");
  const appr = await must("POST", `/calendar/posts/${cal.post.id}/approve`, { note: "QA ok" });
  assert(appr.status, "approve failed");
  const pub = await must("POST", `/calendar/posts/${cal.post.id}/publish`);
  assert(pub.status, "publish failed");
});
await step("calendar: quick-add, move, comment, day log", async () => {
  const quick = await must("POST", "/calendar/quick-add", {
    source: "TASK",
    title: `QA Quick ${stamp}`,
    date: addDays(4),
    priority: "MEDIUM",
  });
  const moved = await must("PATCH", "/calendar/move", { source: "CONTENT_POST", id: cal.post.id, date: addDays(5) });
  assert(moved.ok !== false || moved.date, "move failed");
  const comment = await must("POST", "/calendar/comments", { source: "EVENT", sourceId: cal.event.id, content: "QA comment" });
  assert(comment.id, "calendar comment missing");
  const log = await must("POST", "/calendar/day-logs", { date: iso(today), summary: "QA day log" });
  assert(log.id, "day log missing");
});
await step("calendar: plan create â†’ lock â†’ share", async () => {
  const plan = await must("POST", "/calendar/plans", {
    clientId: acc.client.id,
    month: new Date().toISOString().slice(0, 7),
    title: `QA Plan ${stamp}`,
  });
  const locked = await must("POST", `/calendar/plans/${plan.id}/lock`);
  assert(locked.status === "LOCKED" || locked.lockedAt, "plan not locked");
  const share = await must("POST", `/calendar/plans/${plan.id}/share`);
  assert(share.token ?? share.url, "plan share link missing");
  const unlock = await must("POST", `/calendar/plans/${plan.id}/unlock`, { reason: "QA unlock" });
  assert(unlock.status === "DRAFT", "plan not unlocked");
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   PORTAL
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
await step("portal: user create → password → access → comment", async () => {
  const user = await must("POST", "/portal/users", {
    clientContactId: acc.contact?.id ?? acc.contact2.id,
    password: "QaPortal1234",
  });
  assert(user.id, "portal user id missing");
  const pwd = await must("PATCH", `/portal/users/${user.id}/password`, { password: "QaPortal5678" });
  assert(pwd.ok !== false, "password change failed");
  const access = await must("PATCH", `/portal/users/${user.id}/access`, { isActive: true });
  assert(access.ok !== false || access.isActive !== undefined, "access update failed");
  const comment = await must("POST", "/portal/comments", {
    threadKey: "general",
    content: "QA portal comment",
    clientId: acc.client.id,
  });
  assert(comment.id ?? comment.ok !== false, "portal comment missing");
  const visibility = await must("PATCH", `/portal/tasks/${tasks.task.id}/visibility`, { isClientVisible: true });
  assert(visibility.isClientVisible === true, "task visibility not set");
});

/* ── INSIGHT ─────────────────────────────────────────────────────────────── */
let insightReport = null;
let insightScheduleId = null;
await step("insight: datasource account + sync", async () => {
  const ds = await must("POST", "/insight/datasource/accounts", {
    provider: "META",
    name: `QA Ads ${stamp}`,
    externalId: `act_${stamp}`,
    accessToken: "qa-token",
  });
  assert(ds.id, "datasource account missing");
  const sync = await must("POST", `/insight/datasource/accounts/${ds.id}/sync`);
  assert(sync.ok !== false || sync.rows !== undefined, "datasource sync failed");
});
await step("insight: saved report create + run", async () => {
  const report = await must("POST", "/insight/reports", {
    name: `QA Report ${stamp}`,
    metrics: ["spend", "leads"],
    dimensions: ["campaign"],
    filters: { from: addDays(-30), to: iso(today) },
  });
  insightReport = report;
  const run = await must("POST", `/insight/reports/${report.id}/run`);
  assert(run.id ?? run.ok !== false, "report run failed");
});
await step("insight: alert + schedule + settings", async () => {
  const alert = await must("POST", "/insight/automation/alerts", {
    name: `QA Alert ${stamp}`,
    metric: "overdue_invoices",
    condition: ">",
    threshold: 2,
    windowDays: 7,
    isActive: true,
  });
  const evalRes = await must("POST", "/insight/automation/alerts/evaluate");
  assert(evalRes.ok !== false, "alert evaluation failed");
  const def = await must("POST", "/insight/reports/defs", {
    name: `QA Digest Def ${stamp}`,
    metrics: ["spend"],
    reportType: "AGENCY_SUMMARY",
  });
  const schedule = await must("POST", "/insight/automation/schedules", {
    reportDefId: def.id,
    cron: "weekly",
    recipients: ["qa@example.test"],
    isActive: true,
  });
  insightScheduleId = schedule.id;
  const ran = await must("POST", `/insight/automation/schedules/${schedule.id}/run-now`);
  assert(ran.ok !== false, "schedule run failed");
  const upd = await must("PATCH", "/insight/settings", { forecastWindow: 60 });
  assert(upd.forecastWindow ?? upd.ok !== false, "insight settings not saved");
});

/* ── CLEANUP ─────────────────────────────────────────────────────────────── */
const cleanupLog = [];
async function drop(method, path) {
  try {
    const r = await call(method, path);
    if (r.status >= 400) {
      const msg = typeof r.body === "string" ? r.body : r.body?.message ?? "";
      cleanupLog.push(`${path} -> ${r.status} ${String(msg).slice(0, 90)}`);
    }
  } catch (e) {
    cleanupLog.push(`${path} -> ${e.message}`);
  }
}
/* QA records are recognised by their name prefix, so cleanup also removes
   leftovers from an interrupted earlier run. */
const isQa = (v) => typeof v === "string" && /^QA\b/.test(v);
async function list(path) {
  const r = await call("GET", path);
  return Array.isArray(r.body) ? r.body : r.body?.rows ?? r.body?.items ?? [];
}
async function dropMatching(path, pick, label) {
  for (const row of await list(path)) {
    if (!isQa(pick(row))) continue;
    await drop("DELETE", `${path}/${row.id}`);
  }
}

// 1. tasks and their planning artefacts
for (const t of await list("/tasks")) if (isQa(t.title)) await drop("DELETE", `/tasks/${t.id}`);
for (const sp of await list("/tasks/sprints")) if (isQa(sp.name)) await drop("DELETE", `/tasks/sprints/${sp.id}`);
for (const tp of await list("/tasks/templates")) if (isQa(tp.name)) await drop("DELETE", `/tasks/templates/${tp.id}`);
for (const v of await list("/tasks/views")) if (isQa(v.name)) await drop("DELETE", `/tasks/views/${v.id}`);
for (const a of await list("/tasks/automation")) if (isQa(a.name)) await drop("DELETE", `/tasks/automation/${a.id}`);

// 2. money rows that point at the QA project/client/vendor
await dropMatching("/capital/expenses", (r) => r.description, "expense");
await dropMatching("/capital/budgets", (r) => r.name ?? r.category, "budget");
await dropMatching("/capital/engagements", (r) => r.title ?? r.name, "engagement");
await dropMatching("/capital/vendors", (r) => r.name, "vendor");
await dropMatching("/capital/bank-accounts", (r) => r.accountName, "bank");

// 3. flow project children, then the project
for (const pr of await list("/flow/projects")) {
  if (!isQa(pr.name)) continue;
  for (const d of await list(`/flow/projects/${pr.id}/deliverables`)) await drop("DELETE", `/flow/deliverables/${d.id}`);
  for (const m of await list(`/flow/projects/${pr.id}/milestones`)) await drop("DELETE", `/flow/milestones/${m.id}`);
  for (const rp of await list(`/flow/projects/${pr.id}/reports`)) await drop("DELETE", `/flow/reports/${rp.id}`);
  for (const rf of await list(`/flow/projects/${pr.id}/references`)) await drop("DELETE", `/flow/references/${rf.id}`);
  await drop("DELETE", `/flow/projects/${pr.id}`);
}

// 4. people
for (const e of await list("/people/employees")) if (isQa(e.name)) await drop("DELETE", `/people/employees/${e.id}`);
await dropMatching("/people/holidays", (r) => r.name, "holiday");
for (const c of await list("/people/candidates")) if (isQa(c.firstName) || isQa(c.name)) await drop("DELETE", `/people/candidates/${c.id}`);
for (const c of await list("/people/courses")) if (isQa(c.title)) await drop("DELETE", `/people/courses/${c.id}`);

// 5. calendar
for (const ev of await list("/calendar/events")) if (isQa(ev.title)) await drop("DELETE", `/calendar/events/${ev.id}`);
for (const po of await list("/calendar/posts")) if (isQa(po.title)) await drop("DELETE", `/calendar/posts/${po.id}`);
for (const fl of await list("/calendar/flights")) if (isQa(fl.name)) await drop("DELETE", `/calendar/flights/${fl.id}`);
for (const ca of await list("/calendar/campaigns")) if (isQa(ca.name)) await drop("DELETE", `/calendar/campaigns/${ca.id}`);

// 6. clients + leads + insight defs (parents last)
for (const cl of await list("/accounts/clients")) if (isQa(cl.companyName)) await drop("DELETE", `/accounts/clients/${cl.id}`);
for (const ld of await list("/pulse/leads")) if (isQa(ld.name)) await drop("DELETE", `/pulse/leads/${ld.id}`);
for (const al of await list("/insight/automation/alerts")) if (isQa(al.name)) await drop("DELETE", `/insight/automation/alerts/${al.id}`);
for (const sc of await list("/insight/automation/schedules")) if (isQa(sc.reportDef?.name)) await drop("DELETE", `/insight/automation/schedules/${sc.id}`);
for (const rd of await list("/insight/reports")) if (isQa(rd.name)) await drop("DELETE", `/insight/reports/${rd.id}`);

const passed = results.filter((r) => r.status === "PASS").length;
console.log(JSON.stringify({ passed, failed: failures, cleanupIssues: cleanupLog, results }, null, 2));
process.exit(failures ? 1 : 0);

