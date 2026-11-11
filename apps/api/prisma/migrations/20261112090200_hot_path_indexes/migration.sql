-- Hot-path indexes found missing in the production audit.
-- Every one of these is a sequential scan today (verified with EXPLAIN).

CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");
CREATE INDEX "TaskComment_parentId_idx" ON "TaskComment"("parentId");
CREATE INDEX "Task_archivedAt_parentTaskId_dueDate_idx" ON "Task"("archivedAt", "parentTaskId", "dueDate");
CREATE INDEX "Task_assignedToId_status_dueDate_idx" ON "Task"("assignedToId", "status", "dueDate");
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
CREATE INDEX "Task_completedAt_idx" ON "Task"("completedAt");
CREATE INDEX "LeaveRequest_employeeId_status_startDate_idx" ON "LeaveRequest"("employeeId", "status", "startDate");
CREATE INDEX "LeaveRequest_status_startDate_endDate_idx" ON "LeaveRequest"("status", "startDate", "endDate");
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");
CREATE INDEX "Client_healthScore_idx" ON "Client"("healthScore");
CREATE INDEX "Client_healthLevel_idx" ON "Client"("healthLevel");
CREATE INDEX "Client_industryVertical_idx" ON "Client"("industryVertical");
CREATE INDEX "Project_status_healthStatus_createdAt_idx" ON "Project"("status", "healthStatus", "createdAt");
CREATE INDEX "Project_reportMode_nextReportDate_idx" ON "Project"("reportMode", "nextReportDate");
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");
CREATE INDEX "EstimateAccuracyLog_taskId_idx" ON "EstimateAccuracyLog"("taskId");
CREATE INDEX "Employee_employmentStatus_idx" ON "Employee"("employmentStatus");
CREATE INDEX "Employee_reportingManagerId_idx" ON "Employee"("reportingManagerId");
CREATE INDEX "Expense_isPayable_approvalStatus_dueDate_idx" ON "Expense"("isPayable", "approvalStatus", "dueDate");
CREATE INDEX "Expense_bankAccountId_idx" ON "Expense"("bankAccountId");
CREATE INDEX "Expense_vendorId_idx" ON "Expense"("vendorId");
CREATE INDEX "Payment_type_paymentDate_idx" ON "Payment"("type", "paymentDate");
CREATE INDEX "Payment_installmentId_idx" ON "Payment"("installmentId");
CREATE INDEX "ChurnRiskFlag_flaggedAt_clientId_idx" ON "ChurnRiskFlag"("flaggedAt", "clientId");
CREATE INDEX "ProjectRiskLog_projectId_calculatedAt_idx" ON "ProjectRiskLog"("projectId", "calculatedAt");
