"use client";

import { motion } from "framer-motion";
import { Plus, ReceiptText } from "lucide-react";
import { Btn } from "@/components/table";
import { useCapital } from "./capital-context";
import { AccountModal, ConfirmModal, EditInvoiceModal, ExpenseModal, InvoiceFormModal, VendorModal } from "./modals";

export function CapitalFlash() {
  const { flash } = useCapital();
  if (!flash) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl"
    >
      {flash}
    </motion.div>
  );
}

export function CapitalHeaderActions() {
  const { setExpOpen, setInvOpen } = useCapital();
  return (
    <>
      <Btn variant="outline" onClick={() => setExpOpen(true)}>
        <ReceiptText className="size-3.5" /> Record Expense
      </Btn>
      <Btn variant="primary" onClick={() => setInvOpen(true)}>
        <Plus className="size-3.5" /> New Invoice
      </Btn>
    </>
  );
}

/** Modals shared across every capital tab (create / edit / delete). */
export function CapitalGlobalModals() {
  const c = useCapital();
  return (
    <>
      <InvoiceFormModal
        open={c.invOpen}
        onClose={() => {
          c.setInvOpen(false);
          c.setInvPreset(null);
        }}
        clients={c.clients}
        projects={c.projects}
        initial={c.invPreset}
        onSaved={() => {
          c.notify("Invoice created");
          c.reload();
        }}
      />
      <ExpenseModal
        open={c.expOpen}
        onClose={() => c.setExpOpen(false)}
        onSaved={() => {
          c.notify("Expense recorded");
          c.reload();
        }}
        bankAccounts={c.bankAccounts}
        categories={c.expenseCategories}
        vendors={c.vendors}
        clients={c.clients}
        projects={c.projects}
      />
      <VendorModal
        open={c.vendorOpen || !!c.vendorEdit}
        onClose={() => {
          c.setVendorOpen(false);
          c.setVendorEdit(null);
        }}
        onSaved={() => {
          c.notify("Vendor saved");
          c.reload();
        }}
        editing={c.vendorEdit}
      />
      <AccountModal
        open={c.accountOpen || !!c.accountEdit}
        onClose={() => {
          c.setAccountOpen(false);
          c.setAccountEdit(null);
        }}
        onSaved={() => {
          c.notify("Account saved");
          c.reload();
        }}
        editing={c.accountEdit}
      />
      <EditInvoiceModal
        invoice={c.editInv}
        onClose={() => c.setEditInv(null)}
        clients={c.clients}
        projects={c.projects}
        onSaved={() => {
          c.notify("Invoice updated");
          c.reload();
        }}
      />
      <ConfirmModal
        open={!!c.toDelete}
        onClose={() => c.setToDelete(null)}
        title={c.toDelete?.kind === "invoice" ? "Delete invoice" : "Delete expense"}
        message={c.toDelete ? `Delete "${c.toDelete.name}"? This cannot be undone.` : ""}
        busy={c.deleting}
        onConfirm={() => void c.doDelete()}
      />
      <ConfirmModal
        open={!!c.toDeleteVendor}
        onClose={() => c.setToDeleteVendor(null)}
        title="Delete vendor"
        message={c.toDeleteVendor ? `Delete vendor "${c.toDeleteVendor.name}"? Vendors with expenses must be deactivated instead.` : ""}
        busy={c.deletingVendor}
        onConfirm={() => void c.doDeleteVendor()}
      />
    </>
  );
}
