-- The overdue sweep (`InvoiceService.overdueSweep`, every 10 minutes) filters
-- and updates invoices by status + dueDate. With only `Invoice_status_idx` the
-- planner had to read every SENT/VIEWED row and filter dates in memory, twice
-- per sweep. A composite index lets each pass touch just the rows that can
-- actually move.
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");
