"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  AlarmClock,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileCheck2,
  HandCoins,
  ListTodo,
  Loader2,
  Send,
  Users,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBDT, formatDay, formatNumber } from "@/lib/format";
import { Money, MaskAmounts } from "@/lib/privacy";
import { cn } from "@/components/shared";
import { useToast } from "@/components/toast";
import { Panel, PanelLink, severityTone } from "./primitives";

/* ────────────────────────────────────────────────────────────────────────────
   Action Center — one place for "what needs me now".

   Four tabs that used to live in three different blocks (Needs attention,
   Inbox approvals, Today's work): Attention · Approvals · Follow-ups · Overdue
   tasks. Every row can be acted on without leaving the dashboard.
   ──────────────────────────────────────────────────────────────────────────── */

type Tab = "attention" | "approvals" | "followups" | "overdue";

const SNOOZE_KEY = "zoolyum-dashboard-snooze";

function readSnoozes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function alertMetric(a: any) {
  if (a.kind === "money") return formatBDT(a.metric);
  if (a.kind === "percent") return `${Math.round(a.metric)}%`;
  if (a.kind === "ratio") return `${a.metric}x`;
  return formatNumber(a.metric);
}

export function ActionCenter({
  data,
  onChanged,
}: {
  data: any;
  onChanged: () => void;
}) {
  const toast = useToast();
  const today = data?.today ?? {};
  const [tab, setTab] = useState<Tab>("attention");
  const [handled, setHandled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSnoozed(readSnoozes());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const snooze = (id: string) => {
    const next = { ...snoozed, [id]: Date.now() + 60 * 60 * 1000 };
    setSnoozed(next);
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast.push({ title: "Snoozed for 1 hour", tone: "info" });
  };

  /** One click on the overdue alert logs a chase against every open invoice. */
  const markReminded = async () => {
    const invoices: any[] = data?.capital?.overdueInvoices ?? [];
    if (!invoices.length) return;
    setBusy("remind");
    try {
      const created: { invoiceId: string; reminderId?: string }[] = [];
      for (const invoice of invoices) {
        const row = await apiFetch<any>(`/capital/invoices/${invoice.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            type: "PAYMENT_REMINDER",
            channel: "system",
            notes: "Chased from the dashboard Action Center",
          }),
        });
        created.push({ invoiceId: invoice.id, reminderId: row?.id });
      }
      onChanged();
      toast.undo(
        `Marked ${created.length} invoice${created.length === 1 ? "" : "s"} as reminded`,
        async () => {
          for (const row of created) {
            if (row.reminderId) {
              await apiFetch(`/capital/invoices/${row.invoiceId}/reminders/${row.reminderId}`, {
                method: "DELETE",
              });
            }
          }
          onChanged();
        },
        "Open an invoice to send the actual message."
      );
    } catch (e: any) {
      toast.push({ title: "Could not log the reminder", description: e.message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const alerts = useMemo(
    () =>
      (data?.alerts ?? []).filter(
        (a: any) => !handled[`alert:${a.id}`] && !(snoozed[a.id] > now)
      ),
    [data?.alerts, handled, snoozed, now]
  );

  const approvals = today.approvalItems ?? { expenses: [], leave: [], deliverables: [] };
  const approvalRows = [
    ...(approvals.expenses ?? []).map((e: any) => ({
      key: `expense:${e.id}`,
      kind: "expense" as const,
      title: e.title,
      hint: [e.who, e.category ? String(e.category).replace(/_/g, " ").toLowerCase() : null]
        .filter(Boolean)
        .join(" · "),
      amount: e.amount as number,
      href: e.href,
      approve: async () => {
        await apiFetch(`/capital/expenses/${e.id}`, {
          method: "PATCH",
          body: JSON.stringify({ approvalStatus: "APPROVED" }),
        });
        return async () => {
          await apiFetch(`/capital/expenses/${e.id}`, {
            method: "PATCH",
            body: JSON.stringify({ approvalStatus: "PENDING" }),
          });
        };
      },
    })),
    ...(approvals.leave ?? []).map((l: any) => ({
      key: `leave:${l.id}`,
      kind: "leave" as const,
      title: l.title,
      hint: `${formatDay(l.startDate)} → ${formatDay(l.endDate)}`,
      amount: null,
      href: l.href,
      approve: async () => {
        await apiFetch(`/people/leave-requests/${l.id}`, {
          method: "PATCH",
          body: JSON.stringify({ approved: true }),
        });
        return null;
      },
    })),
    ...(approvals.deliverables ?? []).map((f: any) => ({
      key: `file:${f.id}`,
      kind: "file" as const,
      title: f.title,
      hint: f.project ? `Project · ${f.project}` : "Client deliverable",
      amount: null,
      href: f.href,
      approve: async () => {
        await apiFetch(`/flow/files/${f.id}/approval`, {
          method: "PATCH",
          body: JSON.stringify({ status: "APPROVED" }),
        });
        return async () => {
          await apiFetch(`/flow/files/${f.id}/approval`, {
            method: "PATCH",
            body: JSON.stringify({ status: "PENDING" }),
          });
        };
      },
    })),
  ].filter((row) => !handled[row.key]);

  const followUps: any[] = (today.followUps ?? []).filter(
    (f: any) => !handled[`lead:${f.id}`]
  );
  const overdueTasks: any[] = (today.overdueTasks ?? []).filter(
    (t: any) => !handled[`task:${t.id}`]
  );

  const counts = {
    attention: alerts.length,
    approvals: approvalRows.length,
    followups: followUps.length,
    overdue: overdueTasks.length,
  };

  const tabs: { key: Tab; label: string; count: number; icon: any }[] = [
    { key: "attention", label: "Attention", count: counts.attention, icon: AlertTriangle },
    { key: "approvals", label: "Approvals", count: counts.approvals, icon: ClipboardCheck },
    { key: "followups", label: "Follow-ups", count: counts.followups, icon: Zap },
    { key: "overdue", label: "Overdue tasks", count: counts.overdue, icon: ListTodo },
  ];

  const total = counts.attention + counts.approvals + counts.followups + counts.overdue;

  /* ── Row renderers ─────────────────────────────────────────────────────── */

  const renderAlert = (a: any) => {
    const tone = severityTone(a.severity ?? "info");
    return (
      <div
        key={a.id}
        className="group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-border/60 hover:bg-muted/40"
      >
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tone.tile)}>
          <span className={cn("size-2 rounded-full", tone.dot)} />
        </span>
        <Link href={a.href ?? "#"} className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-body font-semibold">{a.label}</span>
            {a.kind === "money" ? (
              <Money value={a.metric} className={cn("shrink-0 text-body-lg font-bold", tone.text)} />
            ) : (
              <span className={cn("shrink-0 text-body-lg font-bold tabular-nums", tone.text)}>
                {alertMetric(a)}
              </span>
            )}
          </span>
          <span className="block truncate text-meta text-muted-foreground">
            <MaskAmounts text={a.hint} />
          </span>
        </Link>
        {a.id === "overdue-invoices" && (
          <button
            type="button"
            onClick={markReminded}
            disabled={busy === "remind"}
            className="hidden shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-micro font-bold text-primary transition-colors hover:bg-primary/15 disabled:opacity-60 sm:inline-flex"
          >
            {busy === "remind" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Mark reminded
          </button>
        )}
        <button
          type="button"
          onClick={() => snooze(a.id)}
          title="Snooze for 1 hour"
          className="hidden shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground group-hover:flex"
        >
          <AlarmClock className="size-3.5" /> 1h
        </button>
        <Link
          href={a.href ?? "#"}
          className="hidden shrink-0 items-center gap-1 text-micro font-semibold text-primary group-hover:flex"
        >
          {a.action ?? "Open"} <ArrowRight className="size-3.5" />
        </Link>
      </div>
    );
  };

  const renderApproval = (row: (typeof approvalRows)[number]) => {
    const icon =
      row.kind === "expense" ? <HandCoins className="size-4" /> :
      row.kind === "leave" ? <Users className="size-4" /> :
      <FileCheck2 className="size-4" />;
    const isBusy = busy === row.key;
    return (
      <div
        key={row.key}
        data-testid={`approval-${row.key}`}
        className="flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-border/60 hover:bg-muted/40"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
          {icon}
        </span>
        <Link href={row.href} className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-body font-semibold">{row.title}</span>
            {row.amount != null && (
              <Money value={row.amount} className="shrink-0 text-body-lg font-bold" />
            )}
          </span>
          <span className="block truncate text-meta text-muted-foreground">{row.hint || "Awaiting your decision"}</span>
        </Link>
        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            setBusy(row.key);
            try {
              const undo = await row.approve();
              setHandled((h) => ({ ...h, [row.key]: true }));
              onChanged();
              if (undo) {
                toast.undo("Approved", async () => {
                  await undo();
                  setHandled((h) => ({ ...h, [row.key]: false }));
                  onChanged();
                });
              } else {
                toast.push({ title: "Approved", tone: "success" });
              }
            } catch (e: any) {
              toast.push({ title: "Could not approve", description: e.message, tone: "error" });
            } finally {
              setBusy(null);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-micro font-bold text-emerald-600 transition-colors hover:bg-emerald-500/15 disabled:opacity-60 dark:text-emerald-400"
        >
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Approve
        </button>
      </div>
    );
  };

  const renderFollowUp = (f: any) => (
    <div
      key={f.id}
      className="flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-border/60 hover:bg-muted/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Zap className="size-4" />
      </span>
      <Link href="/pulse?tab=pipeline" className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-body font-semibold">
            {f.name}{f.company ? ` · ${f.company}` : ""}
          </span>
          <Money value={f.estimatedDealSize} className="shrink-0 text-body font-bold" />
        </span>
        <span className="block truncate text-meta text-muted-foreground">
          {String(f.stage).replace(/_/g, " ")} · follow-up {formatDay(f.nextFollowUpAt)}
        </span>
      </Link>
      <Link
        href="/pulse?tab=pipeline"
        className="shrink-0 rounded-lg px-2 py-1 text-micro font-semibold text-primary hover:bg-primary/10"
      >
        Log call
      </Link>
    </div>
  );

  const renderTask = (t: any) => {
    const daysLate = t.dueDate
      ? Math.max(1, Math.floor((Date.now() - new Date(t.dueDate).getTime()) / 86400000))
      : null;
    return (
      <div
        key={t.id}
        className="flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-border/60 hover:bg-muted/40"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <CalendarClock className="size-4" />
        </span>
        <Link href={`/tasks?task=${t.id}`} className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold">{t.title}</span>
          <span className="block truncate text-meta text-muted-foreground">
            {t.projectName ?? "No project"} · {t.assignee ?? "Unassigned"}
            {daysLate ? ` · ${daysLate}d overdue` : ""}
          </span>
        </Link>
        <Link
          href={`/tasks?task=${t.id}`}
          className="shrink-0 rounded-lg px-2 py-1 text-micro font-semibold text-primary hover:bg-primary/10"
        >
          Reschedule
        </Link>
      </div>
    );
  };

  const empty = (text: string) => (
    <div className="flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-4 text-body text-emerald-600 dark:text-emerald-400">
      <CheckCheck className="size-3.5" /> {text}
    </div>
  );

  return (
    <Panel
      title="Action Center"
      subtitle="Ranked by severity, then impact — act top-down."
      icon={<AlertTriangle className="size-3.5" />}
      tone="bg-rose-500/10 text-rose-600 dark:text-rose-400"
      action={
        <span className="rounded-full bg-muted px-2 py-0.5 text-micro font-bold tabular-nums text-muted-foreground">
          {total} open
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-meta font-semibold transition-colors",
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-micro font-bold tabular-nums",
                  t.count > 0 ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground"
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex max-h-[340px] flex-col gap-0.5 overflow-y-auto pr-1">
        {tab === "attention" &&
          (alerts.length ? alerts.slice(0, 8).map(renderAlert) : empty("Nothing is on fire. Keep the momentum."))}
        {tab === "approvals" &&
          (approvalRows.length ? approvalRows.map(renderApproval) : empty("No pending approvals."))}
        {tab === "followups" &&
          (followUps.length ? followUps.map(renderFollowUp) : empty("Every lead has a next action."))}
        {tab === "overdue" &&
          (overdueTasks.length ? overdueTasks.map(renderTask) : empty("No overdue tasks."))}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
        <p className="text-micro text-muted-foreground">
          Inline actions update immediately. Snoozed items return after 1 hour.
        </p>
        <PanelLink href="/notifications">Inbox</PanelLink>
      </div>
    </Panel>
  );
}
