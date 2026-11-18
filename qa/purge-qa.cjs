/**
 * Removes every record the QA suites created (names start with "QA ").
 *
 * The API refuses to delete a client that still has calendar/credit children,
 * which is the right product behaviour but leaves QA fixtures behind. This
 * purge runs directly against Prisma so the demo database stays clean.
 *
 *   node qa/purge-qa.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, "..", "apps", "api", ".env");
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) {
  const raw = fs.readFileSync(envFile, "utf8");
  const match = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (match) process.env.DATABASE_URL = match[1];
}
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const QA = { startsWith: "QA " };

async function safe(label, fn) {
  try {
    const n = await fn();
    if (n?.count) console.log(`  ${label}: ${n.count}`);
  } catch (e) {
    console.log(`  ${label}: skipped (${String(e.message).split("\n")[0].slice(0, 110)})`);
  }
}

(async () => {
  const clients = await prisma.client.findMany({ where: { companyName: QA }, select: { id: true, companyName: true } });
  for (const c of clients) {
    console.log(`client ${c.companyName}`);
    const plans = await prisma.calendarPlan.findMany({ where: { clientId: c.id }, select: { id: true } });
    const planIds = plans.map((p) => p.id);
    if (planIds.length) {
      await safe("share links", () => prisma.calendarShareLink.deleteMany({ where: { planId: { in: planIds } } }));
    }
    await safe("plans", () => prisma.calendarPlan.deleteMany({ where: { clientId: c.id } }));
    await safe("plan pillars", () => prisma.calendarPillar.deleteMany({ where: { clientId: c.id } }));
    await safe("platform accounts", () => prisma.platformAccount.deleteMany({ where: { clientId: c.id } }));
    await safe("content posts", () => prisma.contentPost.deleteMany({ where: { clientId: c.id } }));
    await safe("calendar events", () => prisma.calendarEvent.deleteMany({ where: { clientId: c.id } }));
    await safe("ad flights", () => prisma.adFlight.deleteMany({ where: { clientId: c.id } }));
    await safe("campaigns", () => prisma.campaign.deleteMany({ where: { clientId: c.id } }));
    await safe("client comments", () => prisma.clientComment.deleteMany({ where: { clientId: c.id } }));
    await safe("credit notes", () => prisma.creditNote.deleteMany({ where: { clientId: c.id } }));
    await safe("credit balance", () => prisma.clientCreditBalance.deleteMany({ where: { clientId: c.id } }));
    await safe("health logs", () => prisma.clientHealthLog.deleteMany({ where: { clientId: c.id } }));
    await safe("targets", () => prisma.dailyTarget.deleteMany({ where: { clientId: c.id } }));
    await safe("invoices", () => prisma.invoice.deleteMany({ where: { clientId: c.id } }));
    await safe("expenses", () => prisma.expense.deleteMany({ where: { clientId: c.id } }));
    await safe("portal users", () => prisma.portalUser.deleteMany({ where: { clientContact: { clientId: c.id } } }));
    await safe("contacts", () => prisma.clientContact.deleteMany({ where: { clientId: c.id } }));
    await safe("client", () => prisma.client.deleteMany({ where: { id: c.id } }));
  }

  // projects + children
  const projects = await prisma.project.findMany({ where: { name: QA }, select: { id: true, name: true } });
  for (const pr of projects) {
    console.log(`project ${pr.name}`);
    const tasks = await prisma.task.findMany({ where: { projectId: pr.id }, select: { id: true } });
    const taskIds = tasks.map((t) => t.id);
    if (taskIds.length) {
      await safe("task rows", async () => {
        await prisma.taskChecklistItem.deleteMany({ where: { taskId: { in: taskIds } } });
        await prisma.comment.deleteMany({ where: { taskId: { in: taskIds } } });
        await prisma.taskTimeLog.deleteMany({ where: { taskId: { in: taskIds } } });
        await prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] } });
        return prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      });
    }
    await safe("deliverables", () => prisma.projectDeliverable.deleteMany({ where: { projectId: pr.id } }));
    await safe("milestones", () => prisma.projectMilestone.deleteMany({ where: { projectId: pr.id } }));
    await safe("reports", () => prisma.projectReport.deleteMany({ where: { projectId: pr.id } }));
    await safe("references", () => prisma.projectReference.deleteMany({ where: { projectId: pr.id } }));
    await safe("discussions", () => prisma.projectDiscussion.deleteMany({ where: { projectId: pr.id } }));
    await safe("files", () => prisma.projectFile.deleteMany({ where: { projectId: pr.id } }));
    await safe("budgets", () => prisma.budget.deleteMany({ where: { projectId: pr.id } }));
    await safe("project", () => prisma.project.deleteMany({ where: { id: pr.id } }));
  }

  // employees
  const employees = await prisma.employee.findMany({ where: { name: QA }, select: { id: true, name: true } });
  for (const e of employees) {
    console.log(`employee ${e.name}`);
    await safe("attendance", () => prisma.attendance.deleteMany({ where: { employeeId: e.id } }));
    await safe("leave", () => prisma.leaveRequest.deleteMany({ where: { employeeId: e.id } }));
    await safe("leave balances", () => prisma.leaveBalance.deleteMany({ where: { employeeId: e.id } }));
    await safe("okrs", () => prisma.okr.deleteMany({ where: { employeeId: e.id } }));
    await safe("reviews", () => prisma.performanceReview.deleteMany({ where: { employeeId: e.id } }));
    await safe("enrollments", () => prisma.trainingEnrollment.deleteMany({ where: { employeeId: e.id } }));
    await safe("onboarding", () => prisma.onboardingTask.deleteMany({ where: { employeeId: e.id } }));
    await safe("asset", () => prisma.employeeAsset.deleteMany({ where: { employeeId: e.id } }));
    await safe("employee", () => prisma.employee.deleteMany({ where: { id: e.id } }));
  }

  await safe("leads", () => prisma.lead.deleteMany({ where: { name: QA } }));
  await safe("vendors", () => prisma.vendor.deleteMany({ where: { name: QA } }));
  await safe("bank accounts", () => prisma.bankAccount.deleteMany({ where: { accountName: QA } }));
  await safe("sprints", () => prisma.sprint.deleteMany({ where: { name: QA } }));
  await safe("task templates", () => prisma.taskTemplate.deleteMany({ where: { name: QA } }));
  await safe("automation rules", () => prisma.automationRule.deleteMany({ where: { name: QA } }));
  await safe("saved views", () => prisma.savedTaskView.deleteMany({ where: { name: QA } }));
  await safe("alert rules", () => prisma.alertRule.deleteMany({ where: { name: QA } }));
  await safe("report defs", () => prisma.reportDefinition.deleteMany({ where: { name: QA } }));
  await safe("holidays", () => prisma.holiday.deleteMany({ where: { name: QA } }));
  await safe("candidates", () => prisma.candidate.deleteMany({ where: { firstName: "QA" } }));
  await safe("courses", () => prisma.trainingCourse.deleteMany({ where: { title: QA } }));

  await prisma.$disconnect();
  console.log("done");
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
