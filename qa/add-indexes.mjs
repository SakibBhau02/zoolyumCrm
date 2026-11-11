/**
 * Adds the missing hot-path indexes to prisma/schema.prisma.
 * Idempotent: skips an index that already exists in the model.
 */
import fs from "node:fs";

const file = "apps/api/prisma/schema.prisma";
let src = fs.readFileSync(file, "utf8");

const ADD = {
  InvoiceLineItem: ["@@index([invoiceId])"],
  TaskComment: ["@@index([taskId, createdAt])", "@@index([parentId])"],
  Task: [
    "@@index([archivedAt, parentTaskId, dueDate])",
    "@@index([assignedToId, status, dueDate])",
    "@@index([parentTaskId])",
    "@@index([completedAt])",
  ],
  LeaveRequest: ["@@index([employeeId, status, startDate])", "@@index([status, startDate, endDate])"],
  ClientContact: ["@@index([clientId])"],
  Client: ["@@index([healthScore])", "@@index([healthLevel])", "@@index([industryVertical])"],
  Project: ["@@index([status, healthStatus, createdAt])", "@@index([reportMode, nextReportDate])"],
  TaskDependency: ["@@index([dependsOnTaskId])"],
  EstimateAccuracyLog: ["@@index([taskId])"],
  Employee: ["@@index([employmentStatus])", "@@index([reportingManagerId])"],
  Expense: ["@@index([isPayable, approvalStatus, dueDate])", "@@index([bankAccountId])", "@@index([vendorId])"],
  Payment: ["@@index([type, paymentDate])", "@@index([installmentId])"],
  ChurnRiskFlag: ["@@index([flaggedAt, clientId])"],
  ProjectRiskLog: ["@@index([projectId, calculatedAt])"],
};

for (const [model, indexes] of Object.entries(ADD)) {
  const start = src.indexOf(`model ${model} {`);
  if (start < 0) {
    console.log("model not found:", model);
    continue;
  }
  const end = src.indexOf("\n}", start);
  const block = src.slice(start, end);
  const missing = indexes.filter((i) => !block.includes(i));
  if (!missing.length) continue;
  // Insert right before the closing brace, with a blank line + comment.
  const insert = `\n\n  // Hot-path indexes (production audit 2026-11)\n` + missing.map((i) => `  ${i}`).join("\n");
  src = src.slice(0, end) + insert + src.slice(end);
  console.log(`+ ${model}: ${missing.join(", ")}`);
}

fs.writeFileSync(file, src);
