"use client";

import { IncomeTab } from "../_components/tab-loader";
import { useCapital } from "../_components/capital-context";

export default function CapitalIncomePage() {
  const c = useCapital();
  return <IncomeTab income={c.income} error={c.incomeErr} refresh={c.reload} stats={c.incomeStats} bankAccounts={c.bankAccounts} clients={c.clients ?? []} projects={c.projects ?? []} />;
}
