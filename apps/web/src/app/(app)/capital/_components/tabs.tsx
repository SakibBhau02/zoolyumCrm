"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlarmClock, ArrowUpRight, Banknote, Building2, CalendarClock, CalendarDays, Check, CircleDollarSign, Clock, Copy, Download, ExternalLink, Eye, FileDown, FileText, FolderKanban, HandCoins, Landmark, Link2, Mail, Paperclip, Pencil, Phone, Plus, ReceiptText, RefreshCw, Search, ShieldCheck, Trash2, UserPlus, Wallet, X } from "lucide-react";
import { API_URL, apiFetch, apiFetchFormData } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatBDT, formatDate, formatDay, timeAgo } from "@/lib/format";
import { Avatar, CardShell, EmptyState, FadeIn, SectionTitle, SkeletonBlock, StatCard, StatusBadge, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Modal, Select } from "@/components/ui";
import { PaymentDonut, RevenueAreaChart } from "@/components/charts";
import { daysLate, invoiceTotals } from "@/lib/invoice-utils";
import { useBranding } from "@/lib/branding-context";
import { ACCOUNT_CATEGORIES, CAT_TONES, ENTITY_TONES, EXPENSE_STATUSES, INVOICE_STATUSES, exportInvoicesCsv, fmtJSON, label } from "./constants";
import { AddIncomeModal, BudgetModal, CategoriesModal, EditExpenseModal, PayExpenseModal, ReconcileModal } from "./modals";
import type { StatementType } from "@/lib/reports-pdf";
import { Pager, usePaged } from "./table-pager";
import { ApprovalPolicyModal } from "./approval-policy";

// jsPDF (~143 KB gz) is loaded on demand: someone reading the overview must not
// download a PDF engine. Every PDF helper below resolves its module at click time.
const downloadInvoicePdf = async (...args: any[]) => {
  const mod = await import("./invoice-download");
  return (mod.downloadInvoicePdf as any)(...args);
};

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <EmptyState title={message} hint="Could not load data" />
      <Btn variant="outline" onClick={onRetry}><RefreshCw className="size-3.5" /> Retry</Btn>
    </div>
  );
}

/** A titled block inside a record drawer. */
function DetailSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <header className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3.5 py-2">
        <h4 className="flex-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
        {action}
      </header>
      <div className="px-3.5 py-2.5">{children}</div>
    </section>
  );
}

/** Label / value line used across the capital detail drawers. */
function DetailRow({ label: k, children, mono, strong }: { label: string; children: React.ReactNode; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-meta text-muted-foreground">{k}</span>
      <span className={cn("min-w-0 text-right text-meta", strong ? "font-bold" : "font-medium", mono && "font-mono tabular-nums")}>{children}</span>
    </div>
  );
}

/** Big amount + status chips at the top of a detail drawer. */
function DetailHero({
  eyebrow,
  amount,
  tone = "primary",
  chips,
  caption,
}: {
  eyebrow: string;
  amount: React.ReactNode;
  tone?: "primary" | "emerald" | "amber" | "rose";
  chips?: React.ReactNode;
  caption?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    primary: "from-primary/12",
    emerald: "from-emerald-500/12",
    amber: "from-amber-500/12",
    rose: "from-rose-500/12",
  };
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-gradient-to-br to-transparent p-4", tones[tone])}>
      <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
      <p className="mt-0.5 text-page font-bold leading-tight tabular-nums">{amount}</p>
      {chips ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{chips}</div> : null}
      {caption ? <div className="mt-2 text-meta leading-relaxed text-muted-foreground">{caption}</div> : null}
    </div>
  );
}

