"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api";

type CapitalContextValue = {
  refreshKey: number;
  reload: () => void;
  flash: string | null;
  notify: (msg: string) => void;
  // shared lookups
  clients: any[];
  projects: any[];
  bankAccounts: any[];
  vendors: any[];
  accounts: any[];
  expenseCategories: any[];
  // invoice / expense lists (shared so overview + tabs stay in sync)
  invoices: any[] | null;
  invoicesErr: string | null;
  expenses: any[] | null;
  expensesErr: string | null;
  income: any[] | null;
  incomeErr: string | null;
  // finance aggregates
  overview: any;
  incomeStats: any;
  reports: any;
  profitability: any;
  activity: any[] | null;
  aging: any;
  forecast: any;
  budgets: any[];
  statements: { trialBalance: any; profitLoss: any; balanceSheet: any; cashFlow: any };
  apAging: any;
  recurringBusy: boolean;
  runRecurring: () => Promise<void>;
  installmentsDue: any[] | null;
  // global UI state ( header actions + shared modals )
  invOpen: boolean;
  setInvOpen: (v: boolean) => void;
  invPreset: { clientId?: string; projectId?: string; amount?: number; description?: string } | null;
  setInvPreset: (v: { clientId?: string; projectId?: string; amount?: number; description?: string } | null) => void;
  openBalanceInvoice: (preset: { clientId?: string; projectId?: string; amount?: number; description?: string }) => void;
  expOpen: boolean;
  setExpOpen: (v: boolean) => void;
  vendorOpen: boolean;
  setVendorOpen: (v: boolean) => void;
  vendorEdit: any | null;
  setVendorEdit: (v: any | null) => void;
  accountOpen: boolean;
  setAccountOpen: (v: boolean) => void;
  accountEdit: any | null;
  setAccountEdit: (v: any | null) => void;
  editInv: any | null;
  setEditInv: (v: any | null) => void;
  toDelete: { kind: "invoice" | "expense"; id: string; name: string; status?: string } | null;
  setToDelete: (v: { kind: "invoice" | "expense"; id: string; name: string; status?: string } | null) => void;
  deleting: boolean;
  toDeleteVendor: any | null;
  setToDeleteVendor: (v: any | null) => void;
  deletingVendor: boolean;
  duplicateInvoice: (id: string) => Promise<void>;
  doDelete: () => Promise<string | null>;
  doDeleteVendor: () => Promise<void>;
  deleteAccount: (a: any) => Promise<void>;
};

const CapitalContext = createContext<CapitalContextValue | null>(null);

