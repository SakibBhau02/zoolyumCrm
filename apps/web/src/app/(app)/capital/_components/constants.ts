import { formatDate } from "@/lib/format";
import { invoiceTotals } from "@/lib/invoice-utils";

export type TabKey =
  | "overview"
  | "invoices"
  | "expenses"
  | "income"
  | "vendors"
  | "reports"
  | "profitability"
  | "accounts"
  | "activity";

export const TABS: { value: string; key: TabKey; href: string }[] = [
  { value: "Overview", key: "overview", href: "/capital" },
  { value: "Invoices", key: "invoices", href: "/capital/invoices" },
  { value: "Expenses", key: "expenses", href: "/capital/expenses" },
  { value: "Income", key: "income", href: "/capital/income" },
  { value: "Vendors", key: "vendors", href: "/capital/vendors" },
  { value: "Reports", key: "reports", href: "/capital/reports" },
  { value: "Profitability", key: "profitability", href: "/capital/profitability" },
  { value: "Accounts", key: "accounts", href: "/capital/accounts" },
  { value: "Activity", key: "activity", href: "/capital/activity" },
];

/** Legacy `?tab=` values → new routes (backward compat for old links / e2e). */
export const LEGACY_TAB_ROUTE: Record<string, string> = {
  overview: "/capital",
  invoices: "/capital/invoices",
  expenses: "/capital/expenses",
  income: "/capital/income",
  vendors: "/capital/vendors",
  reports: "/capital/reports",
  profitability: "/capital/profitability",
  accounts: "/capital/accounts",
  activity: "/capital/activity",
};

export const ACCOUNT_CATEGORIES = ["ASSET", "LIABILITY", "REVENUE", "DIRECT_COST", "OPEX"];

export const INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
  "VOID",
];
export const PAYMENT_METHODS = ["CASH", "BKASH", "NAGAD", "CARD", "BANK_TRANSFER"];
export const EXPENSE_CATEGORIES = [
  "AD_SPEND",
  "FREELANCER",
  "PRODUCTION",
  "SALARY",
  "SOFTWARE",
  "RENT",
  "MARKETING",
  "TRAVEL",
  "BANK_CHARGE",
  "MISC",
];
export const EXPENSE_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

export const RETAINER_INTERVALS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "BIWEEKLY", label: "Every 15 days" },
  { value: "WEEKLY", label: "Every 7 days" },
];

export const label = (v: string) =>
  v
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const CAT_TONES: Record<string, string> = {
  AD_SPEND: "bg-primary/10 text-primary dark:text-primary ring-1 ring-primary/20",
  MARKETING: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300 ring-1 ring-fuchsia-500/20",
  FREELANCER: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  PRODUCTION: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  SALARY: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  SOFTWARE: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/20",
  RENT: "bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/20",
  TRAVEL: "bg-teal-500/10 text-teal-600 dark:text-teal-300 ring-1 ring-teal-500/20",
  BANK_CHARGE: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  MISC: "bg-muted text-muted-foreground ring-1 ring-border",
};

export const ENTITY_TONES: Record<string, string> = {
  INVOICE: "bg-primary/15 text-primary",
  PAYMENT: "bg-emerald-500/15 text-emerald-400",
  EXPENSE: "bg-amber-500/15 text-amber-400",
  VENDOR: "bg-sky-500/15 text-sky-400",
  ACCOUNT: "bg-fuchsia-500/15 text-fuchsia-400",
};

export const fmtJSON = (v: any) => {
  if (v == null || v === "") return "—";
  try {
    const s = typeof v === "string" ? JSON.stringify(JSON.parse(v)) : JSON.stringify(v);
    return s.length > 70 ? `${s.slice(0, 70)}…` : s;
  } catch {
    return String(v).slice(0, 70);
  }
};

export const today = () => new Date().toISOString().slice(0, 10);

export function exportInvoicesCsv(invoices: any[]) {
  const rows = [["Invoice", "Client", "Project", "Type", "Amount", "Paid", "Balance", "Status", "Issued", "Due"]];
  for (const inv of invoices) {
    const t = invoiceTotals(inv);
    const amount = t.grand;
    const paid = t.paid;
    rows.push([
      inv.invoiceNumber,
      inv.client.companyName,
      inv.project?.name ?? "",
      inv.invoiceType ?? "",
      String(amount),
      String(paid),
      String(amount - paid),
      inv.status,
      formatDate(inv.issueDate),
      inv.dueDate ? formatDate(inv.dueDate) : "",
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `invoices-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
