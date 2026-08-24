-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "CalendarEvent_date_idx" ON "CalendarEvent"("date");

-- CreateIndex
CREATE INDEX "CalendarEvent_projectId_idx" ON "CalendarEvent"("projectId");

-- CreateIndex
CREATE INDEX "ClientComment_projectId_idx" ON "ClientComment"("projectId");

-- CreateIndex
CREATE INDEX "ClientComment_createdAt_idx" ON "ClientComment"("createdAt");

-- CreateIndex
CREATE INDEX "ContentPost_status_idx" ON "ContentPost"("status");

-- CreateIndex
CREATE INDEX "ContentPost_scheduledDate_idx" ON "ContentPost"("scheduledDate");

-- CreateIndex
CREATE INDEX "CorrelationInsight_surfacedAt_idx" ON "CorrelationInsight"("surfacedAt");

-- CreateIndex
CREATE INDEX "DailyTarget_period_idx" ON "DailyTarget"("period");

-- CreateIndex
CREATE INDEX "DeliverableApproval_decidedAt_idx" ON "DeliverableApproval"("decidedAt");

-- CreateIndex
CREATE INDEX "DeliverableApproval_projectFileId_idx" ON "DeliverableApproval"("projectFileId");

-- CreateIndex
CREATE INDEX "ExecutiveDigestLog_generatedAt_idx" ON "ExecutiveDigestLog"("generatedAt");

-- CreateIndex
CREATE INDEX "Expense_approvalStatus_idx" ON "Expense"("approvalStatus");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_clientId_idx" ON "Expense"("clientId");

-- CreateIndex
CREATE INDEX "Expense_projectId_idx" ON "Expense"("projectId");

-- CreateIndex
CREATE INDEX "FinanceAuditLog_timestamp_idx" ON "FinanceAuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "FinanceAuditLog_entityType_entityId_idx" ON "FinanceAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "LeadMeeting_leadId_idx" ON "LeadMeeting"("leadId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_metricName_recordedAt_idx" ON "MetricSnapshot"("metricName", "recordedAt");

-- CreateIndex
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "PortalActivityLog_timestamp_idx" ON "PortalActivityLog"("timestamp");

-- CreateIndex
CREATE INDEX "PortalActivityLog_portalUserId_idx" ON "PortalActivityLog"("portalUserId");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFile_milestoneId_idx" ON "ProjectFile"("milestoneId");

-- CreateIndex
CREATE INDEX "ReportDefinition_createdAt_idx" ON "ReportDefinition"("createdAt");

-- CreateIndex
CREATE INDEX "TimeLog_taskId_idx" ON "TimeLog"("taskId");

-- CreateIndex
CREATE INDEX "TimeLog_employeeId_date_idx" ON "TimeLog"("employeeId", "date");
