"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api";

/**
 * Every query this provider owns. `reload()` invalidates exactly these keys
 * instead of bumping a `?ts=` counter that used to be appended to the URL —
 * that trick guaranteed a network round trip on every render (it made the
 * 30 s `staleTime` impossible to hit) and leaked a meaningless query param
 * into the API logs.
 */
const QUERY_PATHS = [
  "/capital/bootstrap",
  "/capital/overview",
  "/accounts/client-lookup",
  "/flow/project-lookup",
  "/capital/income/stats",
  "/capital/reports",
  "/capital/profitability",
  "/capital/activity",
  "/capital/aging",
  "/capital/forecast",
  "/capital/bank-accounts",
  "/capital/expense-categories",
  "/capital/vendors",
  "/capital/accounts",
  "/capital/budgets",
  "/capital/statements/trial-balance",
  "/capital/statements/profit-loss",
  "/capital/statements/balance-sheet",
  "/capital/statements/cash-flow",
  "/capital/aging/ap",
  "/capital/invoices?pageSize=100",
  "/capital/expenses?limit=200",
  "/capital/income?limit=200",
  "/capital/installments/due",
] as const;

/** Accepts either a bare array or the `{ items, total }` page envelope. */
function unwrapList(value: any): any[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  return Array.isArray(value.items) ? value.items : [];
}

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
  const queryClient = useQueryClient();
  const reload = useCallback(() => {
    setRefreshKey((r) => r + 1);
    for (const path of QUERY_PATHS) {
      void queryClient.invalidateQueries({ queryKey: ["api", path] });
    }
  }, [queryClient]);
  const notify = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }, []);

  // Everything below arrives in ONE request (`/capital/bootstrap`): overview,
  // lookups, the three list envelopes and the four statements. It used to be
  // twenty-one GETs — and every authenticated GET pays three extra round trips
  // (Redis jti check, rate-limit INCR, User lookup) before its handler runs.
  // Only the two cross-module lookups stay separate; they belong to Accounts
  // and Flow, not to Capital.
  const { data: boot, error: bootErr } = useApi<any>(`/capital/bootstrap`);
  const { data: clients } = useApi<any[]>(`/accounts/client-lookup`);
  const { data: projects } = useApi<any[]>(`/flow/project-lookup`);

  const overview = boot?.overview ?? null;
  const incomeStats = boot?.incomeStats ?? null;
  const reports = boot?.reports ?? null;
  const profitability = boot?.profitability ?? null;
  const activity = boot?.activity ?? null;
  const aging = boot?.aging ?? null;
  const forecast = boot?.forecast ?? null;
  const bankAccounts = boot?.bankAccounts ?? null;
  const expenseCategories = boot?.expenseCategories ?? null;
  const vendors = boot?.vendors ?? null;
  const accounts = boot?.accounts ?? null;
  const budgets = boot?.budgets ?? null;
  const apAging = boot?.apAging ?? null;
  const installmentsDue = boot?.installmentsDue ?? null;
  const statements = useMemo(
    () => ({
      trialBalance: boot?.statements?.trialBalance ?? null,
      profitLoss: boot?.statements?.profitLoss ?? null,
      balanceSheet: boot?.statements?.balanceSheet ?? null,
      cashFlow: boot?.statements?.cashFlow ?? null,
    }),
    [boot]
  );

  // Paged envelope: the legacy array path would ship the whole invoice book.
  // The tabs that need a full list page through /capital/invoices themselves.
  const invoices = useMemo(() => unwrapList(boot?.invoices), [boot]);
  const expenses = useMemo(() => unwrapList(boot?.expenses), [boot]);
  const income = useMemo(() => unwrapList(boot?.income), [boot]);

  // A `null` section means the server reported it failed (every section
  // settles independently), so only that list shows an error.
  const sectionErr = (section: any, label: string) =>
    bootErr ? bootErr : boot && section == null ? `Failed to load ${label}` : null;
  const invoicesErr = sectionErr(boot?.invoices, "invoices");
  const expensesErr = sectionErr(boot?.expenses, "expenses");
  const incomeErr = sectionErr(boot?.income, "income");

  const [recurringBusy, setRecurringBusy] = useState(false);

  const runRecurring = useCallback(async () => {
    setRecurringBusy(true);
    try {
      const r = await apiFetch<any>("/capital/recurring/run", { method: "POST" });
      const bits: string[] = [];
      if (r.created > 0) bits.push(`${r.created} recurring invoice(s) generated`);
      if (r.reminders > 0) bits.push(`${r.reminders} installment reminder(s) logged`);
      notify(bits.length ? bits.join(" · ") : "No recurring invoices due");
      reload();
    } catch (e: any) {
      notify(e.message ?? "Recurring billing failed");
    } finally {
      setRecurringBusy(false);
    }
  }, [notify, reload]);

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
        reload();
      } catch (e: any) {
        notify(e.message ?? "Duplicate failed");
      }
    },
    [notify, reload]
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
      reload();
      return id;
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
      return null;
    } finally {
      setDeleting(false);
    }
  }, [toDelete, notify, reload]);

  const doDeleteVendor = useCallback(async () => {
    if (!toDeleteVendor) return;
    setDeletingVendor(true);
    try {
      await apiFetch(`/capital/vendors/${toDeleteVendor.id}`, { method: "DELETE" });
      notify("Vendor deleted");
      setToDeleteVendor(null);
      reload();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeletingVendor(false);
    }
  }, [toDeleteVendor, notify, reload]);

  const deleteAccount = useCallback(
    async (a: any) => {
      try {
        await apiFetch(`/capital/accounts/${a.id}`, { method: "DELETE" });
        notify("Account deactivated");
        reload();
      } catch (e: any) {
        notify(e.message ?? "Deactivate failed");
      }
    },
    [notify, reload]
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
        statements,
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
