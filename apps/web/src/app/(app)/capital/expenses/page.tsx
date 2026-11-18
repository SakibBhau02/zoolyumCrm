"use client";

import { ExpensesTab } from "../_components/tab-loader";
import { useCapital } from "../_components/capital-context";

export default function CapitalExpensesPage() {
  const c = useCapital();
  return (
    <ExpensesTab
      expenses={c.expenses}
      error={c.expensesErr}
      refresh={c.reload}
      notify={c.notify}
      onRecord={() => c.setExpOpen(true)}
      onVendor={() => c.setVendorOpen(true)}
      onDelete={(e) => c.setToDelete({ kind: "expense", id: e.id, name: e.description })}
      categories={c.expenseCategories}
      bankAccounts={c.bankAccounts}
      accounts={c.accounts}
    />
  );
}
