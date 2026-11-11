"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CalendarClock, ExternalLink, FileText,
  FolderKanban, Search, Wallet,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDate } from "@/lib/format";
import { invoiceTotals } from "@/lib/invoice-utils";
import { EmptyState, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Modal } from "@/components/ui";

export type CollectionsMode = "overdue" | "unpaid" | "work";

const DEAD_STATUSES = new Set(["DRAFT", "CANCELLED", "VOID"]);

const daysPast = (dueDate?: string | null) => {
  if (!dueDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
};

const ageTone = (days: number) =>
  days >= 60
    ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
    : days >= 30
      ? "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-300"
      : days > 0
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        : "border-border bg-muted/40 text-muted-foreground";

/**
 * One place to answer "who owes me money, on which invoice, and how late" plus
 * "which projects are not actually moving". Every row deep-links to the exact
 * document (invoice detail in Capital, project workspace in Flow), so a number
 * on the client list is never a dead end again.
 */
export function CollectionsModal({
  open,
  mode,
  onClose,
  onOpenClient,
}: {
  open: boolean;
  mode: CollectionsMode;
  onClose: () => void;
  onOpenClient: (clientId: string, tab?: "invoices" | "projects") => void;
}) {
  const [tab, setTab] = useState<CollectionsMode>(mode);
  const [invoices, setInvoices] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab(mode);
    setQ("");
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<any[]>("/capital/invoices").catch(() => []),
      apiFetch<any[]>("/flow/project-lookup").catch(() => []),
    ])
      .then(([inv, prj]) => {
        if (cancelled) return;
        setInvoices(Array.isArray(inv) ? inv : []);
        setProjects(Array.isArray(prj) ? prj : []);
      })
      .catch((e: any) => !cancelled && setError(e?.message ?? "Could not load collections"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (invoices ?? [])
      .map((inv) => {
        const t = invoiceTotals(inv);
        const days = daysPast(inv.dueDate);
        return { inv, balance: t.balance, grand: t.grand, paid: t.paid, days, overdue: t.balance > 0 && days > 0 };
      })
      .filter((r) => !DEAD_STATUSES.has(r.inv.status) && r.balance > 0)
      .filter((r) => (tab === "overdue" ? r.overdue : true))
      .filter((r) => {
        if (!needle) return true;
        return `${r.inv.invoiceNumber} ${r.inv.client?.companyName ?? ""} ${r.inv.project?.name ?? ""}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => (tab === "overdue" ? b.days - a.days : b.balance - a.balance));
    return list;
  }, [invoices, tab, q]);

  const workRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => !["COMPLETED", "ARCHIVED"].includes(p.status))
      .filter((p) => ["AT_RISK", "DELAYED"].includes(p.healthStatus) || Number(p.progress ?? 0) === 0)
      .filter((p) => {
        if (!needle) return true;
        return `${p.name} ${p.client?.companyName ?? ""} ${p.status}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => Number(b.riskScore ?? 0) - Number(a.riskScore ?? 0));
  }, [projects, q]);

  const totals = useMemo(() => {
    const due = rows.reduce((s, r) => s + r.balance, 0);
    const oldest = rows.reduce((m, r) => Math.max(m, r.days), 0);
    const overdueCount = (invoices ?? []).filter((inv) => {
      const t = invoiceTotals(inv);
      return !DEAD_STATUSES.has(inv.status) && t.balance > 0 && daysPast(inv.dueDate) > 0;
    }).length;
    return { due, oldest, overdueCount };
  }, [rows, invoices]);

  const unpaidCount = useMemo(
    () => (invoices ?? []).filter((inv) => !DEAD_STATUSES.has(inv.status) && invoiceTotals(inv).balance > 0).length,
    [invoices]
  );

  const chips: { id: CollectionsMode; label: string; count: number }[] = [
    { id: "overdue", label: "Overdue", count: totals.overdueCount },
    { id: "unpaid", label: "Unpaid", count: unpaidCount },
    { id: "work", label: "Work at risk", count: workRows.length },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Collections & delivery" size="2xl">
      <div className="flex flex-col gap-3">
        {/* Headline */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-2">
            <p className="text-micro font-bold uppercase tracking-wider text-rose-500">Money to collect</p>
            <p className="mt-0.5 font-heading text-section font-bold tabular-nums text-rose-600 dark:text-rose-300">
              {formatBDT(totals.due)}
            </p>
            <p className="text-micro text-muted-foreground">
              {totals.overdueCount} overdue · {unpaidCount} unpaid
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
            <p className="text-micro font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">Oldest overdue</p>
            <p className="mt-0.5 font-heading text-section font-bold tabular-nums">{totals.oldest ? `${totals.oldest}d` : "—"}</p>
            <p className="text-micro text-muted-foreground">chase the oldest first</p>
          </div>
          <div className="col-span-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 sm:col-span-1">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Work at risk</p>
            <p className="mt-0.5 font-heading text-section font-bold tabular-nums">{workRows.length}</p>
            <p className="text-micro text-muted-foreground">not moving / delayed</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setTab(c.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-meta font-bold transition-colors",
                tab === c.id ? "bg-brand-gradient text-white" : "border border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {c.label}
              <span className={cn("rounded-full px-1.5 py-px text-micro tabular-nums", tab === c.id ? "bg-white/20" : "bg-muted")}>{c.count}</span>
            </button>
          ))}
          <div className="relative ml-auto w-full max-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "work" ? "Search project or client…" : "Search invoice or client…"}
              className="w-full rounded-lg border border-border bg-card py-1 pl-8 pr-2.5 text-meta outline-none placeholder:text-muted-foreground focus:border-primary/40"
            />
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}</div>
          ) : error ? (
            <EmptyState title={error} hint="Close and try again" />
          ) : tab === "work" ? (
            workRows.length === 0 ? (
              <EmptyState title="Delivery looks healthy" hint="No delayed project or zero-progress project right now." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {workRows.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
                      <FolderKanban className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold">{p.name}</p>
                      <p className="truncate text-micro text-muted-foreground">
                        {p.client?.companyName ?? "No client"}
                        {p.assignedPm?.name ? ` · PM ${p.assignedPm.name}` : ""}
                        {p.targetEndDate ? ` · due ${formatDate(p.targetEndDate)}` : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, Math.max(0, Number(p.progress ?? 0)))}%` }} />
                        </div>
                        <span className="text-micro tabular-nums text-muted-foreground">{Number(p.progress ?? 0)}%</span>
                        {p.riskScore != null && <span className="rounded-full bg-muted px-1.5 py-px text-micro font-bold">risk {p.riskScore}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      {p.healthStatus && <StatusBadge status={p.healthStatus} />}
                      {p.client?.id && (
                        <Btn variant="ghost" onClick={() => { onClose(); onOpenClient(p.client.id, "projects"); }} className="!px-2 !py-1 text-micro">
                          Client
                        </Btn>
                      )}
                      <Link
                        href={`/flow/${p.id}`}
                        onClick={onClose}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-micro font-bold text-primary transition-colors hover:bg-muted"
                      >
                        Open <ExternalLink className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : rows.length === 0 ? (
            <EmptyState
              title={tab === "overdue" ? "Nothing overdue" : "Nothing unpaid"}
              hint={tab === "overdue" ? "Every issued invoice is inside its due date." : "Every issued invoice is settled."}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {rows.map(({ inv, balance, grand, paid, days, overdue }) => (
                <div key={inv.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", overdue ? "bg-rose-500/10 text-rose-500" : "bg-sky-500/10 text-sky-500")}>
                    {overdue ? <AlertTriangle className="size-3.5" /> : <Wallet className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-body font-semibold">{inv.client?.companyName ?? "Unknown client"}</span>
                      <span className="rounded bg-muted px-1.5 py-px text-micro font-bold tabular-nums">{inv.invoiceNumber}</span>
                      {overdue && (
                        <span className={cn("rounded-full border px-1.5 py-px text-micro font-bold", ageTone(days))}>
                          {days}d overdue
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-micro text-muted-foreground">
                      {inv.project?.name ? `${inv.project.name} · ` : ""}
                      issued {formatDate(inv.issueDate)}
                      {inv.dueDate ? ` · due ${formatDate(inv.dueDate)}` : " · no due date"}
                      {" · "}{formatBDT(paid)} paid of {formatBDT(grand)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="font-heading text-body-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatBDT(balance)}</span>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Btn variant="ghost" onClick={() => { onClose(); onOpenClient(inv.clientId ?? inv.client?.id, "invoices"); }} className="!px-2 !py-1 text-micro">
                      Client
                    </Btn>
                    <Link
                      href={`/capital/invoices?clientId=${inv.clientId ?? inv.client?.id ?? ""}&inv=${inv.id}`}
                      onClick={onClose}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-2 py-1 text-micro font-bold text-white transition-opacity hover:opacity-90"
                    >
                      <FileText className="size-3.5" /> Invoice
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <p className="flex items-center gap-1 text-micro text-muted-foreground">
            <CalendarClock className="size-3.5" /> Invoice rows open the exact bill in Capital — payments, installments and reminders live there.
          </p>
          <Link href="/capital/invoices?quick=overdue" onClick={onClose} className="inline-flex items-center gap-1 text-meta font-bold text-primary hover:underline">
            All invoices <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </Modal>
  );
}
