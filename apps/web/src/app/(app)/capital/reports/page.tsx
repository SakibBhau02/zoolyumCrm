"use client";

import { ReportsTab } from "../_components/tab-loader";
import { useCapital } from "../_components/capital-context";

export default function CapitalReportsPage() {
  const c = useCapital();
  return (
    <ReportsTab
      reports={c.reports}
      aging={c.aging}
      forecast={c.forecast}
      statements={c.statements}
      apAging={c.apAging}
      budgets={c.budgets}
      projects={c.projects}
      bankAccounts={c.bankAccounts}
      categories={c.expenseCategories}
      onRunRecurring={() => void c.runRecurring()}
      running={c.recurringBusy}
      refresh={c.reload}
      notify={c.notify}
    />
  );
}
