"use client";

import { AccountsTab } from "../_components/tabs";
import { useCapital } from "../_components/capital-context";

export default function CapitalAccountsPage() {
  const c = useCapital();
  return (
    <AccountsTab
      accounts={c.accounts}
      balances={c.statements.trialBalance?.rows ?? []}
      onEdit={(a) => c.setAccountEdit(a)}
      onAdd={() => c.setAccountOpen(true)}
      onDelete={(a) => void c.deleteAccount(a)}
      onSaved={c.reload}
    />
  );
}