export function CapitalProvider({ children }: { children: React.ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const reload = useCallback(() => setRefreshKey((r) => r + 1), []);
  const notify = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const { data: overview } = useApi<any>(`/capital/overview?ts=${refreshKey}`);
  // NOTE: lookups carry ?ts= so every reload() busts the react-query cache.
  // Without it, newly created vendors/accounts/categories/clients only appear
  // after a full page reload (static query keys never refetch).
  const { data: clients } = useApi<any[]>(`/accounts/client-lookup?ts=${refreshKey}`);
  const { data: projects } = useApi<any[]>(`/flow/project-lookup?ts=${refreshKey}`);
  const { data: incomeStats } = useApi<any>(`/capital/income/stats?ts=${refreshKey}`);
  const { data: reports } = useApi<any>(`/capital/reports?ts=${refreshKey}`);
  const { data: profitability } = useApi<any>(`/capital/profitability?ts=${refreshKey}`);
  const { data: activity } = useApi<any[]>(`/capital/activity?ts=${refreshKey}`);
  const { data: aging } = useApi<any>(`/capital/aging?ts=${refreshKey}`);
  const { data: forecast } = useApi<any>(`/capital/forecast?ts=${refreshKey}`);
  const { data: bankAccounts } = useApi<any[]>(`/capital/bank-accounts?ts=${refreshKey}`);
  const { data: expenseCategories } = useApi<any[]>(`/capital/expense-categories?ts=${refreshKey}`);
  const { data: vendors } = useApi<any[]>(`/capital/vendors?ts=${refreshKey}`);
  const { data: accounts } = useApi<any[]>(`/capital/accounts?ts=${refreshKey}`);
  const { data: budgets } = useApi<any[]>(`/capital/budgets?ts=${refreshKey}`);
  const { data: tb } = useApi<any>(`/capital/statements/trial-balance?ts=${refreshKey}`);
  const { data: pl } = useApi<any>(`/capital/statements/profit-loss?ts=${refreshKey}`);
  const { data: bs } = useApi<any>(`/capital/statements/balance-sheet?ts=${refreshKey}`);
  const { data: cf } = useApi<any>(`/capital/statements/cash-flow?ts=${refreshKey}`);
  const { data: apAging } = useApi<any>(`/capital/aging/ap?ts=${refreshKey}`);

  const [invoices, setInvoices] = useState<any[] | null>(null);
  const [invoicesErr, setInvoicesErr] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<any[] | null>(null);
  const [expensesErr, setExpensesErr] = useState<string | null>(null);
  const [income, setIncome] = useState<any[] | null>(null);
  const [incomeErr, setIncomeErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvoices(null);
    setInvoicesErr(null);
    setExpenses(null);
    setExpensesErr(null);
    setIncome(null);
    setIncomeErr(null);
    // Paged envelope: the legacy array path would ship the whole invoice book.
    // The tabs that need a full list page through /capital/invoices themselves.
    apiFetch<any>("/capital/invoices?pageSize=100")
      .then((d) => !cancelled && setInvoices(Array.isArray(d) ? d : d?.items ?? []))
      .catch((e) => !cancelled && setInvoicesErr(e.message ?? "Failed to load invoices"));
    apiFetch<any>("/capital/expenses?limit=200")
      .then((d) => !cancelled && setExpenses(Array.isArray(d) ? d : d?.items ?? []))
      .catch((e) => !cancelled && setExpensesErr(e.message ?? "Failed to load expenses"));
    apiFetch<any>("/capital/income?limit=200")
      .then((d) => !cancelled && setIncome(Array.isArray(d) ? d : d?.items ?? []))
      .catch((e) => !cancelled && setIncomeErr(e.message ?? "Failed to load income"));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const [recurringBusy, setRecurringBusy] = useState(false);
  const [installmentsDue, setInstallmentsDue] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>("/capital/installments/due")
      .then((d) => !cancelled && setInstallmentsDue(d))
      .catch(() => !cancelled && setInstallmentsDue([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const runRecurring = useCallback(async () => {
    setRecurringBusy(true);
    try {
      const r = await apiFetch<any>("/capital/recurring/run", { method: "POST" });
      const bits: string[] = [];
      if (r.created > 0) bits.push(`${r.created} recurring invoice(s) generated`);
      if (r.reminders > 0) bits.push(`${r.reminders} installment reminder(s) logged`);
      notify(bits.length ? bits.join(" · ") : "No recurring invoices due");
      setRefreshKey((v) => v + 1);
    } catch (e: any) {
      notify(e.message ?? "Recurring billing failed");
    } finally {
      setRecurringBusy(false);
    }
  }, [notify]);

  // ---- global modal / action state (previously local to the monolith page) ----
  const [invOpen, setInvOpen] = useState(false);
  const [invPreset, setInvPreset] = useState<{ clientId?: string; projectId?: string; amount?: number; description?: string } | null>(null);
  const openBalanceInvoice = useCallback((preset: { clientId?: string; projectId?: string; amount?: number; description?: string }) => {
    setInvPreset(preset);
    setInvOpen(true);
  }, []);
  const [expOpen, setExpOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorEdit, setVendorEdit] = useState<any | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEdit, setAccountEdit] = useState<any | null>(null);
  const [editInv, setEditInv] = useState<any | null>(null);
  const [toDelete, setToDelete] = useState<{ kind: "invoice" | "expense"; id: string; name: string; status?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toDeleteVendor, setToDeleteVendor] = useState<any | null>(null);
  const [deletingVendor, setDeletingVendor] = useState(false);

  const duplicateInvoice = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/capital/invoices/${id}/duplicate`, { method: "POST" });
        notify("Invoice duplicated");
        setRefreshKey((v) => v + 1);
      } catch (e: any) {
        notify(e.message ?? "Duplicate failed");
      }
    },
    [notify]
  );

  /** Deletes the pending `toDelete` entry. Returns the deleted id (for closing detail views). */
  const doDelete = useCallback(async () => {
    if (!toDelete) return null;
    setDeleting(true);
    try {
      await apiFetch(`/capital/${toDelete.kind === "invoice" ? "invoices" : "expenses"}/${toDelete.id}`, { method: "DELETE" });
      notify("Deleted");
      const id = toDelete.id;
      setToDelete(null);
      setRefreshKey((v) => v + 1);
      return id;
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
      return null;
    } finally {
      setDeleting(false);
    }
  }, [toDelete, notify]);

  const doDeleteVendor = useCallback(async () => {
    if (!toDeleteVendor) return;
    setDeletingVendor(true);
    try {
      await apiFetch(`/capital/vendors/${toDeleteVendor.id}`, { method: "DELETE" });
      notify("Vendor deleted");
      setToDeleteVendor(null);
      setRefreshKey((v) => v + 1);
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeletingVendor(false);
    }
  }, [toDeleteVendor, notify]);

  const deleteAccount = useCallback(
    async (a: any) => {
      try {
        await apiFetch(`/capital/accounts/${a.id}`, { method: "DELETE" });
        notify("Account deactivated");
        setRefreshKey((v) => v + 1);
      } catch (e: any) {
        notify(e.message ?? "Deactivate failed");
      }
    },
    [notify]
  );

  return (
    <CapitalContext.Provider
      value={{
        refreshKey,
        reload,
        flash,
        notify,
        clients: clients ?? [],
        projects: projects ?? [],
        bankAccounts: bankAccounts ?? [],
        vendors: vendors ?? [],
        accounts: accounts ?? [],
        expenseCategories: expenseCategories ?? [],
        invoices: invoices ?? null,
        invoicesErr: invoicesErr ?? null,
        expenses: expenses ?? null,
        expensesErr: expensesErr ?? null,
        income: income ?? null,
        incomeErr: incomeErr ?? null,
        overview,
        incomeStats,
        reports,
        profitability,
        activity: activity ?? null,
        aging,
        forecast,
        budgets: budgets ?? [],
        statements: { trialBalance: tb, profitLoss: pl, balanceSheet: bs, cashFlow: cf },
        apAging,
        recurringBusy,
        runRecurring,
        installmentsDue,
        invOpen,
        setInvOpen,
        invPreset,
        setInvPreset,
        openBalanceInvoice,
        expOpen,
        setExpOpen,
        vendorOpen,
        setVendorOpen,
        vendorEdit,
        setVendorEdit,
        accountOpen,
        setAccountOpen,
        accountEdit,
        setAccountEdit,
        editInv,
        setEditInv,
        toDelete,
        setToDelete,
        deleting,
        toDeleteVendor,
        setToDeleteVendor,
        deletingVendor,
        duplicateInvoice,
        doDelete,
        doDeleteVendor,
        deleteAccount,
      }}
    >
      {children}
    </CapitalContext.Provider>
  );
}

export function useCapital() {
  const ctx = useContext(CapitalContext);
  if (!ctx) throw new Error("useCapital must be used inside CapitalProvider");
  return ctx;
}

/** Null outside CapitalProvider — lets Flow reuse capital modals standalone. */
export function useCapitalOptional() {
  return useContext(CapitalContext);
}
