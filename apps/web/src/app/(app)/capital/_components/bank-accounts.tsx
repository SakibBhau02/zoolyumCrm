"use client";

import { useEffect, useState } from "react";
import { Building2, Landmark, Pencil, Plus, Star, Trash2, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Btn } from "@/components/table";
import { Field, FormActions, Input, Modal, Toggle } from "@/components/ui";
import { PaymentBadge, MethodPicker, PAY_META, paymentKind } from "@/components/payment-badge";
import { cn } from "@/components/shared";

type Account = {
  id: string;
  accountName: string;
  accountType: string;
  currency?: string;
  currentBalance?: number | string;
  accountHolder?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  branch?: string | null;
  routingNumber?: string | null;
  showOnInvoice?: boolean;
  isPrimary?: boolean;
  isActive?: boolean;
};

const blank = (): Account => ({
  id: "",
  accountName: "",
  accountType: "BANK",
  currency: "BDT",
  accountHolder: "",
  bankName: "",
  accountNumber: "",
  branch: "",
  routingNumber: "",
  showOnInvoice: true,
  isPrimary: false,
  isActive: true,
});

/**
 * Bank & mobile-financial-service accounts.
 *
 * These are the accounts an invoice can be paid into. Before this existed the
 * only place to type a bank was the Control module's single default, and the
 * `BankAccount` rows used by every payment form had no way to be created from
 * the UI at all.
 */
