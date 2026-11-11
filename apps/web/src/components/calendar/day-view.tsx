"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { cn, CardShell } from "@/components/shared";
import { Btn } from "@/components/table";
import { Textarea } from "@/components/ui";
import { CalItem, CalendarSummary, label } from "./types";
import { dayLabel, humanTime, weekDates } from "@/lib/calendar-date";
import { ApprovalBadge, PlatformBadges, StatusBadge } from "./parts";

const MISS_REASONS = ["client_delay", "asset_missing", "approval_pending", "capacity", "external"];

export function DayView({
  date,
  items,
  summary,
  logs,
  onOpen,
  onAdd,
  onSaveLog,
  onOpenClient,
}: {
  date: string;
  items: CalItem[];
  summary: CalendarSummary | null;
  logs: any[];
  onOpen: (item: CalItem) => void;
  onAdd: (date: string, time?: string) => void;
  onSaveLog: (body: { date: string; summary: string; misses: string[]; clientId?: string }) => Promise<void>;
  onOpenClient?: (clientId: string) => void;
}) {
  const [note, setNote] = useState("");
  const [misses, setMisses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const allDay = items.filter((i) => i.allDay || !i.startTime);
  const timed = useMemo(
    () => items.filter((i) => !i.allDay && i.startTime).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))),
    [items]
  );
  const overdue = items.filter((i) => i.overdue);

  const save = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await onSaveLog({ date, summary: note.trim(), misses });
      setNote("");
      setMisses([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      <CardShell>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-heading text-section font-semibold">{dayLabel(date)}</h3>
            <p className="text-meta text-muted-foreground">
              {items.length} items · {items.filter((i) => i.isDone).length} done
            </p>
          </div>
          <Btn variant="outline" onClick={() => onAdd(date)}>
            <Plus className="size-3.5" /> Add
          </Btn>
        </div>

        {allDay.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">All day</p>
            <div className="flex flex-col gap-1">
              {allDay.map((i) => (
                <button
                  key={i.key}
                  onClick={() => onOpen(i)}
                  style={{ borderLeftColor: i.clientColor ?? "#7C3AED" }}
                  className={cn("flex items-center gap-2 rounded-lg border-l-2 bg-muted/40 px-2.5 py-1.5 text-left hover:bg-muted/70", i.isDone && "opacity-60")}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{i.title}</span>
                  {i.platforms.length > 0 && <PlatformBadges platforms={i.platforms} />}
                  <ApprovalBadge approval={i.approval} />
                  <StatusBadge status={i.status} tone={i.statusTone} />
                </button>
              ))}
            </div>
          </div>
        )}

        {timed.length === 0 && allDay.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-12 text-center">
            <p className="text-body font-semibold text-muted-foreground">Nothing scheduled</p>
            <p className="text-meta text-muted-foreground/70">Use Add to place a post, meeting or task on this day.</p>
          </div>
        ) : (
          <div className="relative border-l border-border/70 pl-3">
            {timed.map((i) => (
              <div key={i.key} className="relative mb-2.5 flex items-start gap-3">
                <span className="absolute -left-[17px] top-1.5 size-2 rounded-full border-2 border-card bg-primary" />
                <span className="w-14 shrink-0 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                  {humanTime(i.startTime)}
                </span>
                <button
                  onClick={() => onOpen(i)}
                  style={{ borderLeftColor: i.clientColor ?? "#7C3AED" }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-lg border-l-2 bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70",
                    i.isDone && "opacity-60",
                    i.overdue && "ring-1 ring-rose-500/20"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold">{i.title}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {[i.clientName, i.projectName, label(i.status)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {i.platforms.length > 0 && <PlatformBadges platforms={i.platforms} />}
                  <ApprovalBadge approval={i.approval} />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardShell>

      <div className="flex flex-col gap-4">
        <CardShell>
          <h4 className="mb-3 font-heading text-[13px] font-semibold">Day summary</h4>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Meetings" value={`${summary?.meetings.done ?? 0}/${summary?.meetings.planned ?? 0}`} hint="done / planned" />
            <Metric label="Tasks" value={`${summary?.tasks.done ?? 0}/${summary?.tasks.due ?? 0}`} hint={`${summary?.tasks.overdue ?? 0} overdue`} />
            <Metric label="Posts" value={`${summary?.posts.published ?? 0}/${summary?.posts.planned ?? 0}`} hint={`${summary?.posts.pendingApproval ?? 0} in review`} />
            <Metric label="Ad spend" value={`৳${Math.round(summary?.ads.actualSpend ?? 0).toLocaleString("en-US")}`} hint={`${summary?.ads.live ?? 0} live`} />
          </div>
          {overdue.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-2.5 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
              <p className="text-[11px] leading-snug text-rose-500">
                {overdue.length} item{overdue.length > 1 ? "s" : ""} overdue — {overdue.slice(0, 2).map((i) => i.title).join(", ")}
                {overdue.length > 2 ? "…" : ""}
              </p>
            </div>
          )}
        </CardShell>

        <CardShell>
          <h4 className="mb-1 font-heading text-[13px] font-semibold">Close-out</h4>
          <p className="mb-2.5 text-[11px] text-muted-foreground">What happened, what did not — and why.</p>
          <div className="flex flex-col gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Two posts held for client assets; shoot ran 40 min late."
              className="min-h-16 text-[12px]"
            />
            <div className="flex flex-wrap gap-1">
              {MISS_REASONS.map((m) => {
                const on = misses.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMisses(on ? misses.filter((x) => x !== m) : [...misses, m])}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                      on ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label(m)}
                  </button>
                );
              })}
            </div>
            <Btn variant="primary" onClick={save} disabled={busy || !note.trim()} className="!w-full">
              <CheckCircle2 className="size-3.5" /> {busy ? "Saving…" : "Save day note"}
            </Btn>
          </div>

          {logs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3">
              {logs.slice(0, 4).map((l) => (
                <div key={l.id} className="text-[11px] leading-snug">
                  <p className="font-medium">{l.summary}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {l.author?.name ?? "—"}
                    {l.client?.companyName ? ` · ${l.client.companyName}` : ""}
                  </p>
                  {Array.isArray(l.misses) && l.misses.length > 0 && (
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {l.misses.map((m: string) => (
                        <span key={m} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-300">
                          {label(m)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardShell>

        <CardShell className="!p-4">
          <h4 className="mb-2 text-[12px] font-semibold">Quick links</h4>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(items.map((i) => i.clientId).filter(Boolean))].slice(0, 6).map((id) => {
              const item = items.find((i) => i.clientId === id)!;
              return (
                <button
                  key={id}
                  onClick={() => onOpenClient?.(id!)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10.5px] font-medium hover:border-primary/30 hover:text-primary"
                >
                  <span className="size-1.5 rounded-full" style={{ background: item.clientColor }} />
                  {item.clientName}
                </button>
              );
            })}
          </div>
        </CardShell>
      </div>
    </div>
  );
}

function Metric({ label: lbl, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 px-2.5 py-2">
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">{lbl}</p>
      <p className="text-[16px] font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[9.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
