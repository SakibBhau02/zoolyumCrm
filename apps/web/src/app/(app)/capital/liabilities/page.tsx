"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  CalendarClock,
  ChevronRight,
  Clock,
  HandCoins,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api";
import { useCapital } from "../_components/capital-context";
import { formatBDT, formatDate, formatDay } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { PAYMENT_METHODS, label } from "../_components/constants";
/* ────────────────────────────────────────────────────────────────────────────
   Liabilities — vendor commitments, advances and the balance still owed.

   The screen answers four questions in order:
     1. How much do we owe in total?       → KPI row
     2. How urgent is it?                  → aging buckets
     3. Who are we exposed to?             → vendor balances
     4. What exactly did we agree?         → table → drawer → payments
   ──────────────────────────────────────────────────────────────────────────── */

const money = (n: any) => `৳${Math.round(Number(n ?? 0)).toLocaleString("en-US")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

const CATEGORIES = [
  { value: "CREW", label: "Crew / DOP" },
  { value: "EQUIPMENT", label: "Equipment rental" },
  { value: "STUDIO", label: "Studio" },
  { value: "LOCATION", label: "Location" },
  { value: "POST_PRODUCTION", label: "Post-production" },
  { value: "TALENT", label: "Talent" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "CATERING", label: "Catering" },
  { value: "FREELANCE", label: "Freelancer" },
  { value: "OTHER", label: "Other" },
];

const PAY_TYPES = [
  { value: "ADVANCE", label: "Advance" },
  { value: "PARTIAL", label: "Part payment" },
  { value: "FINAL", label: "Final settlement" },
  { value: "REFUND", label: "Refund from vendor" },
];

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open (balance > 0)" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PAID", label: "Fully paid" },
  { value: "ACTIVE", label: "Active (in progress)" },
  { value: "COMPLETED", label: "Delivered" },
  { value: "DRAFT", label: "Draft" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

function statusOf(r: any) {
  if (r.status === "CANCELLED") return { label: "Cancelled", tone: "bg-muted text-muted-foreground ring-1 ring-border", dot: "bg-muted-foreground" };
  if (r.overdue) return { label: `Overdue ${r.daysOverdue}d`, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20", dot: "bg-rose-500" };
  if (r.balance <= 0) return { label: "Paid", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20", dot: "bg-emerald-500" };
  if (r.status === "COMPLETED") return { label: "Delivered · unpaid", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20", dot: "bg-amber-500" };
  if (r.paid > 0) return { label: "Part paid", tone: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20", dot: "bg-sky-500" };
  if (r.status === "DRAFT") return { label: "Draft", tone: "bg-muted text-muted-foreground ring-1 ring-border", dot: "bg-muted-foreground" };
  return { label: "Open", tone: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20", dot: "bg-sky-500" };
}

function Pill({ r }: { r: any }) {
  const s = statusOf(r);
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-semibold", s.tone)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

function Kpi({
  label: l,
  value,
  hint,
  icon,
  tone,
  tile,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: string;
  tile?: string;
}) {
  return (
    <CardShell className="relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex size-9 items-center justify-center rounded-xl", tile ?? "bg-primary/10 text-primary")}>{icon}</span>
      </div>
      <p className={cn("mt-3 font-heading text-stat font-bold leading-none tracking-tight tabular-nums", tone)}>{value}</p>
      <p className="mt-1.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
      <p className="mt-1 truncate text-micro text-muted-foreground">{hint}</p>
    </CardShell>
  );
}

function LiabilitiesContent() {
  const { data, loading, mutate } = useApi<any>("/capital/engagements");
  const c = useCapital();
  const params = useSearchParams();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "OPEN");
  const [vendorId, setVendorId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<any>(null);
  const [completeFor, setCompleteFor] = useState<any>(null);

  const rows: any[] = data?.rows ?? [];
  const summary = data?.summary ?? {};
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status) {
        if (["OPEN", "OVERDUE", "PAID"].includes(status)) {
          if (status === "OPEN" && !(r.balance > 0)) return false;
          if (status === "OVERDUE" && !r.overdue) return false;
          if (status === "PAID" && r.balance > 0) return false;
        } else if (r.status !== status) return false;
      }
      if (vendorId && r.vendorId !== vendorId) return false;
      if (projectId && r.projectId !== projectId) return false;
      if (needle) {
        const hay = `${r.reference} ${r.title} ${r.vendor?.name ?? ""} ${r.project?.name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, status, vendorId, projectId]);

  const refresh = () => {
    mutate();
    c.reload();
  };

  const aging = data?.aging ?? {};
  const agingMax = Math.max(...Object.values(aging as Record<string, number>), 1);
  const overduePct = summary.totalPayable ? Math.round((summary.overdueAmount / summary.totalPayable) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-heading text-section font-semibold">Vendor liabilities</p>
          <p className="text-meta text-muted-foreground">
            What we agreed, what we already paid, and what is still owed — with TDS and due dates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New engagement
          </Btn>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total owed"
          value={formatBDT(summary.combinedPayable ?? 0)}
          hint={`${formatBDT(summary.totalPayable ?? 0)} contracts · ${formatBDT(summary.otherPayables ?? 0)} other bills`}
          icon={<Wallet className="size-4" />}
          tone="text-foreground"
        />
        <Kpi
          label="Paid to vendors"
          value={formatBDT(summary.totalPaid ?? 0)}
          hint={`${formatBDT(summary.totalCommitted ?? 0)} committed in total`}
          icon={<Banknote className="size-4" />}
          tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />
        <Kpi
          label="Overdue"
          value={formatBDT(summary.combinedOverdue ?? 0)}
          hint={`${summary.overdueCount ?? 0} contract(s) past due${overduePct ? ` · ${overduePct}% of payables` : ""}`}
          icon={<AlertTriangle className="size-4" />}
          tone={(summary.combinedOverdue ?? 0) > 0 ? "text-rose-500" : undefined}
          tile="bg-rose-500/10 text-rose-600 dark:text-rose-400"
        />
        <Kpi
          label="Due next 7 days"
          value={formatBDT(summary.dueWeekAmount ?? 0)}
          hint={`${summary.dueWeekCount ?? 0} commitment(s) · ${summary.openCount ?? 0} open`}
          icon={<CalendarClock className="size-4" />}
          tile="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        />
      </div>

      {/* Aging + vendor exposure */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <CardShell className="xl:col-span-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-widest text-muted-foreground">
                <Clock className="size-3.5" /> Payables aging
              </p>
              <p className="mt-0.5 text-meta text-muted-foreground">How long the unpaid balance has been sitting past its due date.</p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold tabular-nums">{formatBDT(summary.totalPayable ?? 0)}</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
            {[
              { key: "CURRENT", label: "Current", tone: "bg-emerald-500" },
              { key: "1-30", label: "1–30d", tone: "bg-amber-500" },
              { key: "31-60", label: "31–60d", tone: "bg-orange-500" },
              { key: "61-90", label: "61–90d", tone: "bg-rose-500" },
              { key: "90+", label: "90d+", tone: "bg-rose-700" },
            ].map((b) => {
              const v = Number(aging[b.key] ?? 0);
              return (
                <div key={b.key} className="rounded-xl border border-border/60 bg-muted/20 px-2.5 py-2">
                  <p className={cn("text-body-lg font-bold tabular-nums", v > 0 && b.key !== "CURRENT" ? "text-foreground" : "text-foreground")}>{formatBDT(v)}</p>
                  <p className="mt-0.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{b.label}</p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", b.tone)} style={{ width: `${Math.max(2, (v / agingMax) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-2.5 text-micro">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Advances outstanding {formatBDT(summary.advanceOutstanding ?? 0)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">Retention held {formatBDT(summary.retentionHeld ?? 0)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">{summary.vendorCount ?? 0} vendors</span>
            {summary.onTimeRate != null && (
              <span className={cn("rounded-full px-2 py-0.5 font-semibold", summary.onTimeRate >= 80 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>
                On-time payments {summary.onTimeRate}% ({summary.settledCount} settled)
              </span>
            )}
            {(summary.otherPayables ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400">
                Other vendor bills {formatBDT(summary.otherPayables)}
              </span>
            )}
          </div>
        </CardShell>

        <CardShell>
          <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-widest text-muted-foreground">
            <Users className="size-3.5" /> Exposure by vendor
          </p>
          <p className="mt-0.5 text-meta text-muted-foreground">Who we owe the most right now.</p>
          <div className="mt-3 flex flex-col gap-2">
            {(data?.byVendor ?? []).filter((v: any) => v.balance > 0).slice(0, 5).map((v: any) => (
              <div key={v.id} className="flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-micro font-bold">
                  {v.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-meta font-medium">{v.name}</span>
                  <span className="block text-micro text-muted-foreground">
                    {formatBDT(v.paid)} paid of {formatBDT(v.total)}
                    {v.overdue > 0 ? ` · ${formatBDT(v.overdue)} overdue` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-meta font-bold tabular-nums">{formatBDT(v.balance)}</span>
              </div>
            ))}
            {!(data?.byVendor ?? []).some((v: any) => v.balance > 0) && (
              <p className="py-6 text-center text-meta text-muted-foreground">Nothing owed right now.</p>
            )}
          </div>
        </CardShell>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, project, reference…" className="w-[240px] pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[180px]">
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
        <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-[170px]">
          <option value="">All vendors</option>
          {(c.vendors ?? []).map((v: any) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-[180px]">
          <option value="">All projects</option>
          {(c.projects ?? []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <span className="ml-auto text-meta text-muted-foreground">{filtered.length} of {rows.length} records</span>
      </div>

      {/* Table */}
      {loading && !data ? (
        <CardShell><p className="py-10 text-center text-body text-muted-foreground">Loading liabilities…</p></CardShell>
      ) : filtered.length === 0 ? (
        <CardShell>
          <EmptyState
            title={rows.length === 0 ? "No vendor commitments yet" : "Nothing matches these filters"}
            hint={rows.length === 0 ? "Add the first deal — e.g. a DOP for ৳7,000 with a ৳3,000 advance — and the balance appears here automatically." : "Try clearing the status or vendor filter."}
          />
        </CardShell>
      ) : (
        <TableShell
          footer={
            <>
              <span className="text-meta text-muted-foreground">Click any row for the payment history and actions.</span>
              <span className="text-meta font-semibold tabular-nums">Balance shown: {formatBDT(filtered.reduce((s, r) => s + r.balance, 0))}</span>
            </>
          }
        >
          <table className="w-full">
            <THead>
              <Th>Engagement</Th>
              <Th>Vendor</Th>
              <Th className="hidden md:table-cell">Project</Th>
              <Th className="text-right">Agreed</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th className="hidden lg:table-cell">Due</Th>
              <Th>Status</Th>
              <Th />
            </THead>
            <tbody>
              {filtered.map((r, i) => (
                <Tr key={r.id} index={i} onClick={() => setSelectedId(r.id)}>
                  <Td>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-micro text-muted-foreground">{r.reference} · {label(r.category)}</p>
                  </Td>
                  <Td>
                    <p>{r.vendor?.name ?? "—"}</p>
                    <p className="text-micro text-muted-foreground">{r.client?.companyName ?? "No client"}</p>
                  </Td>
                  <Td className="hidden md:table-cell text-muted-foreground">{r.project?.name ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{money(r.totalAmount)}</Td>
                  <Td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(r.paid)}</Td>
                  <Td className={cn("text-right font-semibold tabular-nums", r.overdue ? "text-rose-500" : "")}>{money(r.balance)}</Td>
                  <Td className="hidden lg:table-cell text-muted-foreground">
                    {r.dueDate ? formatDay(r.dueDate) : "—"}
                    {r.overdue && <span className="ml-1 text-micro font-semibold text-rose-500">{r.daysOverdue}d</span>}
                  </Td>
                  <Td><Pill r={r} /></Td>
                  <Td className="text-right"><ChevronRight className="size-3.5 text-muted-foreground/50" /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      {/* Create / edit */}
      <Modal
        open={createOpen || !!editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.reference}` : "New vendor engagement"}
        size="lg"
      >
        <EngagementForm
          key={editing?.id ?? "new"}
          editing={editing}
          vendors={c.vendors ?? []}
          projects={c.projects ?? []}
          bankAccounts={c.bankAccounts ?? []}
          onDone={(saved) => {
            setCreateOpen(false);
            setEditing(null);
            refresh();
            if (saved?.id) setSelectedId(saved.id);
          }}
        />
      </Modal>

      {/* Payment */}
      <Modal
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={payFor ? `Record payment — ${payFor.reference}` : "Record payment"}
      >
        {payFor && (
          <PaymentForm
            key={payFor.id}
            engagement={payFor}
            bankAccounts={c.bankAccounts ?? []}
            onDone={() => {
              setPayFor(null);
              refresh();
            }}
          />
        )}
      </Modal>

      {/* Complete */}
      <Modal
        open={!!completeFor}
        onClose={() => setCompleteFor(null)}
        title={completeFor ? `Mark delivered — ${completeFor.reference}` : "Mark delivered"}
      >
        {completeFor && (
          <CompleteForm
            key={completeFor.id}
            engagement={completeFor}
            onDone={() => {
              setCompleteFor(null);
              refresh();
            }}
          />
        )}
      </Modal>

      {/* Engagement detail */}
      <Modal
        open={!!selected}
        onClose={() => setSelectedId(null)}
        eyebrow="Payable engagement"
        icon={<HandCoins className="size-4" />}
        title={
          selected ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate">{selected.title}</span>
              <Pill r={selected} />
            </span>
          ) : ""
        }
        subtitle={selected ? `${selected.reference} · ${selected.vendor?.name ?? "—"}` : undefined}
        size="lg"
        footer={
          selected ? (
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="primary" onClick={() => setPayFor(selected)} disabled={selected.balance <= 0}>
                <Banknote className="size-3.5" /> Record payment
              </Btn>
              {selected.status !== "COMPLETED" && (
                <Btn variant="outline" onClick={() => setCompleteFor(selected)}>
                  <BadgeCheck className="size-3.5" /> Mark delivered
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setEditing(selected)}>
                <Pencil className="size-3.5" /> Edit
              </Btn>
              <Link href={`/capital/vendors`} className="ml-auto text-meta font-semibold text-primary hover:underline">
                Vendor directory
              </Link>
            </div>
          ) : null
        }
      >
        {selected && <EngagementDetail r={selected} onChange={refresh} />}
      </Modal>
    </div>
  );
}

/* ── Detail view ──────────────────────────────────────────────────────────── */

function EngagementDetail({ r, onChange }: { r: any; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(null);
  const pct = r.totalAmount > 0 ? Math.min(100, Math.round((r.paid / r.totalAmount) * 100)) : 0;

  const act = async (kind: "cancel" | "delete") => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/capital/engagements/${r.id}${kind === "cancel" ? "/cancel" : ""}`, {
        method: kind === "cancel" ? "POST" : "DELETE",
      });
      setConfirming(null);
      onChange();
    } catch (e: any) {
      setError(e.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-section font-bold tabular-nums">{money(r.totalAmount)}</p>
          <p className="mt-0.5 text-micro uppercase tracking-wide text-muted-foreground">Agreed</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-section font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{money(r.paid)}</p>
          <p className="mt-0.5 text-micro uppercase tracking-wide text-muted-foreground">Paid</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
          <p className={cn("text-section font-bold tabular-nums", r.balance > 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400")}>{money(r.balance)}</p>
          <p className="mt-0.5 text-micro uppercase tracking-wide text-muted-foreground">Balance</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-micro text-muted-foreground">
          <span>{pct}% settled</span>
          <span>{r.retention > 0 ? `Retention ${money(r.retention)}` : r.taxWithheld > 0 ? `TDS ${money(r.taxWithheld)}` : ""}</span>
        </div>
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
          <div className="h-full bg-rose-500/60" style={{ width: `${Math.max(0, 100 - pct)}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border/60 p-3 text-meta">
        <Meta k="Vendor" v={r.vendor?.name ?? "—"} />
        <Meta k="Category" v={label(r.category)} />
        <Meta k="Project" v={r.project?.name ?? "No project"} />
        <Meta k="Client" v={r.client?.companyName ?? "—"} />
        <Meta k="Due" v={r.dueDate ? formatDate(r.dueDate) : "—"} danger={r.overdue} />
        <Meta k="Started" v={r.startDate ? formatDate(r.startDate) : "—"} />
        <Meta k="Terms" v={r.paymentTerms || "—"} />
        <Meta k="Bill" v={r.billNumber ? `${r.billNumber}${r.billReceivedAt ? ` · ${formatDay(r.billReceivedAt)}` : ""}` : "Not received"} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">Payment history</p>
          <span className="text-micro text-muted-foreground">{r.payments?.length ?? 0} entries</span>
        </div>
        {(r.payments ?? []).length === 0 ? (
          <p className="rounded-xl bg-muted/30 px-3 py-4 text-center text-meta text-muted-foreground">
            No payments yet. The full {money(r.totalAmount)} is still owed.
          </p>
        ) : (
          <div className="flex flex-col">
            {(r.payments ?? []).map((p: any) => (
              <div key={p.id} className="flex items-center gap-2.5 border-b border-border/50 py-2 last:border-0">
                <span className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  p.type === "REFUND" ? "bg-rose-500/10 text-rose-500" : p.type === "ADVANCE" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                )}>
                  {p.type === "REFUND" ? <ArrowLeftRight className="size-3.5" /> : <Banknote className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-meta font-medium">{label(p.type)} · {label(p.paymentMethod)}</span>
                  <span className="block text-micro text-muted-foreground">
                    {formatDate(p.paymentDate)}
                    {p.referenceId ? ` · ${p.referenceId}` : ""}
                    {p.taxWithheld > 0 ? ` · TDS ${money(p.taxWithheld)}` : ""}
                  </span>
                </span>
                <span className={cn("shrink-0 text-body font-bold tabular-nums", p.type === "REFUND" ? "text-rose-500" : "text-foreground")}>
                  {p.type === "REFUND" ? "−" : ""}{money(p.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-meta text-rose-600 dark:text-rose-300">{error}</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        {confirming ? (
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-rose-500/5 px-3 py-2">
            <span className="text-meta text-rose-600 dark:text-rose-300">
              {confirming === "delete" ? "Delete this engagement?" : "Cancel this engagement?"}
            </span>
            <span className="flex gap-2">
              <Btn variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>Keep</Btn>
              <Btn variant="outline" className="border-rose-500/40 text-rose-600" onClick={() => void act(confirming)} disabled={busy}>
                {busy ? "Working…" : "Confirm"}
              </Btn>
            </span>
          </div>
        ) : (
          <>
            {r.status !== "CANCELLED" && r.status !== "COMPLETED" && r.paid === 0 && (
              <Btn variant="ghost" onClick={() => setConfirming("cancel")}>
                <X className="size-3.5" /> Cancel engagement
              </Btn>
            )}
            {r.status !== "COMPLETED" && r.paid === 0 && (
              <Btn variant="ghost" className="text-rose-600 hover:bg-rose-500/10" onClick={() => setConfirming("delete")}>
                <Trash2 className="size-3.5" /> Delete
              </Btn>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Meta({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-micro uppercase tracking-wide text-muted-foreground">{k}</p>
      <p className={cn("truncate font-medium", danger && "text-rose-500")}>{v}</p>
    </div>
  );
}

/* ── Forms ────────────────────────────────────────────────────────────────── */

function EngagementForm({
  editing,
  vendors,
  projects,
  bankAccounts,
  onDone,
}: {
  editing: any;
  vendors: any[];
  projects: any[];
  bankAccounts: any[];
  onDone: (saved?: any) => void;
}) {
  const [form, setForm] = useState<any>({
    vendorId: editing?.vendorId ?? "",
    title: editing?.title ?? "",
    category: editing?.category ?? "CREW",
    projectId: editing?.projectId ?? "",
    totalAmount: editing ? String(editing.totalAmount) : "",
    startDate: editing?.startDate ? String(editing.startDate).slice(0, 10) : todayStr(),
    dueDate: editing?.dueDate ? String(editing.dueDate).slice(0, 10) : "",
    paymentTerms: editing?.paymentTerms ?? "",
    retentionPct: editing ? String(editing.retentionPct ?? 0) : "",
    notes: editing?.notes ?? "",
    advanceAmount: "",
    advanceMethod: "BANK_TRANSFER",
    advanceBankId: bankAccounts[0]?.id ?? "",
    advanceDate: todayStr(),
    taxWithheld: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const project = projects.find((p) => p.id === form.projectId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: any = {
        vendorId: form.vendorId,
        title: form.title,
        category: form.category,
        projectId: form.projectId || null,
        totalAmount: Number(form.totalAmount),
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        paymentTerms: form.paymentTerms || null,
        retentionPct: form.retentionPct ? Number(form.retentionPct) : 0,
        notes: form.notes || null,
      };
      if (!editing && Number(form.advanceAmount) > 0) {
        payload.initialPayment = {
          amount: Number(form.advanceAmount),
          type: "ADVANCE",
          paymentMethod: form.advanceMethod,
          bankAccountId: form.advanceBankId || undefined,
          paymentDate: form.advanceDate || todayStr(),
          taxWithheld: Number(form.taxWithheld) || 0,
        };
      }
      const saved = editing
        ? await apiFetch(`/capital/engagements/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await apiFetch("/capital/engagements", { method: "POST", body: JSON.stringify(payload) });
      onDone(saved);
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Vendor *">
          <Select value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
            <option value="">Select a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.category ? ` · ${v.category}` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="What are you hiring for? *">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. DOP — full-day shoot" />
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Agreed amount (৳) *">
          <Input type="number" min="0" step="0.01" value={form.totalAmount} onChange={(e) => set("totalAmount", e.target.value)} placeholder="7000" />
        </Field>
        <Field label="Project (optional)" hint={project ? `Linked project: ${project.name}` : "Link it to a project for cost tracking"}>
          <Select value={form.projectId} onChange={(e) => set("projectId", e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Payment terms" hint="How the balance will be settled">
          <Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="3,000 advance, 4,000 on delivery" />
        </Field>
        <Field label="Start date">
          <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        <Field label="Balance due date" hint="Used for aging and overdue alerts">
          <Input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label="Retention / holdback (%)" hint="Optional — money held until sign-off">
          <Input type="number" min="0" max="100" step="0.01" value={form.retentionPct} onChange={(e) => set("retentionPct", e.target.value)} placeholder="0" />
        </Field>
      </div>

      {!editing && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
          <p className="flex items-center gap-1.5 text-meta font-semibold text-primary"><Banknote className="size-3.5" /> Advance paid now (optional)</p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            The deal is recorded in full; only this amount leaves the bank today. The rest shows as the remaining liability.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Advance (৳)">
              <Input type="number" min="0" step="0.01" value={form.advanceAmount} onChange={(e) => set("advanceAmount", e.target.value)} placeholder="3000" />
            </Field>
            <Field label="Method">
              <Select value={form.advanceMethod} onChange={(e) => set("advanceMethod", e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
              </Select>
            </Field>
            <Field label="Bank / cash account">
              <Select value={form.advanceBankId} onChange={(e) => set("advanceBankId", e.target.value)}>
                <option value="">Default</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.accountName}</option>)}
              </Select>
            </Field>
            <Field label="TDS withheld (৳)">
              <Input type="number" min="0" step="0.01" value={form.taxWithheld} onChange={(e) => set("taxWithheld", e.target.value)} placeholder="0" />
            </Field>
          </div>
        </div>
      )}

      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Call time, deliverables, bank details, anything the team should know…" />
      </Field>

      {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-meta text-rose-600 dark:text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
        <Btn variant="ghost" onClick={() => onDone()}>Cancel</Btn>
        <Btn variant="primary" onClick={() => void submit()} disabled={busy || !form.vendorId || !form.title || !Number(form.totalAmount)}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create engagement"}
        </Btn>
      </div>
    </div>
  );
}

function PaymentForm({ engagement, bankAccounts, onDone }: { engagement: any; bankAccounts: any[]; onDone: () => void }) {
  const [form, setForm] = useState<any>({
    amount: String(engagement.balance),
    type: engagement.paid === 0 ? "ADVANCE" : "FINAL",
    paymentMethod: "BANK_TRANSFER",
    bankAccountId: bankAccounts[0]?.id ?? "",
    paymentDate: todayStr(),
    referenceId: "",
    taxWithheld: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const amount = Number(form.amount) || 0;
  const tax = Number(form.taxWithheld) || 0;
  const isRefund = form.type === "REFUND";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/capital/engagements/${engagement.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          type: form.type,
          paymentMethod: form.paymentMethod,
          bankAccountId: form.bankAccountId || undefined,
          paymentDate: form.paymentDate,
          referenceId: form.referenceId || undefined,
          taxWithheld: tax,
          notes: form.notes || undefined,
        }),
      });
      onDone();
    } catch (e: any) {
      setError(e.message ?? "Could not record payment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center justify-between text-meta">
          <span className="text-muted-foreground">Agreed</span><span className="font-semibold tabular-nums">{money(engagement.totalAmount)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-meta">
          <span className="text-muted-foreground">Already paid</span><span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(engagement.paid)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-meta">
          <span className="text-muted-foreground">Balance</span><span className="font-bold tabular-nums text-rose-500">{money(engagement.balance)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (৳) *">
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
            {PAY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </Select>
        </Field>
        <Field label="Pay from">
          <Select value={form.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
            <option value="">Default account</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.accountName} · {formatBDT(b.currentBalance)}</option>)}
          </Select>
        </Field>
        <Field label="Reference / cheque no.">
          <Input value={form.referenceId} onChange={(e) => set("referenceId", e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="TDS / VDS withheld (৳)" hint={isRefund ? "Not used for refunds" : `Vendor receives ${money(amount - tax)}`}>
          <Input type="number" min="0" step="0.01" value={form.taxWithheld} onChange={(e) => set("taxWithheld", e.target.value)} placeholder="0" disabled={isRefund} />
        </Field>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-meta text-rose-600 dark:text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
        <Btn variant="primary" onClick={() => void submit()} disabled={busy || amount <= 0}>
          {busy ? "Recording…" : isRefund ? "Record refund" : `Pay ${money(amount)}`}
        </Btn>
      </div>
    </div>
  );
}

function CompleteForm({ engagement, onDone }: { engagement: any; onDone: () => void }) {
  const [deliveredAt, setDeliveredAt] = useState(todayStr());
  const [billNumber, setBillNumber] = useState("");
  const [billReceivedAt, setBillReceivedAt] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/capital/engagements/${engagement.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ deliveredAt, billNumber: billNumber || undefined, billReceivedAt }),
      });
      onDone();
    } catch (e: any) {
      setError(e.message ?? "Could not complete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-300">
        Marking this delivered moves {money(engagement.totalAmount)} from a commitment into Accounts Payable and recognises the cost in the P&amp;L. Only do it when the work is actually done.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Delivered on">
          <Input type="date" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} />
        </Field>
        <Field label="Vendor bill number">
          <Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Bill received on">
          <Input type="date" value={billReceivedAt} onChange={(e) => setBillReceivedAt(e.target.value)} />
        </Field>
      </div>
      {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-meta text-rose-600 dark:text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
        <Btn variant="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Posting…" : "Mark delivered & post cost"}
        </Btn>
      </div>
    </div>
  );
}

export default function LiabilitiesPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-body text-muted-foreground">Loading…</div>}>
      <LiabilitiesContent />
    </Suspense>
  );
}
