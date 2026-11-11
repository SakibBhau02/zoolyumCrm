import { PrismaClient, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const daysFromNow = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const bdt = (n: number | string) => new Prisma.Decimal(n);

async function main() {
  console.log("Seeding Zoolyum OS...");

  // ── wipe in dependency order ─────────────────────────────────────────
  await prisma.$transaction([
    prisma.deliverableApproval.deleteMany(),
    prisma.clientComment.deleteMany(),
    prisma.portalActivityLog.deleteMany(),
    prisma.portalUser.deleteMany(),
    prisma.financeAuditLog.deleteMany(),
    prisma.reconciliationRecord.deleteMany(),
    prisma.bankAccount.deleteMany(),
    prisma.creditBalance.deleteMany(),
    prisma.budget.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceLineItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.vendor.deleteMany(),
    prisma.account.deleteMany(),
    prisma.estimateAccuracyLog.deleteMany(),
    prisma.taskComment.deleteMany(),
    prisma.timeLog.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.task.deleteMany(),
    prisma.projectRiskLog.deleteMany(),
    prisma.projectFile.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.project.deleteMany(),
    prisma.projectTemplate.deleteMany(),
    prisma.churnRiskFlag.deleteMany(),
    prisma.clientHealthLog.deleteMany(),
    prisma.clientDocument.deleteMany(),
    prisma.clientContact.deleteMany(),
    prisma.client.deleteMany(),
    prisma.lostReason.deleteMany(),
    prisma.proposal.deleteMany(),
    prisma.leadActivity.deleteMany(),
    prisma.leadFollowUp.deleteMany(),
    prisma.leadNote.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.leadCategory.deleteMany(),
    prisma.pipelineStage.deleteMany(),
    prisma.attritionRiskFlag.deleteMany(),
    prisma.utilizationLog.deleteMany(),
    prisma.performanceReview.deleteMany(),
    prisma.payrollRecord.deleteMany(),
    prisma.leaveBalance.deleteMany(),
    prisma.leaveRequest.deleteMany(),
    prisma.attendanceCorrection.deleteMany(),
    prisma.attendance.deleteMany(),
    prisma.punchLog.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.holiday.deleteMany(),
    prisma.attendancePolicy.deleteMany(),
    prisma.metricSnapshot.deleteMany(),
    prisma.correlationInsight.deleteMany(),
    prisma.executiveDigestLog.deleteMany(),
    prisma.reportDefinition.deleteMany(),
    prisma.systemAuditLog.deleteMany(),
    prisma.brandingConfig.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.user.deleteMany(),
    prisma.role.deleteMany(),
  ]);

  // ── Roles ────────────────────────────────────────────────────────────
  const perm = (
    view: boolean,
    edit: boolean,
    approve: boolean
  ): Prisma.JsonObject => ({ view, edit, approve });

  const roleOwner = await prisma.role.create({
    data: {
      name: "Owner",
      description: "Full visibility and control across every module",
      modulePermissions: {
        PULSE: perm(true, true, true), ACCOUNTS: perm(true, true, true),
        FLOW: perm(true, true, true), TASKS: perm(true, true, true),
        PEOPLE: perm(true, true, true), CAPITAL: perm(true, true, true),
        INSIGHT: perm(true, true, true), PORTAL: perm(true, true, true),
        CONTROL: perm(true, true, true),
      },
    },
  });
  const roleSales = await prisma.role.create({
    data: {
      name: "Sales/BD",
      modulePermissions: {
        PULSE: perm(true, true, true), ACCOUNTS: perm(true, true, false),
        FLOW: perm(true, false, false), TASKS: perm(true, false, false),
        PEOPLE: perm(false, false, false), CAPITAL: perm(false, false, false),
        INSIGHT: perm(true, false, false), PORTAL: perm(false, false, false),
        CONTROL: perm(false, false, false),
      },
    },
  });
  const rolePm = await prisma.role.create({
    data: {
      name: "Project Manager",
      modulePermissions: {
        PULSE: perm(true, false, false), ACCOUNTS: perm(true, true, false),
        FLOW: perm(true, true, true), TASKS: perm(true, true, false),
        PEOPLE: perm(true, false, false), CAPITAL: perm(true, false, false),
        INSIGHT: perm(true, false, false), PORTAL: perm(true, true, false),
        CONTROL: perm(false, false, false),
      },
    },
  });
  const roleTeam = await prisma.role.create({
    data: {
      name: "Team Member",
      modulePermissions: {
        PULSE: perm(false, false, false), ACCOUNTS: perm(false, false, false),
        FLOW: perm(true, false, false), TASKS: perm(true, true, false),
        PEOPLE: perm(true, false, false), CAPITAL: perm(false, false, false),
        INSIGHT: perm(false, false, false), PORTAL: perm(false, false, false),
        CONTROL: perm(false, false, false),
      },
    },
  });
  const roleHr = await prisma.role.create({
    data: {
      name: "HR/Admin",
      modulePermissions: {
        PULSE: perm(false, false, false), ACCOUNTS: perm(false, false, false),
        FLOW: perm(false, false, false), TASKS: perm(false, false, false),
        PEOPLE: perm(true, true, true), CAPITAL: perm(true, false, false),
        INSIGHT: perm(false, false, false), PORTAL: perm(false, false, false),
        CONTROL: perm(true, true, false),
      },
    },
  });
  const roleFinance = await prisma.role.create({
    data: {
      name: "Finance",
      modulePermissions: {
        PULSE: perm(false, false, false), ACCOUNTS: perm(true, false, false),
        FLOW: perm(true, false, false), TASKS: perm(true, false, false),
        PEOPLE: perm(true, false, false), CAPITAL: perm(true, true, true),
        INSIGHT: perm(true, false, false), PORTAL: perm(false, false, false),
        CONTROL: perm(false, false, false),
      },
    },
  });

  // ── Users ────────────────────────────────────────────────────────────
  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const uSakib = await prisma.user.create({
    data: { name: "Sakib Hasan", email: "sakib@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleOwner.id, lastLoginAt: daysAgo(0, 9) },
  });
  const uSadia = await prisma.user.create({
    data: { name: "Sadia Rahman", email: "sadia@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleFinance.id, lastLoginAt: daysAgo(0, 8) },
  });
  const uRahim = await prisma.user.create({
    data: { name: "Rahim Uddin", email: "rahim@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleSales.id, lastLoginAt: daysAgo(1, 18) },
  });
  const uKarim = await prisma.user.create({
    data: { name: "Karim Ahmed", email: "karim@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: rolePm.id, lastLoginAt: daysAgo(0, 10) },
  });
  const uTanvir = await prisma.user.create({
    data: { name: "Tanvir Islam", email: "tanvir@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: rolePm.id, lastLoginAt: daysAgo(2, 11) },
  });
  const uNusrat = await prisma.user.create({
    data: { name: "Nusrat Jahan", email: "nusrat@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleHr.id, lastLoginAt: daysAgo(0, 9) },
  });

  // ── Employees ────────────────────────────────────────────────────────
  const empSakib = await prisma.employee.create({ data: { name: "Sakib Hasan", roleTitle: "Founder & CEO", department: "Leadership", joinDate: daysAgo(730), costRate: bdt(1500), salary: bdt(85000), deviceId: "101", skillTags: ["Strategy", "Sales"], user: { connect: { id: uSakib.id } } } });
  const empSadia = await prisma.employee.create({ data: { name: "Sadia Rahman", roleTitle: "Finance & Ops", department: "Finance", joinDate: daysAgo(540), costRate: bdt(700), salary: bdt(60000), deviceId: "102", skillTags: ["Accounting", "Operations"], user: { connect: { id: uSadia.id } } } });
  const empRahim = await prisma.employee.create({ data: { name: "Rahim Uddin", roleTitle: "BD Lead", department: "Sales", joinDate: daysAgo(400), costRate: bdt(600), salary: bdt(55000), deviceId: "103", skillTags: ["Sales", "Meta Ads"], user: { connect: { id: uRahim.id } } } });
  const empKarim = await prisma.employee.create({ data: { name: "Karim Ahmed", roleTitle: "Senior PM", department: "Delivery", joinDate: daysAgo(500), costRate: bdt(650), salary: bdt(70000), deviceId: "104", skillTags: ["Video Production", "Client Comms"], user: { connect: { id: uKarim.id } } } });
  const empTanvir = await prisma.employee.create({ data: { name: "Tanvir Islam", roleTitle: "PM", department: "Delivery", joinDate: daysAgo(300), costRate: bdt(550), salary: bdt(50000), deviceId: "105", skillTags: ["Web", "SEO"], user: { connect: { id: uTanvir.id } } } });
  const empNusrat = await prisma.employee.create({ data: { name: "Nusrat Jahan", roleTitle: "HR & Admin", department: "Operations", joinDate: daysAgo(250), costRate: bdt(500), salary: bdt(45000), deviceId: "106", skillTags: ["HR", "Payroll"], user: { connect: { id: uNusrat.id } } } });
  const empFahim = await prisma.employee.create({ data: { name: "Fahim Chowdhury", roleTitle: "Video Editor", department: "Delivery", joinDate: daysAgo(380), costRate: bdt(450), salary: bdt(42000), deviceId: "107", skillTags: ["Premiere Pro", "Motion Graphics"], reportingManagerId: empKarim.id } });
  const empMitu = await prisma.employee.create({ data: { name: "Mitu Akter", roleTitle: "Graphic Designer", department: "Delivery", joinDate: daysAgo(200), costRate: bdt(400), salary: bdt(38000), deviceId: "108", skillTags: ["Figma", "Illustrator"], reportingManagerId: empKarim.id } });
  const empSohan = await prisma.employee.create({ data: { name: "Sohan Mia", roleTitle: "Web Developer", department: "Delivery", joinDate: daysAgo(160), costRate: bdt(500), salary: bdt(40000), deviceId: "109", skillTags: ["WordPress", "Next.js"], reportingManagerId: empTanvir.id } });
  const empLamia = await prisma.employee.create({ data: { name: "Lamia Haque", roleTitle: "Content Writer", department: "Delivery", joinDate: daysAgo(90), costRate: bdt(350), salary: bdt(30000), deviceId: "110", skillTags: ["Copywriting", "Bangla Content"], reportingManagerId: empKarim.id } });

  const employees = [empSakib, empSadia, empRahim, empKarim, empTanvir, empNusrat, empFahim, empMitu, empSohan, empLamia];

  // ── Attendance (last 5 days + today) ─────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const e of employees) {
    for (let d = 4; d >= 0; d--) {
      const date = daysAgo(d);
      date.setHours(0, 0, 0, 0);
      let status: "PRESENT" | "ABSENT" | "LATE" | "WFH" | "HALF_DAY" = "PRESENT";
      if (e.id === empLamia.id && d === 0) status = "ABSENT";
      if (e.id === empFahim.id && d === 1) status = "LATE";
      if (e.id === empMitu.id && d === 0) status = "WFH";
      if (e.id === empMitu.id && d === 2) status = "HALF_DAY";
      if (e.id === empRahim.id && d === 3) status = "ABSENT";
      const inTime = new Date(date); inTime.setHours(status === "LATE" ? 11 : 9, 30, 0, 0);
      const outTime = new Date(date); outTime.setHours(19, 0, 0, 0);
      await prisma.attendance.create({
        data: {
          employeeId: e.id, date, status,
          checkInTime: status === "ABSENT" ? null : inTime,
          checkOutTime: status === "ABSENT" ? null : outTime,
        },
      });
    }
  }

  // ── Leave ────────────────────────────────────────────────────────────
  // Quota table first (balances derive from it; UNPAID stays unlimited).
  await prisma.leavePolicy.createMany({
    data: [
      { leaveType: "CASUAL", annualDays: bdt(10), description: "Casual leave — planned short leave" },
      { leaveType: "SICK", annualDays: bdt(14), description: "Sick leave — medical" },
      { leaveType: "EARNED", annualDays: bdt(18), description: "Earned / annual leave" },
    ],
    skipDuplicates: true,
  });
  await prisma.leaveBalance.createMany({
    data: [
      { employeeId: empFahim.id, leaveType: "CASUAL", balanceDays: bdt(8), period: "2026" },
      { employeeId: empFahim.id, leaveType: "SICK", balanceDays: bdt(10), period: "2026" },
      { employeeId: empMitu.id, leaveType: "CASUAL", balanceDays: bdt(6), period: "2026" },
      { employeeId: empLamia.id, leaveType: "CASUAL", balanceDays: bdt(2), period: "2026" },
      { employeeId: empSohan.id, leaveType: "CASUAL", balanceDays: bdt(9), period: "2026" },
    ],
  });
  await prisma.leaveRequest.createMany({
    data: [
      { employeeId: empFahim.id, leaveType: "SICK", startDate: daysAgo(3), endDate: daysAgo(2), status: "APPROVED", appliedAt: daysAgo(5) },
      { employeeId: empMitu.id, leaveType: "CASUAL", startDate: daysFromNow(6), endDate: daysFromNow(6), status: "PENDING", appliedAt: daysAgo(1) },
      { employeeId: empLamia.id, leaveType: "CASUAL", startDate: daysFromNow(2), endDate: daysFromNow(3), status: "APPROVED", appliedAt: daysAgo(4) },
      { employeeId: empSohan.id, leaveType: "EARNED", startDate: daysFromNow(10), endDate: daysFromNow(12), status: "PENDING", appliedAt: daysAgo(2) },
    ],
  });

  // ── Utilization (4 weeks × 10 employees) ─────────────────────────────
  const utilPlans: Record<string, number[]> = {
    [empSakib.id]: [0.4, 0.45, 0.42, 0.5], [empSadia.id]: [0.6, 0.65, 0.62, 0.58],
    [empRahim.id]: [0.75, 0.8, 0.78, 0.85], [empKarim.id]: [0.9, 0.95, 1.05, 1.1],
    [empTanvir.id]: [0.85, 0.9, 0.88, 0.92], [empNusrat.id]: [0.5, 0.55, 0.52, 0.6],
    [empFahim.id]: [0.95, 1.1, 1.15, 1.2], [empMitu.id]: [0.8, 0.85, 0.9, 0.95],
    [empSohan.id]: [0.9, 0.95, 1.0, 1.05], [empLamia.id]: [0.7, 0.75, 0.8, 0.72],
  };
  for (const e of employees) {
    const plan = utilPlans[e.id];
    for (let w = 0; w < 4; w++) {
      const weekStart = daysAgo((3 - w) * 7); weekStart.setHours(0, 0, 0, 0);
      await prisma.utilizationLog.create({
        data: {
          employeeId: e.id, weekStartDate: weekStart,
          billableHours: bdt(Math.round(160 * plan[w])), availableHours: bdt(160),
          utilizationRate: plan[w],
        },
      });
    }
  }

  // ── Payroll (last month) ─────────────────────────────────────────────
  const salaries: [typeof empSakib, number][] = [
    [empSakib, 250000], [empSadia, 90000], [empRahim, 80000], [empKarim, 85000],
    [empTanvir, 70000], [empNusrat, 60000], [empFahim, 55000], [empMitu, 45000],
    [empSohan, 60000], [empLamia, 35000],
  ];
  for (const [e, base] of salaries) {
    await prisma.payrollRecord.create({
      data: {
        employeeId: e.id, period: "2026-07",
        basicSalary: bdt(base), allowances: bdt(Math.round(base * 0.2)),
        deductions: bdt(Math.round(base * 0.05)), unpaidLeaveDeduction: bdt(0),
        bonus: e.id === empFahim.id ? bdt(5000) : bdt(0),
        netPay: bdt(Math.round(base * 1.2 - base * 0.05) + (e.id === empFahim.id ? 5000 : 0)),
        status: "FINALIZED",
        auditTrail: [{ source: "attendance_auto_draft", period: "2026-07" }],
      },
    });
  }

  // ── Attendance policy + holiday calendar ─────────────────────────────
  await prisma.attendancePolicy.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      weeklyOffDays: ["FRIDAY", "SATURDAY"],
      graceMinutes: 15,
      shiftStart: "10:00",
      shiftEnd: "18:00",
      halfDayCutoff: "12:00",
      lateLadder: [{ lates: 3, days: 1 }, { lates: 6, days: 2 }, { lates: 9, days: 3 }],
      dailyRateDivisor: 26,
      proRataEnabled: false,
    },
  });
  await prisma.holiday.createMany({
    data: [
      { date: "2026-01-01", name: "New Year's Day", description: "Public holiday", tentative: false, isGovernment: true },
      { date: "2026-02-21", name: "International Mother Language Day", description: "Shaheed Dibos", tentative: false, isGovernment: true },
      { date: "2026-03-20", name: "Eid-ul-Fitr", description: "Lunar — confirm exact date", tentative: true, isGovernment: true },
      { date: "2026-03-26", name: "Independence Day", description: "Public holiday", tentative: false, isGovernment: true },
      { date: "2026-04-14", name: "Pohela Boishakh", description: "Bengali New Year", tentative: false, isGovernment: true },
      { date: "2026-05-01", name: "May Day", description: "Public holiday", tentative: false, isGovernment: true },
      { date: "2026-05-27", name: "Eid-ul-Azha", description: "Lunar — confirm exact date", tentative: true, isGovernment: true },
      { date: "2026-08-15", name: "National Mourning Day", description: "Public holiday", tentative: false, isGovernment: true },
      { date: "2026-12-16", name: "Victory Day", description: "Public holiday", tentative: false, isGovernment: true },
      { date: "2026-12-25", name: "Christmas Day", description: "Public holiday", tentative: false, isGovernment: true },
    ],
  });

  // ── Performance + attrition signals ──────────────────────────────────
  await prisma.performanceReview.createMany({
    data: [
      { employeeId: empFahim.id, reviewPeriod: "H1-2026", selfScore: bdt(7), managerScore: bdt(7.5), objectiveSignals: { taskCompletionRate: 0.92, utilizationTrend: 1.15, sentimentScore: 0.8 }, reviewedById: uKarim.id, reviewedAt: daysAgo(20) },
      { employeeId: empLamia.id, reviewPeriod: "H1-2026", selfScore: bdt(8), managerScore: bdt(8), objectiveSignals: { taskCompletionRate: 0.96, utilizationTrend: 0.85, sentimentScore: 0.9 }, reviewedById: uKarim.id, reviewedAt: daysAgo(18) },
    ],
  });
  await prisma.attritionRiskFlag.create({
    data: { employeeId: empFahim.id, riskLevel: "HIGH", contributingFactors: "Utilization >115% for 3 weeks, reduced leave usage", flaggedAt: daysAgo(2) },
  });

  // ── Pipeline stages + Leads ──────────────────────────────────────────
  const stageNew = await prisma.pipelineStage.create({ data: { name: "New", order: 0, slaDays: 2 } });
  const stageContacted = await prisma.pipelineStage.create({ data: { name: "Contacted", order: 1, slaDays: 3 } });
  const stageQualified = await prisma.pipelineStage.create({ data: { name: "Qualified", order: 2, slaDays: 4 } });
  const stageProposal = await prisma.pipelineStage.create({ data: { name: "Proposal Sent", order: 3, slaDays: 5 } });
  const stageNegotiation = await prisma.pipelineStage.create({ data: { name: "Negotiation", order: 4, slaDays: 7 } });
  const stageWon = await prisma.pipelineStage.create({ data: { name: "Won", order: 5, slaDays: 0 } });
  const stageLost = await prisma.pipelineStage.create({ data: { name: "Lost", order: 6, slaDays: 0 } });

  // ── Lead categories (user-defined) ────────────────────────────────────
  const categoryDefs = [
    "Digital Marketing", "SEO", "Social Media", "Content", "Branding",
    "Web Development", "PPC", "School Admission 2026", "E-commerce Growth",
  ];
  const categoryById = new Map<string, any>();
  for (const catName of categoryDefs) {
    const cat = await prisma.leadCategory.create({ data: { name: catName } });
    categoryById.set(catName, cat);
  }
  const catId = (name: string) => categoryById.get(name)?.id ?? null;

  const leadDefs = [
    { name: "Mehedi Karim", company: "Green Valley School", source: "REFERRAL" as const, vertical: "EDUCATION" as const, stage: "NEGOTIATION" as const, score: 88, size: 480000, owner: uRahim.id, days: 21, phone: "+8801711-223344", temperature: "HOT" as const, category: "School Admission 2026", probability: 75, tags: ["admission-campaign", "video-package"], starred: true },
    { name: "Dr. Farzana Alam", company: "Careline Diagnostics", source: "FACEBOOK" as const, vertical: "HEALTHCARE" as const, stage: "NEGOTIATION" as const, score: 82, size: 320000, owner: uRahim.id, days: 14, phone: "+8801912-445566", temperature: "HOT" as const, category: "Social Media", probability: 70, tags: ["portfolio-sent"] },
    { name: "Rifat Hossain", company: "BanglaMart D2C", source: "WEBSITE" as const, vertical: "D2C" as const, stage: "PROPOSAL_SENT" as const, score: 74, size: 260000, owner: uRahim.id, days: 9, phone: "+8801813-778899", temperature: "WARM" as const, category: "E-commerce Growth", probability: 55, tags: ["proposal-v2", "ecommerce"] },
    { name: "Shahidul Islam", company: "Metropolitan Coaching", source: "FACEBOOK" as const, vertical: "EDUCATION" as const, stage: "PROPOSAL_SENT" as const, score: 68, size: 150000, owner: uRahim.id, days: 7, phone: "+8801555-112233", temperature: "WARM" as const, category: "School Admission 2026", probability: 50, tags: ["website-revamp"] },
    { name: "Nabila Chowdhury", company: "Chowdhury Pharma", source: "REFERRAL" as const, vertical: "HEALTHCARE" as const, stage: "CONTACTED" as const, score: 55, size: 200000, owner: uRahim.id, days: 4, phone: "+8801616-998877", temperature: "WARM" as const, category: "Branding", probability: 40, tags: [] },
    { name: "Arif Bhuiyan", company: "FitnessFirst BD", source: "COLD" as const, vertical: "D2C" as const, stage: "CONTACTED" as const, score: 40, size: 120000, owner: uSakib.id, days: 2, phone: "+8801717-334455", temperature: "WARM" as const, category: "E-commerce Growth", probability: 35, tags: [] },
    { name: "Selina Begum", company: "Sunshine Pre-school", source: "WEBSITE" as const, vertical: "EDUCATION" as const, stage: "NEW" as const, score: 35, size: 90000, owner: uRahim.id, days: 1, phone: "+8801888-667788", temperature: "COLD" as const, category: "School Admission 2026", probability: 25, tags: ["budget-tbd"] },
    { name: "Tanim Rahman", company: "Echo Studio", source: "EMAIL" as const, vertical: "OTHER" as const, stage: "NEW" as const, score: 30, size: 75000, owner: uRahim.id, days: 0, phone: "+8801999-445566", temperature: "COLD" as const, category: "PPC", probability: 20, tags: [] },
    { name: "Jashim Uddin", company: "North View College", source: "FACEBOOK" as const, vertical: "EDUCATION" as const, stage: "WON" as const, score: 95, size: 540000, owner: uRahim.id, days: 40, phone: "+8801512-556677", temperature: "HOT" as const, category: "School Admission 2026", probability: 100, tags: ["loyal-client"] },
    { name: "Sultana Parvin", company: "Urban Clinic Ltd", source: "COLD" as const, vertical: "HEALTHCARE" as const, stage: "LOST" as const, score: 38, size: 180000, owner: uRahim.id, days: 30, phone: "+8801612-887766", temperature: "COLD" as const, category: "SEO", probability: 0, tags: [] },
  ];

  const leads = new Map<string, any>();
  for (const l of leadDefs) {
    const created = await prisma.lead.create({
      data: {
        name: l.name, company: l.company, source: l.source, vertical: l.vertical,
        temperature: l.temperature, leadCategoryId: catId(l.category), probability: l.probability,
        tags: l.tags, starred: l.starred,
        uid: `LD-${String(leads.size + 1).padStart(4, "0")}`,
        stage: l.stage, leadScore: l.score, estimatedDealSize: bdt(l.size),
        assignedToId: l.owner, contactPhone: l.phone, contactEmail: `${l.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        createdAt: daysAgo(l.days), lastContactedAt: l.days > 0 ? daysAgo(Math.max(l.days - 2, 0)) : null,
        convertedClientId: null,
      },
    });
    leads.set(l.name, created);
  }

  // activity + proposals + lost reason
  await prisma.leadActivity.createMany({
    data: [
      { leadId: leads.get("Mehedi Karim").id, type: "CALL", content: "Discussed full video package + admission campaign. Sent cost breakdown.", loggedById: uRahim.id, loggedAt: daysAgo(3) },
      { leadId: leads.get("Mehedi Karim").id, type: "MEETING", content: "Met principal + admission coordinator at school. Budget confirmed 4.8L.", loggedById: uRahim.id, loggedAt: daysAgo(6) },
      { leadId: leads.get("Dr. Farzana Alam").id, type: "WHATSAPP", content: "Sent service portfolio and case studies.", loggedById: uRahim.id, loggedAt: daysAgo(2) },
      { leadId: leads.get("Rifat Hossain").id, type: "EMAIL", content: "Proposal PDF v2 sent with revised timeline.", loggedById: uRahim.id, loggedAt: daysAgo(1) },
    ],
  });
  // follow-ups (v0-crm subsystem demo data)
  await prisma.leadFollowUp.createMany({
    data: [
      { leadId: leads.get("Mehedi Karim").id, date: new Date(Date.now() - 86400000), notes: "Follow up on final budget approval", status: "MISSED" },
      { leadId: leads.get("Mehedi Karim").id, date: new Date(Date.now() + 2 * 86400000), notes: "Send revised contract", status: "SCHEDULED" },
      { leadId: leads.get("Dr. Farzana Alam").id, date: new Date(Date.now() + 86400000), notes: "Demo call with lab head", status: "SCHEDULED" },
      { leadId: leads.get("Nabila Chowdhury").id, date: new Date(Date.now() - 2 * 86400000), notes: "Call re portfolio scope", status: "COMPLETED" },
    ],
  });
  // notes (v0-crm note history demo data)
  await prisma.leadNote.createMany({
    data: [
      { leadId: leads.get("Mehedi Karim").id, content: "Principal র সাথে direct কথা হয়েছে — budget confirmed 4.8L, আগামী সপ্তাহে contract।", createdById: uRahim.id, createdAt: daysAgo(6) },
      { leadId: leads.get("Mehedi Karim").id, content: "Admission campaign video package + Facebook ads combo offer দিলাম।", createdById: uRahim.id, createdAt: daysAgo(3) },
      { leadId: leads.get("Rifat Hossain").id, content: "Client চাচ্ছে e-commerce growth-এর জন্য monthly retainer — proposal v2 পাঠানো হয়েছে।", createdById: uRahim.id, createdAt: daysAgo(2) },
      { leadId: leads.get("Selina Begum").id, content: "Budget TBD — December admission cycle-এর জন্য follow-up করতে হবে।", createdById: uSakib.id, createdAt: daysAgo(1) },
    ],
  });
  // sync nextFollowUpAt from scheduled follow-ups
  const scheduledFus = await prisma.leadFollowUp.findMany({
    where: { status: "SCHEDULED" },
    select: { leadId: true, date: true },
  });
  for (const sf of scheduledFus) {
    await prisma.lead.update({ where: { id: sf.leadId }, data: { nextFollowUpAt: sf.date } });
  }
  await prisma.proposal.createMany({
    data: [
      { leadId: leads.get("Mehedi Karim").id, versionNumber: 1, fileUrl: "/storage/proposals/gvs-v1.pdf", sentDate: daysAgo(8), viewed: true, viewDurationSecs: 480, status: "SENT" },
      { leadId: leads.get("Rifat Hossain").id, versionNumber: 1, fileUrl: "/storage/proposals/banglamart-v1.pdf", sentDate: daysAgo(2), viewed: true, viewDurationSecs: 190, status: "SENT" },
      { leadId: leads.get("Shahidul Islam").id, versionNumber: 1, fileUrl: "/storage/proposals/metro-coaching-v1.pdf", sentDate: daysAgo(1), viewed: false, status: "SENT" },
    ],
  });
  await prisma.lostReason.create({
    data: { leadId: leads.get("Sultana Parvin").id, reasonCategory: "PRICE", notes: "Chose cheaper freelancer. Revisit next quarter." },
  });

  // ── Clients ──────────────────────────────────────────────────────────
  const clientDefs = [
    { company: "Green Valley School", vertical: "EDUCATION" as const, owner: uKarim.id, health: 88, level: "GREEN" as const, billing: "MONTHLY_RETAINER" as const, renewal: 26, contractStart: 240, driver: null },
    { company: "Careline Diagnostics", vertical: "HEALTHCARE" as const, owner: uKarim.id, health: 72, level: "YELLOW" as const, billing: "PROJECT_BASED" as const, renewal: 95, contractStart: 180, driver: "2 overdue invoices + declining margin over 3 months" },
    { company: "BanglaMart", vertical: "D2C" as const, owner: uTanvir.id, health: 90, level: "GREEN" as const, billing: "MONTHLY_RETAINER" as const, renewal: 12, contractStart: 300, driver: null },
    { company: "North View College", vertical: "EDUCATION" as const, owner: uKarim.id, health: 80, level: "GREEN" as const, billing: "PROJECT_BASED" as const, renewal: 60, contractStart: 120, driver: null },
    { company: "Urban Clinic Ltd", vertical: "HEALTHCARE" as const, owner: uTanvir.id, health: 55, level: "RED" as const, billing: "PROJECT_BASED" as const, renewal: 45, contractStart: 200, driver: "3 overdue invoices + scope creep 35% over benchmark" },
    { company: "Smart Kids Academy", vertical: "EDUCATION" as const, owner: uKarim.id, health: 78, level: "YELLOW" as const, billing: "MONTHLY_RETAINER" as const, renewal: 22, contractStart: 150, driver: "Engagement dip — no portal login 14 days" },
    { company: "GlowSkin Beauty", vertical: "D2C" as const, owner: uTanvir.id, health: 92, level: "GREEN" as const, billing: "MONTHLY_RETAINER" as const, renewal: 120, contractStart: 420, driver: null },
  ];
  const clients = new Map<string, any>();
  for (const c of clientDefs) {
    const cl = await prisma.client.create({
      data: {
        companyName: c.company, industryVertical: c.vertical, accountOwnerId: c.owner,
        healthScore: c.health, healthLevel: c.level, healthDriver: c.driver,
        billingCycleType: c.billing, contractStartDate: daysAgo(c.contractStart),
        renewalDate: daysFromNow(c.renewal),
      },
    });
    clients.set(c.company, cl);
  }
  // mark won lead's conversion
  await prisma.lead.update({ where: { id: leads.get("Jashim Uddin").id }, data: { convertedClientId: clients.get("North View College").id } });

  // contacts
  await prisma.clientContact.createMany({
    data: [
      { clientId: clients.get("Green Valley School").id, name: "Mehedi Karim", roleTitle: "Principal", email: "principal@gvs.edu.bd", phone: "+8801711-223344", isPrimary: true, portalAccessEnabled: true },
      { clientId: clients.get("Green Valley School").id, name: "Rina Akter", roleTitle: "Admission Coordinator", email: "rina@gvs.edu.bd", isPrimary: false, portalAccessEnabled: true },
      { clientId: clients.get("Careline Diagnostics").id, name: "Dr. Farzana Alam", roleTitle: "Director", email: "farzana@careline.bd", isPrimary: true, portalAccessEnabled: true },
      { clientId: clients.get("BanglaMart").id, name: "Rifat Hossain", roleTitle: "Owner", email: "rifat@banglamart.bd", isPrimary: true, portalAccessEnabled: true },
      { clientId: clients.get("Urban Clinic Ltd").id, name: "Dr. Salma Khatun", roleTitle: "Managing Director", email: "salma@urbanclinic.bd", isPrimary: true, portalAccessEnabled: false },
      { clientId: clients.get("GlowSkin Beauty").id, name: "Tasnim Ferdous", roleTitle: "Brand Manager", email: "tasnim@glowskin.bd", isPrimary: true, portalAccessEnabled: true },
      { clientId: clients.get("Smart Kids Academy").id, name: "Kamal Hossain", roleTitle: "Director", email: "kamal@smartkids.bd", isPrimary: true, portalAccessEnabled: true },
    ],
  });

  // health history (3 months)
  for (const [name, cl] of clients) {
    const base = cl.healthScore;
    await prisma.clientHealthLog.createMany({
      data: [
        { clientId: cl.id, score: Math.max(30, base - 8), driverSummary: "Month -3 snapshot", recordedAt: daysAgo(90) },
        { clientId: cl.id, score: Math.max(30, base - 4), driverSummary: "Month -2 snapshot", recordedAt: daysAgo(60) },
        { clientId: cl.id, score: Math.max(30, base - 1), driverSummary: "Month -1 snapshot", recordedAt: daysAgo(30) },
      ],
    });
  }
  await prisma.churnRiskFlag.createMany({
    data: [
      { clientId: clients.get("Urban Clinic Ltd").id, riskLevel: "HIGH", matchedPattern: "Overdue invoices + declining engagement matches churned-client pattern", flaggedAt: daysAgo(3) },
      { clientId: clients.get("Smart Kids Academy").id, riskLevel: "MEDIUM", matchedPattern: "Portal activity dropped sharply last 14 days", flaggedAt: daysAgo(1) },
    ],
  });

  // documents
  await prisma.clientDocument.createMany({
    data: [
      { clientId: clients.get("Green Valley School").id, type: "MOU", fileUrl: "/storage/docs/gvs-mou-2026.pdf", uploadedById: uKarim.id },
      { clientId: clients.get("BanglaMart").id, type: "BRAND_ASSET", fileUrl: "/storage/docs/banglamart-brandkit.zip", uploadedById: uTanvir.id },
      { clientId: clients.get("GlowSkin Beauty").id, type: "PROPOSAL", fileUrl: "/storage/docs/glowskin-signed-proposal.pdf", uploadedById: uTanvir.id },
    ],
  });

  // ── Project templates + Projects ─────────────────────────────────────
  const tplVideo = await prisma.projectTemplate.create({
    data: {
      name: "School Video Production Package",
      description: "Script → shoot → edit → review → deliver",
      benchmarkDurationDays: 21, benchmarkHours: 90,
      defaultTaskList: ["Script writing", "Shoot planning", "Production day", "Editing", "Client review", "Final delivery"],
    },
  });
  const tplWeb = await prisma.projectTemplate.create({
    data: {
      name: "Website Audit + SEO Proposal",
      description: "Audit, recommendations, implementation",
      benchmarkDurationDays: 14, benchmarkHours: 45,
      defaultTaskList: ["Site crawl & audit", "Competitor analysis", "Recommendation deck", "Implementation"],
    },
  });

  const projectDefs = [
    { client: "Green Valley School", name: "Admission Campaign Video", type: "CAMPAIGN" as const, tpl: tplVideo.id, pm: uKarim.id, budget: 320000, status: "ACTIVE" as const, health: "ON_TRACK" as const, risk: 22, start: 12, end: 12, driver: null, cat: "Video Production", prio: "HIGH", prog: 70, spent: 210000, team: ["Karim Ahmed", "Farhan Hasan"], billing: "ONE_TIME", pay: "PARTIAL" },
    { client: "Green Valley School", name: "Monthly Content Retainer", type: "RETAINER" as const, tpl: null, pm: uKarim.id, budget: 160000, status: "ACTIVE" as const, health: "ON_TRACK" as const, risk: 18, start: 200, end: 14, driver: null, cat: "Content Retainer", prio: "MEDIUM", prog: 45, spent: 64000, team: ["Karim Ahmed"], billing: "RECURRING", pay: "PAID", interval: "monthly" },
    { client: "Careline Diagnostics", name: "Brand Refresh + TVC", type: "FIXED" as const, tpl: tplVideo.id, pm: uKarim.id, budget: 280000, status: "ACTIVE" as const, health: "AT_RISK" as const, risk: 62, start: 30, end: 20, driver: "Assignee at 118% utilization + budget burn 74% at 60% completion", cat: "Branding", prio: "HIGH", prog: 60, spent: 207000, team: ["Karim Ahmed", "Nusrat Jahan", "Farhan Hasan"], billing: "ONE_TIME", pay: "PARTIAL" },
    { client: "BanglaMart", name: "D2C Performance Campaign", type: "CAMPAIGN" as const, tpl: null, pm: uTanvir.id, budget: 240000, status: "ACTIVE" as const, health: "ON_TRACK" as const, risk: 25, start: 25, end: 8, driver: null, cat: "Performance Marketing", prio: "URGENT", prog: 75, spent: 168000, team: ["Tanvir Islam", "Sabina Yasmin"], billing: "ONE_TIME", pay: "PARTIAL" },
    { client: "BanglaMart", name: "Social Content Retainer", type: "RETAINER" as const, tpl: null, pm: uTanvir.id, budget: 120000, status: "ACTIVE" as const, health: "ON_TRACK" as const, risk: 15, start: 120, end: 10, driver: null, cat: "Content Retainer", prio: "MEDIUM", prog: 50, spent: 50000, team: ["Tanvir Islam", "Sabina Yasmin"], billing: "RECURRING", pay: "PAID", interval: "30-days" },
    { client: "North View College", name: "Convocation Documentary", type: "FIXED" as const, tpl: tplVideo.id, pm: uKarim.id, budget: 420000, status: "COMPLETED" as const, health: "ON_TRACK" as const, risk: 5, start: 90, end: -30, driver: null, cat: "Video Production", prio: "MEDIUM", prog: 100, spent: 398000, team: ["Karim Ahmed", "Farhan Hasan"], billing: "ONE_TIME", pay: "PAID" },
    { client: "Urban Clinic Ltd", name: "Website Revamp", type: "FIXED" as const, tpl: tplWeb.id, pm: uTanvir.id, budget: 180000, status: "ACTIVE" as const, health: "DELAYED" as const, risk: 78, start: 60, end: 25, driver: "Client approval pending 9 days + scope creep 35% over benchmark", cat: "Web Development", prio: "HIGH", prog: 40, spent: 90000, team: ["Tanvir Islam", "Rafiul Islam"], billing: "ONE_TIME", pay: "OVERDUE" },
    { client: "Smart Kids Academy", name: "Parent Engagement App", type: "FIXED" as const, tpl: null, pm: uKarim.id, budget: 380000, status: "PLANNING" as const, health: "AT_RISK" as const, risk: 55, start: 5, end: 75, driver: "Requirement gathering incomplete, client unresponsive", cat: "App Development", prio: "MEDIUM", prog: 5, spent: 15000, team: ["Karim Ahmed", "Rafiul Islam"], billing: "ONE_TIME", pay: "PENDING" },
    { client: "GlowSkin Beauty", name: "Q3 Influencer Campaign", type: "CAMPAIGN" as const, tpl: null, pm: uTanvir.id, budget: 200000, status: "ACTIVE" as const, health: "ON_TRACK" as const, risk: 20, start: 10, end: 18, driver: null, cat: "Influencer Marketing", prio: "MEDIUM", prog: 35, spent: 60000, team: ["Tanvir Islam", "Sabina Yasmin"], billing: "ONE_TIME", pay: "PENDING" },
    { client: "GlowSkin Beauty", name: "Brand Film Series", type: "FIXED" as const, tpl: tplVideo.id, pm: uKarim.id, budget: 260000, status: "PAUSED" as const, health: "AT_RISK" as const, risk: 45, start: 40, end: 35, driver: "Awaiting brand asset refresh from client", cat: "Video Production", prio: "LOW", prog: 30, spent: 78000, team: ["Karim Ahmed", "Farhan Hasan"], billing: "RECURRING", pay: "PARTIAL", interval: "monthly" },
  ];

  const projects = new Map<string, any>();
  for (let i = 0; i < projectDefs.length; i++) {
    const p = projectDefs[i];
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const clientSlug = p.client.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const isRecurring = p.billing === "RECURRING";
    const nextBilling = isRecurring
      ? p.interval === "7-days"
        ? daysFromNow(7)
        : p.interval === "15-days"
          ? daysFromNow(15)
          : p.interval === "30-days"
            ? daysFromNow(30)
            : daysFromNow(30)
      : null;
    const proj = await prisma.project.create({
      data: {
        clientId: clients.get(p.client).id, name: p.name, type: p.type, templateId: p.tpl,
        assignedPmId: p.pm,
        // amount synced to budgetAmount for compat; both must be present for new model
        amount: bdt(p.budget),
        budgetAmount: bdt(p.budget),
        status: p.status,
        healthStatus: p.health, riskScore: p.risk, riskDriver: p.driver,
        startDate: daysAgo(p.start), targetEndDate: daysFromNow(p.end),
        uid: `PJ-${String(i + 1).padStart(4, "0")}`,
        category: p.cat, priority: p.prio, progress: p.prog,
        spentAmount: bdt(p.spent), team: p.team,
        billingType: p.billing as any, recurringInterval: p.interval,
        nextBillingDate: nextBilling,
        monthlyRate: isRecurring ? bdt(p.budget) : undefined,
        paymentStatus: p.pay,
        description: `${p.name} — professional delivery for ${p.client} (${p.cat}). Scope covers ${p.cat.toLowerCase()} with milestone-driven timeline, budget-burn tracking and client-visible deliverables.`,
        projectLink: `https://live.example.com/${slug}`,
        websiteUrl: `https://${clientSlug}.com`,
        socialLinks: {
          facebook: `https://fb.com/${clientSlug}`,
          linkedin: `https://linkedin.com/company/${clientSlug}`,
          instagram: `https://instagram.com/${clientSlug}`,
        },
      },
    });
    projects.set(p.name, proj);
  }

  // milestones
  await prisma.milestone.createMany({
    data: [
      { projectId: projects.get("Admission Campaign Video").id, name: "Script approved", dueDate: daysAgo(8), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(8) },
      { projectId: projects.get("Admission Campaign Video").id, name: "Shoot day", dueDate: daysAgo(3), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(3) },
      { projectId: projects.get("Admission Campaign Video").id, name: "First edit review", dueDate: daysFromNow(2), status: "REVIEW", clientVisible: true },
      { projectId: projects.get("Admission Campaign Video").id, name: "Final delivery", dueDate: daysFromNow(8), status: "PENDING", clientVisible: true },
      { projectId: projects.get("Brand Refresh + TVC").id, name: "Concept board", dueDate: daysAgo(20), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(20) },
      { projectId: projects.get("Brand Refresh + TVC").id, name: "TVC shoot", dueDate: daysFromNow(6), status: "IN_PRODUCTION", clientVisible: true },
      { projectId: projects.get("Website Revamp").id, name: "Design mockups", dueDate: daysAgo(10), status: "REVIEW", clientVisible: true },
      { projectId: projects.get("D2C Performance Campaign").id, name: "Ad creative batch 1", dueDate: daysAgo(2), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(2) },
      { projectId: projects.get("Q3 Influencer Campaign").id, name: "Creator contracts", dueDate: daysFromNow(5), status: "IN_PRODUCTION", clientVisible: true },
    ],
  });

  // project files + approvals
  const scriptFile = await prisma.projectFile.create({
    data: { projectId: projects.get("Admission Campaign Video").id, fileUrl: "/storage/files/gvs-script-v2.pdf", versionNumber: 2, uploadedById: uKarim.id, approvalStatus: "APPROVED", uploadedAt: daysAgo(8) },
  });
  await prisma.projectFile.create({
    data: { projectId: projects.get("Website Revamp").id, fileUrl: "/storage/files/urban-mockups-v3.fig", versionNumber: 3, uploadedById: uTanvir.id, approvalStatus: "REVISION_REQUESTED", uploadedAt: daysAgo(2) },
  });

  // risk logs
  for (const [name, p] of projects) {
    await prisma.projectRiskLog.createMany({
      data: [
        { projectId: p.id, riskScore: Math.max(5, p.riskScore - 15), primaryDriver: "2 weeks ago", calculatedAt: daysAgo(14) },
        { projectId: p.id, riskScore: p.riskScore, primaryDriver: p.riskDriver ?? "steady", calculatedAt: daysAgo(1) },
      ],
    });
  }

  // ── Tasks + TimeLogs ─────────────────────────────────────────────────
  const taskDefs = [
    { title: "Shoot B-roll footage", proj: "Admission Campaign Video", emp: empFahim.id, pri: "HIGH" as const, status: "DONE" as const, due: -3, est: 6, clientVis: false, desc: "Campus tour + classroom B-roll" },
    { title: "Edit 60s admission film", proj: "Admission Campaign Video", emp: empFahim.id, pri: "URGENT" as const, status: "IN_PROGRESS" as const, due: 1, est: 12, clientVis: true, desc: "First cut with music + captions" },
    { title: "Design social cutdowns", proj: "Admission Campaign Video", emp: empMitu.id, pri: "MEDIUM" as const, status: "TODO" as const, due: 4, est: 5, clientVis: false, desc: "3× 15s cutdowns for Facebook/Instagram" },
    { title: "Write script v2", proj: "Admission Campaign Video", emp: empLamia.id, pri: "MEDIUM" as const, status: "DONE" as const, due: -9, est: 3, clientVis: false },
    { title: "TVC concept boards", proj: "Brand Refresh + TVC", emp: empMitu.id, pri: "HIGH" as const, status: "REVIEW" as const, due: 0, est: 8, clientVis: true },
    { title: "Shoot TVC day 1", proj: "Brand Refresh + TVC", emp: empFahim.id, pri: "URGENT" as const, status: "TODO" as const, due: 6, est: 14, clientVis: true },
    { title: "Meta ads setup", proj: "D2C Performance Campaign", emp: empRahim.id, pri: "HIGH" as const, status: "DONE" as const, due: -5, est: 4, clientVis: false },
    { title: "Creative batch 1 review", proj: "D2C Performance Campaign", emp: empMitu.id, pri: "HIGH" as const, status: "IN_PROGRESS" as const, due: 1, est: 3, clientVis: true },
    { title: "Site crawl & audit", proj: "Website Revamp", emp: empSohan.id, pri: "HIGH" as const, status: "DONE" as const, due: -15, est: 6, clientVis: false },
    { title: "Design mockups v3", proj: "Website Revamp", emp: empMitu.id, pri: "URGENT" as const, status: "BLOCKED" as const, due: 0, est: 10, clientVis: true, desc: "Blocked: client revision notes pending" },
    { title: "WordPress theme development", proj: "Website Revamp", emp: empSohan.id, pri: "HIGH" as const, status: "IN_PROGRESS" as const, due: 8, est: 20, clientVis: false },
    { title: "Monthly content calendar", proj: "Monthly Content Retainer", emp: empLamia.id, pri: "MEDIUM" as const, status: "DONE" as const, due: -1, est: 4, clientVis: true },
    { title: "Content batch: 12 posts", proj: "Monthly Content Retainer", emp: empLamia.id, pri: "HIGH" as const, status: "IN_PROGRESS" as const, due: 3, est: 8, clientVis: false },
    { title: "Batch 1 post design", proj: "Social Content Retainer", emp: empMitu.id, pri: "MEDIUM" as const, status: "TODO" as const, due: 2, est: 5, clientVis: false },
    { title: "Platform setup + posting", proj: "Social Content Retainer", emp: empRahim.id, pri: "MEDIUM" as const, status: "DONE" as const, due: -2, est: 2, clientVis: false },
    { title: "Convocation edit final", proj: "Convocation Documentary", emp: empFahim.id, pri: "MEDIUM" as const, status: "DONE" as const, due: -28, est: 15, clientVis: true },
    { title: "Requirement gathering doc", proj: "Parent Engagement App", emp: empKarim.id, pri: "HIGH" as const, status: "BLOCKED" as const, due: 3, est: 6, clientVis: false, desc: "Awaiting client decision on modules" },
    { title: "Influencer shortlist", proj: "Q3 Influencer Campaign", emp: empRahim.id, pri: "HIGH" as const, status: "DONE" as const, due: -4, est: 3, clientVis: false },
    { title: "Creator contracts + briefing", proj: "Q3 Influencer Campaign", emp: empKarim.id, pri: "HIGH" as const, status: "IN_PROGRESS" as const, due: 5, est: 4, clientVis: true },
    { title: "Brand film script", proj: "Brand Film Series", emp: empLamia.id, pri: "MEDIUM" as const, status: "DONE" as const, due: -30, est: 4, clientVis: true },
    { title: "Payroll draft July", proj: null, emp: empSadia.id, pri: "URGENT" as const, status: "IN_PROGRESS" as const, due: 0, est: 4, clientVis: false },
    { title: "Quarterly P&L review", proj: null, emp: empSadia.id, pri: "HIGH" as const, status: "TODO" as const, due: 5, est: 3, clientVis: false },
    { title: "Proposal for Careline v2", proj: null, emp: empRahim.id, pri: "HIGH" as const, status: "IN_PROGRESS" as const, due: 1, est: 3, clientVis: false },
    { title: "Q3 leave calendar", proj: null, emp: empNusrat.id, pri: "MEDIUM" as const, status: "TODO" as const, due: 7, est: 2, clientVis: false },
    { title: "Monthly utilization report", proj: null, emp: empNusrat.id, pri: "MEDIUM" as const, status: "DONE" as const, due: -1, est: 2, clientVis: false },
  ];

  const taskMap = new Map<string, any>();
  for (const t of taskDefs) {
    const due = t.due >= 0 ? daysFromNow(t.due) : daysAgo(-t.due);
    const created = await prisma.task.create({
      data: {
        title: t.title, description: t.desc, projectId: t.proj ? projects.get(t.proj)?.id ?? null : null,
        assignedToId: t.emp, priority: t.pri, status: t.status,
        dueDate: due,
        estimatedHours: bdt(t.est), isClientVisible: t.clientVis,
        // A task seeded as DONE must carry a completion stamp, otherwise it is
        // invisible to burndown/cycle-time (which read completedAt). Seeded
        // tasks are already past their due date, so dueDate is the closest
        // honest proxy — and it is a seed-only assumption, not a data migration.
        completedAt: t.status === "DONE" ? due : null,
      },
    });
    taskMap.set(t.title, created);
  }
  await prisma.taskDependency.createMany({
    data: [
      { taskId: taskMap.get("Edit 60s admission film").id, dependsOnTaskId: taskMap.get("Shoot B-roll footage").id },
      { taskId: taskMap.get("Design social cutdowns").id, dependsOnTaskId: taskMap.get("Edit 60s admission film").id },
      { taskId: taskMap.get("WordPress theme development").id, dependsOnTaskId: taskMap.get("Design mockups v3").id },
      { taskId: taskMap.get("Shoot TVC day 1").id, dependsOnTaskId: taskMap.get("TVC concept boards").id },
    ],
  });

  // time logs this week
  const timeLogDefs: [string, number, number][] = [
    ["Edit 60s admission film", 4, 1], ["Edit 60s admission film", 3.5, 0],
    ["TVC concept boards", 6, 0], ["Creative batch 1 review", 2.5, 1],
    ["WordPress theme development", 8, 0], ["WordPress theme development", 6, 1],
    ["Content batch: 12 posts", 4, 0], ["Monthly content calendar", 3, 2],
    ["Payroll draft July", 3, 0], ["Proposal for Careline v2", 2, 1],
    ["Influencer shortlist", 2.5, 3], ["Convocation edit final", 2, 4],
    ["Site crawl & audit", 1.5, 3], ["Meta ads setup", 2, 4],
    ["Monthly utilization report", 1.5, 1], ["Brand film script", 1, 4],
  ];
  for (const [title, hours, d] of timeLogDefs) {
    const task = taskMap.get(title);
    if (!task) continue;
    const emp = await prisma.employee.findFirst({ where: { tasks: { some: { id: task.id } } } });
    const date = daysAgo(d); date.setHours(0, 0, 0, 0);
    await prisma.timeLog.create({ data: { taskId: task.id, employeeId: emp?.id ?? empFahim.id, hours: bdt(hours), date, loggedVia: d % 2 ? "MANUAL" : "TIMER" } });
  }

  // task comments
  await prisma.taskComment.createMany({
    data: [
      { taskId: taskMap.get("Edit 60s admission film").id, authorId: uKarim.id, content: "Client loved the rushes. Keep the energy high on the cut.", mentionedUserIds: [] },
      { taskId: taskMap.get("Design mockups v3").id, authorId: uTanvir.id, content: "Waiting on client revision notes since Monday.", mentionedUserIds: [] },
    ],
  });

  // ── Capital ──────────────────────────────────────────────────────────
  const acctReceivables = await prisma.account.create({ data: { code: "1100", name: "Accounts Receivable", category: "ASSET" } });
  const acctCash = await prisma.account.create({ data: { code: "1200", name: "Cash & Bank", category: "ASSET" } });
  const acctPayables = await prisma.account.create({ data: { code: "2000", name: "Accounts Payable", category: "LIABILITY" } });
  await prisma.account.create({ data: { code: "2100", name: "VAT Payable", category: "LIABILITY" } });
  await prisma.account.create({ data: { code: "3000", name: "Retained Earnings", category: "LIABILITY" } });
  const acctRevenue = await prisma.account.create({ data: { code: "4000", name: "Agency Revenue", category: "REVENUE" } });
  await prisma.account.create({ data: { code: "4100", name: "Management Fees", category: "REVENUE" } });
  await prisma.account.create({ data: { code: "4200", name: "Other Income", category: "REVENUE" } });
  await prisma.account.create({ data: { code: "4300", name: "Discounts Allowed", category: "REVENUE" } });
  const acctAdSpend = await prisma.account.create({ data: { code: "5000", name: "Ad Spend", category: "DIRECT_COST" } });
  const acctFreelancer = await prisma.account.create({ data: { code: "5010", name: "Freelancer Payments", category: "DIRECT_COST" } });
  const acctProduction = await prisma.account.create({ data: { code: "5020", name: "Production Costs", category: "DIRECT_COST" } });
  const acctSalary = await prisma.account.create({ data: { code: "5030", name: "Salaries & Benefits", category: "OPEX" } });
  const acctSoftware = await prisma.account.create({ data: { code: "5040", name: "Software & Subscriptions", category: "OPEX" } });
  const acctRent = await prisma.account.create({ data: { code: "5050", name: "Rent & Office", category: "OPEX" } });
  const acctUtilities = await prisma.account.create({ data: { code: "5060", name: "Utilities", category: "OPEX" } });
  const acctMarketing = await prisma.account.create({ data: { code: "5070", name: "Marketing", category: "OPEX" } });
  const acctTravel = await prisma.account.create({ data: { code: "5080", name: "Travel", category: "OPEX" } });
  const acctBankCharge = await prisma.account.create({ data: { code: "5090", name: "Bank Charges", category: "OPEX" } });
  const acctProfFees = await prisma.account.create({ data: { code: "5100", name: "Professional Fees", category: "OPEX" } });
  const acctBadDebt = await prisma.account.create({ data: { code: "6500", name: "Bad Debt", category: "OPEX" } });

  const catDefs: { key: string; name: string; accountId: string; subs: string[] }[] = [
    { key: "AD_SPEND", name: "Ad Spend", accountId: acctAdSpend.id, subs: ["Meta Ads", "Google Ads", "TikTok Ads", "Boosted Posts", "Influencer Ads"] },
    { key: "FREELANCER", name: "Freelancer", accountId: acctFreelancer.id, subs: ["Copywriting", "Design", "Video Editing", "Motion Graphics", "Voice Over"] },
    { key: "PRODUCTION", name: "Production", accountId: acctProduction.id, subs: ["Camera & Equipment", "Studio Rent", "Crew", "Props & Sets", "Post Production"] },
    { key: "SALARY", name: "Salary & Benefits", accountId: acctSalary.id, subs: ["Salary", "Bonus", "Incentive", "PF & Gratuity", "Health Benefits"] },
    { key: "SOFTWARE", name: "Software & Subscriptions", accountId: acctSoftware.id, subs: ["Adobe", "Meta Business Suite", "Google Workspace", "Project Tools", "Other SaaS"] },
    { key: "RENT", name: "Rent & Office", accountId: acctRent.id, subs: ["Office Rent", "Office Supplies", "Furniture", "Maintenance", "Security"] },
    { key: "UTILITIES", name: "Utilities", accountId: acctUtilities.id, subs: ["Electricity", "Internet", "Water", "Gas", "Mobile & SIM"] },
    { key: "MARKETING", name: "Marketing", accountId: acctMarketing.id, subs: ["Events & Sponsorships", "Brand Collateral", "PR", "Giveaways"] },
    { key: "TRAVEL", name: "Travel", accountId: acctTravel.id, subs: ["Local Transport", "Accommodation", "Airfare", "Fuel", "Client Visits"] },
    { key: "BANK_CHARGE", name: "Bank Charges", accountId: acctBankCharge.id, subs: ["Transfer Fees", "Gateway Fees", "Account Maintenance", "Interest"] },
    { key: "PROFESSIONAL_FEES", name: "Professional Fees", accountId: acctProfFees.id, subs: ["Legal", "Accounting", "Consulting", "Audit"] },
    { key: "MISC", name: "Miscellaneous", accountId: acctMarketing.id, subs: ["Gifts & Client Relations", "Misc"] },
  ];
  for (const c of catDefs) {
    await prisma.expenseCategoryDef.create({ data: { key: c.key, name: c.name, accountId: c.accountId, subcategories: c.subs } });
  }

  await prisma.bankAccount.createMany({
    data: [
      { accountName: "DBBL Business", accountType: "BANK", currentBalance: bdt(2450000) },
      { accountName: "bKash Business", accountType: "BKASH", currentBalance: bdt(680000) },
      { accountName: "Nagad Business", accountType: "NAGAD", currentBalance: bdt(320000) },
      { accountName: "Petty Cash", accountType: "CASH", currentBalance: bdt(45000) },
    ],
  });

  const vendorFb = await prisma.vendor.create({ data: { name: "Meta Platforms", category: "Ad Spend", email: "billing@meta.com", phone: "+1 650 543 4800", paymentTerms: "Net 15" } });
  await prisma.vendor.create({ data: { name: "Fiverr Freelancers", category: "Freelancer", email: "support@fiverr.com", paymentTerms: "Net 7" } });
  await prisma.vendor.create({ data: { name: "Cameraman Rafi", category: "Production", phone: "+8801711223344", paymentTerms: "On delivery" } });
  await prisma.vendor.create({ data: { name: "Adobe", category: "Software", email: "billing@adobe.com", paymentTerms: "Net 30" } });

  // expenses
  await prisma.expense.createMany({
    data: [
      { description: "Facebook ads — BanglaMart July", amount: bdt(185000), category: "AD_SPEND", subcategory: "Meta Ads", accountId: acctAdSpend.id, date: daysAgo(6), vendorId: vendorFb.id, paymentMethod: "BANK_TRANSFER", isClientBillable: true, clientId: clients.get("BanglaMart").id, projectId: projects.get("D2C Performance Campaign").id, approvalStatus: "APPROVED", submittedById: uRahim.id, approvedById: uSadia.id },
      { description: "Facebook ads — GlowSkin July", amount: bdt(92000), category: "AD_SPEND", subcategory: "Meta Ads", accountId: acctAdSpend.id, date: daysAgo(8), vendorId: vendorFb.id, paymentMethod: "BANK_TRANSFER", isClientBillable: true, clientId: clients.get("GlowSkin Beauty").id, projectId: projects.get("Q3 Influencer Campaign").id, approvalStatus: "APPROVED", submittedById: uRahim.id, approvedById: uSadia.id },
      { description: "Motion graphics freelancer", amount: bdt(24000), category: "FREELANCER", subcategory: "Motion Graphics", accountId: acctFreelancer.id, date: daysAgo(5), vendorId: vendorFb.id, paymentMethod: "BKASH", isClientBillable: false, projectId: projects.get("Admission Campaign Video").id, approvalStatus: "APPROVED", submittedById: uKarim.id, approvedById: uSadia.id },
      { description: "Camera + lighting rental", amount: bdt(18000), category: "PRODUCTION", subcategory: "Camera & Equipment", accountId: acctProduction.id, date: daysAgo(4), vendorId: vendorFb.id, paymentMethod: "CASH", isClientBillable: true, clientId: clients.get("Careline Diagnostics").id, projectId: projects.get("Brand Refresh + TVC").id, approvalStatus: "APPROVED", submittedById: uKarim.id, approvedById: uSadia.id },
      { description: "Adobe Creative Cloud", amount: bdt(12000), category: "SOFTWARE", subcategory: "Adobe", accountId: acctSoftware.id, date: daysAgo(3), vendorId: vendorFb.id, paymentMethod: "CARD", isClientBillable: false, approvalStatus: "APPROVED", submittedById: uSadia.id },
      { description: "Office rent — August", amount: bdt(45000), category: "RENT", subcategory: "Office Rent", accountId: acctRent.id, date: daysAgo(2), vendorId: null, paymentMethod: "BANK_TRANSFER", isClientBillable: false, approvalStatus: "PENDING", submittedById: uSadia.id },
      { description: "Ads test batch — Smart Kids", amount: bdt(15000), category: "AD_SPEND", subcategory: "Meta Ads", accountId: acctAdSpend.id, date: daysAgo(1), vendorId: vendorFb.id, paymentMethod: "BKASH", isClientBillable: true, clientId: clients.get("Smart Kids Academy").id, approvalStatus: "PENDING", submittedById: uRahim.id },
      { description: "Sound editor — TVC", amount: bdt(8500), category: "FREELANCER", subcategory: "Video Editing", accountId: acctFreelancer.id, date: daysAgo(7), vendorId: vendorFb.id, paymentMethod: "NAGAD", isClientBillable: true, clientId: clients.get("Careline Diagnostics").id, projectId: projects.get("Brand Refresh + TVC").id, approvalStatus: "APPROVED", submittedById: uKarim.id, approvedById: uSadia.id },
    ],
  });

  // invoices
  const invDefs = [
    { client: "Green Valley School", project: "Monthly Content Retainer", num: "ZLM-2026-0034", type: "RECURRING" as const, issue: 30, due: 15, status: "PAID" as const, lines: [{ d: "Content retainer — July", q: 1, u: 160000, tag: "AGENCY_REVENUE" as const }] },
    { client: "Green Valley School", project: "Admission Campaign Video", num: "ZLM-2026-0041", type: "ONE_TIME" as const, issue: 12, due: 5, status: "PARTIALLY_PAID" as const, lines: [{ d: "Admission campaign video — 60% milestone", q: 1, u: 192000, tag: "AGENCY_REVENUE" as const }] },
    { client: "BanglaMart", project: "D2C Performance Campaign", num: "ZLM-2026-0042", type: "COMBINED" as const, issue: 8, due: 3, status: "VIEWED" as const, lines: [{ d: "Management fee — July", q: 1, u: 55000, tag: "MANAGEMENT_FEE" as const }, { d: "Ad spend pass-through", q: 1, u: 185000, tag: "PASS_THROUGH" as const }] },
    { client: "BanglaMart", project: "Social Content Retainer", num: "ZLM-2026-0043", type: "RECURRING" as const, issue: 5, due: 0, status: "SENT" as const, lines: [{ d: "Social content retainer — August", q: 1, u: 120000, tag: "AGENCY_REVENUE" as const }] },
    { client: "Careline Diagnostics", project: "Brand Refresh + TVC", num: "ZLM-2026-0039", type: "ONE_TIME" as const, issue: 25, due: 11, status: "OVERDUE" as const, lines: [{ d: "Brand refresh — concept milestone", q: 1, u: 84000, tag: "AGENCY_REVENUE" as const }] },
    { client: "Careline Diagnostics", project: "Brand Refresh + TVC", num: "ZLM-2026-0044", type: "ONE_TIME" as const, issue: 2, due: 12, status: "DRAFT" as const, lines: [{ d: "TVC production deposit", q: 1, u: 140000, tag: "AGENCY_REVENUE" as const }] },
    { client: "GlowSkin Beauty", project: "Q3 Influencer Campaign", num: "ZLM-2026-0045", type: "COMBINED" as const, issue: 1, due: 14, status: "SENT" as const, lines: [{ d: "Campaign management — August", q: 1, u: 40000, tag: "MANAGEMENT_FEE" as const }, { d: "Ad spend pass-through", q: 1, u: 92000, tag: "PASS_THROUGH" as const }] },
    { client: "North View College", project: "Convocation Documentary", num: "ZLM-2026-0030", type: "ONE_TIME" as const, issue: 45, due: 30, status: "PAID" as const, lines: [{ d: "Convocation documentary — full", q: 1, u: 420000, tag: "AGENCY_REVENUE" as const }] },
    { client: "Urban Clinic Ltd", project: "Website Revamp", num: "ZLM-2026-0036", type: "ONE_TIME" as const, issue: 35, due: 21, status: "OVERDUE" as const, lines: [{ d: "Website revamp — 50% advance", q: 1, u: 90000, tag: "AGENCY_REVENUE" as const }] },
    { client: "Urban Clinic Ltd", project: "Website Revamp", num: "ZLM-2026-0040", type: "ONE_TIME" as const, issue: 18, due: 4, status: "OVERDUE" as const, lines: [{ d: "Website revamp — milestone 2", q: 1, u: 54000, tag: "AGENCY_REVENUE" as const }] },
    { client: "Smart Kids Academy", project: "Parent Engagement App", num: "ZLM-2026-0046", type: "ADVANCE" as const, issue: 0, due: 15, status: "DRAFT" as const, lines: [{ d: "App development — 30% advance", q: 1, u: 114000, tag: "AGENCY_REVENUE" as const }] },
    { client: "GlowSkin Beauty", project: "Brand Film Series", num: "ZLM-2026-0037", type: "ONE_TIME" as const, issue: 20, due: 6, status: "PAID" as const, lines: [{ d: "Brand film — script milestone", q: 1, u: 78000, tag: "AGENCY_REVENUE" as const }] },
  ];

  for (const inv of invDefs) {
    const created = await prisma.invoice.create({
      data: {
        invoiceNumber: inv.num, clientId: clients.get(inv.client).id,
        projectId: inv.project ? projects.get(inv.project)?.id ?? null : null,
        invoiceType: inv.type, status: inv.status, issueDate: daysAgo(inv.issue),
        dueDate: inv.due >= 0 ? daysFromNow(inv.due) : daysAgo(-inv.due),
        createdById: uSadia.id,
        lineItems: { create: inv.lines.map((l) => ({ description: l.d, quantity: bdt(l.q), unitPrice: bdt(l.u), amount: bdt(l.q * l.u), revenueTag: l.tag })) },
      },
    });
    if (inv.status === "PAID" || inv.status === "PARTIALLY_PAID") {
      const total = inv.lines.reduce((s, l) => s + l.q * l.u, 0);
      const paid = inv.status === "PAID" ? total : Math.round(total * 0.6);
      const methods = ["BKASH", "NAGAD", "BANK_TRANSFER"] as const;
      const method = methods[invDefs.indexOf(inv) % 3];
      const bankAcct = await prisma.bankAccount.findFirst({ where: { accountType: method === "BKASH" ? "BKASH" : method === "NAGAD" ? "NAGAD" : "BANK" } });
      await prisma.payment.create({
        data: { invoiceId: created.id, amount: bdt(paid), paymentMethod: method, referenceId: `TXN-${created.invoiceNumber.slice(-4)}`, paymentDate: daysAgo(Math.max(inv.issue - 2, 1)), recordedById: uSadia.id, bankAccountId: bankAcct?.id ?? null, balanceCredited: true },
      });
    }
  }

  await prisma.creditBalance.create({
    data: { clientId: clients.get("GlowSkin Beauty").id, amount: bdt(12500), source: "Overpayment" },
  });
  await prisma.budget.createMany({
    data: [
      { scopeType: "PROJECT", projectId: projects.get("Admission Campaign Video").id, budgetAmount: bdt(320000) },
      { scopeType: "PROJECT", projectId: projects.get("Brand Refresh + TVC").id, budgetAmount: bdt(280000) },
      { scopeType: "PROJECT", projectId: projects.get("Website Revamp").id, budgetAmount: bdt(180000) },
      { scopeType: "PROJECT", projectId: projects.get("D2C Performance Campaign").id, budgetAmount: bdt(240000) },
    ],
  });
  await prisma.reconciliationRecord.createMany({
    data: [
      { bankAccountId: (await prisma.bankAccount.findFirst({ where: { accountType: "BANK" } }))!.id, statementDate: daysAgo(1), statementAmount: bdt(192000), statementReference: "STMT-JUL-04", matchedPaymentId: null, matchStatus: "MATCHED" },
      { bankAccountId: (await prisma.bankAccount.findFirst({ where: { accountType: "BKASH" } }))!.id, statementDate: daysAgo(1), statementAmount: bdt(18000), statementReference: "BK-7312", matchedPaymentId: null, matchStatus: "UNMATCHED" },
    ],
  });

  // ── GL backfill: journal entries from seeded invoices/payments/expenses ──
  const postEntry = async (entryType: string, reference: string, entryDate: Date, sourceId: string, notes: string | null, lines: { accountId: string; debit: number; credit: number; memo?: string }[]) => {
    const rounded = lines.map((l) => ({ ...l, debit: Math.round(l.debit * 100) / 100, credit: Math.round(l.credit * 100) / 100 }));
    if (!rounded.reduce((s, l) => s + l.debit - l.credit, 0)) {
      await prisma.journalEntry.create({
        data: { entryType, reference, entryDate, sourceId, notes, createdById: uSadia.id, lines: { create: rounded.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })) } },
      });
    }
  };
  const accountByCode = async (code: string) => (await prisma.account.findFirst({ where: { code } }))!;
  const acctAR = await accountByCode("1100");
  const acctBank = await accountByCode("1200");
  const acctAP = await accountByCode("2000");
  const acctExpenseByCat: Record<string, string> = {};
  for (const def of catDefs) acctExpenseByCat[def.key] = def.accountId;

  const allInvoices = await prisma.invoice.findMany({ include: { lineItems: true, payments: true } });
  for (const inv of allInvoices) {
    if (["DRAFT", "CANCELLED", "VOID"].includes(inv.status)) continue;
    const revenueLines: { accountId: string; debit: number; credit: number }[] = [];
    let total = 0;
    for (const l of inv.lineItems) {
      total += Number(l.amount);
      revenueLines.push({ accountId: acctRevenue.id, debit: 0, credit: Number(l.amount) });
    }
    if (total > 0) {
      await postEntry("INVOICE", inv.invoiceNumber, inv.issueDate, inv.id, null, [{ accountId: acctAR.id, debit: total, credit: 0 }, ...revenueLines]);
    }
    for (const p of inv.payments) {
      await postEntry("PAYMENT", `${inv.invoiceNumber} / ${p.referenceId ?? p.id}`, p.paymentDate, inv.id, null, [
        { accountId: acctBank.id, debit: Number(p.amount), credit: 0 },
        { accountId: acctAR.id, debit: 0, credit: Number(p.amount) },
      ]);
    }
  }
  const allExpenses = await prisma.expense.findMany();
  for (const e of allExpenses) {
    if (e.approvalStatus !== "APPROVED") continue;
    const expenseAcct = acctExpenseByCat[e.category] ?? acctMarketing.id;
    if (e.isPayable) {
      await postEntry("EXPENSE", `EXP-${e.id.slice(-8)}`, e.date, e.id, null, [
        { accountId: expenseAcct, debit: Number(e.amount), credit: 0 },
        { accountId: acctAP.id, debit: 0, credit: Number(e.amount) },
      ]);
    } else {
      await postEntry("EXPENSE", `EXP-${e.id.slice(-8)}`, e.date, e.id, null, [
        { accountId: expenseAcct, debit: Number(e.amount), credit: 0 },
        { accountId: acctBank.id, debit: 0, credit: Number(e.amount) },
      ]);
    }
  }

  // ── Opening balances ────────────────────────────────────────────────
  // The bank accounts were created with a starting balance, but the ledger
  // never received the capital it came from. Post it once so Cash & Bank (1200)
  // equals the sum of the bank accounts (the statements are derived from the
  // GL). Mirrors scripts/backfill-opening-balances.mjs for existing databases.
  const cashAgg = await prisma.journalEntryLine.aggregate({ where: { accountId: acctBank.id }, _sum: { debit: true, credit: true } });
  const cashGl = Number(cashAgg._sum.debit ?? 0) - Number(cashAgg._sum.credit ?? 0);
  const bankSum = Number((await prisma.bankAccount.aggregate({ _sum: { currentBalance: true } }))._sum.currentBalance);
  const acctEquity = await accountByCode("3000");
  const openingGap = Math.round((bankSum - cashGl) * 100) / 100;
  if (Math.abs(openingGap) > 0.01) {
    const openingLines =
      openingGap > 0
        ? [
            { accountId: acctBank.id, debit: openingGap, credit: 0 },
            { accountId: acctEquity.id, debit: 0, credit: openingGap },
          ]
        : [
            { accountId: acctBank.id, debit: 0, credit: -openingGap },
            { accountId: acctEquity.id, debit: -openingGap, credit: 0 },
          ];
    await postEntry("OPENING", "OPENING-BANK", new Date(Date.UTC(2026, 0, 1)), "OPENING-BANK", "Opening cash to match bank accounts", openingLines);
  }

  // ── Insight: metric snapshots (8 months trend) ───────────────────────
  const trend = [
    { m: 0, inv: 680000, col: 640000, exp: 510000, pv: 900000 },
    { m: 1, inv: 720000, col: 700000, exp: 540000, pv: 1050000 },
    { m: 2, inv: 760000, col: 730000, exp: 560000, pv: 1100000 },
    { m: 3, inv: 810000, col: 790000, exp: 580000, pv: 1250000 },
    { m: 4, inv: 860000, col: 820000, exp: 610000, pv: 1350000 },
    { m: 5, inv: 920000, col: 890000, exp: 640000, pv: 1480000 },
    { m: 6, inv: 980000, col: 950000, exp: 670000, pv: 1650000 },
    { m: 7, inv: 1050000, col: 990000, exp: 705000, pv: 1820000 },
  ];
  for (let i = 0; i < trend.length; i++) {
    const t = trend[i];
    const monthDate = new Date(); monthDate.setMonth(monthDate.getMonth() - (7 - i)); monthDate.setDate(1);
    await prisma.metricSnapshot.createMany({
      data: [
        { metricName: "monthly_invoiced", value: t.inv, recordedAt: monthDate },
        { metricName: "monthly_collected", value: t.col, recordedAt: monthDate },
        { metricName: "monthly_expenses", value: t.exp, recordedAt: monthDate },
        { metricName: "weighted_pipeline", value: t.pv, recordedAt: monthDate },
      ],
    });
  }
  await prisma.correlationInsight.createMany({
    data: [
      { description: "Projects using the School Video template have 40% higher margin than custom-scoped video work", supportingData: { template: "School Video Production Package", marginDelta: "+40%" }, confidenceLevel: 0.82, surfacedAt: daysAgo(1) },
      { description: "Referral-acquired clients show 2.3x the lifetime value of cold-outreach clients", supportingData: { segment: "referral vs cold", ltvRatio: 2.3 }, confidenceLevel: 0.77, surfacedAt: daysAgo(2) },
      { description: "Education-vertical leads convert slower but retain 1.6x longer than D2C", supportingData: { educationCycle: "38d", d2cCycle: "21d" }, confidenceLevel: 0.71, surfacedAt: daysAgo(4) },
    ],
  });
  await prisma.executiveDigestLog.create({
    data: { period: "2026-W32", snapshotData: { pipeline: 1820000, utilization: 0.92, cash: 3490000 }, deliveryStatus: "SENT" },
  });

  // ── Portal ───────────────────────────────────────────────────────────
  const gvsContact = await prisma.clientContact.findFirst({ where: { clientId: clients.get("Green Valley School").id, isPrimary: true } });
  const bmContact = await prisma.clientContact.findFirst({ where: { clientId: clients.get("BanglaMart").id, isPrimary: true } });
  const skContact = await prisma.clientContact.findFirst({ where: { clientId: clients.get("Smart Kids Academy").id, isPrimary: true } });

  const pv1 = await prisma.portalUser.create({ data: { clientContactId: gvsContact!.id, passwordHash: hash("portal123"), lastLoginAt: daysAgo(1, 20) } });
  const pv2 = await prisma.portalUser.create({ data: { clientContactId: bmContact!.id, passwordHash: hash("portal123"), lastLoginAt: daysAgo(2, 16) } });
  const pv3 = await prisma.portalUser.create({ data: { clientContactId: skContact!.id, passwordHash: hash("portal123"), lastLoginAt: daysAgo(9, 12) } });

  await prisma.portalActivityLog.createMany({
    data: [
      { portalUserId: pv1.id, action: "APPROVED_DELIVERABLE", relatedEntityType: "ProjectFile", relatedEntityId: scriptFile.id, timestamp: daysAgo(7, 15) },
      { portalUserId: pv1.id, action: "VIEWED_INVOICE", relatedEntityType: "Invoice", relatedEntityId: "ZLM-2026-0041", timestamp: daysAgo(2, 11) },
      { portalUserId: pv2.id, action: "VIEWED_INVOICE", relatedEntityType: "Invoice", relatedEntityId: "ZLM-2026-0042", timestamp: daysAgo(1, 18) },
      { portalUserId: pv3.id, action: "LOGGED_IN", timestamp: daysAgo(9, 12) },
    ],
  });
  await prisma.clientComment.createMany({
    data: [
      { projectId: projects.get("Admission Campaign Video").id, portalUserId: pv1.id, content: "Footage looks amazing! Can we include a few shots of the science lab?", sentiment: "POSITIVE", createdAt: daysAgo(3, 14) },
      { projectId: projects.get("Website Revamp").id, portalUserId: pv2.id, content: "We've been waiting 9 days for these mockups. When will we get them?", sentiment: "NEGATIVE_URGENT", createdAt: daysAgo(1, 10) },
    ],
  });
  await prisma.deliverableApproval.create({
    data: { projectFileId: scriptFile.id, portalUserId: pv1.id, decision: "APPROVED", revisionNotes: "Approved with minor caption fixes", decidedAt: daysAgo(7, 15) },
  });

  // ── Control extras ───────────────────────────────────────────────────
  await prisma.brandingConfig.create({
    data: { logoUrl: "/brand/zoolyum-logo.svg", logoDarkUrl: "/brand/zoolyum-logo-dark.svg", logoLightUrl: "/brand/zoolyum-logo-light.svg", appName: "Zoolyum OS", primaryColor: "#7C3AED", secondaryColor: "#38BDF8", invoiceNumberingFormat: "ZLM-{year}-{seq}" },
  });
  await prisma.integration.createMany({
    data: [
      { providerName: "Facebook Lead Ads", type: "ADS", status: "CONNECTED", connectedById: uSakib.id, connectedAt: daysAgo(60) },
      { providerName: "bKash Business API", type: "PAYMENT", status: "DISCONNECTED" },
      { providerName: "SSLCommerz", type: "PAYMENT", status: "DISCONNECTED" },
      { providerName: "DBBL Statement Import", type: "BANKING", status: "CONNECTED", connectedById: uSadia.id, connectedAt: daysAgo(30) },
    ],
  });
  await prisma.systemAuditLog.createMany({
    data: [
      { actorUserId: uSadia.id, action: "INVOICE_SENT", entityType: "Invoice", entityId: "ZLM-2026-0043", afterValue: { status: "SENT" } },
      { actorUserId: uNusrat.id, action: "PAYROLL_FINALIZED", entityType: "PayrollRecord", entityId: "2026-07" },
      { actorUserId: uSakib.id, action: "ROLE_UPDATED", entityType: "Role", entityId: roleFinance.id, afterValue: { name: "Finance" } },
    ],
  });

  console.log("✅ Seed complete:");
  console.log(`  Users: ${await prisma.user.count()}, Clients: ${await prisma.client.count()}, Projects: ${await prisma.project.count()}, Tasks: ${await prisma.task.count()}, Invoices: ${await prisma.invoice.count()}, Employees: ${await prisma.employee.count()}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
