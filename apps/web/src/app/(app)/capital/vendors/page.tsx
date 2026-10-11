"use client";

import { VendorsTab } from "../_components/tabs";
import { useCapital } from "../_components/capital-context";

export default function CapitalVendorsPage() {
  const c = useCapital();
  return (
    <VendorsTab
      vendors={c.vendors}
      expenses={c.expenses ?? []}
      onEdit={(v) => c.setVendorEdit(v)}
      onAdd={() => c.setVendorOpen(true)}
      onDelete={(v) => c.setToDeleteVendor(v)}
      onSaved={c.reload}
    />
  );
}
