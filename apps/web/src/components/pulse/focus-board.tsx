"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Filter,
  Flame,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PulseWorkItem, PulseWorklist } from "@/lib/types";
import { formatBDT } from "@/lib/format";
import { Avatar, EmptyState, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Segmented } from "@/components/ui";
import { QuickLogModal } from "./quick-log";

type Bucket = "overdue" | "today" | "upcoming" | "unscheduled";

const BUCKETS: { key: Bucket; label: string; hint: string; tone: string; icon: typeof AlarmClock }[] = [
  { key: "overdue", label: "Overdue", hint: "Promised, then missed", tone: "rose", icon: AlarmClock },
  { key: "today", label: "Due today", hint: "Call these before 6pm", tone: "amber", icon: Clock3 },
  { key: "upcoming", label: "Next 7 days", hint: "Plan ahead", tone: "sky", icon: CalendarClock },
  { key: "unscheduled", label: "No next step", hint: "Going quiet", tone: "violet", icon: CircleDashed },
];

const TONE: Record<string, { pill: string; dot: string; bar: string }> = {
  rose: {
    pill: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
  },
  amber: {
    pill: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  sky: {
    pill: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
    dot: "bg-sky-500",
    bar: "bg-sky-500",
  },
  violet: {
    pill: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
    dot: "bg-violet-500",
    bar: "bg-violet-500",
  },
};

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** "2h overdue", "Today · 14:30", "Mon, 9 Nov" — the label a rep scans first. */
export function dueLabel(iso: string | null | undefined) {
  if (!iso) return "No next step";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const dayMs = 86400000;
  const today = startOfDay(now);
  const target = startOfDay(d);
  const dayDiff = Math.round((target.getTime() - today.getTime()) / dayMs);

  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (diffMs < 0) {
    const overdueDays = Math.max(1, Math.ceil(-diffMs / dayMs));
    if (overdueDays <= 1) return `Overdue · ${Math.max(1, Math.round(-diffMs / 3600000))}h`;
    return `${overdueDays}d overdue`;
  }
  if (dayDiff === 0) return `Today · ${time}`;
  if (dayDiff === 1) return `Tomorrow · ${time}`;
  if (dayDiff < 7) return d.toLocaleDateString("en-GB", { weekday: "short" }) + ` · ${time}`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isOverdue(iso: string | null) {
  return !!iso && new Date(iso).getTime() < Date.now();
}

export function FocusBoard({
  employees,
  onOpenLead,
  notify,
}: {
  employees: { id: string; name: string; department?: string | null }[];
  onOpenLead: (id: string) => void;
  notify: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [bucket, setBucket] = useState<Bucket>("overdue");
  const [manualBucket, setManualBucket] = useState(false);
  const [logLead, setLogLead] = useState<PulseWorkItem | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pulse", "worklist", scope],
    queryFn: () =>
      apiFetch<PulseWorklist>(`/pulse/worklist${scope === "mine" ? "?mine=true" : ""}`),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pulse"] });
    qc.invalidateQueries({ queryKey: ["api", "/pulse/summary"] });
  };

  // Land on the first bucket that actually has work — an empty overdue list
  // should not be the first thing a rep sees when 12 leads are due today.
  useEffect(() => {
    if (manualBucket || !data) return;
    if (data.counts.overdue > 0) return;
    if (data.counts.today > 0) setBucket("today");
    else if (data.counts.upcoming > 0) setBucket("upcoming");
    else if (data.counts.unscheduled > 0) setBucket("unscheduled");
  }, [data, manualBucket]);

  const complete = useMutation({
    mutationFn: (item: PulseWorkItem) => {
      if (item.followUpId) {
        return apiFetch(`/pulse/follow-ups/${item.followUpId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "COMPLETED" }),
        });
      }
      if (item.meetingId) {
        return apiFetch(`/pulse/leads/${item.id}/meetings/${item.meetingId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "COMPLETED" }),
        });
      }
      // Legacy leads can carry a date without a follow-up row.
      return apiFetch(`/pulse/leads/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nextFollowUpAt: null }),
      });
    },
    onSuccess: (_r, item) => {
      notify(`Done — ${item.name}`);
      refresh();
    },
    onError: (e: Error) => notify(e.message ?? "Could not update"),
  });

  const snooze = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      apiFetch(`/pulse/leads/${id}/snooze`, { method: "POST", body: JSON.stringify({ days }) }),
    onSuccess: () => {
      setSnoozeFor(null);
      notify("Follow-up moved");
      refresh();
    },
    onError: (e: Error) => notify(e.message ?? "Could not snooze"),
  });

  const lists = useMemo<Record<Bucket, PulseWorkItem[]>>(
    () => ({
      overdue: data?.overdue ?? [],
      today: data?.today ?? [],
      upcoming: data?.upcoming ?? [],
      unscheduled: data?.unscheduled ?? [],
    }),
    [data]
  );

  const active = BUCKETS.find((b) => b.key === bucket)!;
  const items = lists[bucket];
  const counts = data?.counts;
  const totalToDo = (counts?.overdue ?? 0) + (counts?.today ?? 0);

  return (
    <div className="flex flex-col gap-4">
      {/* header + scope */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-title font-semibold tracking-tight">
            <Sparkles className="size-3.5 text-primary" />
            Today
            {totalToDo > 0 && (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-meta font-bold text-rose-500">
                {totalToDo} to contact
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-body text-muted-foreground">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · work
            the queue top to bottom, log the outcome, set the next step.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            value={scope}
            onChange={(v) => setScope(v as "mine" | "all")}
            options={[
              { value: "all", label: "Everyone" },
              { value: "mine", label: "My leads" },
            ]}
          />
        </div>
      </div>

      {/* bucket filter */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {BUCKETS.map((b) => {
          const n = counts?.[b.key] ?? 0;
          const on = bucket === b.key;
          return (
            <button
              key={b.key}
              onClick={() => {
                setManualBucket(true);
                setBucket(b.key);
              }}
              className={cn(
                "group relative overflow-hidden rounded-2xl border p-3 text-left transition-all",
                on
                  ? "border-primary/40 bg-primary/[0.06] shadow-sm shadow-primary/10"
                  : "border-border/60 bg-card hover:border-primary/25 hover:bg-muted/30"
              )}
            >
              <span className={cn("absolute inset-y-0 left-0 w-0.5 transition-opacity", TONE[b.tone].bar, on ? "opacity-100" : "opacity-0")} />
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-meta font-bold tracking-wide text-muted-foreground uppercase">
                  <b.icon className={cn("size-3.5", on ? "text-primary" : "")} />
                  {b.label}
                </span>
                {on && <span className={cn("size-1.5 rounded-full", TONE[b.tone].dot)} />}
              </div>
              <p className="mt-1 text-stat font-heading font-bold tabular-nums leading-none">{n}</p>
              <p className="mt-1 text-meta text-muted-foreground">{b.hint}</p>
            </button>
          );
        })}
      </div>

      {/* queue */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", TONE[active.tone].dot)} />
            <p className="text-body-lg font-bold">{active.label}</p>
            <span className="text-body text-muted-foreground">
              {items.length} {items.length === 1 ? "lead" : "leads"}
              {bucket === "unscheduled" ? " with no plan" : ""}
            </span>
          </div>
          {bucket === "unscheduled" && (
            <p className="text-meta text-muted-foreground">Every active lead should have a next step.</p>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {[...Array(5)].map((_, i) => (
              <SkeletonBlock key={i} className="h-[74px]" />
            ))}
          </div>
        ) : error ? (
          <div className="p-4">
            <EmptyState title={(error as Error).message} hint="Check that the API is running, then retry." />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="size-4" />
            </span>
            <p className="text-body-lg font-semibold">
              {bucket === "overdue" ? "Nothing overdue — clean slate" : `No leads in ${active.label.toLowerCase()}`}
            </p>
            <p className="max-w-sm text-body text-muted-foreground">
              {bucket === "overdue"
                ? "Pick up the due-today list so tomorrow does not start in the red."
                : "Move to another bucket, or add a lead to get started."}
            </p>
            {bucket === "overdue" && (counts?.today ?? 0) > 0 && (
              <Btn variant="outline" className="mt-1" onClick={() => { setManualBucket(true); setBucket("today"); }}>
                See {counts?.today} due today <ArrowRight className="size-3.5" />
              </Btn>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            <AnimatePresence initial={false}>
              {items.map((l, i) => {
                const overdue = isOverdue(l.nextFollowUpAt);
                const noPlan = !l.nextFollowUpAt;
                const menuOpen = snoozeFor === l.id;
                return (
                  <motion.li
                    key={l.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(i, 6) * 0.02 }}
                    className={cn(
                      "group relative flex flex-col gap-2.5 px-3.5 py-3 transition-colors hover:bg-muted/25 lg:grid lg:grid-cols-[minmax(0,1.5fr)_120px_164px_auto] lg:items-center lg:gap-3",
                      overdue && "bg-rose-500/[0.03]"
                    )}
                  >
                    {/* contact */}
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Avatar name={l.name} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            onClick={() => onOpenLead(l.id)}
                            className="max-w-full truncate text-left text-body-lg font-semibold hover:text-primary hover:underline"
                          >
                            {l.name}
                          </button>
                          {l.priority === "URGENT" && (
                            <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-micro font-bold text-rose-500">
                              URGENT
                            </span>
                          )}
                          {l.stale && !noPlan && (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-300">
                              STALE
                            </span>
                          )}
                        </div>
                        <p className="truncate text-body text-muted-foreground">
                          {l.company ?? "—"}
                          {l.uid ? ` · ${l.uid}` : ""}
                          {scope === "all" && l.assignedTo ? ` · ${l.assignedTo.name}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
                          {l.lastContactedAt ? (
                            <span>last touch {l.daysSinceContact === 0 ? "today" : `${l.daysSinceContact}d ago`}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-300">never contacted</span>
                          )}
                          {l.nextActionKind && l.nextActionNote ? (
                            <span className="truncate max-w-56">· {l.nextActionNote}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* deal + stage */}
                    <div className="flex items-center gap-2 lg:block lg:text-right">
                      <p className="text-body-lg font-bold tabular-nums">{formatBDT(l.estimatedDealSize)}</p>
                      <div className="lg:mt-0.5">
                        <StatusBadge status={l.stage} />
                      </div>
                    </div>

                    {/* next step */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-meta font-bold",
                          noPlan
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                            : overdue
                              ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                              : "border-primary/25 bg-primary/[0.07] text-primary"
                        )}
                      >
                        {noPlan ? <CircleDashed className="size-3.5" /> : <CalendarClock className="size-3.5" />}
                        {dueLabel(l.nextFollowUpAt)}
                      </span>
                      {l.leadScore != null && (
                        <span className="hidden items-center gap-0.5 text-meta font-bold text-muted-foreground lg:inline-flex">
                          <Flame className="size-3.5 text-amber-500" />
                          {l.leadScore}
                        </span>
                      )}
                    </div>

                    {/* actions */}
                    <div className="flex items-center justify-end gap-1">
                      {l.contactPhone && (
                        <a
                          href={`tel:${l.contactPhone.replace(/[^+\d]/g, "")}`}
                          className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted hover:text-foreground"
                          title={`Call ${l.contactPhone}`}
                        >
                          <Phone className="size-3.5" />
                        </a>
                      )}
                      {l.contactPhone && (
                        <a
                          href={`https://wa.me/${l.contactPhone.replace(/[^\d]/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-emerald-600 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 dark:text-emerald-400"
                          title="Open WhatsApp"
                        >
                          <MessageCircle className="size-3.5" />
                        </a>
                      )}
                      {l.contactEmail && (
                        <a
                          href={`mailto:${l.contactEmail}`}
                          className="hidden size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted hover:text-foreground sm:flex"
                          title={`Email ${l.contactEmail}`}
                        >
                          <Mail className="size-4" />
                        </a>
                      )}
                      <Btn
                        variant="primary"
                        className="!px-2.5 !py-1.5 text-body"
                        onClick={() => setLogLead(l)}
                        title="Log what happened and set the next step"
                      >
                        Log
                      </Btn>
                      {!noPlan && (
                        <button
                          onClick={() => complete.mutate(l)}
                          disabled={complete.isPending}
                          className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-emerald-600 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
                          title="Mark done"
                        >
                          <Check className="size-3.5" />
                        </button>
                      )}
                      <div className="relative">
                        <button
                          onClick={() => setSnoozeFor(menuOpen ? null : l.id)}
                          className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Snooze"
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                        {menuOpen && (
                          <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                            <p className="border-b border-border/60 px-2.5 py-1.5 text-micro font-bold tracking-wide text-muted-foreground uppercase">
                              Move follow-up
                            </p>
                            {[
                              { days: 1, label: "Tomorrow" },
                              { days: 3, label: "In 3 days" },
                              { days: 7, label: "Next week" },
                            ].map((o) => (
                              <button
                                key={o.days}
                                onClick={() => snooze.mutate({ id: l.id, days: o.days })}
                                className="block w-full px-2.5 py-1.5 text-left text-body font-medium transition-colors hover:bg-muted"
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* footer insight */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/20 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-4 text-body text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" /> {counts?.stale ?? 0} stale leads
          </span>
          <span className="flex items-center gap-1.5">
            <Filter className="size-3.5" /> {counts?.upcoming ?? 0} planned this week
          </span>
          <span className="flex items-center gap-1.5">
            <Flame className="size-3.5" /> {formatBDT(counts?.pipelineValue ?? 0)} in play
          </span>
        </div>
        <p className="text-meta text-muted-foreground">
          Tip: log every call — the note and the next step are what make tomorrow easy.
        </p>
      </div>

      <QuickLogModal
        lead={logLead}
        open={!!logLead}
        onClose={() => setLogLead(null)}
        employees={employees}
        onSaved={notify}
      />
    </div>
  );
}
