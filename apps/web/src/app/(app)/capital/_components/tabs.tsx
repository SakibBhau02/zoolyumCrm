"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Banknote, Check, CircleDollarSign, Copy, Eye, HandCoins, Landmark, Pencil, Plus, ReceiptText, RefreshCw, Search, Trash2, UserPlus, Wallet, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate, formatDay, timeAgo } from "@/lib/format";
import { Avatar, CardShell, EmptyState, FadeIn, SectionTitle, SkeletonBlock, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Select } from "@/components/ui";
import { PaymentDonut, RevenueAreaChart } from "@/components/charts";
import { invoiceTotals } from "@/lib/invoice-utils";
import { ACCOUNT_CATEGORIES, CAT_TONES, ENTITY_TONES, EXPENSE_STATUSES, INVOICE_STATUSES, exportInvoicesCsv, fmtJSON, label } from "./constants";
import { AddIncomeModal, BudgetModal, CategoriesModal, EditExpenseModal, PayExpenseModal, ReconcileModal } from "./modals";

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <EmptyState title={message} hint="Could not load data" />
      <Btn variant="outline" onClick={onRetry}><RefreshCw className="size-3.5" /> Retry</Btn>
    </div>
  );
}

export function OverviewTab({ overview, invoices, expenses }: { overview: any; invoices: any[] | null; expenses: any[] | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Invoiced" value={formatBDT(overview?.totalInvoiced)} sub="incl. pass-through" tone="primary" icon={<Wallet className="size-5" />} />
        <StatCard label="Recognized Revenue" value={formatBDT(overview?.recognizedRevenue)} sub="agency revenue only" tone="sky" icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="Collected" value={formatBDT(overview?.collected)} sub={`${overview?.billableShare ?? 0}% billable`} tone="emerald" icon={<HandCoins className="size-5" />} />
        <StatCard label="Outstanding" value={formatBDT(overview?.outstanding)} sub={`${formatBDT(overview?.overdueAmount)} overdue`} tone="amber" icon={<Banknote className="size-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell className="xl:col-span-2">
          <SectionTitle title="Revenue Trend" subtitle="Invoiced vs collected vs expenses" />
          <RevenueAreaChart data={(overview?.trend ?? []).map((t: any) => ({ ...t, month: String(t.month).slice(0, 3) }))} />
        </CardShell>
        <CardShell>
          <SectionTitle title="Payment Split" subtitle="collected by method" />
          <PaymentDonut data={overview?.paymentSplit ?? []} />
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {!invoices ? (
            <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
          ) : (
            <FadeIn>
              <TableShell footer={<><span className="text-[11.5px] text-muted-foreground">{(invoices ?? []).length} invoices · cash position {formatBDT(overview?.cashPosition)}</span><Btn variant="ghost" onClick={() => exportInvoicesCsv(invoices ?? [])}>Export CSV</Btn></>}>
                <table className="w-full">
                  <THead><Th>Invoice</Th><Th>Client</Th><Th>Type</Th><Th>Amount</Th><Th>Status</Th><Th>Due</Th></THead>
                  <tbody>
                    {(invoices ?? []).slice(0, 8).map((inv, i) => (
                      <Tr key={inv.id} index={i}>
                        <Td>
                          <p className="font-medium tabular-nums">{inv.invoiceNumber}</p>
                          <p className="text-[11px] text-muted-foreground">{label(inv.invoiceType)}</p>
                        </Td>
                        <Td className="text-muted-foreground">{inv.client.companyName}</Td>
                        <Td className="text-muted-foreground">{inv.project?.name ?? "—"}</Td>
                        <Td className="font-semibold tabular-nums">{formatBDT(invoiceTotals(inv).grand)}</Td>
                        <Td><StatusBadge status={inv.status} /></Td>
                        <Td className="text-muted-foreground">{formatDay(inv.dueDate)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </FadeIn>
          )}
        </div>

        <FadeIn delay={0.1}>
          <CardShell className="h-full">
            <h3 className="mb-4 text-[15px] font-heading font-semibold">Recent Expenses</h3>
            <div className="flex flex-col gap-3">
              {(expenses ?? []).slice(0, 7).map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">{e.description}</p>
                    <p className="text-[10.5px] text-muted-foreground">{label(e.category)} · {e.isClientBillable ? "billable" : "absorbed"} · {formatDay(e.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12.5px] font-bold tabular-nums">{formatBDT(e.amount)}</p>
                    <StatusBadge status={e.approvalStatus} />
                  </div>
                </div>
              ))}
              {!expenses?.length && <p className="text-[12px] text-muted-foreground">No expenses</p>}
            </div>
          </CardShell>
        </FadeIn>
      </div>
    </div>
  );
}

export function InvoicesTab({ invoices, error, refresh, clients, onView, onNew, onDuplicate, onDelete, initialClientId }: { invoices: any[] | null; error: string | null; refresh: () => void; clients: any[]; onView: (id: string) => void; onNew: () => void; onDuplicate: (id: string) => void; onDelete: (inv: any) => void; initialClientId?: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [range, setRange] = useState("all");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");

  useEffect(() => {
    if (initialClientId) setClientId(initialClientId);
  }, [initialClientId]);

  const inRange = (iso: string | null | undefined) => {
    if (range === "all" || !iso) return range === "all" ? true : !!iso;
    const d = new Date(String(iso).slice(0, 10));
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === "today") return d >= startOfDay;
    if (range === "this-week") {
      const dow = (startOfDay.getDay() + 6) % 7;
      const mon = new Date(startOfDay);
      mon.setDate(mon.getDate() - dow);
      return d >= mon;
    }
    if (range === "this-month") return d >= new Date(now.getFullYear(), now.getMonth(), 1);
    if (range === "this-quarter") return d >= new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    if (range === "this-year") return d >= new Date(now.getFullYear(), 0, 1);
    return true;
  };

  const list = useMemo(() => {
    const items = invoices ?? [];
    const ql = q.trim().toLowerCase();
    const lo = minAmt === "" ? null : Number(minAmt);
    const hi = maxAmt === "" ? null : Number(maxAmt);
    return items.filter((inv) => {
      if (ql && !inv.invoiceNumber.toLowerCase().includes(ql) && !inv.client.companyName.toLowerCase().includes(ql)) return false;
      if (status && inv.status !== status) return false;
      if (clientId && inv.client.id !== clientId) return false;
      if (!inRange(inv.issueDate)) return false;
      const g = invoiceTotals(inv).grand;
      if (lo != null && g < lo) return false;
      if (hi != null && g > hi) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, q, status, clientId, range, minAmt, maxAmt]);

  const sums = useMemo(() => {
    let billed = 0, paid = 0, due = 0;
    for (const inv of list) {
      const t = invoiceTotals(inv);
      billed += t.grand;
      paid += t.paid;
      due += t.balance;
    }
    return { billed, paid, due };
  }, [list]);

  const filtered = q.trim() !== "" || status !== "" || clientId !== "" || range !== "all" || minAmt !== "" || maxAmt !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-40"><option value="">All statuses</option>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="!w-44"><option value="">All clients</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select>
        <Select value={range} onChange={(e) => setRange(e.target.value)} className="!w-36">
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="this-week">This week</option>
          <option value="this-month">This month</option>
          <option value="this-quarter">This quarter</option>
          <option value="this-year">This year</option>
        </Select>
        <input value={minAmt} onChange={(e) => setMinAmt(e.target.value)} type="number" min={0} placeholder="Min ৳" className="w-24 rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} type="number" min={0} placeholder="Max ৳" className="w-24 rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        <div className="ml-auto"><Btn variant="primary" onClick={onNew} data-testid="new-invoice-btn"><Plus className="size-3.5" /> New Invoice</Btn></div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-[11.5px] text-muted-foreground">
        <span>Filtered sum: <b className="tabular-nums text-foreground">{formatBDT(sums.billed)}</b></span>
        <span>Paid: <b className="tabular-nums text-emerald-500">{formatBDT(sums.paid)}</b></span>
        <span>Due: <b className="tabular-nums text-rose-500">{formatBDT(sums.due)}</b></span>
        {filtered && (
          <button onClick={() => { setQ(""); setStatus(""); setClientId(""); setRange("all"); setMinAmt(""); setMaxAmt(""); }} className="ml-auto text-[11.5px] font-bold text-primary hover:underline">
            Reset all filters
          </button>
        )}
      </div>

      {!invoices && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} invoices</span>}>
            <table className="w-full">
              <THead><Th>Invoice #</Th><Th>Client</Th><Th>Issue / Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th /></THead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No invoices match" hint="Adjust filters or create a new invoice." /></td></tr>
                )}
                {list.map((inv, i) => {
                  const t = invoiceTotals(inv);
                  const amount = t.grand;
                  const paidAmt = t.paid;
                  return (
                    <Tr key={inv.id} index={i} onClick={() => onView(inv.id)} className="cursor-pointer">
                      <Td>
                        <p className="font-medium tabular-nums">{inv.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-foreground">{label(inv.invoiceType ?? "INVOICE")}</p>
                      </Td>
                      <Td className="text-muted-foreground">{inv.client.companyName}</Td>
                      <Td>
                        <p className="text-[11.5px]">{formatDate(inv.issueDate)}</p>
                        <p className="text-[11px] text-muted-foreground">due {formatDate(inv.dueDate)}</p>
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">{formatBDT(amount)}</Td>
                      <Td className={cn("text-right tabular-nums", paidAmt > 0 ? "text-emerald-500" : "text-muted-foreground/60")}>{formatBDT(paidAmt)}</Td>
                      <Td className={cn("text-right font-medium tabular-nums", amount - paidAmt > 0 ? "text-amber-500" : "text-emerald-500")}>{formatBDT(amount - paidAmt)}</Td>
                      <Td><StatusBadge status={inv.status} /></Td>
                      <Td>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => onView(inv.id)} aria-label="View invoice" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50" title="View"><Eye className="size-4" /></button>
                          <button onClick={() => onDuplicate(inv.id)} aria-label="Duplicate invoice" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50" title="Duplicate"><Copy className="size-4" /></button>
                          <button onClick={() => onDelete(inv)} aria-label="Delete invoice" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-rose-500/10 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/50" title="Delete"><Trash2 className="size-4" /></button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
    </div>
  );
}

export function ExpensesTab({ expenses, error, refresh, notify, onRecord, onVendor, onDelete, categories, bankAccounts, accounts }: { expenses: any[] | null; error: string | null; refresh: () => void; notify: (m: string) => void; onRecord: () => void; onVendor: () => void; onDelete: (e: any) => void; categories: any[]; bankAccounts: any[]; accounts: any[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payExpense, setPayExpense] = useState<any | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<any | null>(null);

  const catOptions = categories ?? [];
  const list = useMemo(() => {
    const items = expenses ?? [];
    const ql = q.trim().toLowerCase();
    return items.filter((e) => {
      if (ql && !e.description.toLowerCase().includes(ql) && !(e.vendor?.name ?? "").toLowerCase().includes(ql)) return false;
      if (cat && e.category !== cat) return false;
      if (status && e.approvalStatus !== status) return false;
      return true;
    });
  }, [expenses, q, cat, status]);

  const setApproval = async (e: any, s: string) => {
    setBusyId(e.id);
    try {
      await apiFetch(`/capital/expenses/${e.id}`, { method: "PATCH", body: JSON.stringify({ approvalStatus: s }) });
      notify(`Expense ${label(s)}`);
      refresh();
    } catch (err2: any) {
      notify(err2.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const openPay = (e: any) => { setPayExpense(e); setPayOpen(true); };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search expenses…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-44"><option value="">All categories</option>{catOptions.map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-36"><option value="">All statuses</option>{EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="outline" onClick={onVendor}><UserPlus className="size-3.5" /> Add Vendor</Btn>
          <Btn variant="outline" onClick={() => setCatsOpen(true)}><Pencil className="size-3.5" /> Categories</Btn>
          <Btn variant="primary" onClick={onRecord} data-testid="record-expense-btn"><Plus className="size-3.5" /> Record Expense</Btn>
        </div>
      </div>

      {!expenses && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} expenses · pending approvals {list.filter((e) => e.approvalStatus === "PENDING").length} · payable {list.filter((e) => e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount)).length}</span>}>
            <table className="w-full">
              <THead><Th>Description</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th>Date</Th><Th className="hidden lg:table-cell">Method</Th><Th>Status</Th><Th className="hidden xl:table-cell">By</Th><Th><span className="sr-only">Actions</span></Th></THead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No expenses match" hint="Adjust filters or record a new expense." /></td></tr>
                )}
                {list.map((e, i) => {
                  const catName = catOptions.find((c: any) => c.key === e.category)?.name ?? label(e.category);
                  const owing = e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount);
                  return (
                    <Tr key={e.id} index={i}>
                      <Td className="max-w-64">
                        <p className="truncate font-medium">{e.description}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{e.vendor?.name ?? "no vendor"} {e.subcategory ? `· ${e.subcategory}` : ""} {e.isClientBillable && "· billable"} {e.client && `· ${e.client.companyName}`} {e.project && `· ${e.project.name}`}</p>
                      </Td>
                      <Td><span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold", CAT_TONES[e.category] ?? CAT_TONES.MISC)}>{catName}</span>{owing && <span className="ml-1.5 inline-flex whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500 ring-1 ring-amber-500/20">PAYABLE</span>}{e.payrollRecordId && <span className="ml-1.5 inline-flex whitespace-nowrap rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-500 ring-1 ring-sky-500/20">PAYROLL</span>}</Td>
                      <Td className="text-right font-semibold tabular-nums">{formatBDT(e.amount)}{e.currency && e.currency !== "BDT" && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{e.currency}</span>}</Td>
                      <Td className="whitespace-nowrap text-muted-foreground">{formatDate(e.date)}</Td>
                      <Td className="hidden capitalize text-muted-foreground lg:table-cell">{label(e.paymentMethod ?? "N/A")}</Td>
                      <Td><StatusBadge status={e.approvalStatus} /></Td>
                      <Td className="hidden xl:table-cell">
                        <p className="whitespace-nowrap text-[11.5px]">{e.submittedBy?.name ?? "—"}</p>
                        <p className="whitespace-nowrap text-[10.5px] text-muted-foreground">{e.approvalStatus === "APPROVED" ? (e.approvedBy?.name ? `by ${e.approvedBy.name}` : "approved") : e.approvalStatus === "REJECTED" ? "rejected" : "awaiting review"}</p>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-0.5">
                          {owing && <button onClick={() => openPay(e)} aria-label="Pay expense" className="rounded-lg p-2 text-amber-500 transition-colors outline-none hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-500/50" title="Pay expense"><HandCoins className="size-4" /></button>}
                          {e.approvalStatus === "PENDING" && (
                            <>
                              <button onClick={() => setApproval(e, "APPROVED")} disabled={busyId === e.id} aria-label="Approve expense" className="rounded-lg p-2 text-emerald-500 transition-colors outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-50" title="Approve"><Check className="size-4" /></button>
                              <button onClick={() => setApproval(e, "REJECTED")} disabled={busyId === e.id} aria-label="Reject expense" className="rounded-lg p-2 text-rose-500 transition-colors outline-none hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/50 disabled:opacity-50" title="Reject"><X className="size-4" /></button>
                            </>
                          )}
                          <button onClick={() => setEditExpense(e)} aria-label="Edit expense" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50" title="Edit"><Pencil className="size-4" /></button>
                          <button onClick={() => onDelete(e)} aria-label="Delete expense" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-rose-500/10 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/50" title="Delete"><Trash2 className="size-4" /></button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <PayExpenseModal expense={payExpense} open={payOpen} bankAccounts={bankAccounts} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); notify("Payment recorded"); refresh(); }} />
      <EditExpenseModal expense={editExpense} onClose={() => setEditExpense(null)} onSaved={() => { setEditExpense(null); notify("Expense updated"); refresh(); }} categories={categories} />
      <CategoriesModal open={catsOpen} categories={categories} accounts={accounts} onClose={() => setCatsOpen(false)} onSaved={() => { notify("Category saved"); refresh(); }} />
    </div>
  );
}

export function IncomeTab({ income, error, refresh, stats, bankAccounts }: { income: any[] | null; error: string | null; refresh: () => void; stats: any; bankAccounts: any[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const byMethod = stats?.byMethod ?? [];
  const byMethodTotal = byMethod.reduce((s: number, m: any) => s + Number(m.amount ?? 0), 0);
  const bySource = stats?.bySource ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Income" value={formatBDT(stats?.total)} sub="all-time collections" tone="emerald" icon={<HandCoins className="size-5" />} />
          <StatCard label="Payments" value={stats?.count ?? "—"} sub="transactions recorded" tone="sky" icon={<ReceiptText className="size-5" />} />
          <StatCard label="Avg Payment" value={formatBDT(stats?.avgAmount)} sub="per transaction" tone="primary" icon={<Banknote className="size-5" />} />
          <StatCard label="Top Method" value={byMethod.length ? label(byMethod[0].method) : "—"} sub={`${byMethod.length ? formatBDT(byMethod[0].amount) : "৳0"} · ${byMethodTotal ? Math.round((byMethod[0].amount / byMethodTotal) * 100) : 0}% of collections`} tone="amber" icon={<Landmark className="size-5" />} />
        </div>
        <Btn variant="primary" onClick={() => setAddOpen(true)} data-testid="record-income-btn"><Plus className="size-3.5" /> Record Income</Btn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {byMethod.length > 1 && (
          <CardShell>
            <SectionTitle title="By Method" subtitle="collected income by payment channel" />
            <PaymentDonut data={byMethod} />
          </CardShell>
        )}
        {bySource.length > 0 && (
          <CardShell>
            <SectionTitle title="By Source" subtitle="invoice payments vs manual income" />
            <div className="flex flex-col gap-3">
              {bySource.map((s: any) => (
                <div key={s.source} className="flex items-center gap-2.5">
                  <span className="w-28 shrink-0 text-[12px] capitalize text-muted-foreground">{label(s.source)}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(s.amount ?? 0) / Math.max(bySource.reduce((a: number, b: any) => a + Number(b.amount ?? 0), 0), 1)) * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[12px] font-bold tabular-nums">{formatBDT(s.amount)}</span>
                </div>
              ))}
            </div>
          </CardShell>
        )}
      </div>

      {!income && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{income?.length ?? 0} income entries</span>}>
            <table className="w-full">
              <THead><Th>Date</Th><Th>Client</Th><Th>Project</Th><Th>Invoice</Th><Th>Method</Th><Th>Source</Th><Th className="text-right">Amount</Th><Th>Recorded by</Th></THead>
              <tbody>
                {income?.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No income recorded" hint="Collections will appear here as invoices are paid." /></td></tr>
                )}
                {(income ?? []).map((it, i) => {
                  const isManual = it.source === "MANUAL" || it.source === "manual";
                  return (
                    <Tr key={it.id} index={i}>
                      <Td className="text-muted-foreground">{formatDate(it.date ?? it.paymentDate)}</Td>
                      <Td className="font-medium">{it.client ?? it.invoice?.client?.companyName ?? "—"}</Td>
                      <Td className="text-muted-foreground">{it.project ?? it.invoice?.project?.name ?? "—"}</Td>
                      <Td className="tabular-nums text-muted-foreground">
                        {it.invoice?.id ? (
                          <Link href={`/capital/invoices?inv=${it.invoice.id}`} className="font-medium text-primary hover:underline">
                            {it.invoice.invoiceNumber}
                          </Link>
                        ) : (
                          it.invoice?.invoiceNumber ?? (isManual ? "—" : it.description ?? "—")
                        )}
                      </Td>
                      <Td className="text-muted-foreground">{label(it.method ?? it.paymentMethod)}</Td>
                      <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", isManual ? "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20" : "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20")}>{isManual ? "MANUAL" : "INVOICE"}</span></Td>
                      <Td className="text-right font-semibold tabular-nums text-emerald-500">{formatBDT(it.amount)}{it.currency && it.currency !== "BDT" && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{it.currency}</span>}</Td>
                      <Td className="text-muted-foreground">{it.recordedBy?.name ?? it.recordedBy ?? "system"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <AddIncomeModal open={addOpen} bankAccounts={bankAccounts} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); refresh(); }} />
    </div>
  );
}

export function ReportsTab({ reports, aging, forecast, statements, apAging, budgets, projects, bankAccounts, categories, onRunRecurring, running, refresh, notify }: { reports: any; aging: any; forecast: any; statements: any; apAging: any; budgets: any[]; projects: any[]; bankAccounts: any[]; categories: any[]; onRunRecurring: () => void; running: boolean; refresh: () => void; notify: (m: string) => void }) {
  const km = reports?.keyMetrics ?? {};
  const byCategory = reports?.byCategory ?? [];
  const byMethod = reports?.byMethod ?? [];
  const cashFlow = reports?.cashFlow ?? [];
  const budget = reports?.budgetOverview ?? [];
  const tax = reports?.taxReport ?? {};
  const maxCat = Math.max(...byCategory.map((c: any) => Number(c.amount ?? 0)), 1);
  const maxFlow = Math.max(...cashFlow.map((w: any) => Math.max(Number(w.income ?? 0), Number(w.outflow ?? 0))), 1);
  const agingBuckets = aging?.buckets ?? {};
  const agingClients = aging?.byClient ?? [];
  const maxAging = Math.max(...agingClients.map((c: any) => Number(c.total ?? 0)), 1);
  const forecastBuckets = forecast?.buckets ?? [];
  const maxForecast = Math.max(...forecastBuckets.map((b: any) => Math.max(Number(b.inflow ?? 0), Number(b.outflow ?? 0))), 1);
  const AGING_KEYS = [
    { key: "CURRENT", label: "Current" },
    { key: "1-30", label: "1–30d" },
    { key: "31-60", label: "31–60d" },
    { key: "61-90", label: "61–90d" },
    { key: "90+", label: "90d+" },
  ];
  const clientCell = (c: any, key: string) => (c[key] ? formatBDT(c[key]) : "—");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<any | null>(null);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [reconAccount, setReconAccount] = useState(bankAccounts[0]?.id ?? "");
  const [reconData, setReconData] = useState<any | null>(null);
  const [reconErr, setReconErr] = useState<string | null>(null);
  const [reconOpen, setReconOpen] = useState(false);
  const [reconBusy, setReconBusy] = useState(false);

  useEffect(() => {
    if (!reconAccount) return;
    let cancelled = false;
    apiFetch<any>(`/capital/reconciliation?bankAccountId=${reconAccount}`)
      .then((d) => !cancelled && setReconData(d))
      .catch((e) => !cancelled && setReconErr(e.message));
    return () => { cancelled = true; };
  }, [reconAccount, budgets, apAging]);

  const deleteBudget = async (id: string) => {
    setBudgetBusy(true);
    try {
      await apiFetch(`/capital/budgets/${id}`, { method: "DELETE" });
      setBudgetOpen(false);
      setBudgetEdit(null);
      notify("Budget deleted");
      refresh();
    } catch (e: any) {
      setReconErr(e.message ?? "Delete failed");
    } finally {
      setBudgetBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Avg Invoice Value" value={formatBDT(km.avgInvoiceValue)} sub="per invoice" tone="primary" icon={<ReceiptText className="size-5" />} />
        <StatCard label="Profit Margin" value={km.profitMargin != null ? `${Math.round(km.profitMargin)}%` : "—"} sub="recognized revenue basis" tone="sky" icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="Collection Rate" value={km.collectionRate != null ? `${Math.round(km.collectionRate)}%` : "—"} sub="collected vs invoiced" tone="emerald" icon={<HandCoins className="size-5" />} />
        <StatCard label="Tax Year" value={tax.fiscalYear ?? "—"} sub={`rate ${tax.taxRate ?? 22}%`} tone="amber" icon={<Landmark className="size-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell className="xl:col-span-2">
          <SectionTitle title="8-Month Trend" subtitle="invoiced vs collected vs expenses" />
          <RevenueAreaChart data={(reports?.trend8 ?? []).map((t: any) => ({ ...t, month: String(t.month).slice(0, 3) }))} />
        </CardShell>
        <CardShell>
          <SectionTitle title="By Method" subtitle="collections split" />
          <PaymentDonut data={byMethod} />
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell>
          <SectionTitle title="Invoiced by Type" subtitle="one-time vs recurring vs advance" />
          <div className="flex flex-col gap-3">
            {byCategory.length === 0 && <p className="text-[12px] text-muted-foreground">No expense data</p>}
            {byCategory.map((c: any) => (
              <div key={c.name} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 truncate text-[12px] capitalize text-muted-foreground">{label(c.name)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(c.amount ?? 0) / maxCat) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-[12px] font-bold tabular-nums">{formatBDT(c.amount)}</span>
              </div>
            ))}
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Weekly Cash Flow" subtitle="income vs outflow" />
          <div className="flex flex-col gap-2.5">
            {cashFlow.length === 0 && <p className="text-[12px] text-muted-foreground">No cash flow data</p>}
            {cashFlow.map((w: any) => {
              const empty = !Number(w.income ?? 0) && !Number(w.outflow ?? 0);
              return (
                <div key={w.week} className={cn("grid grid-cols-[64px_1fr_1fr] items-center gap-2 text-[11px]", empty && "opacity-40")}>
                  <span className="truncate text-muted-foreground">{w.week}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 rounded-full bg-emerald-500/80" style={{ width: `${(Number(w.income ?? 0) / maxFlow) * 100}%` }} />
                    <span className="text-[10.5px] tabular-nums text-emerald-500">{formatBDT(w.income)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 rounded-full bg-rose-500/80" style={{ width: `${(Number(w.outflow ?? 0) / maxFlow) * 100}%` }} />
                    <span className="text-[10.5px] tabular-nums text-rose-500">{formatBDT(w.outflow)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Budget Overview" subtitle="planned vs actual" />
          <TableShell>
            <table className="w-full">
              <THead><Th>Bucket</Th><Th className="text-right">Planned</Th><Th className="text-right">Actual</Th><Th className="text-right">Var.</Th></THead>
              <tbody>
                {budget.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No budget data" /></td></tr>
                )}
                {budget.map((b: any, i: number) => {
                  const diff = Number(b.actual ?? 0) - Number(b.planned ?? 0);
                  return (
                    <Tr key={b.name} index={i}>
                      <Td className="text-[12px] font-medium">{label(b.name)}</Td>
                      <Td className="text-right text-[12px] tabular-nums text-muted-foreground">{formatBDT(b.planned)}</Td>
                      <Td className="text-right text-[12px] tabular-nums">{formatBDT(b.actual)}</Td>
                      <Td className={cn("text-right text-[12px] font-semibold tabular-nums", diff > 0 ? "text-rose-500" : "text-emerald-500")}>{diff > 0 ? "+" : ""}{formatBDT(diff)}</Td>
                    </Tr>
                  );
                })}
            </tbody>
          </table>
          </TableShell>
        </CardShell>
      </div>

      <CardShell>
        <SectionTitle title="Tax Report" subtitle={`estimated tax at ${tax.taxRate ?? 22}% · fiscal year ${tax.fiscalYear ?? "—"}`} />
        <TableShell>
          <table className="w-full">
            <THead><Th>Period</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Collected</Th><Th className="text-right">Expenses</Th><Th className="text-right">Net</Th><Th className="text-right">Est. Tax</Th></THead>
            <tbody>
              {(tax.rows ?? []).map((r: any, i: number) => (
                <Tr key={r.label} index={i}>
                  <Td className="font-medium">{r.label}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.invoiced)}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.collected)}</Td>
                  <Td className="text-right tabular-nums">{formatBDT(r.expenses)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatBDT(r.net)}</Td>
                  <Td className="text-right tabular-nums text-amber-500">{formatBDT(r.estimatedTax)}</Td>
                </Tr>
              ))}
              {tax.totals && (
                <tr className="border-t border-border/60 bg-muted/40">
                  <Td className="font-bold">Totals</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.invoiced)}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.collected)}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.expenses)}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatBDT(tax.totals.net)}</Td>
                  <Td className="text-right font-bold tabular-nums text-amber-500">{formatBDT(tax.totals.estimatedTax)}</Td>
                </tr>
              )}
            </tbody>
          </table>
        </TableShell>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="Accounts Receivable Aging" subtitle={`${formatBDT(aging?.totalOutstanding ?? 0)} outstanding as of today`} />
        <Btn variant="outline" onClick={onRunRecurring} className={running ? "opacity-60" : ""}><RefreshCw className="size-3.5" /> {running ? "Running…" : "Run recurring billing"}</Btn>
      </div>
      <CardShell>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_KEYS.map((b) => (
            <div key={b.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("mt-0.5 text-[15px] font-heading font-bold tabular-nums", b.key === "90+" && Number(agingBuckets[b.key] ?? 0) > 0 ? "text-rose-500" : b.key === "CURRENT" ? "" : "text-amber-500")}>{formatBDT(agingBuckets[b.key] ?? 0)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <TableShell>
            <table className="w-full">
            <THead><Th>Client</Th><Th className="text-right">Total</Th><Th className="text-right">Current</Th><Th className="text-right">1–30d</Th><Th className="text-right">31–60d</Th><Th className="text-right">61–90d</Th><Th className="text-right">90d+</Th><Th className="w-40">Concentration</Th></THead>
            <tbody>
              {agingClients.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-8"><EmptyState title="No outstanding invoices" hint="Everything is collected." /></td></tr>
              )}
              {agingClients.map((c: any, i: number) => (
                <Tr key={c.clientId} index={i}>
                  <Td className="font-medium">{c.clientName}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatBDT(c.total)}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "current")}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "d30")}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "d60")}</Td>
                  <Td className="text-right tabular-nums">{clientCell(c, "d90")}</Td>
                  <Td className="text-right tabular-nums text-rose-500">{clientCell(c, "d90p")}</Td>
                  <Td>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(c.total ?? 0) / maxAging) * 100}%` }} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        </div>
      </CardShell>

      <CardShell>
        <SectionTitle title="90-Day Cash Flow Forecast" subtitle={`cash position ${formatBDT(forecast?.cashPosition ?? 0)} · projected inflow ${formatBDT(forecast?.totalInflow ?? 0)} vs outflow ${formatBDT(forecast?.totalOutflow ?? 0)}`} />
        <div className="flex flex-col gap-3">
          {forecastBuckets.length === 0 && <p className="text-[12px] text-muted-foreground">Nothing scheduled in the next 90 days.</p>}
          {forecastBuckets.map((b: any) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11.5px] font-semibold">{b.label}</span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 rounded-full bg-emerald-500/80" style={{ width: `${(Number(b.inflow ?? 0) / maxForecast) * 100}%` }} />
                  <span className="text-[10.5px] tabular-nums text-emerald-500">{formatBDT(b.inflow)} in</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 rounded-full bg-rose-500/80" style={{ width: `${(Number(b.outflow ?? 0) / maxForecast) * 100}%` }} />
                  <span className="text-[10.5px] tabular-nums text-rose-500">{formatBDT(b.outflow)} out</span>
                </div>
              </div>
              <span className={cn("w-24 shrink-0 text-right text-[11.5px] font-bold tabular-nums", b.net >= 0 ? "text-emerald-500" : "text-rose-500")}>{b.net >= 0 ? "+" : ""}{formatBDT(b.net)}</span>
            </div>
          ))}
        </div>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="GL Statements" subtitle="double-entry ledger · all figures in BDT" />
        {statements?.trialBalance && <p className={cn("text-[11.5px] font-bold", Number(statements.trialBalance.totalDebit) === Number(statements.trialBalance.totalCredit) ? "text-emerald-500" : "text-rose-500")}>Balanced: {formatBDT(statements.trialBalance.totalDebit)} = {formatBDT(statements.trialBalance.totalCredit)}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell>
          <SectionTitle title="Trial Balance" subtitle="all ledger accounts" />
          <TableShell>
            <table className="w-full">
              <THead><Th>Account</Th><Th>Code</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></THead>
              <tbody>
                {(statements?.trialBalance?.rows ?? []).length === 0 && <tr><td colSpan={5} className="px-5 py-6"><EmptyState title="No ledger entries" /></td></tr>}
                {(statements?.trialBalance?.rows ?? []).map((r: any, i: number) => (
                  <Tr key={r.accountId} index={i}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="tabular-nums text-muted-foreground">{r.code}</Td>
                    <Td className="text-right tabular-nums">{r.debit ? formatBDT(r.debit) : "—"}</Td>
                    <Td className="text-right tabular-nums">{r.credit ? formatBDT(r.credit) : "—"}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", Number(r.balance) < 0 ? "text-rose-500" : "")}>{formatBDT(r.balance)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </CardShell>

        <CardShell>
          <SectionTitle title="Balance Sheet" subtitle={`assets ${formatBDT(statements?.balanceSheet?.totalAssets ?? 0)} · equity & liabilities ${formatBDT(statements?.balanceSheet?.totalEquityAndLiabilities ?? 0)}`} />
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Assets</p>
              {(statements?.balanceSheet?.assets ?? []).map((a: any) => (
                <div key={a.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{a.name} <span className="text-[10px] text-muted-foreground">({a.code})</span></span><span className="font-semibold tabular-nums">{formatBDT(a.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Liabilities</p>
              {(statements?.balanceSheet?.liabilities ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">None</p>}
              {(statements?.balanceSheet?.liabilities ?? []).map((a: any) => (
                <div key={a.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{a.name} <span className="text-[10px] text-muted-foreground">({a.code})</span></span><span className="font-semibold tabular-nums">{formatBDT(a.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Equity (balancing figure)</p>
              <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]">
                <span>Retained earnings + current profit</span>
                <span className="font-semibold tabular-nums">{formatBDT(statements?.balanceSheet?.equity ?? 0)}</span>
              </div>
            </div>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Profit & Loss" subtitle="accrual basis · period to date" />
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Revenue</p>
              {(statements?.profitLoss?.revenue ?? []).map((r: any) => (
                <div key={r.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{r.name} <span className="text-[10px] text-muted-foreground">({r.code})</span></span><span className="font-semibold tabular-nums text-emerald-500">{formatBDT(r.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
              {(statements?.profitLoss?.expenses ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">None</p>}
              {(statements?.profitLoss?.expenses ?? []).map((r: any) => (
                <div key={r.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[12px]"><span>{r.name} <span className="text-[10px] text-muted-foreground">({r.code})</span></span><span className="font-semibold tabular-nums text-rose-500">{formatBDT(r.amount)}</span></div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
              <span className="text-[11.5px] font-bold">Net Profit</span>
              <span className={cn("text-[13px] font-bold tabular-nums", Number(statements?.profitLoss?.netIncome ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(statements?.profitLoss?.netIncome ?? 0)}</span>
            </div>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Cash Flow" subtitle={`net ${formatBDT(statements?.cashFlow?.netOperating ?? 0)} operating · closing ${formatBDT(statements?.cashFlow?.closingBalance ?? 0)}`} />
          <TableShell>
            <table className="w-full">
              <THead><Th>Detail</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right">Net</Th></THead>
              <tbody>
                {(statements?.cashFlow?.detail ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No transactions" /></td></tr>}
                {(statements?.cashFlow?.detail ?? []).map((d: any, i: number) => (
                  <Tr key={i} index={i}>
                    <Td className="font-medium">{d.label}</Td>
                    <Td className="text-right tabular-nums text-emerald-500">{d.in ? formatBDT(d.in) : "—"}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{d.out ? formatBDT(d.out) : "—"}</Td>
                    <Td className="text-right font-semibold tabular-nums">{d.net >= 0 ? "+" : ""}{formatBDT(d.net)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </CardShell>
      </div>

      <CardShell>
        <SectionTitle title="Accounts Payable Aging" subtitle={`${formatBDT(apAging?.totalPayable ?? 0)} payable to vendors as of today`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_KEYS.map((b) => (
            <div key={b.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("mt-0.5 text-[15px] font-heading font-bold tabular-nums", b.key === "90+" && Number(apAging?.buckets?.[b.key] ?? 0) > 0 ? "text-rose-500" : b.key === "CURRENT" ? "" : "text-amber-500")}>{formatBDT(apAging?.buckets?.[b.key] ?? 0)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <TableShell>
            <table className="w-full">
              <THead><Th>Vendor</Th><Th className="text-right">Total</Th><Th className="text-right">Current</Th><Th className="text-right">1–30d</Th><Th className="text-right">31–60d</Th><Th className="text-right">61–90d</Th><Th className="text-right">90d+</Th></THead>
              <tbody>
                {(apAging?.byVendor ?? []).length === 0 && <tr><td colSpan={7} className="px-5 py-8"><EmptyState title="Nothing payable" hint="No unpaid vendor bills." /></td></tr>}
                {(apAging?.byVendor ?? []).map((c: any, i: number) => (
                  <Tr key={c.vendorId} index={i}>
                    <Td className="font-medium">{c.vendorName}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatBDT(c.total)}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "current")}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "d30")}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "d60")}</Td>
                    <Td className="text-right tabular-nums">{clientCell(c, "d90")}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{clientCell(c, "d90p")}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="Budget Plans" subtitle={`${budgets?.length ?? 0} budgets set`} />
        <Btn variant="outline" onClick={() => { setBudgetEdit(null); setBudgetOpen(true); }}><Plus className="size-3.5" /> New Budget</Btn>
      </div>
      <CardShell>
        <TableShell>
          <table className="w-full">
            <THead><Th>Scope</Th><Th>Target</Th><Th className="text-right">Budget</Th><Th className="text-right">Spent</Th><Th className="text-right">Remaining</Th><Th>Period</Th><Th /></THead>
            <tbody>
              {(budgets ?? []).length === 0 && <tr><td colSpan={7} className="px-5 py-8"><EmptyState title="No budgets yet" hint="Create budgets to track spend vs plan." /></td></tr>}
              {(budgets ?? []).map((b: any, i: number) => {
                const spent = Number(b.spent ?? 0);
                const remaining = Number(b.budgetAmount) - spent;
                return (
                  <Tr key={b.id} index={i}>
                    <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", b.scopeType === "PROJECT" ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20")}>{label(b.scopeType)}</span></Td>
                    <Td className="font-medium">{b.project?.name ?? label(b.category ?? "—")}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatBDT(b.budgetAmount)}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{formatBDT(spent)}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", remaining < 0 ? "text-rose-500" : "text-emerald-500")}>{formatBDT(remaining)}</Td>
                    <Td className="text-[11px] text-muted-foreground">{b.periodStart ? `${formatDate(b.periodStart)} → ${b.periodEnd ? formatDate(b.periodEnd) : "open"}` : "All time"}</Td>
                    <Td>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => { setBudgetEdit(b); setBudgetOpen(true); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button>
                        <button onClick={() => deleteBudget(b.id)} disabled={budgetBusy} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50" title="Delete"><Trash2 className="size-3.5" /></button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </CardShell>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle title="Bank Reconciliation" subtitle="match ledger to bank statement" />
        <div className="flex items-center gap-2">
          <Select value={reconAccount} onChange={(e) => setReconAccount(e.target.value)} className="!w-48">{(bankAccounts ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.accountName}</option>)}</Select>
          <Btn variant="primary" onClick={() => setReconOpen(true)}><Plus className="size-3.5" /> Add Entry</Btn>
        </div>
      </div>
      <CardShell>
        {reconErr && <p className="mb-2 text-[12px] font-medium text-rose-400">{reconErr}</p>}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Ledger transactions</p>
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Ref</Th><Th>Kind</Th><Th className="text-right">Amount</Th></THead>
                <tbody>
                  {(reconData?.transactions ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No transactions" /></td></tr>}
                  {(reconData?.transactions ?? []).map((t: any, i: number) => (
                    <Tr key={t.id} index={i}>
                      <Td className="text-[11px] text-muted-foreground">{formatDate(t.date)}</Td>
                      <Td className="text-[11.5px]">{t.ref}</Td>
                      <Td className="text-[10.5px] text-muted-foreground">{label(t.kind)}</Td>
                      <Td className={cn("text-right text-[11.5px] font-semibold tabular-nums", t.amount >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(t.amount)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Statement records</p>
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th>Status</Th></THead>
                <tbody>
                  {(reconData?.records ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No statement entries" /></td></tr>}
                  {(reconData?.records ?? []).map((r: any, i: number) => (
                    <Tr key={r.id} index={i}>
                      <Td className="text-[11px] text-muted-foreground">{formatDate(r.statementDate)}</Td>
                      <Td className="text-[11.5px]">{r.statementReference ?? "—"}</Td>
                      <Td className="text-right text-[11.5px] font-semibold tabular-nums">{formatBDT(r.statementAmount)}</Td>
                      <Td><StatusBadge status={r.matchStatus} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
        </div>
      </CardShell>
      <BudgetModal open={budgetOpen} onClose={() => { setBudgetOpen(false); setBudgetEdit(null); }} onSaved={() => { setBudgetOpen(false); setBudgetEdit(null); notify("Budget saved"); refresh(); }} editing={budgetEdit} projects={projects} categories={categories} />
      <ReconcileModal open={reconOpen} bankAccounts={bankAccounts} txns={reconData?.transactions ?? []} onClose={() => setReconOpen(false)} onSaved={() => { setReconOpen(false); setReconErr(null); notify("Statement entry saved"); refresh(); }} />
    </div>
  );
}

export function ProfitabilityTab({ data }: { data: any }) {
  const monthly = data?.monthly ?? [];
  const summary = data?.summary ?? {};
  const maxProfit = Math.max(...monthly.map((m: any) => Math.max(Math.abs(Number(m.profit ?? 0)), 1)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Revenue" value={formatBDT(summary.totalRevenue)} sub="recognized" tone="sky" icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="Total Expenses" value={formatBDT(summary.totalExpenses)} sub="incl. pass-through" tone="rose" icon={<Banknote className="size-5" />} />
        <StatCard label="Net Profit" value={formatBDT(summary.netProfit)} sub={summary.margin != null ? `${Math.round(summary.margin)}% margin` : "—"} tone="emerald" icon={<HandCoins className="size-5" />} />
        <StatCard label="Avg Monthly Profit" value={formatBDT(monthly.length ? Number(summary.totalProfit ?? 0) / monthly.length : 0)} sub={`${monthly.length} months tracked`} tone="primary" icon={<Wallet className="size-5" />} />
      </div>

      {!data ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : (
        <FadeIn>
          <CardShell>
            <SectionTitle title="Monthly Profitability" subtitle="revenue vs expenses per month" />
            <TableShell>
              <table className="w-full">
                <THead><Th>Month</Th><Th className="text-right">Revenue</Th><Th className="text-right">Expenses</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th><Th className="w-40">Profit vs peak</Th></THead>
                <tbody>
                  {monthly.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10"><EmptyState title="No profitability data" hint="Data appears once invoices and expenses are recorded." /></td></tr>
                  )}
                  {monthly.map((m: any, i: number) => (
                    <Tr key={m.month} index={i}>
                      <Td className="font-medium">{String(m.month).slice(0, 7)}</Td>
                      <Td className="text-right tabular-nums">{formatBDT(m.revenue)}</Td>
                      <Td className="text-right tabular-nums text-rose-500">{formatBDT(m.expenses)}</Td>
                      <Td className={cn("text-right font-semibold tabular-nums", m.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(m.profit)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{m.margin != null ? `${Math.round(m.margin)}%` : "—"}</Td>
                      <Td>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", m.profit >= 0 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${(Math.abs(Number(m.profit ?? 0)) / maxProfit) * 100}%` }} />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </CardShell>
          <CardShell>
            <SectionTitle title="Project Profitability" subtitle={`best: ${summary.bestProject ?? "—"}`} />
            <TableShell>
              <table className="w-full">
                <THead><Th>Project</Th><Th className="text-right">Budget</Th><Th className="text-right">Collected</Th><Th className="text-right">Revenue</Th><Th className="text-right">Cost</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th><Th className="text-right">Hours</Th></THead>
                <tbody>
                  {(data?.projects ?? []).length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No project data" /></td></tr>}
                  {(data?.projects ?? []).map((p: any, i: number) => (
                    <Tr key={p.id} index={i}>
                      <Td className="font-medium">{p.name}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{formatBDT(p.budget)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{formatBDT(p.collected)}</Td>
                      <Td className="text-right tabular-nums">{formatBDT(p.revenue)}</Td>
                      <Td className="text-right tabular-nums text-rose-500">{formatBDT(p.cost)}</Td>
                      <Td className={cn("text-right font-semibold tabular-nums", p.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(p.profit)}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{p.margin != null ? `${Math.round(p.margin)}%` : "—"}</Td>
                      <Td className="text-right tabular-nums text-muted-foreground">{p.hoursLogged ?? 0}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </CardShell>
        </FadeIn>
      )}
    </div>
  );
}

export function AccountsTab({ accounts, balances, onEdit, onAdd, onDelete, onSaved }: { accounts: any[]; balances: any[]; onEdit: (a: any) => void; onAdd: () => void; onDelete: (a: any) => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (ql && !a.name.toLowerCase().includes(ql) && !(a.code ?? "").toLowerCase().includes(ql)) return false;
      if (cat && a.category !== cat) return false;
      return true;
    });
  }, [accounts, q, cat]);
  const balanceOf = (id: string) => balances.find((b: any) => b.accountId === id)?.balance ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-40"><option value="">All categories</option>{ACCOUNT_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={onAdd}><Plus className="size-3.5" /> Add Account</Btn>
        </div>
      </div>

      <FadeIn>
        <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} accounts · {list.filter((a) => a.isActive).length} active</span>}>
          <table className="w-full">
            <THead><Th>Code</Th><Th>Name</Th><Th>Category</Th><Th className="text-right">Ledger balance</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10"><EmptyState title="No accounts match" hint="Adjust filters or add a new account." /></td></tr>
              )}
              {list.map((a, i) => (
                <Tr key={a.id} index={i}>
                  <Td className="font-mono text-[12px] tabular-nums text-muted-foreground">{a.code ?? "—"}</Td>
                  <Td className="font-medium">{a.name}</Td>
                  <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold", a.category === "ASSET" ? "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20" : a.category === "LIABILITY" ? "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20" : a.category === "REVENUE" ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20")}>{label(a.category)}</span></Td>
                  <Td className={cn("text-right font-semibold tabular-nums", balanceOf(a.id) < 0 ? "text-rose-500" : "")}>{formatBDT(balanceOf(a.id))}</Td>
                  <Td><StatusBadge status={a.isActive ? "Active" : "Inactive"} /></Td>
                  <Td>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => onEdit(a)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button>
                      {a.isActive && <button onClick={() => onDelete(a)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Deactivate"><Trash2 className="size-3.5" /></button>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </FadeIn>
    </div>
  );
}

export function VendorsTab({ vendors, expenses, onEdit, onAdd, onDelete, onSaved }: { vendors: any[]; expenses: any[]; onEdit: (v: any) => void; onAdd: () => void; onDelete: (v: any) => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return vendors.filter((v) => !ql || v.name.toLowerCase().includes(ql) || (v.email ?? "").toLowerCase().includes(ql));
  }, [vendors, q]);
  const expByVendor = useMemo(() => {
    const m = new Map<string, { count: number; paid: number; payable: number }>();
    for (const e of expenses) {
      if (!e.vendorId) continue;
      const entry = m.get(e.vendorId) ?? { count: 0, paid: 0, payable: 0 };
      entry.count += 1;
      if (e.isPayable) entry.payable += Number(e.amount) - Number(e.paidAmount ?? 0);
      m.set(e.vendorId, entry);
    }
    return m;
  }, [expenses]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={onAdd} data-testid="add-vendor-btn"><UserPlus className="size-3.5" /> Add Vendor</Btn>
        </div>
      </div>

      <FadeIn>
        <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{list.length} vendors · {list.filter((v) => v.isActive).length} active</span>}>
          <table className="w-full">
            <THead><Th>Name</Th><Th>Contact</Th><Th>Payment terms</Th><Th className="text-right">Expenses</Th><Th className="text-right">Payable</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10"><EmptyState title="No vendors" hint="Add vendors to track accounts payable." /></td></tr>
              )}
              {list.map((v, i) => {
                const stat = expByVendor.get(v.id);
                return (
                  <Tr key={v.id} index={i}>
                    <Td className="font-medium">{v.name}</Td>
                    <Td className="text-[11.5px] text-muted-foreground">{v.email ? <p>{v.email}</p> : null}{v.phone ? <p>{v.phone}</p> : null}{!v.email && !v.phone ? "—" : null}</Td>
                    <Td className="text-[11.5px] text-muted-foreground">{v.paymentTerms ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{stat?.count ?? 0}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", (stat?.payable ?? 0) > 0 ? "text-amber-500" : "text-muted-foreground")}>{formatBDT(stat?.payable ?? 0)}</Td>
                    <Td><StatusBadge status={v.isActive ? "Active" : "Inactive"} /></Td>
                    <Td>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => onEdit(v)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil className="size-3.5" /></button>
                        <button onClick={() => onDelete(v)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="Delete"><Trash2 className="size-3.5" /></button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </FadeIn>
    </div>
  );
}

export function ActivityTab({ activity, refresh }: { activity: any[] | null; refresh: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {!activity ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : (
        <FadeIn>
          <CardShell>
            <SectionTitle title="Activity Log" subtitle="all finance mutations, newest first" action={<Btn variant="ghost" onClick={refresh}><RefreshCw className="size-3.5" /> Refresh</Btn>} />
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" hint="Invoice, payment and expense changes will show up here." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <span className={cn("mt-1 size-2 shrink-0 rounded-full", a.entityType === "PAYMENT" ? "bg-emerald-500" : a.entityType === "EXPENSE" ? "bg-amber-400" : a.entityType === "INVOICE" ? "bg-primary" : "bg-sky-400")} />
                    <div className="min-w-0 flex-1 rounded-xl border border-border/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", ENTITY_TONES[a.entityType] ?? "bg-muted text-muted-foreground")}>{label(a.entityType)}</span>
                        <p className="text-[12.5px] font-medium">{a.action}</p>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(a.timestamp)} · {a.performedBy?.name ?? "system"}</span>
                      </div>
                      {(a.beforeValue != null || a.afterValue != null) && (
                        <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground/80">{fmtJSON(a.beforeValue)} → {fmtJSON(a.afterValue)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </FadeIn>
      )}
    </div>
  );
}

