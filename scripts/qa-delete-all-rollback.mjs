/**
 * Rollback-safe verification of the "Delete All Data" SQL.
 * Runs the exact statements inside a transaction and always rolls back.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRUNCATE = `
TRUNCATE TABLE
  "Client",
  "Lead",
  "Project",
  "Task",
  "PortalUser",
  "BankAccount",
  "Invoice",
  "JournalEntry",
  "ReportDefinition",
  "AdAccount",
  "CalendarEvent",
  "ContentPost",
  "DailyTarget",
  "MetricSnapshot",
  "CorrelationInsight",
  "ExecutiveDigestLog",
  "Notification",
  "NotificationPreference",
  "FinanceAuditLog",
  "Holiday",
  "Candidate",
  "TrainingCourse",
  "WorkdayOverride",
  "WhatsappMessageLog",
  "TelegramMessageLog",
  "TelegramLinkCode",
  "Attendance",
  "AttendanceCorrection",
  "LeaveBalance",
  "LeaveRequest",
  "PayrollRecord",
  "PerformanceReview",
  "Okr",
  "TrainingEnrollment",
  "UtilizationLog",
  "AttritionRiskFlag",
  "PunchLog",
  "EmployeeChecklist",
  "EmployeeChecklistItem",
  "TaskTimer",
  "TimeLog",
  "EstimateAccuracyLog"
RESTART IDENTITY CASCADE;
`;

const before = {
  clients: await prisma.client.count(),
  invoices: await prisma.invoice.count(),
  employees: await prisma.employee.count(),
  budgets: await prisma.budget.count(),
  journal: await prisma.journalEntry.count(),
  punches: await prisma.punchLog.count(),
  employeesLinked: await prisma.user.count({ where: { employeeId: { not: null } } }),
};

try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE "User" SET "employeeId" = NULL`);
      await tx.$executeRawUnsafe(TRUNCATE);
      await tx.$executeRawUnsafe(`DELETE FROM "Employee"`);
      // Safety checks INSIDE the transaction: these must survive the wipe.
      const preserved = {
        users: await tx.user.count(),
        roles: await tx.role.count(),
        settings: await tx.settings.count(),
        audit: await tx.systemAuditLog.count(),
        integrations: await tx.integration.count(),
      };
      if (preserved.users === 0 || preserved.roles === 0) {
        throw new Error(`PRESERVED TABLES WIPED: ${JSON.stringify(preserved)}`);
      }
      const left = {
        clients: await tx.client.count(),
        invoices: await tx.invoice.count(),
        employees: await tx.employee.count(),
        budgets: await tx.budget.count(),
        journal: await tx.journalEntry.count(),
        punches: await tx.punchLog.count(),
      };
      if (Object.values(left).some((n) => n !== 0)) {
        throw new Error(`BUSINESS DATA LEFT BEHIND: ${JSON.stringify(left)}`);
      }
      throw new Error("__ROLLBACK__");
    },
    { timeout: 60000 }
  );
  console.log("UNEXPECTED: transaction committed");
  process.exit(1);
} catch (e) {
  if (e?.message !== "__ROLLBACK__") {
    console.error("DELETE-ALL SQL FAILED:", e?.message);
    process.exit(1);
  }
}

const after = {
  clients: await prisma.client.count(),
  invoices: await prisma.invoice.count(),
  employees: await prisma.employee.count(),
  budgets: await prisma.budget.count(),
  journal: await prisma.journalEntry.count(),
  punches: await prisma.punchLog.count(),
  employeesLinked: await prisma.user.count({ where: { employeeId: { not: null } } }),
};
const unchanged = Object.keys(before).every((k) => before[k] === after[k]);
console.log(JSON.stringify({ ok: true, rolledBack: unchanged, before, after }, null, 2));
await prisma.$disconnect();
process.exit(unchanged ? 0 : 1);
