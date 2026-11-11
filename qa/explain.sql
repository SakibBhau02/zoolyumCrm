\echo === InvoiceLineItem by invoiceId
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM "InvoiceLineItem" WHERE "invoiceId"='perf_inv_1';
\echo === TaskComment by taskId ordered
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM "TaskComment" WHERE "taskId"='perf_task_1' ORDER BY "createdAt" DESC LIMIT 50;
\echo === LeaveRequest active range
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM "LeaveRequest" WHERE status='APPROVED' AND "startDate" <= now() AND "endDate" >= now();
\echo === Task board default sort
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT id,title,status,"dueDate" FROM "Task" WHERE "archivedAt" IS NULL AND "parentTaskId" IS NULL ORDER BY "dueDate" ASC LIMIT 50;
\echo === Accounts list sort
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT id,"companyName","healthScore" FROM "Client" ORDER BY "healthScore" DESC, "createdAt" DESC LIMIT 500;
\echo === Invoice ledger for client set (financial summary shape)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT i."clientId", i.status, i."taxRate", li.amount, p.amount FROM "Invoice" i LEFT JOIN "InvoiceLineItem" li ON li."invoiceId"=i.id LEFT JOIN "Payment" p ON p."invoiceId"=i.id WHERE i."clientId" IN (SELECT id FROM "Client" LIMIT 500);