export function OverviewTab({ overview, invoices, expenses, aging, installmentsDue }: { overview: any; invoices: any[] | null; expenses: any[] | null; aging?: any; installmentsDue?: any[] | null }) {
  const router = useRouter();
  const inv = invoices ?? [];
  const exp = expenses ?? [];

  // ── Decision inputs, derived once ─────────────────────────────────────
  const receivable = inv.filter((i) => !["DRAFT", "CANCELLED", "VOID"].includes(i.status));
  const overdueList = receivable.filter((i) => {
    const t = invoiceTotals(i);
    return t.balance > 0 && daysLate(i.dueDate) > 0;
  });
  const overdueValue = overdueList.reduce((s, i) => s + invoiceTotals(i).balanceBdt, 0);
  const drafts = inv.filter((i) => i.status === "DRAFT");
  const draftValue = drafts.reduce((s, i) => s + invoiceTotals(i).grandBdt, 0);
  const pendingExp = exp.filter((e) => e.approvalStatus === "PENDING");
  const pendingValue = pendingExp.reduce((s, e) => s + Number(e.amount ?? 0) * (Number(e.exchangeRate ?? 1) || 1), 0);
  const dueInstallments = (installmentsDue ?? []).filter((s) => s.overdue);
  const installmentValue = dueInstallments.reduce((s, s2) => s + Number(s2.balance ?? 0), 0);

  const collected = Number(overview?.collected ?? 0);
  const invoiced = Number(overview?.totalInvoiced ?? 0);
  const outstanding = Number(overview?.outstanding ?? 0);
  const collectionRate = invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0;
  const overduePct = outstanding > 0 ? Math.round((overdueValue / outstanding) * 100) : 0;

  const attention = [
    overdueList.length > 0 && {
      key: "overdue",
      tone: "rose" as const,
      icon: <AlarmClock className="size-4" />,
      title: `${overdueList.length} invoice${overdueList.length === 1 ? "" : "s"} overdue`,
      detail: `${formatBDT(overdueValue)} past due — chase these first`,
      href: "/capital/invoices?status=OVERDUE",
      cta: "Review",
    },
    dueInstallments.length > 0 && {
      key: "installments",
      tone: "amber" as const,
      icon: <CalendarClock className="size-4" />,
      title: `${dueInstallments.length} installment${dueInstallments.length === 1 ? "" : "s"} overdue`,
      detail: `${formatBDT(installmentValue)} across payment plans`,
      href: "/capital/invoices",
      cta: "Open plans",
    },
    pendingExp.length > 0 && {
      key: "expenses",
      tone: "sky" as const,
      icon: <ReceiptText className="size-4" />,
      title: `${pendingExp.length} expense${pendingExp.length === 1 ? "" : "s"} awaiting approval`,
      detail: `${formatBDT(pendingValue)} needs a decision`,
      href: "/capital/expenses",
      cta: "Approve",
    },
    drafts.length > 0 && {
      key: "drafts",
      tone: "violet" as const,
      icon: <FileText className="size-4" />,
      title: `${drafts.length} draft invoice${drafts.length === 1 ? "" : "s"} not issued`,
      detail: `${formatBDT(draftValue)} billable but not sent`,
      href: "/capital/invoices",
      cta: "Finish",
    },
    Number(overview?.unreconciledCount ?? 0) > 0 && {
      key: "recon",
      tone: "sky" as const,
      icon: <Landmark className="size-4" />,
      title: `${overview.unreconciledCount} bank entr${Number(overview.unreconciledCount) === 1 ? "y" : "ies"} unreconciled`,
      detail: "Cash position can drift until statements are matched",
      href: "/capital/reports",
      cta: "Reconcile",
    },
  ].filter(Boolean) as { key: string; tone: "rose" | "amber" | "sky" | "violet"; icon: React.ReactNode; title: string; detail: string; href: string; cta: string }[];

  const toneCls = {
    rose: "border-rose-500/30 bg-rose-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
    sky: "border-sky-500/30 bg-sky-500/5",
    violet: "border-violet-500/30 bg-violet-500/5",
  } as const;
  const iconCls = {
    rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    sky: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  } as const;

  const buckets = aging?.buckets ?? null;
  const bucketRows = buckets
    ? [
        { key: "CURRENT", label: "Not due yet", value: Number(buckets.CURRENT ?? 0) },
        { key: "1-30", label: "1–30 days", value: Number(buckets["1-30"] ?? 0) },
        { key: "31-60", label: "31–60 days", value: Number(buckets["31-60"] ?? 0) },
        { key: "61-90", label: "61–90 days", value: Number(buckets["61-90"] ?? 0) },
        { key: "90+", label: "90+ days", value: Number(buckets["90+"] ?? 0) },
      ]
    : [];
  const bucketMax = Math.max(1, ...bucketRows.map((b) => b.value));
  const bucketTotal = bucketRows.reduce((s, b) => s + b.value, 0);

  // Show a balanced pair of cards: six ageing clients, six latest expenses.
  const recentExpenses = exp.slice(0, 6);
  const recentBillableShare = recentExpenses.length
    ? Math.round((recentExpenses.filter((e) => e.isClientBillable).length / recentExpenses.length) * 100)
    : 0;
  const billableShare = Number(overview?.expensesMonth ?? 0) > 0 ? Number(overview?.billableShare ?? 0) : recentBillableShare;

  return (
    <div className="flex flex-col gap-4">
      {/* ── What needs a decision today ─────────────────────────────────── */}
      {attention.length > 0 && (
        <div>
          <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Needs attention</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2">
            {attention.map((a) => (
              <Link key={a.key} href={a.href} className={cn("group flex items-start gap-2.5 rounded-2xl border p-3 transition-colors hover:border-primary/40", toneCls[a.tone])}>
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconCls[a.tone])}>{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold leading-snug">{a.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-micro leading-snug text-muted-foreground">{a.detail}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-micro font-bold text-primary">
                    {a.cta} <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Headline numbers ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total Invoiced" value={formatBDT(invoiced)} sub={`${receivable.length} live invoices`} tone="primary" icon={<Wallet className="size-4" />} index={0} />
        <StatCard label="Collected" value={formatBDT(collected)} sub={`${collectionRate}% collection rate`} tone="emerald" icon={<HandCoins className="size-4" />} index={1} />
        <StatCard label="Outstanding" value={formatBDT(outstanding)} sub={overdueValue > 0 ? `${formatBDT(overdueValue)} overdue (${overduePct}%)` : "nothing overdue"} tone="amber" icon={<Banknote className="size-4" />} index={2} />
        <StatCard label="Cash position" value={formatBDT(overview?.cashPosition)} sub={Number(overview?.expensesMonth ?? 0) > 0 ? `${formatBDT(overview.expensesMonth)} spent this month` : "across all bank accounts"} tone="sky" icon={<Landmark className="size-4" />} index={3} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell className="xl:col-span-2">
          <SectionTitle
            title="Revenue trend"
            subtitle="Invoiced vs collected vs expenses"
            action={<Link href="/capital/reports" className="text-meta font-semibold text-primary hover:underline">Full report →</Link>}
          />
          <RevenueAreaChart data={(overview?.trend ?? []).map((t: any) => ({ ...t, month: String(t.month).slice(0, 3) }))} />
        </CardShell>
        <CardShell>
          <SectionTitle title="Payment split" subtitle="collected by method" />
          <PaymentDonut data={overview?.paymentSplit ?? []} />
        </CardShell>
      </div>

      {/* ── Where the money is stuck ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <CardShell>
          <SectionTitle
            title="Receivables ageing"
            subtitle={bucketTotal > 0 ? `${formatBDT(bucketTotal)} outstanding across ${receivable.length} invoices` : "Nothing outstanding"}
            action={<Link href="/capital/reports" className="text-meta font-semibold text-primary hover:underline">Aging report →</Link>}
          />
          {bucketRows.length === 0 ? (
            <SkeletonBlock className="h-32" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {bucketRows.map((b) => (
                <div key={b.key} className="flex items-center gap-2.5">
                  <span className="w-24 shrink-0 text-meta text-muted-foreground">{b.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", b.key === "CURRENT" ? "bg-emerald-500" : b.key === "1-30" ? "bg-sky-500" : b.key === "31-60" ? "bg-amber-400" : "bg-rose-500")}
                      style={{ width: `${(b.value / bucketMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-meta font-bold tabular-nums">{formatBDT(b.value)}</span>
                </div>
              ))}
            </div>
          )}
          {(aging?.byClient ?? []).length > 0 && (
            <div className="mt-4 border-t border-border/50 pt-3">
              <p className="mb-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Top exposures</p>
              <div className="flex flex-col gap-1.5">
                {(aging?.byClient ?? []).slice(0, 6).map((c: any) => (
                  <div key={c.clientId} className="flex items-center justify-between gap-2 text-meta">
                    <span className="min-w-0 truncate font-medium">{c.clientName}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {c.d90p > 0 && <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-micro font-bold text-rose-500">{formatBDT(c.d90p)} 90+</span>}
                      <span className="font-bold tabular-nums">{formatBDT(c.total)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardShell>

        <CardShell>
          <SectionTitle
            title="Recent expenses"
            subtitle={Number(overview?.expensesMonth ?? 0) > 0 ? `${formatBDT(overview.expensesMonth)} this month · ${billableShare}% client-billable` : `latest entries · ${billableShare}% client-billable`}
            action={<Link href="/capital/expenses" className="text-meta font-semibold text-primary hover:underline">All expenses →</Link>}
          />
          <div className="flex flex-col gap-2.5">
            {recentExpenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">{e.description}</p>
                  <p className="truncate text-micro text-muted-foreground">
                    {label(e.category)} · {e.isClientBillable ? "billable" : "absorbed"} · {formatDay(e.date)}
                    {e.vendor?.name ? ` · ${e.vendor.name}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-body font-bold tabular-nums">{formatBDT(e.amount)}</p>
                  <StatusBadge status={e.approvalStatus} />
                </div>
              </div>
            ))}
            {expenses === null ? (
              <SkeletonBlock className="h-24" />
            ) : exp.length === 0 ? (
              <p className="text-body text-muted-foreground">No expenses recorded.</p>
            ) : null}
          </div>
        </CardShell>
      </div>

      {/* ── Recent invoices, with the number that matters: days overdue ── */}
      <div>
        {!invoices ? (
          <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        ) : (
          <FadeIn>
            <TableShell
              footer={
                <>
                  <span className="text-meta text-muted-foreground">
                    {inv.length} invoices · cash position {formatBDT(overview?.cashPosition)}
                  </span>
                  <Link href="/capital/invoices" className="text-meta font-bold text-primary hover:underline">All invoices →</Link>
                </>
              }
            >
              <table className="w-full">
                <THead><Th>Invoice</Th><Th>Client</Th><Th>Amount</Th><Th>Balance</Th><Th>Status</Th><Th>Ageing</Th><Th>Due</Th></THead>
                <tbody>
                  {inv.slice(0, 8).map((it, i) => {
                    const t = invoiceTotals(it);
                    const days = daysLate(it.dueDate);
                    const late = t.balance > 0 && days > 0 && !["DRAFT", "CANCELLED", "VOID"].includes(it.status);
                    return (
                      <Tr key={it.id} index={i} onClick={() => router.push(`/capital/invoices?inv=${it.id}`)} className="cursor-pointer">
                        <Td>
                          <Link href={`/capital/invoices?inv=${it.id}`} onClick={(ev) => ev.stopPropagation()} className="font-medium tabular-nums hover:text-primary hover:underline">{it.invoiceNumber}</Link>
                          <p className="text-meta text-muted-foreground">{label(it.invoiceType)}</p>
                        </Td>
                        <Td className="text-muted-foreground">{it.client.companyName}</Td>
                        <Td className="font-semibold tabular-nums">{formatBDT(t.grand)}</Td>
                        <Td className={cn("tabular-nums", t.balance > 0 ? "font-semibold" : "text-emerald-500")}>
                          {it.status === "DRAFT" ? "—" : formatBDT(t.balance)}
                        </Td>
                        <Td><StatusBadge status={it.status} /></Td>
                        <Td>
                          {late ? (
                            <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold", days > 60 ? "bg-rose-500/15 text-rose-500" : days > 30 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-sky-500/15 text-sky-600 dark:text-sky-400")}>
                              {days}d late
                            </span>
                          ) : (
                            <span className="text-meta text-muted-foreground">—</span>
                          )}
                        </Td>
                        <Td className="text-muted-foreground">{formatDay(it.dueDate)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </FadeIn>
        )}
      </div>
    </div>
  );
}

export function InvoicesTab({ error, refresh, refreshKey, clients, onView, onNew, onDuplicate, onDelete, initialClientId }: { error: string | null; refresh: () => void; refreshKey?: number; clients: any[]; onView: (id: string) => void; onNew: () => void; onDuplicate: (id: string) => void; onDelete: (inv: any) => void; initialClientId?: string }) {
  const { branding } = useBranding();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [quick, setQuick] = useState<"all" | "overdue" | "due7" | "draft" | "paid">("all");
  const [page, setPage] = useState(0);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  // Filters and the page slice are resolved by the API — the browser only ever
  // holds one page of rows plus the counters it renders.
  const qs = new URLSearchParams({
    page: String(page + 1),
    pageSize: "12",
    // Bump the key on every global refresh so create/delete/duplicate reload the
    // table (the server ignores unknown params; it just changes the cache key).
    ...(refreshKey !== undefined ? { rk: String(refreshKey) } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(status ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(quick !== "all" ? { quick } : {}),
    ...(minAmt !== "" ? { min: minAmt } : {}),
    ...(maxAmt !== "" ? { max: maxAmt } : {}),
  }).toString();
  const { data, loading: pagedLoading, error: pagedErr, mutate } = useApi<any>(`/capital/invoices?${qs}`);
  const list: any[] = data?.items ?? [];
  const sums = data?.sums ?? { billed: 0, paid: 0, due: 0, drafts: 0, draftValue: 0 };
  const counts = data?.counts ?? { all: 0, overdue: 0, due7: 0, draft: 0, paid: 0 };
  const values = data?.values ?? { overdue: 0, due7: 0, draft: 0 };
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;
  const loading = pagedLoading && !data;
  const loadError = pagedErr ?? error;
  const reload = () => { void mutate(); refresh(); };

  useEffect(() => {
    if (initialClientId) setClientId(initialClientId);
  }, [initialClientId]);

  // Any filter change resets to the first page — landing on page 4 of a
  // narrower result set would look empty.
  useEffect(() => { setPage(0); }, [q, status, clientId, quick, minAmt, maxAmt]);

  // Counters and headline totals are computed server-side over the filtered
  // set, so the chips stay meaningful even when one is active.
  const quickChips: { key: typeof quick; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "overdue", label: "Overdue", count: counts.overdue },
    { key: "due7", label: "Due ≤ 7 days", count: counts.due7 },
    { key: "draft", label: "Drafts", count: counts.draft },
    { key: "paid", label: "Paid", count: counts.paid },
  ];
  const overdueValue = values.overdue;
  const due7Count = counts.due7;
  const draftValue = values.draft;
  const drafts = counts.draft;
  const hasFilters = q.trim() !== "" || status !== "" || clientId !== "" || minAmt !== "" || maxAmt !== "" || quick !== "all";

  const downloadOne = async (id: string) => {
    setPdfId(id);
    setPdfErr(null);
    try {
      await downloadInvoicePdf(id, branding);
    } catch (e: any) {
      setPdfErr(e?.message ?? "PDF generation failed");
    } finally {
      setPdfId(null);
    }
  };

  // ── Bulk actions ─────────────────────────────────────────────────────
  // `list` is already the current page, so selection only ever spans it.
  const selectedRows = list.filter((i) => selected.includes(i.id));
  const selectableOnPage = list.map((i) => i.id);
  const allOnPage = selectableOnPage.length > 0 && selectableOnPage.every((id) => selected.includes(id));

  const toggleOne = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const togglePage = () => setSelected((s) => (allOnPage ? s.filter((id) => !selectableOnPage.includes(id)) : [...new Set([...s, ...selectableOnPage])]));

  const bulkMarkSent = async () => {
    const rows = selectedRows.filter((i) => i.status === "DRAFT");
    if (!rows.length) return;
    setBulkBusy(true);
    setBulkMsg(null);
    let ok = 0;
    for (const inv of rows) {
      try {
        await apiFetch(`/capital/invoices/${inv.id}`, { method: "PATCH", body: JSON.stringify({ status: "SENT" }) });
        ok++;
      } catch {
        /* counted below */
      }
    }
    setBulkMsg(`${ok}/${rows.length} marked as sent`);
    setSelected([]);
    setBulkBusy(false);
    reload();
  };

  const bulkRemind = async () => {
    const rows = selectedRows.filter((i) => ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status));
    if (!rows.length) return;
    setBulkBusy(true);
    setBulkMsg(null);
    let ok = 0;
    for (const inv of rows) {
      try {
        await apiFetch(`/capital/invoices/${inv.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({ type: "manual", channel: "system", subject: `Payment reminder — ${inv.invoiceNumber}` }),
        });
        ok++;
      } catch {
        /* counted below */
      }
    }
    setBulkMsg(`${ok}/${rows.length} reminders logged`);
    setSelected([]);
    setBulkBusy(false);
    reload();
  };

  const bulkDownload = async () => {
    if (!selectedRows.length) return;
    setBulkBusy(true);
    setBulkMsg(`Preparing ${selectedRows.length} PDFs…`);
    let ok = 0;
    for (const inv of selectedRows) {
      try {
        await downloadInvoicePdf(inv.id, branding);
        ok++;
      } catch {
        /* counted below */
      }
    }
    setBulkMsg(`${ok}/${selectedRows.length} PDFs downloaded`);
    setBulkBusy(false);
    void mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Issued" value={formatBDT(sums.billed)} sub={`${counts.all - counts.draft} live invoice${counts.all - counts.draft === 1 ? "" : "s"}`} tone="primary" icon={<Wallet className="size-4" />} index={0} />
        <StatCard label="Collected" value={formatBDT(sums.paid)} sub={sums.billed > 0 ? `${Math.round((sums.paid / sums.billed) * 100)}% of issued` : "nothing collected yet"} tone="emerald" icon={<HandCoins className="size-4" />} index={1} />
        <StatCard label="Outstanding" value={formatBDT(sums.due)} sub={`${due7Count} due within 7 days`} tone="amber" icon={<Banknote className="size-4" />} index={2} />
        <StatCard label="Overdue" value={formatBDT(overdueValue)} sub={`${counts.overdue} invoice${counts.overdue === 1 ? "" : "s"} past due`} tone="rose" icon={<AlarmClock className="size-4" />} index={3} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {quickChips.map((c) => (
          <button
            key={c.key}
            onClick={() => setQuick(c.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-meta font-semibold transition-colors",
              quick === c.key ? "bg-brand-gradient text-white" : "border border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {c.label}
            <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-bold tabular-nums", quick === c.key ? "bg-white/20" : "bg-muted")}>{c.count}</span>
          </button>
        ))}
        {draftValue > 0 && (
          <span className="ml-auto self-center text-meta text-amber-600 dark:text-amber-400">
            {drafts} draft{drafts === 1 ? "" : "s"} ({formatBDT(draftValue)}) not issued
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by invoice # or client…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-40"><option value="">All statuses</option>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="!w-44"><option value="">All clients</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}</Select>
        <input value={minAmt} onChange={(e) => setMinAmt(e.target.value)} type="number" min={0} placeholder="Min ৳" className="w-24 rounded-xl border border-border bg-card px-3 py-2 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} type="number" min={0} placeholder="Max ৳" className="w-24 rounded-xl border border-border bg-card px-3 py-2 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        {hasFilters && (
          <button onClick={() => { setQ(""); setStatus(""); setClientId(""); setMinAmt(""); setMaxAmt(""); setQuick("all"); }} className="text-meta font-bold text-primary hover:underline">
            Reset
          </button>
        )}
        <div className="ml-auto"><Btn variant="primary" onClick={onNew} data-testid="new-invoice-btn"><Plus className="size-3.5" /> New Invoice</Btn></div>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-meta font-bold">{selected.length} selected</span>
          <span className="text-meta text-muted-foreground">
            {selectedRows.filter((i) => i.status === "DRAFT").length} draft · {selectedRows.filter((i) => ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status)).length} collectable
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {bulkMsg && <span className="text-meta font-medium text-primary">{bulkMsg}</span>}
            <Btn variant="outline" className="!py-1.5" onClick={bulkMarkSent} disabled={bulkBusy || !selectedRows.some((i) => i.status === "DRAFT")}>
              Mark as sent
            </Btn>
            <Btn variant="outline" className="!py-1.5" onClick={bulkRemind} disabled={bulkBusy || selectedRows.every((i) => i.status === "DRAFT")}>
              Send reminder
            </Btn>
            <Btn variant="outline" className="!py-1.5" onClick={bulkDownload} disabled={bulkBusy}>
              <Download className="size-3.5" /> PDFs
            </Btn>
            <Btn variant="ghost" className="!py-1.5" onClick={() => setSelected([])}>Clear</Btn>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : loadError ? (
        <ErrorRetry message={loadError} onRetry={reload} />
      ) : (
        <FadeIn>
          <TableShell
            footer={
              <>
                <span className="text-meta text-muted-foreground">
                  {total} invoice{total === 1 ? "" : "s"} · {formatBDT(sums.billed)} issued · {formatBDT(sums.due)} due
                </span>
                <div className="flex items-center gap-2">
                  {pdfErr && <span className="text-meta font-medium text-rose-500">{pdfErr}</span>}
                  <Pager page={page} pages={pages} onPage={setPage} total={total} pageSize={12} label="invoices" />
                  <Btn variant="ghost" onClick={() => exportInvoicesCsv(list)}><Download className="size-3.5" /> CSV</Btn>
                </div>
              </>
            }
          >
            <table className="w-full">
              <THead>
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={togglePage}
                    className="size-3.5 cursor-pointer accent-violet-600"
                  />
                </Th>
                <Th>Invoice #</Th><Th>Client</Th><Th>Issue / Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th />
              </THead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={9} className="px-5 py-10"><EmptyState title="No invoices match" hint="Adjust filters or create a new invoice." /></td></tr>
                )}
                {list.map((inv, i) => {
                  const t = invoiceTotals(inv);
                  const amount = t.grand;
                  const paidAmt = t.paid;
                  const picked = selected.includes(inv.id);
                  return (
                    <Tr key={inv.id} index={i} onClick={() => onView(inv.id)} className="cursor-pointer">
                      <Td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${inv.invoiceNumber}`}
                          checked={picked}
                          onChange={() => toggleOne(inv.id)}
                          className="size-3.5 cursor-pointer accent-violet-600"
                        />
                      </Td>
                      <Td>
                        <p className="font-medium tabular-nums">{inv.invoiceNumber}</p>
                        <p className="text-meta text-muted-foreground">{label(inv.invoiceType ?? "INVOICE")}</p>
                      </Td>
                      <Td className="text-muted-foreground">{inv.client.companyName}</Td>
                      <Td>
                        <p className="text-meta">{formatDate(inv.issueDate)}</p>
                        <p className="text-meta text-muted-foreground">
                          due {formatDate(inv.dueDate)}
                          {(() => {
                            const d = daysLate(inv.dueDate);
                            return inv.status !== "DRAFT" && amount - paidAmt > 0 && d > 0 ? <span className={cn("ml-1 font-bold", d > 60 ? "text-rose-500" : d > 30 ? "text-amber-500" : "text-sky-500")}>· {d}d late</span> : null;
                          })()}
                        </p>
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">{formatBDT(amount)}</Td>
                      <Td className={cn("text-right tabular-nums", paidAmt > 0 ? "text-emerald-500" : "text-muted-foreground/60")}>{formatBDT(paidAmt)}</Td>
                      <Td className={cn("text-right font-medium tabular-nums", inv.status === "DRAFT" ? "text-muted-foreground/50" : amount - paidAmt > 0 ? "text-amber-500" : "text-emerald-500")}>
                        {inv.status === "DRAFT" ? "—" : formatBDT(amount - paidAmt)}
                      </Td>
                      <Td><StatusBadge status={inv.status} /></Td>
                      <Td>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => void downloadOne(inv.id)}
                            disabled={pdfId === inv.id}
                            aria-label="Download invoice PDF"
                            className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50"
                            title="Download PDF"
                          >
                            <Download className={cn("size-3.5", pdfId === inv.id && "animate-pulse")} />
                          </button>
                          <button onClick={() => onView(inv.id)} aria-label="View invoice" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50" title="View"><Eye className="size-3.5" /></button>
                          <button onClick={() => onDuplicate(inv.id)} aria-label="Duplicate invoice" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50" title="Duplicate"><Copy className="size-3.5" /></button>
                          <button onClick={() => onDelete(inv)} aria-label="Delete invoice" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-rose-500/10 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/50" title="Delete"><Trash2 className="size-3.5" /></button>
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
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policy, setPolicy] = useState<any | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<any>("/capital/approval-policy").then(setPolicy).catch(() => setPolicy(null));
  }, [policyOpen]);

  const catOptions = categories ?? [];
  const [quick, setQuick] = useState<"all" | "pending" | "approved" | "payable" | "month">("all");
  const list = useMemo(() => {
    const items = expenses ?? [];
    const ql = q.trim().toLowerCase();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return items.filter((e) => {
      if (ql) {
        const hay = `${e.description ?? ""} ${e.vendor?.name ?? ""} ${e.vendorBillNumber ?? ""} ${e.notes ?? ""} ${e.department ?? ""} ${e.client?.companyName ?? ""} ${e.project?.name ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (cat && e.category !== cat) return false;
      if (status && e.approvalStatus !== status) return false;
      if (quick === "pending" && e.approvalStatus !== "PENDING") return false;
      if (quick === "approved" && e.approvalStatus !== "APPROVED") return false;
      if (quick === "payable" && !(e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount))) return false;
      if (quick === "month" && new Date(e.date) < monthStart) return false;
      return true;
    });
  }, [expenses, q, cat, status, quick]);

  const totals = useMemo(() => {
    let spend = 0, billable = 0, pending = 0, owed = 0;
    for (const e of list) {
      const amt = Number(e.amount ?? 0);
      spend += amt;
      if (e.isClientBillable) billable += amt;
      if (e.approvalStatus === "PENDING") pending += amt;
      if (e.isPayable) owed += Math.max(0, amt - Number(e.paidAmount ?? 0));
    }
    return { spend, billable, pending, owed };
  }, [list]);

  // Keep the DOM to one page — a year of expenses is thousands of rows.
  const expPg = usePaged(list, 15);
  // The drawer reads the live row so approve/pay refreshes are reflected instantly.
  const detail = useMemo(() => (expenses ?? []).find((e) => e.id === detailId) ?? null, [expenses, detailId]);

  const quickChips = [
    { key: "all" as const, label: "All", count: (expenses ?? []).length },
    { key: "pending" as const, label: "Pending", count: (expenses ?? []).filter((e) => e.approvalStatus === "PENDING").length },
    { key: "approved" as const, label: "Approved", count: (expenses ?? []).filter((e) => e.approvalStatus === "APPROVED").length },
    { key: "payable" as const, label: "Unpaid", count: (expenses ?? []).filter((e) => e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount)).length },
    { key: "month" as const, label: "This month", count: (expenses ?? []).filter((e) => { const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); return new Date(e.date) >= m; }).length },
  ];

  const exportCsv = () => {
    const rows: (string | number)[][] = [["Date", "Description", "Category", "Vendor", "Amount", "Currency", "Client billable", "Status", "Method", "Paid"]];
    for (const e of list) {
      rows.push([
        String(e.date ?? "").slice(0, 10), e.description ?? "", label(e.category ?? ""), e.vendor?.name ?? "",
        Number(e.amount ?? 0), e.currency ?? "BDT", e.isClientBillable ? "yes" : "no", e.approvalStatus ?? "",
        e.paymentMethod ?? "", Number(e.paidAmount ?? 0),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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

  /** Receipt upload — image or PDF, attached straight to the expense row. */
  const uploadReceipt = async (expense: any, ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await apiFetchFormData(`/capital/expenses/${expense.id}/receipt`, fd);
      notify("Receipt attached");
      refresh();
    } catch (err: any) {
      notify(err.message ?? "Receipt upload failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Spend in view" value={formatBDT(totals.spend)} sub={`${list.length} expense${list.length === 1 ? "" : "s"}`} tone="primary" icon={<ReceiptText className="size-4" />} index={0} />
        <StatCard label="Client-billable" value={formatBDT(totals.billable)} sub={totals.spend > 0 ? `${Math.round((totals.billable / totals.spend) * 100)}% recoverable` : "—"} tone="sky" icon={<CircleDollarSign className="size-4" />} index={1} />
        <StatCard label="Awaiting approval" value={formatBDT(totals.pending)} sub={`${list.filter((e) => e.approvalStatus === "PENDING").length} pending`} tone="amber" icon={<Wallet className="size-4" />} index={2} />
        <StatCard label="Still payable" value={formatBDT(totals.owed)} sub="unpaid, payable items" tone="rose" icon={<HandCoins className="size-4" />} index={3} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {quickChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setQuick(c.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-meta font-semibold transition-colors",
                quick === c.key ? "bg-brand-gradient text-white" : "border border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {c.label}
              <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-bold tabular-nums", quick === c.key ? "bg-white/20" : "bg-muted")}>{c.count}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Btn variant="outline" onClick={onVendor}><UserPlus className="size-3.5" /> Add Vendor</Btn>
          <Btn variant="outline" onClick={() => setCatsOpen(true)}><Pencil className="size-3.5" /> Categories</Btn>
          <Btn variant="outline" onClick={() => setPolicyOpen(true)}><ShieldCheck className="size-3.5" /> Approval matrix</Btn>
          <Btn variant="primary" onClick={onRecord} data-testid="record-expense-btn"><Plus className="size-3.5" /> Record Expense</Btn>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search expenses…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-44"><option value="">All categories</option>{catOptions.map((c: any) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-36"><option value="">All statuses</option>{EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        {policy && (
          <button onClick={() => setPolicyOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-micro text-muted-foreground transition-colors hover:text-foreground" title="Open the approval matrix">
            <ShieldCheck className={cn("size-3.5", policy.enabled ? "text-emerald-500" : "text-amber-500")} />
            {policy.enabled ? `${policy.rules.length} approval limits on` : "Approval limits off"}
            <span className="font-bold text-primary">View</span>
          </button>
        )}
      </div>


      {!expenses && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell
            footer={
              <>
                <span className="text-meta text-muted-foreground">
                  {list.length} expenses · {formatBDT(totals.spend)} total · {formatBDT(totals.owed)} still payable
                </span>
                <div className="flex items-center gap-2">
                  <Pager page={expPg.page} pages={expPg.pages} onPage={expPg.setPage} total={list.length} pageSize={15} label="expenses" />
                  <Btn variant="ghost" onClick={exportCsv}><Download className="size-3.5" /> CSV</Btn>
                </div>
              </>
            }
          >
            <table className="w-full">
              <THead><Th>Description</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th>Date</Th><Th className="hidden lg:table-cell">Method</Th><Th>Status</Th><Th className="hidden 2xl:table-cell">By</Th><Th><span className="sr-only">Actions</span></Th></THead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-10"><EmptyState title="No expenses match" hint="Adjust filters or record a new expense." /></td></tr>
                )}
                {expPg.paged.map((e, i) => {
                  const catName = catOptions.find((c: any) => c.key === e.category)?.name ?? label(e.category);
                  const owing = e.isPayable && Number(e.paidAmount ?? 0) < Number(e.amount);
                  return (
                    <Tr key={e.id} index={i} onClick={() => setDetailId(e.id)} className={cn("cursor-pointer", detailId === e.id && "bg-primary/[0.04]")}>
                      <Td className="max-w-64">
                        <p className="truncate font-medium">{e.description}</p>
                        <p className="truncate text-meta text-muted-foreground">{e.vendor?.name ?? "no vendor"}{e.vendorBillNumber ? ` · bill ${e.vendorBillNumber}` : ""} {e.subcategory ? `· ${e.subcategory}` : ""} {e.isClientBillable && "· billable"} {e.client && `· ${e.client.companyName}`} {e.project && `· ${e.project.name}`}</p>
                      </Td>
                      <Td><span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-semibold", CAT_TONES[e.category] ?? CAT_TONES.MISC)}>{catName}</span>{owing && <span className="ml-1.5 inline-flex whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-micro font-bold text-amber-500 ring-1 ring-amber-500/20">PAYABLE</span>}{e.payrollRecordId && <span className="ml-1.5 inline-flex whitespace-nowrap rounded-full bg-sky-500/10 px-2 py-0.5 text-micro font-bold text-sky-500 ring-1 ring-sky-500/20">PAYROLL</span>}</Td>
                      <Td className="text-right font-semibold tabular-nums">
                        {formatBDT(e.amount)}
                        {e.currency && e.currency !== "BDT" && <span className="ml-1 text-micro font-normal text-muted-foreground">{e.currency}</span>}
                        {e.isClientBillable && Number(e.markupPct ?? 0) > 0 && (
                          <span className="ml-1 text-micro font-normal text-emerald-600 dark:text-emerald-400">+{e.markupPct}%</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-muted-foreground">{formatDate(e.date)}</Td>
                      <Td className="hidden capitalize text-muted-foreground lg:table-cell">{label(e.paymentMethod ?? "N/A")}</Td>
                      <Td><StatusBadge status={e.approvalStatus} /></Td>
                      <Td className="hidden 2xl:table-cell">
                        <p className="whitespace-nowrap text-meta">{e.submittedBy?.name ?? "—"}</p>
                        <p className="whitespace-nowrap text-micro text-muted-foreground">{e.approvalStatus === "APPROVED" ? (e.approvedBy?.name ? `by ${e.approvedBy.name}` : "approved") : e.approvalStatus === "REJECTED" ? "rejected" : "awaiting review"}</p>
                      </Td>
                      <Td onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => setDetailId(e.id)} aria-label="View expense details" title="View details" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50"><Eye className="size-3.5" /></button>
                          {e.receiptUrl ? (
                            <a
                              href={`${API_URL.replace(/\/api$/, "")}${e.receiptUrl}`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="View receipt"
                              title="View receipt"
                              className="rounded-lg p-2 text-sky-500 transition-colors outline-none hover:bg-sky-500/10 focus-visible:ring-2 focus-visible:ring-sky-500/50"
                            >
                              <Paperclip className="size-3.5" />
                            </a>
                          ) : (
                            <label
                              title="Attach receipt"
                              className="cursor-pointer rounded-lg p-2 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Paperclip className="size-3.5" />
                              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(ev) => void uploadReceipt(e, ev)} />
                            </label>
                          )}
                          {owing && <button onClick={() => openPay(e)} aria-label="Pay expense" className="rounded-lg p-2 text-amber-500 transition-colors outline-none hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-500/50" title="Pay expense"><HandCoins className="size-4" /></button>}
                          {e.approvalStatus === "PENDING" && (
                            <>
                              {e.approval?.canApprove === false ? (
                                <button
                                  type="button"
                                  disabled
                                  aria-label={`Cannot approve: ${e.approval.reason}`}
                                  title={`Cannot approve — ${e.approval.reason}`}
                                  className="cursor-not-allowed rounded-lg p-2 text-muted-foreground/40"
                                >
                                  <Check className="size-3.5" />
                                </button>
                              ) : (
                                <button onClick={() => setApproval(e, "APPROVED")} disabled={busyId === e.id} aria-label="Approve expense" className="rounded-lg p-2 text-emerald-500 transition-colors outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-50" title="Approve"><Check className="size-3.5" /></button>
                              )}
                              <button onClick={() => setApproval(e, "REJECTED")} disabled={busyId === e.id} aria-label="Reject expense" className="rounded-lg p-2 text-rose-500 transition-colors outline-none hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/50 disabled:opacity-50" title="Reject"><X className="size-3.5" /></button>
                            </>
                          )}
                          <button onClick={() => setEditExpense(e)} aria-label="Edit expense" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50" title="Edit"><Pencil className="size-3.5" /></button>
                          <button onClick={() => onDelete(e)} aria-label="Delete expense" className="rounded-lg p-2 text-muted-foreground transition-colors outline-none hover:bg-rose-500/10 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/50" title="Delete"><Trash2 className="size-3.5" /></button>
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
      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        eyebrow="Expense"
        icon={<ReceiptText className="size-4" />}
        title={detail?.description ?? ""}
        subtitle={detail ? `${formatDate(detail.date)} · ${label(detail.category ?? "")}` : undefined}
        size="lg"
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detail.approvalStatus === "PENDING" && (
                <>
                  <Btn variant="outline" className="border-rose-500/40 text-rose-600" onClick={() => setApproval(detail, "REJECTED")} disabled={busyId === detail.id}><X className="size-3.5" /> Reject</Btn>
                  {detail.approval?.canApprove !== false && (
                    <Btn variant="primary" onClick={() => setApproval(detail, "APPROVED")} disabled={busyId === detail.id}><Check className="size-3.5" /> Approve</Btn>
                  )}
                </>
              )}
              {detail.isPayable && Number(detail.paidAmount ?? 0) < Number(detail.amount) && (
                <Btn variant="primary" onClick={() => { const e = detail; setDetailId(null); openPay(e); }}><HandCoins className="size-3.5" /> Record payment</Btn>
              )}
              <Btn variant="outline" onClick={() => { const e = detail; setDetailId(null); setEditExpense(e); }}><Pencil className="size-3.5" /> Edit</Btn>
              <Btn variant="ghost" className="text-rose-600 hover:bg-rose-500/10" onClick={() => { const e = detail; setDetailId(null); onDelete(e); }}><Trash2 className="size-3.5" /> Delete</Btn>
            </div>
          ) : null
        }
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <DetailHero
              eyebrow="Expense amount"
              amount={formatBDT(detail.amount)}
              chips={
                <>
                  <StatusBadge status={detail.approvalStatus} />
                  <span className={cn("rounded-full px-2 py-0.5 text-micro font-bold", CAT_TONES[detail.category] ?? CAT_TONES.MISC)}>
                    {catOptions.find((c: any) => c.key === detail.category)?.name ?? label(detail.category ?? "MISC")}
                  </span>
                  {detail.isClientBillable && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-micro font-bold text-sky-600 dark:text-sky-300">Client billable{Number(detail.markupPct ?? 0) > 0 ? ` +${detail.markupPct}%` : ""}</span>}
                  {detail.payrollRecordId && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-bold text-emerald-600 dark:text-emerald-300">From payroll</span>}
                </>
              }
            />

            <DetailSection title="Where it sits">
              <DetailRow label="Client">{detail.client?.companyName ?? "—"}</DetailRow>
              <DetailRow label="Project">{detail.project?.name ?? "—"}</DetailRow>
              <DetailRow label="Vendor">{detail.vendor?.name ?? "—"}</DetailRow>
              <DetailRow label="Vendor bill">{detail.vendorBillNumber ?? "—"}</DetailRow>
              <DetailRow label="Subcategory">{detail.subcategory ?? "—"}</DetailRow>
              <DetailRow label="Department">{detail.department ?? "—"}</DetailRow>
            </DetailSection>

            <DetailSection title="Payment">
              <DetailRow label="Date">{formatDate(detail.date)}</DetailRow>
              <DetailRow label="Method">{label(detail.paymentMethod ?? "—")}</DetailRow>
              <DetailRow label="Paid" mono>{formatBDT(detail.paidAmount ?? 0)}</DetailRow>
              <DetailRow label="Still payable" mono strong>{detail.isPayable ? formatBDT(Math.max(0, Number(detail.amount ?? 0) - Number(detail.paidAmount ?? 0))) : "—"}</DetailRow>
              <DetailRow label="Currency">{detail.currency ?? "BDT"}</DetailRow>
            </DetailSection>

            <DetailSection title="Approval trail">
              <DetailRow label="Submitted by">{detail.submittedBy?.name ?? "—"}</DetailRow>
              <DetailRow label="Status">{label(detail.approvalStatus ?? "—")}</DetailRow>
              <DetailRow label="Approved by">{detail.approvedBy?.name ?? "—"}</DetailRow>
            </DetailSection>

            {detail.notes && (
              <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">{detail.notes}</p>
              </DetailSection>
            )}

            <DetailSection title="Receipt">
              {detail.receiptUrl ? (
                <a
                  href={`${API_URL.replace(/\/api$/, "")}${detail.receiptUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2 text-body font-semibold transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <span className="flex min-w-0 items-center gap-2"><Paperclip className="size-3.5 shrink-0" /> <span className="truncate">View attached receipt</span></span>
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              ) : (
                <p className="text-meta text-muted-foreground">No receipt attached — upload one from the expense row.</p>
              )}
            </DetailSection>
          </div>
        )}
      </Modal>
      <PayExpenseModal expense={payExpense} open={payOpen} bankAccounts={bankAccounts} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); notify("Payment recorded"); refresh(); }} />
      <EditExpenseModal expense={editExpense} onClose={() => setEditExpense(null)} onSaved={() => { setEditExpense(null); notify("Expense updated"); refresh(); }} categories={categories} />
      <CategoriesModal open={catsOpen} categories={categories} accounts={accounts} onClose={() => setCatsOpen(false)} onSaved={() => { notify("Category saved"); refresh(); }} />
      <ApprovalPolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} notify={notify} />
    </div>
  );
}

export function IncomeTab({ income, error, refresh, stats, bankAccounts, clients, projects }: { income: any[] | null; error: string | null; refresh: () => void; stats: any; bankAccounts: any[]; clients?: any[]; projects?: any[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [range, setRange] = useState<"all" | "month" | "last" | "year">("all");
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const byMethod = stats?.byMethod ?? [];
  const byMethodTotal = byMethod.reduce((s: number, m: any) => s + Number(m.amount ?? 0), 0);
  const bySource = stats?.bySource ?? [];

  const rows = useMemo(() => {
    const items = income ?? [];
    const ql = q.trim().toLowerCase();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return items.filter((it) => {
      const m = it.method ?? it.paymentMethod ?? "";
      if (method && m !== method) return false;
      if (ql) {
        const hay = `${it.client ?? it.invoice?.client?.companyName ?? ""} ${it.project ?? ""} ${it.invoice?.invoiceNumber ?? ""} ${it.description ?? ""} ${it.reference ?? ""} ${it.notes ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      const d = new Date(it.date ?? it.paymentDate);
      if (range === "month" && d < monthStart) return false;
      if (range === "last" && (d < lastStart || d >= monthStart)) return false;
      if (range === "year" && d < new Date(now.getFullYear(), 0, 1)) return false;
      return true;
    });
  }, [income, q, method, range]);

  const rowsTotal = rows.reduce((s, it) => s + Number(it.amount ?? 0), 0);
  const incPg = usePaged(rows, 15);

  /** Two-step delete for a manual income entry (reverses its bank + ledger). */
  const removeManual = async (it: any) => {
    if (delConfirm !== it.id) {
      setDelConfirm(it.id);
      return;
    }
    setDelConfirm(null);
    try {
      await apiFetch(`/capital/income/${it.id}`, { method: "DELETE" });
      setDelErr(null);
      setDetailId(null);
      refresh();
    } catch (e: any) {
      setDelErr(e.message ?? "Could not delete the income entry");
    }
  };
  // Live row so the drawer reflects refreshes without a stale snapshot.
  const detail = useMemo(() => (income ?? []).find((it) => it.id === detailId) ?? null, [income, detailId]);
  const methodOptions = Array.from(new Set((income ?? []).map((it) => it.method ?? it.paymentMethod).filter(Boolean)));

  const exportCsv = () => {
    const head = [["Date", "Client", "Project", "Invoice", "Method", "Source", "Amount", "Tax withheld", "Net received", "Currency", "Reference", "Notes", "Recorded by"]];
    for (const it of rows) {
      head.push([
        String(it.date ?? it.paymentDate ?? "").slice(0, 10),
        it.client ?? it.invoice?.client?.companyName ?? "",
        it.project ?? it.invoice?.project?.name ?? "",
        it.invoice?.invoiceNumber ?? (it.description ?? ""),
        label(it.method ?? it.paymentMethod ?? ""),
        it.source ?? "",
        String(Number(it.amount ?? 0)),
        String(Number(it.taxWithheld ?? 0)),
        String(Number(it.netAmount ?? it.amount ?? 0)),
        it.currency ?? "BDT",
        it.reference ?? "",
        it.notes ?? "",
        it.recordedBy?.name ?? "system",
      ]);
    }
    const csv = head.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `income-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Income" value={formatBDT(stats?.total)} sub="all-time collections" tone="emerald" icon={<HandCoins className="size-4" />} />
          <StatCard label="Payments" value={stats?.count ?? "—"} sub="transactions recorded" tone="sky" icon={<ReceiptText className="size-4" />} />
          <StatCard label="Avg Payment" value={formatBDT(stats?.avgAmount)} sub="per transaction" tone="primary" icon={<Banknote className="size-4" />} />
          <StatCard label="Top Method" value={byMethod.length ? label(byMethod[0].method) : "—"} sub={`${byMethod.length ? formatBDT(byMethod[0].amount) : "৳0"} · ${byMethodTotal ? Math.round((byMethod[0].amount / byMethodTotal) * 100) : 0}% of collections`} tone="amber" icon={<Landmark className="size-4" />} />
        </div>
        <Btn variant="outline" onClick={() => setShowAnalytics((v) => !v)}>
          <Eye className="size-3.5" /> {showAnalytics ? "Hide" : "Show"} analytics
        </Btn>
        <Btn variant="primary" onClick={() => setAddOpen(true)} data-testid="record-income-btn"><Plus className="size-3.5" /> Record Income</Btn>
      </div>

      {showAnalytics && (
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
                    <span className="w-28 shrink-0 text-body capitalize text-muted-foreground">{label(s.source)}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(s.amount ?? 0) / Math.max(bySource.reduce((a: number, b: any) => a + Number(b.amount ?? 0), 0), 1)) * 100}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-body font-bold tabular-nums">{formatBDT(s.amount)}</span>
                  </div>
                ))}
              </div>
            </CardShell>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, project or invoice…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="!w-40">
          <option value="">All methods</option>
          {methodOptions.map((m: any) => <option key={m} value={m}>{label(m)}</option>)}
        </Select>
        <Select value={range} onChange={(e) => setRange(e.target.value as any)} className="!w-40">
          <option value="all">All time</option>
          <option value="month">This month</option>
          <option value="last">Last month</option>
          <option value="year">This year</option>
        </Select>
        <span className="ml-auto rounded-xl border border-border/60 bg-card px-3 py-2 text-meta text-muted-foreground">
          In view: <b className="tabular-nums text-foreground">{formatBDT(rowsTotal)}</b>
        </span>
      </div>
      {delErr && <p className="text-meta font-medium text-rose-500">{delErr}</p>}

      {!income && !error ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={refresh} />
      ) : (
        <FadeIn>
          <TableShell
            footer={
              <>
                <span className="text-meta text-muted-foreground">{rows.length} of {(income ?? []).length} entries · {formatBDT(rowsTotal)}</span>
                <div className="flex items-center gap-2">
                  <Pager page={incPg.page} pages={incPg.pages} onPage={incPg.setPage} total={rows.length} pageSize={15} label="entries" />
                  <Btn variant="ghost" onClick={exportCsv}><Download className="size-3.5" /> CSV</Btn>
                </div>
              </>
            }
          >
            <table className="w-full">
              <THead><Th>Date</Th><Th>Client</Th><Th className="hidden 2xl:table-cell">Project</Th><Th>Invoice</Th><Th className="hidden xl:table-cell">Method</Th><Th className="hidden 2xl:table-cell">Bank</Th><Th>Source</Th><Th className="text-right">Amount</Th><Th className="hidden 2xl:table-cell">Recorded by</Th><Th className="w-10" /></THead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="px-5 py-10"><EmptyState title="No income in this view" hint="Collections appear here as invoices are paid." /></td></tr>
                )}
                {incPg.paged.map((it, i) => {
                  const isManual = it.source === "MANUAL" || it.source === "manual";
                  const isDollar = it.source === "dollar";
                  return (
                    <Tr key={it.id} index={i} onClick={() => setDetailId(it.id)} className={cn("cursor-pointer", detailId === it.id && "bg-primary/[0.04]")}>
                      <Td className="text-muted-foreground">{formatDate(it.date ?? it.paymentDate)}</Td>
                      <Td className="font-medium">{it.client ?? it.invoice?.client?.companyName ?? "—"}</Td>
                      <Td className="hidden text-muted-foreground 2xl:table-cell">{it.project ?? it.invoice?.project?.name ?? "—"}</Td>
                      <Td className="tabular-nums text-muted-foreground">
                        {it.invoice?.id ? (
                          <Link href={`/capital/invoices?inv=${it.invoice.id}`} onClick={(ev) => ev.stopPropagation()} className="font-medium text-primary hover:underline">
                            {it.invoice.invoiceNumber}
                          </Link>
                        ) : (
                          it.invoice?.invoiceNumber ?? (isManual ? "—" : it.description ?? "—")
                        )}
                      </Td>
                      <Td className="hidden text-muted-foreground xl:table-cell">{label(it.method ?? it.paymentMethod)}</Td>
                      <Td className="hidden xl:table-cell">
                        {/* Where the money landed, and whether the bank statement
                            line has been matched — the one thing a reconciliation
                            review needs from this table. */}
                        {isDollar ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-meta text-muted-foreground">Auto (FX ledger)</span>
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-teal-500/10 px-1.5 py-0.5 text-micro font-bold text-teal-600 ring-1 ring-teal-500/20 dark:text-teal-300">
                              FX gain
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-meta text-muted-foreground">{it.bankAccount ?? "—"}</span>
                            {it.reconciled ? (
                              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-micro font-bold text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                                <Check className="size-3.5" /> matched
                              </span>
                            ) : (
                              <Link href="/capital/reports" onClick={(ev) => ev.stopPropagation()} className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-micro font-bold text-amber-600 ring-1 ring-amber-500/20 hover:underline dark:text-amber-400">
                                reconcile →
                              </Link>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-micro font-bold",
                          isDollar
                            ? "bg-teal-500/10 text-teal-600 ring-1 ring-teal-500/20 dark:text-teal-300"
                            : isManual
                              ? "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20"
                              : "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20"
                        )}>
                          {isDollar ? "DOLLAR" : isManual ? "MANUAL" : "INVOICE"}
                        </span>
                      </Td>
                      <Td className={cn("text-right font-semibold tabular-nums", Number(it.amount) < 0 ? "text-rose-500" : "text-emerald-500")}>
                        {formatBDT(it.amount)}
                        {isDollar && it.fx && <span className="ml-1 text-micro font-normal text-muted-foreground">on {formatBDT(it.fx.bdt)}</span>}
                        {isManual && Number(it.taxWithheld ?? 0) > 0 && (
                          <span className="ml-1 text-micro font-normal text-muted-foreground">net {formatBDT(it.netAmount)}</span>
                        )}
                        {it.currency && it.currency !== "BDT" && <span className="ml-1 text-micro font-normal text-muted-foreground">{it.currency}</span>}
                      </Td>
                      <Td className="hidden text-muted-foreground 2xl:table-cell">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate">{it.recordedBy?.name ?? it.recordedBy ?? "system"}</span>
                          <button onClick={(ev) => { ev.stopPropagation(); setDetailId(it.id); }} aria-label="View income details" title="View details" className="shrink-0 rounded-lg p-1 text-muted-foreground/70 transition-colors hover:bg-primary/10 hover:text-primary"><Eye className="size-3.5" /></button>
                        </span>
                      </Td>
                      <Td>
                        {isManual && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); void removeManual(it); }}
                            aria-label={delConfirm === it.id ? "Confirm delete income" : "Delete income"}
                            title={delConfirm === it.id ? "Click again to confirm" : "Delete this manual income"}
                            className={cn(
                              "rounded-lg p-1.5 transition-colors",
                              delConfirm === it.id ? "bg-rose-500/15 text-rose-500" : "text-muted-foreground/70 hover:bg-rose-500/10 hover:text-rose-500"
                            )}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        eyebrow="Income entry"
        icon={<HandCoins className="size-4" />}
        title={detail ? (detail.client ?? detail.invoice?.client?.companyName ?? detail.description ?? "Collection") : ""}
        subtitle={detail ? `${formatDate(detail.date ?? detail.paymentDate)} · ${label(detail.method ?? detail.paymentMethod ?? "")}` : undefined}
        size="lg"
      >
        {detail && (() => {
          const isManual = detail.source === "MANUAL" || detail.source === "manual";
          const isDollar = detail.source === "dollar";
          return (
            <div className="flex flex-col gap-3">
              <DetailHero
                eyebrow="Amount received"
                tone="emerald"
                amount={formatBDT(detail.amount)}
                chips={
                  <>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-micro font-bold",
                      isDollar
                        ? "bg-teal-500/10 text-teal-600 dark:text-teal-300"
                        : isManual
                          ? "bg-sky-500/10 text-sky-600 dark:text-sky-300"
                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    )}>
                      {isDollar ? "DOLLAR DESK" : isManual ? "MANUAL" : "INVOICE PAYMENT"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">{label(detail.method ?? detail.paymentMethod ?? "—")}</span>
                    {detail.currency && detail.currency !== "BDT" && <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">{detail.currency}</span>}
                  </>
                }
                caption={detail.notes}
              />

              <DetailSection title="Collection">
                <DetailRow label="Date">{formatDate(detail.date ?? detail.paymentDate)}</DetailRow>
                <DetailRow label="Client">{detail.client ?? detail.invoice?.client?.companyName ?? "—"}</DetailRow>
                <DetailRow label="Project">{detail.project ?? detail.invoice?.project?.name ?? "—"}</DetailRow>
                <DetailRow label="Invoice">
                  {detail.invoice?.id ? (
                    <Link href={`/capital/invoices?inv=${detail.invoice.id}`} className="font-semibold text-primary hover:underline">
                      {detail.invoice.invoiceNumber}
                    </Link>
                  ) : (
                    detail.invoice?.invoiceNumber ?? "—"
                  )}
                </DetailRow>
                <DetailRow label="Bank account">{detail.bankAccount ?? (isDollar ? "Auto (FX ledger)" : "—")}</DetailRow>
                <DetailRow label="Reference">{detail.reference ?? "—"}</DetailRow>
                <DetailRow label="Recorded by">{detail.recordedBy?.name ?? detail.recordedBy ?? "system"}</DetailRow>
                <DetailRow label="Reconciliation">
                  {detail.reconciled ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-micro font-bold text-emerald-600 dark:text-emerald-300"><Check className="size-3.5" /> matched</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-500/10 px-1.5 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-300">unreconciled</span>
                  )}
                </DetailRow>
              </DetailSection>

              <DetailSection title="Amounts">
                <DetailRow label="Gross" mono>{formatBDT(detail.amount)}</DetailRow>
                <DetailRow label="Tax withheld" mono>{formatBDT(detail.taxWithheld ?? 0)}</DetailRow>
                <DetailRow label="Net received" mono strong>{formatBDT(detail.netAmount ?? detail.amount)}</DetailRow>
                {isDollar && detail.fx && <DetailRow label="FX value" mono>{formatBDT(detail.fx.bdt)}</DetailRow>}
                <DetailRow label="Currency">{detail.currency ?? "BDT"}</DetailRow>
              </DetailSection>

              {detail.notes && (
                <DetailSection title="Notes">
                  <p className="whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">{detail.notes}</p>
                </DetailSection>
              )}
            </div>
          );
        })()}
      </Modal>
      <AddIncomeModal open={addOpen} bankAccounts={bankAccounts} clients={clients ?? []} projects={projects ?? []} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); refresh(); }} />
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

  // bankAccounts arrive asynchronously from context; the initial state above is
  // empty on first render, so adopt the first account once it exists (this is
  // why the Reconciliation panel used to show "No transactions" forever).
  useEffect(() => {
    if (!reconAccount && bankAccounts.length > 0) setReconAccount(bankAccounts[0].id);
  }, [bankAccounts, reconAccount]);
  const [reconOpen, setReconOpen] = useState(false);
  const [reconBusy, setReconBusy] = useState(false);

  // ── downloadable reports ──
  const { branding } = useBranding();
  const [monthValue, setMonthValue] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [reportBusy, setReportBusy] = useState<string | null>(null);

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

  /** Monthly / six-month PDF: fetch the window, then render an A4 sheet. */
  const downloadPeriodReport = async (kind: "monthly" | "six-month") => {
    if (reportBusy) return;
    setReportBusy(kind);
    try {
      const { buildBusinessReportPdf, monthBounds, sixMonthBounds } = await import("@/lib/reports-pdf");
      const bounds = kind === "monthly" ? monthBounds(monthValue) : sixMonthBounds(monthValue);
      const data = await apiFetch<any>(
        `/capital/reports/period?from=${bounds.from}&to=${bounds.to}`
      );
      const doc = await buildBusinessReportPdf(
        {
          kind,
          title: kind === "monthly" ? "Monthly Financial Report" : "Six-Month Financial Report",
          periodLabel: bounds.label,
          generatedAt: new Date(),
          summary: data.totals,
          monthly: data.monthly,
          byCategory: data.byCategory,
          byMethod: data.byMethod,
          byStatus: data.byStatus,
          expensesByCategory: data.expensesByCategory,
          topClients: data.topClients,
          invoices: data.invoices,
          expenses: data.expenses,
        },
        branding ?? undefined
      );
      doc.save(`${kind}-report-${bounds.from}-to-${bounds.to}.pdf`);
      notify(kind === "monthly" ? "Monthly report downloaded" : "Six-month report downloaded");
    } catch (e: any) {
      notify(e.message ?? "Report download failed");
    } finally {
      setReportBusy(null);
    }
  };

  /** All-time snapshot, built from the data already loaded on this page. */
  const downloadFullReport = async () => {
    if (reportBusy) return;
    setReportBusy("full");
    try {
      const invoiced = Number(km.totalInvoiced ?? 0);
      const collected = Number(km.totalCollected ?? 0);
      const spent = Number(km.totalExpenses ?? 0);
      const profit = invoiced - spent;
      // The statement cards may still be loading when the button is pressed.
      // Fetch them rather than printing an empty "Statement Highlights" block.
      let stmts = statements;
      if (!stmts?.profitLoss || !stmts?.trialBalance) {
        const [tb, pl, bs, cf] = await Promise.all([
          apiFetch<any>("/capital/statements/trial-balance").catch(() => null),
          apiFetch<any>("/capital/statements/profit-loss").catch(() => null),
          apiFetch<any>("/capital/statements/balance-sheet").catch(() => null),
          apiFetch<any>("/capital/statements/cash-flow").catch(() => null),
        ]);
        stmts = { trialBalance: tb, profitLoss: pl, balanceSheet: bs, cashFlow: cf };
      }
      const { buildBusinessReportPdf } = await import("@/lib/reports-pdf");
      const doc = await buildBusinessReportPdf(
        {
          kind: "full",
          title: "Financial Report",
          periodLabel: "All-time snapshot",
          generatedAt: new Date(),
          summary: {
            invoiced,
            collected,
            expenses: spent,
            profit,
            margin: km.profitMargin ?? (invoiced ? (profit / invoiced) * 100 : 0),
            collectionRate: km.collectionRate ?? 0,
            outstanding: Number(aging?.totalOutstanding ?? 0),
          },
          monthly: (reports?.trend8 ?? []).map((t: any) => ({
            label: String(t.month ?? ""),
            invoiced: Number(t.revenue ?? 0),
            collected: Number(t.collected ?? 0),
            expenses: Number(t.expenses ?? 0),
            profit: Number(t.profit ?? 0),
          })),
          byCategory,
          byMethod,
          expensesByCategory: (budget ?? []).map((b: any) => ({
            name: b.name,
            amount: Number(b.actual ?? 0),
          })),
          statements: stmts,
        },
        branding ?? undefined
      );
      doc.save("financial-report.pdf");
      notify("Financial report downloaded");
    } catch (e: any) {
      notify(e.message ?? "Report download failed");
    } finally {
      setReportBusy(null);
    }
  };

  /** Trial balance / P&L / balance sheet / cash flow as a standalone PDF. */
  const downloadStatement = async (kind: StatementType) => {
    if (reportBusy) return;
    setReportBusy(kind);
    try {
      const source: Record<StatementType, any> = {
        "trial-balance": statements?.trialBalance,
        "profit-loss": statements?.profitLoss,
        "balance-sheet": statements?.balanceSheet,
        "cash-flow": statements?.cashFlow,
      };
      const endpoint: Record<StatementType, string> = {
        "trial-balance": "/capital/statements/trial-balance",
        "profit-loss": "/capital/statements/profit-loss",
        "balance-sheet": "/capital/statements/balance-sheet",
        "cash-flow": "/capital/statements/cash-flow",
      };
      // Always refresh from the API: the page may still be loading its queries
      // when the button is pressed, and a stale/empty prop must not print an
      // empty statement.
      let data = source[kind];
      try {
        data = await apiFetch<any>(endpoint[kind]);
      } catch {
        /* fall back to the already-loaded data */
      }
      const { buildStatementPdf, statementLabel } = await import("@/lib/reports-pdf");
      const doc = await buildStatementPdf(kind, data, branding ?? undefined);
      doc.save(`${kind}.pdf`);
      notify(`${statementLabel(kind)} downloaded`);
    } catch (e: any) {
      notify(e.message ?? "Statement download failed");
    } finally {
      setReportBusy(null);
    }
  };

  const STATEMENT_DOWNLOADS: { kind: StatementType; label: string }[] = [
    { kind: "trial-balance", label: "Trial Balance" },
    { kind: "profit-loss", label: "Profit & Loss" },
    { kind: "balance-sheet", label: "Balance Sheet" },
    { kind: "cash-flow", label: "Cash Flow" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky section jump — the report is long; one click beats scrolling. */}
      <div className="sticky top-[58px] z-30 -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-border/60 bg-card/95 p-1 shadow-sm backdrop-blur">
        {[
          { id: "rep-kpis", label: "Key metrics" },
          { id: "rep-trend", label: "Trend" },
          { id: "rep-tax", label: "Tax" },
          { id: "rep-aging", label: "Receivable aging" },
          { id: "rep-forecast", label: "Forecast" },
          { id: "rep-statements", label: "GL statements" },
          { id: "rep-payables", label: "Payable aging" },
          { id: "rep-budgets", label: "Budgets" },
          { id: "rep-recon", label: "Reconciliation" },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "auto", block: "start" })}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-micro font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {s.label}
          </button>
        ))}
      </div>
      <CardShell>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SectionTitle
              title="Download reports"
              subtitle="Pick a month, then export a print-ready A4 PDF — with company header, signature and page numbers"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">
              Month
              <input
                type="month"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-body font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary/50"
              />
            </label>
            <Btn variant="primary" onClick={() => void downloadPeriodReport("monthly")} disabled={!!reportBusy}>
              <FileDown className="size-3.5" /> {reportBusy === "monthly" ? "Building…" : "Monthly report"}
            </Btn>
            <Btn variant="outline" onClick={() => void downloadPeriodReport("six-month")} disabled={!!reportBusy}>
              <FileDown className="size-3.5" /> {reportBusy === "six-month" ? "Building…" : "6-month report"}
            </Btn>
            <Btn variant="outline" onClick={() => void downloadFullReport()} disabled={!!reportBusy}>
              <FileDown className="size-3.5" /> {reportBusy === "full" ? "Building…" : "Full report"}
            </Btn>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
            Download statement
          </span>
          {STATEMENT_DOWNLOADS.map((s) => (
            <Btn key={s.kind} variant="outline" onClick={() => void downloadStatement(s.kind)} disabled={!!reportBusy}>
              <Download className="size-3.5" /> {reportBusy === s.kind ? "Building…" : s.label}
            </Btn>
          ))}
        </div>
      </CardShell>

      <div id="rep-kpis" className="grid scroll-mt-24 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Avg Invoice Value" value={formatBDT(km.avgInvoiceValue)} sub="per invoice" tone="primary" icon={<ReceiptText className="size-4" />} />
        <StatCard label="Profit Margin" value={km.profitMargin != null ? `${Math.round(km.profitMargin)}%` : "—"} sub="recognized revenue basis" tone="sky" icon={<CircleDollarSign className="size-4" />} />
        <StatCard label="Collection Rate" value={km.collectionRate != null ? `${Math.round(km.collectionRate)}%` : "—"} sub="collected vs invoiced" tone="emerald" icon={<HandCoins className="size-4" />} />
        <StatCard label="Tax Year" value={tax.fiscalYear ?? "—"} sub={`rate ${tax.taxRate ?? 22}%`} tone="amber" icon={<Landmark className="size-4" />} />
      </div>

      <div id="rep-trend" className="grid scroll-mt-24 grid-cols-1 gap-4 xl:grid-cols-3">
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
            {byCategory.length === 0 && <p className="text-body text-muted-foreground">No expense data</p>}
            {byCategory.map((c: any) => (
              <div key={c.name} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 truncate text-body capitalize text-muted-foreground">{label(c.name)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(Number(c.amount ?? 0) / maxCat) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-body font-bold tabular-nums">{formatBDT(c.amount)}</span>
              </div>
            ))}
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Weekly Cash Flow" subtitle="income vs outflow" />
          <div className="flex flex-col gap-2.5">
            {cashFlow.length === 0 && <p className="text-body text-muted-foreground">No cash flow data</p>}
            {cashFlow.map((w: any) => {
              const empty = !Number(w.income ?? 0) && !Number(w.outflow ?? 0);
              return (
                <div key={w.week} className={cn("grid grid-cols-[64px_1fr_1fr] items-center gap-2 text-meta", empty && "opacity-40")}>
                  <span className="truncate text-muted-foreground">{w.week}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 rounded-full bg-emerald-500/80" style={{ width: `${(Number(w.income ?? 0) / maxFlow) * 100}%` }} />
                    <span className="text-micro tabular-nums text-emerald-500">{formatBDT(w.income)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 rounded-full bg-rose-500/80" style={{ width: `${(Number(w.outflow ?? 0) / maxFlow) * 100}%` }} />
                    <span className="text-micro tabular-nums text-rose-500">{formatBDT(w.outflow)}</span>
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
                      <Td className="text-body font-medium">{label(b.name)}</Td>
                      <Td className="text-right text-body tabular-nums text-muted-foreground">{formatBDT(b.planned)}</Td>
                      <Td className="text-right text-body tabular-nums">{formatBDT(b.actual)}</Td>
                      <Td className={cn("text-right text-body font-semibold tabular-nums", diff > 0 ? "text-rose-500" : "text-emerald-500")}>{diff > 0 ? "+" : ""}{formatBDT(diff)}</Td>
                    </Tr>
                  );
                })}
            </tbody>
          </table>
          </TableShell>
        </CardShell>
      </div>

      <CardShell id="rep-tax">
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
      <CardShell id="rep-aging">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_KEYS.map((b) => (
            <div key={b.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("mt-0.5 text-section font-heading font-bold tabular-nums", b.key === "90+" && Number(agingBuckets[b.key] ?? 0) > 0 ? "text-rose-500" : b.key === "CURRENT" ? "" : "text-amber-500")}>{formatBDT(agingBuckets[b.key] ?? 0)}</p>
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

      <CardShell id="rep-forecast">
        <SectionTitle title="90-Day Cash Flow Forecast" subtitle={`cash position ${formatBDT(forecast?.cashPosition ?? 0)} · projected inflow ${formatBDT(forecast?.totalInflow ?? 0)} vs outflow ${formatBDT(forecast?.totalOutflow ?? 0)}`} />
        <div className="flex flex-col gap-3">
          {forecastBuckets.length === 0 && <p className="text-body text-muted-foreground">Nothing scheduled in the next 90 days.</p>}
          {forecastBuckets.map((b: any) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-meta font-semibold">{b.label}</span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 rounded-full bg-emerald-500/80" style={{ width: `${(Number(b.inflow ?? 0) / maxForecast) * 100}%` }} />
                  <span className="text-micro tabular-nums text-emerald-500">{formatBDT(b.inflow)} in</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 rounded-full bg-rose-500/80" style={{ width: `${(Number(b.outflow ?? 0) / maxForecast) * 100}%` }} />
                  <span className="text-micro tabular-nums text-rose-500">{formatBDT(b.outflow)} out</span>
                </div>
              </div>
              <span className={cn("w-24 shrink-0 text-right text-meta font-bold tabular-nums", b.net >= 0 ? "text-emerald-500" : "text-rose-500")}>{b.net >= 0 ? "+" : ""}{formatBDT(b.net)}</span>
            </div>
          ))}
        </div>
      </CardShell>

      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="GL Statements" subtitle="double-entry ledger · all figures in BDT" />
        {statements?.trialBalance && <p className={cn("text-meta font-bold", Number(statements.trialBalance.totalDebit) === Number(statements.trialBalance.totalCredit) ? "text-emerald-500" : "text-rose-500")}>Balanced: {formatBDT(statements.trialBalance.totalDebit)} = {formatBDT(statements.trialBalance.totalCredit)}</p>}
      </div>
      <div id="rep-statements" className="grid scroll-mt-24 grid-cols-1 gap-4 xl:grid-cols-2">
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
              <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Assets</p>
              {(statements?.balanceSheet?.assets ?? []).map((a: any) => (
                <div key={a.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-body"><span>{a.name} <span className="text-micro text-muted-foreground">({a.code})</span></span><span className="font-semibold tabular-nums">{formatBDT(a.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Liabilities</p>
              {(statements?.balanceSheet?.liabilities ?? []).length === 0 && <p className="text-meta text-muted-foreground">None</p>}
              {(statements?.balanceSheet?.liabilities ?? []).map((a: any) => (
                <div key={a.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-body"><span>{a.name} <span className="text-micro text-muted-foreground">({a.code})</span></span><span className="font-semibold tabular-nums">{formatBDT(a.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Equity</p>
              <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-body">
                <span>Retained earnings</span>
                <span className="font-semibold tabular-nums">{formatBDT(statements?.balanceSheet?.retainedEarnings ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-body">
                <span>Current period profit</span>
                <span className="font-semibold tabular-nums">{formatBDT(statements?.balanceSheet?.currentProfit ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-body">
                <span className="font-bold">Total equity</span>
                <span className="font-semibold tabular-nums">{formatBDT(statements?.balanceSheet?.equity ?? 0)}</span>
              </div>
              <p className={cn("mt-2 text-meta font-semibold", statements?.balanceSheet?.balanced ? "text-emerald-500" : "text-rose-500")}>
                {statements?.balanceSheet?.balanced
                  ? "Assets = liabilities + equity ✓"
                  : `Out of balance by ${formatBDT(Number(statements?.balanceSheet?.totalAssets ?? 0) - Number(statements?.balanceSheet?.totalEquityAndLiabilities ?? 0))}`}
              </p>
            </div>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Profit & Loss" subtitle="accrual basis · period to date" />
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Revenue</p>
              {(statements?.profitLoss?.revenue ?? []).map((r: any) => (
                <div key={r.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-body"><span>{r.name} <span className="text-micro text-muted-foreground">({r.code})</span></span><span className="font-semibold tabular-nums text-emerald-500">{formatBDT(r.amount)}</span></div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Expenses</p>
              {(statements?.profitLoss?.expenses ?? []).length === 0 && <p className="text-meta text-muted-foreground">None</p>}
              {(statements?.profitLoss?.expenses ?? []).map((r: any) => (
                <div key={r.code} className="flex items-center justify-between border-b border-border/40 py-1.5 text-body"><span>{r.name} <span className="text-micro text-muted-foreground">({r.code})</span></span><span className="font-semibold tabular-nums text-rose-500">{formatBDT(r.amount)}</span></div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
              <span className="text-meta font-bold">Net Profit</span>
              <span className={cn("text-body-lg font-bold tabular-nums", Number(statements?.profitLoss?.netIncome ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(statements?.profitLoss?.netIncome ?? 0)}</span>
            </div>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Cash Flow" subtitle={`opening ${formatBDT(statements?.cashFlow?.openingBalance ?? 0)} · net ${formatBDT(statements?.cashFlow?.netOperating ?? 0)} operating · closing ${formatBDT(statements?.cashFlow?.closingBalance ?? 0)}`} />
          {statements?.cashFlow && statements.cashFlow.reconciled === false && (
            <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-600 dark:text-amber-400">
              The cash-flow statement closes at {formatBDT(statements.cashFlow.calculatedClosing ?? 0)} but the bank accounts hold {formatBDT(statements.cashFlow.closingBalance)}. A cash movement is missing from the ledger (or a bank balance was edited by hand) — post the missing entry to reconcile.
            </p>
          )}
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

      <CardShell id="rep-payables">
        <SectionTitle title="Accounts Payable Aging" subtitle={`${formatBDT(apAging?.totalPayable ?? 0)} payable to vendors as of today`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGING_KEYS.map((b) => (
            <div key={b.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("mt-0.5 text-section font-heading font-bold tabular-nums", b.key === "90+" && Number(apAging?.buckets?.[b.key] ?? 0) > 0 ? "text-rose-500" : b.key === "CURRENT" ? "" : "text-amber-500")}>{formatBDT(apAging?.buckets?.[b.key] ?? 0)}</p>
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
      <CardShell id="rep-budgets">
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
                    <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-micro font-bold", b.scopeType === "PROJECT" ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20")}>{label(b.scopeType)}</span></Td>
                    <Td className="font-medium">{b.project?.name ?? label(b.category ?? "—")}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatBDT(b.budgetAmount)}</Td>
                    <Td className="text-right tabular-nums text-rose-500">{formatBDT(spent)}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", remaining < 0 ? "text-rose-500" : "text-emerald-500")}>{formatBDT(remaining)}</Td>
                    <Td className="text-meta text-muted-foreground">{b.periodStart ? `${formatDate(b.periodStart)} → ${b.periodEnd ? formatDate(b.periodEnd) : "open"}` : "All time"}</Td>
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
      <CardShell id="rep-recon">
        {reconErr && <p className="mb-2 text-body font-medium text-rose-400">{reconErr}</p>}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div>
            <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Ledger transactions</p>
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Ref</Th><Th>Kind</Th><Th className="text-right">Amount</Th></THead>
                <tbody>
                  {(reconData?.transactions ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No transactions" /></td></tr>}
                  {(reconData?.transactions ?? []).map((t: any, i: number) => (
                    <Tr key={t.id} index={i}>
                      <Td className="text-meta text-muted-foreground">{formatDate(t.date)}</Td>
                      <Td className="text-meta">{t.ref}</Td>
                      <Td className="text-micro text-muted-foreground">{label(t.kind)}</Td>
                      <Td className={cn("text-right text-meta font-semibold tabular-nums", t.amount >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatBDT(t.amount)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
          <div>
            <p className="mb-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Statement records</p>
            <TableShell>
              <table className="w-full">
                <THead><Th>Date</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th>Status</Th></THead>
                <tbody>
                  {(reconData?.records ?? []).length === 0 && <tr><td colSpan={4} className="px-5 py-6"><EmptyState title="No statement entries" /></td></tr>}
                  {(reconData?.records ?? []).map((r: any, i: number) => (
                    <Tr key={r.id} index={i}>
                      <Td className="text-meta text-muted-foreground">{formatDate(r.statementDate)}</Td>
                      <Td className="text-meta">{r.statementReference ?? "—"}</Td>
                      <Td className="text-right text-meta font-semibold tabular-nums">{formatBDT(r.statementAmount)}</Td>
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total Revenue" value={formatBDT(summary.totalRevenue)} sub="recognized" tone="sky" icon={<CircleDollarSign className="size-4" />} />
        <StatCard label="Total Expenses" value={formatBDT(summary.totalExpenses)} sub="incl. pass-through" tone="rose" icon={<Banknote className="size-4" />} />
        <StatCard label="Net Profit" value={formatBDT(summary.netProfit)} sub={summary.margin != null ? `${Math.round(summary.margin)}% margin` : "—"} tone="emerald" icon={<HandCoins className="size-4" />} />
        <StatCard label="Avg Monthly Profit" value={formatBDT(monthly.length ? Number(summary.totalProfit ?? 0) / monthly.length : 0)} sub={`${monthly.length} months tracked`} tone="primary" icon={<Wallet className="size-4" />} />
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (ql && !a.name.toLowerCase().includes(ql) && !(a.code ?? "").toLowerCase().includes(ql)) return false;
      if (cat && a.category !== cat) return false;
      return true;
    });
  }, [accounts, q, cat]);
  const balanceOf = (id: string) => balances.find((b: any) => b.accountId === id)?.balance ?? 0;
  const detail = useMemo(() => accounts.find((a) => a.id === detailId) ?? null, [accounts, detailId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-40"><option value="">All categories</option>{ACCOUNT_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={onAdd}><Plus className="size-3.5" /> Add Account</Btn>
        </div>
      </div>

      <FadeIn>
        <TableShell footer={<span className="text-meta text-muted-foreground">{list.length} accounts · {list.filter((a) => a.isActive).length} active</span>}>
          <table className="w-full">
            <THead><Th>Code</Th><Th>Name</Th><Th>Category</Th><Th className="text-right">Ledger balance</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10"><EmptyState title="No accounts match" hint="Adjust filters or add a new account." /></td></tr>
              )}
              {list.map((a, i) => (
                <Tr key={a.id} index={i} onClick={() => setDetailId(a.id)} className={cn("cursor-pointer", detailId === a.id && "bg-primary/[0.04]")}>
                  <Td className="font-mono text-body tabular-nums text-muted-foreground">{a.code ?? "—"}</Td>
                  <Td className="font-medium">{a.name}</Td>
                  <Td><span className={cn("inline-flex rounded-full px-2 py-0.5 text-micro font-bold", a.category === "ASSET" ? "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20" : a.category === "LIABILITY" ? "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20" : a.category === "REVENUE" ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20")}>{label(a.category)}</span></Td>
                  <Td className={cn("text-right font-semibold tabular-nums", balanceOf(a.id) < 0 ? "text-rose-500" : "")}>{formatBDT(balanceOf(a.id))}</Td>
                  <Td><StatusBadge status={a.isActive ? "Active" : "Inactive"} /></Td>
                  <Td onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setDetailId(a.id)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="View details"><Eye className="size-3.5" /></button>
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

      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        eyebrow="Ledger account"
        icon={<Landmark className="size-4" />}
        title={detail?.name ?? ""}
        subtitle={detail ? `${detail.code ?? "—"} · ${label(detail.category ?? "")}` : undefined}
        size="lg"
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Btn variant="outline" onClick={() => { const a = detail; setDetailId(null); onEdit(a); }}><Pencil className="size-3.5" /> Edit account</Btn>
              {detail.isActive && <Btn variant="ghost" className="text-rose-600 hover:bg-rose-500/10" onClick={() => { const a = detail; setDetailId(null); onDelete(a); }}><Trash2 className="size-3.5" /> Deactivate</Btn>}
            </div>
          ) : null
        }
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <DetailHero
              eyebrow="Ledger balance"
              tone={balanceOf(detail.id) < 0 ? "rose" : "primary"}
              amount={formatBDT(balanceOf(detail.id))}
              chips={
                <>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">{label(detail.category ?? "")}</span>
                  <StatusBadge status={detail.isActive ? "Active" : "Inactive"} />
                </>
              }
              caption={detail.description}
            />
            <DetailSection title="Account">
              <DetailRow label="Code" mono>{detail.code ?? "—"}</DetailRow>
              <DetailRow label="Name" strong>{detail.name}</DetailRow>
              <DetailRow label="Category">{label(detail.category ?? "")}</DetailRow>
              <DetailRow label="Status">{detail.isActive ? "Active" : "Inactive"}</DetailRow>
              <DetailRow label="Normal side">{["LIABILITY", "REVENUE", "EQUITY"].includes(detail.category) ? "Credit" : "Debit"}</DetailRow>
            </DetailSection>
            {detail.description && (
              <DetailSection title="Description">
                <p className="whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">{detail.description}</p>
              </DetailSection>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function VendorsTab({ vendors, expenses, onEdit, onAdd, onDelete, onSaved }: { vendors: any[]; expenses: any[]; onEdit: (v: any) => void; onAdd: () => void; onDelete: (v: any) => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
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

  const detail = useMemo(() => vendors.find((v) => v.id === detailId) ?? null, [vendors, detailId]);
  const detailStat = detail ? expByVendor.get(detail.id) : undefined;
  const detailExpenses = useMemo(
    () => (detail ? expenses.filter((e) => e.vendorId === detail.id).slice(0, 8) : []),
    [detail, expenses]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors…" className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={onAdd} data-testid="add-vendor-btn"><UserPlus className="size-3.5" /> Add Vendor</Btn>
        </div>
      </div>

      <FadeIn>
        <TableShell footer={<span className="text-meta text-muted-foreground">{list.length} vendors · {list.filter((v) => v.isActive).length} active</span>}>
          <table className="w-full">
            <THead><Th>Name</Th><Th>Contact</Th><Th>Payment terms</Th><Th className="text-right">Expenses</Th><Th className="text-right">Payable</Th><Th>Status</Th><Th /></THead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10"><EmptyState title="No vendors" hint="Add vendors to track accounts payable." /></td></tr>
              )}
              {list.map((v, i) => {
                const stat = expByVendor.get(v.id);
                return (
                  <Tr key={v.id} index={i} onClick={() => setDetailId(v.id)} className={cn("cursor-pointer", detailId === v.id && "bg-primary/[0.04]")}>
                    <Td className="font-medium">{v.name}</Td>
                    <Td className="text-meta text-muted-foreground">{v.email ? <p>{v.email}</p> : null}{v.phone ? <p>{v.phone}</p> : null}{!v.email && !v.phone ? "—" : null}</Td>
                    <Td className="text-meta text-muted-foreground">{v.paymentTerms ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{stat?.count ?? 0}</Td>
                    <Td className={cn("text-right font-semibold tabular-nums", (stat?.payable ?? 0) > 0 ? "text-amber-500" : "text-muted-foreground")}>{formatBDT(stat?.payable ?? 0)}</Td>
                    <Td><StatusBadge status={v.isActive ? "Active" : "Inactive"} /></Td>
                    <Td onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => setDetailId(v.id)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="View details"><Eye className="size-3.5" /></button>
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

      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        eyebrow="Vendor"
        icon={<Building2 className="size-4" />}
        title={detail?.name ?? ""}
        subtitle={detail ? (detail.category ?? detail.paymentTerms ?? "Supplier") : undefined}
        size="lg"
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Btn variant="outline" onClick={() => { const v = detail; setDetailId(null); onEdit(v); }}><Pencil className="size-3.5" /> Edit vendor</Btn>
              <Btn variant="ghost" className="text-rose-600 hover:bg-rose-500/10" onClick={() => { const v = detail; setDetailId(null); onDelete(v); }}><Trash2 className="size-3.5" /> Delete</Btn>
            </div>
          ) : null
        }
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <DetailHero
              eyebrow="Payable to this vendor"
              tone="amber"
              amount={formatBDT(detailStat?.payable ?? 0)}
              chips={
                <>
                  <StatusBadge status={detail.isActive ? "Active" : "Inactive"} />
                  {detail.paymentTerms && <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">{detail.paymentTerms}</span>}
                </>
              }
              caption={`${detailStat?.count ?? 0} expense${(detailStat?.count ?? 0) === 1 ? "" : "s"} recorded with this vendor`}
            />

            <DetailSection title="Contact">
              <DetailRow label="Email">
                {detail.email ? <a href={`mailto:${detail.email}`} className="text-primary hover:underline">{detail.email}</a> : "—"}
              </DetailRow>
              <DetailRow label="Phone">
                {detail.phone ? <a href={`tel:${detail.phone}`} className="text-primary hover:underline">{detail.phone}</a> : "—"}
              </DetailRow>
              <DetailRow label="Payment terms">{detail.paymentTerms ?? "—"}</DetailRow>
              <DetailRow label="Category">{detail.category ?? "—"}</DetailRow>
            </DetailSection>

            <DetailSection title="Spend">
              <DetailRow label="Expenses" mono>{detailStat?.count ?? 0}</DetailRow>
              <DetailRow label="Still payable" mono strong>{formatBDT(detailStat?.payable ?? 0)}</DetailRow>
            </DetailSection>

            {detailExpenses.length > 0 && (
              <DetailSection title="Recent expenses">
                <div className="flex flex-col divide-y divide-border/40">
                  {detailExpenses.map((e: any) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-meta font-medium">{e.description}</p>
                        <p className="text-micro text-muted-foreground">{formatDate(e.date)} · {label(e.approvalStatus ?? "")}</p>
                      </div>
                      <span className="shrink-0 text-meta font-bold tabular-nums">{formatBDT(e.amount)}</span>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {detail.notes && (
              <DetailSection title="Notes">
                <p className="whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">{detail.notes}</p>
              </DetailSection>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function ActivityTab({ activity, refresh }: { activity: any[] | null; refresh: () => void }) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useMemo(() => (activity ?? []).find((a) => a.id === detailId) ?? null, [activity, detailId]);
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
                  <div key={a.id} onClick={() => setDetailId(a.id)} className="flex cursor-pointer items-start gap-3 rounded-xl transition-colors hover:bg-muted/40">
                    <span className={cn("mt-1 size-2 shrink-0 rounded-full", a.entityType === "PAYMENT" ? "bg-emerald-500" : a.entityType === "EXPENSE" ? "bg-amber-400" : a.entityType === "INVOICE" ? "bg-primary" : "bg-sky-400")} />
                    <div className="min-w-0 flex-1 rounded-xl border border-border/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-bold uppercase", ENTITY_TONES[a.entityType] ?? "bg-muted text-muted-foreground")}>{label(a.entityType)}</span>
                        <p className="text-body font-medium">{a.action}</p>
                        <span className="ml-auto shrink-0 text-micro text-muted-foreground/70">{timeAgo(a.timestamp)} · {a.performedBy?.name ?? "system"}</span>
                      </div>
                      {(a.beforeValue != null || a.afterValue != null) && (
                        <p className="mt-1 truncate font-mono text-micro text-muted-foreground/80">{fmtJSON(a.beforeValue)} → {fmtJSON(a.afterValue)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </FadeIn>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        eyebrow={detail ? label(detail.entityType ?? "Activity") : "Activity"}
        icon={<Clock className="size-4" />}
        title={detail?.action ?? ""}
        subtitle={detail ? `${timeAgo(detail.timestamp)} · ${detail.performedBy?.name ?? "system"}` : undefined}
        size="lg"
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <DetailSection title="Event">
              <DetailRow label="Entity">{label(detail.entityType ?? "—")}</DetailRow>
              <DetailRow label="Action">{detail.action}</DetailRow>
              <DetailRow label="Actor">{detail.performedBy?.name ?? "system"}</DetailRow>
              <DetailRow label="When">{new Date(detail.timestamp).toLocaleString()}</DetailRow>
              {detail.entityId && <DetailRow label="Record id" mono>{detail.entityId}</DetailRow>}
            </DetailSection>
            <DetailSection title="Before">
              <pre className="max-h-56 overflow-auto rounded-xl bg-muted/40 p-3 font-mono text-micro leading-relaxed">{detail.beforeValue == null ? "—" : JSON.stringify(detail.beforeValue, null, 2)}</pre>
            </DetailSection>
            <DetailSection title="After">
              <pre className="max-h-56 overflow-auto rounded-xl bg-muted/40 p-3 font-mono text-micro leading-relaxed">{detail.afterValue == null ? "—" : JSON.stringify(detail.afterValue, null, 2)}</pre>
            </DetailSection>
          </div>
        )}
      </Modal>
    </div>
  );
}

