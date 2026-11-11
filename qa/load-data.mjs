/**
 * Generates production-like data volume in the target database so query plans
 * and latency numbers are representative instead of measuring an empty schema.
 *
 * Run:  DATABASE_URL=... node qa/load-data.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rand = (n) => Math.floor(Math.random() * n);
const pickOne = (a) => a[rand(a.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function chunk(model, rows, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size), skipDuplicates: true });
  }
}

const SOURCES = ["FACEBOOK", "REFERRAL", "COLD", "WEBSITE", "EMAIL", "OTHER", "LINKEDIN", "GOOGLE_ADS", "WHATSAPP", "EVENT", "PARTNER", "INBOUND_PHONE"];
const STAGES = ["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];
const VERTICALS = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TSTATUS = ["TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"];
const METHODS = ["BKASH", "NAGAD", "CASH", "BANK_TRANSFER", "CARD"];

async function main() {
  const baseUsers = await prisma.user.findMany({ select: { id: true } });
  const userIds = baseUsers.map((u) => u.id);
  console.log("users:", userIds.length);

  // ── Employees ────────────────────────────────────────────────────────
  const empRows = Array.from({ length: 40 }).map((_, i) => ({
    id: `perf_emp_${i}`,
    name: `Perf Employee ${i}`,
    roleTitle: pickOne(["Designer", "Developer", "Account Manager", "Copywriter", "Media Buyer"]),
    department: pickOne(["Creative", "Engineering", "Accounts", "Marketing"]),
    joinDate: daysAgo(rand(900)),
    employmentStatus: "ACTIVE",
    costRate: 300 + rand(900),
    salary: 30000 + rand(90000),
    weeklyCapacityHours: 40,
    email: `perf${i}@zoolyum.test`,
  }));
  await chunk(prisma.employee, empRows);
  const employees = await prisma.employee.findMany({ select: { id: true } });
  const empIds = employees.map((e) => e.id);

  // ── Clients + contacts ───────────────────────────────────────────────
  const clientRows = Array.from({ length: 300 }).map((_, i) => ({
    id: `perf_client_${i}`,
    companyName: `Perf Client ${i} Ltd`,
    industryVertical: pickOne(VERTICALS),
    healthScore: 40 + rand(60),
    healthLevel: pickOne(["GREEN", "YELLOW", "RED"]),
    billingCycleType: pickOne(["MONTHLY_RETAINER", "PROJECT_BASED", "ONE_TIME"]),
    monthlyAmount: 25000 + rand(200000),
    contractStartDate: daysAgo(rand(1000)),
    renewalDate: new Date(Date.now() + rand(300) * 86400000),
    accountOwnerId: pickOne(userIds),
    createdAt: daysAgo(rand(1000)),
  }));
  await chunk(prisma.client, clientRows);
  const clients = await prisma.client.findMany({ select: { id: true } });
  const clientIds = clients.map((c) => c.id);

  const contactRows = Array.from({ length: 600 }).map((_, i) => ({
    id: `perf_contact_${i}`,
    clientId: pickOne(clientIds),
    name: `Contact ${i}`,
    roleTitle: "Marketing Head",
    email: `contact${i}@perf.test`,
    isPrimary: i % 3 === 0,
  }));
  await chunk(prisma.clientContact, contactRows);

  // ── Projects ─────────────────────────────────────────────────────────
  const projRows = Array.from({ length: 1200 }).map((_, i) => ({
    id: `perf_proj_${i}`,
    clientId: pickOne(clientIds),
    name: `Perf Project ${i}`,
    startDate: daysAgo(rand(700)),
    targetEndDate: new Date(Date.now() + rand(200) * 86400000),
    status: pickOne(["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]),
    healthStatus: pickOne(["ON_TRACK", "AT_RISK", "DELAYED"]),
    riskScore: rand(100),
    budgetAmount: 50000 + rand(900000),
    assignedPmId: pickOne(userIds),
    monthlyRate: 20000 + rand(100000),
    billingType: pickOne(["ONE_TIME", "RECURRING"]),
  }));
  await chunk(prisma.project, projRows);
  const projects = await prisma.project.findMany({ select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  // ── Tasks ────────────────────────────────────────────────────────────
  const taskRows = Array.from({ length: 8000 }).map((_, i) => ({
    id: `perf_task_${i}`,
    projectId: pickOne(projectIds),
    title: `Perf Task ${i} — ${pickOne(["design banner", "write copy", "fix bug", "review campaign", "client call"])}`,
    assignedToId: pickOne(empIds),
    priority: pickOne(PRIORITIES),
    dueDate: new Date(Date.now() + (rand(120) - 60) * 86400000),
    status: pickOne(TSTATUS),
    estimatedHours: 1 + rand(20),
    createdAt: daysAgo(rand(500)),
    taskType: pickOne(["general", "design", "development", "content"]),
    isClientVisible: i % 4 === 0,
  }));
  await chunk(prisma.task, taskRows);
  const tasks = await prisma.task.findMany({ select: { id: true } });
  const taskIds = tasks.map((t) => t.id);
  console.log("tasks:", taskIds.length);

  await chunk(
    prisma.timeLog,
    Array.from({ length: 12000 }).map((_, i) => ({
      id: `perf_log_${i}`,
      taskId: pickOne(taskIds),
      employeeId: pickOne(empIds),
      hours: 0.5 + rand(8),
      date: daysAgo(rand(180)),
      isBillable: i % 5 !== 0,
    }))
  );

  await chunk(
    prisma.taskComment,
    Array.from({ length: 20000 }).map((_, i) => ({
      id: `perf_cmt_${i}`,
      taskId: pickOne(taskIds),
      authorId: pickOne(userIds),
      content: `Comment ${i} on this task, quick note about progress.`,
      createdAt: daysAgo(rand(300)),
    }))
  );

  // ── Leads ────────────────────────────────────────────────────────────
  const leadRows = Array.from({ length: 4000 }).map((_, i) => ({
    id: `perf_lead_${i}`,
    name: `Perf Lead ${i}`,
    company: `Lead Co ${i}`,
    contactEmail: `lead${i}@perf.test`,
    contactPhone: `+88017${String(10000000 + i).slice(0, 8)}`,
    source: pickOne(SOURCES),
    vertical: pickOne(VERTICALS),
    stage: pickOne(STAGES),
    leadScore: rand(100),
    estimatedDealSize: 20000 + rand(500000),
    assignedToId: pickOne(userIds),
    nextFollowUpAt: new Date(Date.now() + (rand(60) - 30) * 86400000),
    createdAt: daysAgo(rand(400)),
    temperature: pickOne(["HOT", "WARM", "COLD"]),
    priority: pickOne(PRIORITIES),
  }));
  await chunk(prisma.lead, leadRows);
  const leads = await prisma.lead.findMany({ select: { id: true } });
  const leadIds = leads.map((l) => l.id);

  await chunk(
    prisma.leadActivity,
    Array.from({ length: 12000 }).map((_, i) => ({
      id: `perf_act_${i}`,
      leadId: pickOne(leadIds),
      type: pickOne(["CALL", "EMAIL", "MEETING", "NOTE"]),
      content: `Activity ${i} logged`,
      loggedById: pickOne(userIds),
      loggedAt: daysAgo(rand(250)),
    }))
  );

  // ── Capital ──────────────────────────────────────────────────────────
  const banks = await prisma.bankAccount.findMany({ select: { id: true } });
  const bankIds = banks.map((b) => b.id);
  const invRows = Array.from({ length: 3000 }).map((_, i) => ({
    id: `perf_inv_${i}`,
    invoiceNumber: `PERF-${String(i).padStart(5, "0")}`,
    clientId: pickOne(clientIds),
    projectId: pickOne(projectIds),
    issueDate: daysAgo(rand(400)),
    dueDate: new Date(Date.now() + (rand(60) - 30) * 86400000),
    status: pickOne(["DRAFT", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"]),
    createdById: pickOne(userIds),
    discountAmount: 0,
    shippingFee: 0,
  }));
  await chunk(prisma.invoice, invRows);

  const lineRows = [];
  const payRows = [];
  for (let i = 0; i < 3000; i++) {
    const qty = 1 + rand(3);
    let total = 0;
    for (let j = 0; j < 3; j++) {
      const unit = 5000 + rand(40000);
      const amount = unit * qty;
      total += amount;
      lineRows.push({
        id: `perf_line_${i}_${j}`,
        invoiceId: `perf_inv_${i}`,
        description: `Service ${j}`,
        quantity: qty,
        unitPrice: unit,
        amount,
        revenueTag: j === 2 ? "PASS_THROUGH" : "AGENCY_REVENUE",
      });
    }
    const payCount = rand(3);
    for (let k = 0; k < payCount; k++) {
      payRows.push({
        id: `perf_pay_${i}_${k}`,
        invoiceId: `perf_inv_${i}`,
        amount: Math.round(total / (payCount + 1)),
        paymentMethod: pickOne(METHODS),
        paymentDate: daysAgo(rand(120)),
        recordedById: pickOne(userIds),
        bankAccountId: bankIds.length ? pickOne(bankIds) : null,
      });
    }
  }
  await chunk(prisma.invoiceLineItem, lineRows);
  await chunk(prisma.payment, payRows);

  await chunk(
    prisma.expense,
    Array.from({ length: 4000 }).map((_, i) => ({
      id: `perf_exp_${i}`,
      description: `Expense ${i}`,
      amount: 1000 + rand(80000),
      date: daysAgo(rand(300)),
      category: pickOne(["ADS", "SOFTWARE", "SALARY", "OFFICE", "TRAVEL"]),
      approvalStatus: pickOne(["PENDING", "APPROVED", "REJECTED"]),
      isClientBillable: i % 3 === 0,
      clientId: pickOne(clientIds),
      projectId: pickOne(projectIds),
      submittedById: pickOne(userIds),
      isPayable: i % 4 === 0,
      paidAmount: 0,
      dueDate: new Date(Date.now() + (rand(40) - 20) * 86400000),
    }))
  );

  // ── Attendance (50 employees × 240 workdays) ─────────────────────────
  const attRows = [];
  for (const empId of empIds) {
    for (let d = 0; d < 240; d++) {
      const date = daysAgo(d);
      if (date.getDay() === 5 || date.getDay() === 6) continue;
      attRows.push({
        id: `perf_att_${empId}_${d}`,
        employeeId: empId,
        date: new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())),
        status: pickOne(["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT", "WFH"]),
      });
    }
  }
  await chunk(prisma.attendance, attRows);

  await chunk(
    prisma.utilizationLog,
    empIds.flatMap((empId, i) =>
      Array.from({ length: 30 }).map((_, w) => ({
        id: `perf_util_${i}_${w}`,
        employeeId: empId,
        weekStartDate: daysAgo(w * 7),
        billableHours: 20 + rand(20),
        availableHours: 40,
        utilizationRate: 0.5 + Math.random() * 0.7,
      }))
    )
  );

  // ── Calendar + notifications + ads ───────────────────────────────────
  await chunk(
    prisma.calendarEvent,
    Array.from({ length: 10000 }).map((_, i) => {
      const d = daysAgo(rand(200));
      return {
        id: `perf_cal_${i}`,
        title: `Calendar Item ${i}`,
        type: pickOne(["CAMPAIGN", "CONTENT", "MEETING", "DEADLINE", "MILESTONE", "SHOOT", "REPORT"]),
        date: d.toISOString().slice(0, 10),
        clientId: pickOne(clientIds),
        projectId: pickOne(projectIds),
        createdById: pickOne(userIds),
      };
    })
  );

  await chunk(
    prisma.notification,
    Array.from({ length: 15000 }).map((_, i) => ({
      id: `perf_notif_${i}`,
      userId: pickOne(userIds),
      type: "TASK",
      title: `Notification ${i}`,
      message: `Something happened ${i}`,
      isRead: i % 3 === 0,
      createdAt: daysAgo(rand(90)),
    }))
  );

  const adAccounts = await prisma.adAccount.findMany({ select: { id: true, clientId: true } });
  if (adAccounts.length) {
    const adRows = [];
    for (let d = 0; d < 240; d++) {
      const date = daysAgo(d);
      for (const acc of adAccounts) {
        adRows.push({
          id: `perf_ad_${acc.id}_${d}`,
          provider: pickOne(["META", "GOOGLE"]),
          date: new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())),
          adAccountId: acc.id,
          clientId: acc.clientId,
          impressions: 1000 + rand(90000),
          clicks: 10 + rand(3000),
          spend: 500 + rand(50000),
          conversions: rand(60),
          conversionValue: rand(200000),
        });
      }
    }
    await chunk(prisma.adInsight, adRows);
    console.log("adInsight rows:", adRows.length);
  }

  const counts = await prisma.$queryRawUnsafe(
    `select relname, n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by n_live_tup desc limit 20`
  );
  console.log(counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