export function BankAccountsCard({
  bankAccounts,
  onSaved,
  notify,
}: {
  bankAccounts: Account[];
  onSaved: () => void;
  notify: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<Account | null>(null);
  const [confirming, setConfirming] = useState<Account | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (account: Account, force = false) => {
    setBusyId(account.id);
    try {
      const r = await apiFetch<{ deleted: boolean; deactivated: boolean; used: number }>(
        `/capital/bank-accounts/${account.id}${force ? "?force=true" : ""}`,
        { method: "DELETE" }
      );
      notify(r.deleted ? "Account deleted" : "Account deactivated — it already has transactions");
      setConfirming(null);
      onSaved();
    } catch (e: any) {
      notify(e.message ?? "Could not delete the account");
    } finally {
      setBusyId(null);
    }
  };

  const makePrimary = async (account: Account) => {
    setBusyId(account.id);
    try {
      await apiFetch(`/capital/bank-accounts/${account.id}`, { method: "PATCH", body: JSON.stringify({ isPrimary: true }) });
      notify(`${account.accountName} is now the primary account`);
      onSaved();
    } catch (e: any) {
      notify(e.message ?? "Could not update the account");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-title font-semibold">
            <Landmark className="size-4 text-primary" /> Bank &amp; mobile banking
          </p>
          <p className="mt-0.5 text-meta text-muted-foreground">
            Accounts the client can pay into. Active ones marked “show on invoice” print on every invoice.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setEditing(blank())}>
          <Plus className="size-3.5" /> Add bank account
        </Btn>
      </div>

      {bankAccounts.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Wallet className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-body font-semibold">No bank or MFS account yet</p>
          <p className="mt-1 text-meta text-muted-foreground">
            Add your bank account, bKash, Nagad, Rocket or Upay wallet so invoices can show where to pay.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {bankAccounts.map((account) => {
            const meta = PAY_META[paymentKind(account.accountType)];
            return (
              <li key={account.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", account.isActive === false && "opacity-55")}>
                <PaymentBadge kind={account.accountType} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-body font-semibold">
                    {account.accountName || meta.label}
                    {account.isPrimary && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        <Star className="size-2.5" /> Primary
                      </span>
                    )}
                    {account.showOnInvoice === false && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden on invoice</span>
                    )}
                    {account.isActive === false && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Inactive</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-meta leading-snug text-muted-foreground line-clamp-2 sm:truncate">
                    {[
                      account.bankName,
                      account.accountNumber,
                      account.branch,
                      account.accountHolder,
                    ].filter(Boolean).join("  ·  ") || meta.label}
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  {!account.isPrimary && (
                    <button
                      type="button"
                      onClick={() => void makePrimary(account)}
                      disabled={busyId === account.id}
                      title="Make primary"
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-500"
                    >
                      <Star className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(account)}
                    title="Edit"
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(account)}
                    title="Delete"
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AccountModal
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onSaved();
        }}
        notify={notify}
      />

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        eyebrow="Delete account"
        icon={<Trash2 className="size-4" />}
        title={confirming?.accountName ?? ""}
        subtitle="Deactivating keeps every ledger row and just hides the account. Deleting removes it for good — past payments and expenses stay in the books but are no longer linked to it."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirming(null)}>Cancel</Btn>
            <Btn variant="outline" disabled={!!busyId} onClick={() => confirming && void remove(confirming)}>
              Deactivate
            </Btn>
            <Btn variant="primary" disabled={!!busyId} onClick={() => confirming && void remove(confirming, true)}>
              {busyId ? "Working…" : "Delete permanently"}
            </Btn>
          </div>
        }
      >
        <p className="text-body text-muted-foreground">
          Choose <span className="font-semibold text-foreground">Deactivate</span> to keep the history linked, or{" "}
          <span className="font-semibold text-foreground">Delete permanently</span> to remove this account from every
          picker and invoice.
        </p>
      </Modal>
    </section>
  );
}

function AccountModal({
  account,
  onClose,
  onSaved,
  notify,
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
  notify: (m: string) => void;
}) {
  const [f, setF] = useState<Account>(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = !!account;
  const editing = !!account?.id;

  useEffect(() => {
    if (!account) return;
    setErr(null);
    setF({ ...blank(), ...account });
  }, [account]);

  const kind = paymentKind(f.accountType);
  const isBank = kind === "BANK";
  const isMfs = PAY_META[kind].mfs;

  const set = (key: keyof Account, value: any) => setF((prev) => ({ ...prev, [key]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.accountName.trim()) return setErr("Give the account a name (e.g. “UCB Current” or “bKash merchant”)");
    if (isMfs && !String(f.accountNumber ?? "").trim()) return setErr("Enter the mobile wallet number");
    if (isBank && !String(f.accountNumber ?? "").trim() && !String(f.bankName ?? "").trim()) {
      return setErr("Enter the bank name or the account number");
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        accountName: f.accountName.trim(),
        accountType: kind,
        accountHolder: f.accountHolder ?? "",
        bankName: isBank ? f.bankName ?? "" : "",
        accountNumber: f.accountNumber ?? "",
        branch: isBank ? f.branch ?? "" : "",
        routingNumber: isBank ? f.routingNumber ?? "" : "",
        showOnInvoice: f.showOnInvoice !== false,
        isPrimary: !!f.isPrimary,
        isActive: f.isActive !== false,
      };
      await apiFetch(editing ? `/capital/bank-accounts/${f.id}` : "/capital/bank-accounts", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      notify(editing ? "Account updated" : "Account added");
      onSaved();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Bank & mobile banking"
      icon={<Building2 className="size-4" />}
      title={editing ? "Edit account" : "Add account"}
      subtitle="Printed on invoices when “show on invoice” is on."
      size="lg"
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-semibold text-muted-foreground">Account type</span>
          <MethodPicker value={f.accountType} onChange={(v) => set("accountType", v)} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Account name" required hint="Shown in every payment picker">
            <Input value={f.accountName} onChange={(e) => set("accountName", e.target.value)} placeholder={isBank ? "UCB Current" : "bKash merchant"} autoFocus />
          </Field>
          <Field label="Account holder">
            <Input value={f.accountHolder ?? ""} onChange={(e) => set("accountHolder", e.target.value)} placeholder="Zoolyum Agency" />
          </Field>
          {isBank && (
            <Field label="Bank name">
              <Input value={f.bankName ?? ""} onChange={(e) => set("bankName", e.target.value)} placeholder="United Commercial Bank" />
            </Field>
          )}
          <Field label={isMfs ? "Mobile wallet number" : "Account number"} required={isMfs}>
            <Input
              value={f.accountNumber ?? ""}
              onChange={(e) => set("accountNumber", e.target.value)}
              placeholder={isMfs ? "01XXXXXXXXX" : "0563222001011687"}
              inputMode={isMfs ? "tel" : "text"}
            />
          </Field>
          {isBank && (
            <>
              <Field label="Branch">
                <Input value={f.branch ?? ""} onChange={(e) => set("branch", e.target.value)} placeholder="Gulshan Branch" />
              </Field>
              <Field label="Routing number">
                <Input value={f.routingNumber ?? ""} onChange={(e) => set("routingNumber", e.target.value)} placeholder="245262982" />
              </Field>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle checked={f.showOnInvoice !== false} onChange={(v) => set("showOnInvoice", v)} label="Show on invoices" hint="Prints in the “Pay via” box" />
          <Toggle checked={!!f.isPrimary} onChange={(v) => set("isPrimary", v)} label="Primary account" hint="Highlighted first, prefilled in forms" />
        </div>
        {editing && (
          <Toggle checked={f.isActive !== false} onChange={(v) => set("isActive", v)} label="Active" hint="Inactive accounts disappear from payment forms" />
        )}

        {err && <p className="text-meta font-medium text-rose-500">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Add account"} />
      </form>
    </Modal>
  );
}
