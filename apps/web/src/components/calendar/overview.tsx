"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Megaphone,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn, CardShell, SectionTitle, StatCard } from "@/components/shared";
import { Btn } from "@/components/table";
import { CalItem, CalendarClient, CalendarSummary, label } from "./types";
import { dayLabel, humanTime, todayISO, weekDates } from "@/lib/calendar-date";
import { ApprovalBadge, DayCellBars, PlatformBadges, StatusBadge } from "./parts";

export function Overview({
  today,
  todayItems,
  weekItems,
  days,
  summary,
  clients,
  onOpen,
  onAdd,
  onOpenDay,
  onOpenClient,
  onOpenView,
}: {
  today: string;
  todayItems: CalItem[];
  weekItems: CalItem[];
  days: Record<string, any>;
  summary: CalendarSummary | null;
  clients: CalendarClient[];
  onOpen: (item: CalItem) => void;
  onAdd: () => void;
  onOpenDay: (date: string) => void;
  onOpenClient: (id: string) => void;
  onOpenView: (view: string) => void;
}) {
  const week = useMemo(() => weekDates(today), [today]);
  const timed = useMemo(
    () => todayItems.filter((i) => !i.allDay && i.startTime).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))),
    [todayItems]
  );
  const allDay = todayItems.filter((i) => i.allDay || !i.startTime);

  const attention = useMemo(() => {
    const overdue = todayItems.filter((i) => i.overdue).length;
    const pending = todayItems.filter((i) => i.approval === "INTERNAL_REVIEW").length;
    const missed = summary?.posts.missed ?? 0;
    const gaps = summary?.posts.gapDays ?? 0;
    return { overdue, pending, missed, gaps };
  }, [todayItems, summary]);

  const clientRollup = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; count: number }>();
    for (const i of weekItems) {
      if (!i.clientId) continue;
      const row = map.get(i.clientId) ?? { id: i.clientId, name: i.clientName ?? "—", color: i.clientColor ?? "#7C3AED", count: 0 };
      row.count++;
      map.set(i.clientId, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [weekItems]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <button onClick={() => onOpenView("day")} className="text-left">
          <StatCard
            label="Meetings"
            value={summary?.meetings.planned ?? 0}
            sub={`${summary?.meetings.done ?? 0} done · ${summary?.meetings.noShow ?? 0} no-show`}
            icon={<CalendarClock className="size-4" />}
          />
        </button>
        <button onClick={() => onOpenView("week")} className="text-left">
          <StatCard
            label="Tasks"
            value={summary?.tasks.due ?? 0}
            sub={`${summary?.tasks.done ?? 0} done · ${summary?.tasks.overdue ?? 0} overdue`}
            icon={<ClipboardList className="size-4" />}
          />
        </button>
        <button onClick={() => onOpenView("grid")} className="text-left">
          <StatCard
            label="Posts"
            value={summary?.posts.planned ?? 0}
            sub={`${summary?.posts.published ?? 0} published · ${summary?.posts.pendingApproval ?? 0} in review`}
            icon={<Megaphone className="size-4" />}
          />
        </button>
        <button onClick={() => onOpenView("timeline")} className="text-left">
          <StatCard
            label="Ad flights"
            value={summary?.ads.live ?? 0}
            sub={`৳${Math.round(summary?.ads.actualSpend ?? 0).toLocaleString("en-US")} spent`}
            icon={<Sparkles className="size-4" />}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
        <CardShell>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-heading text-section font-semibold">Today</h3>
              <p className="text-meta text-muted-foreground">{dayLabel(today)} · {todayItems.length} items</p>
            </div>
            <Btn variant="primary" onClick={onAdd}>
              <Plus className="size-3.5" /> New
            </Btn>
          </div>

          {todayItems.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="size-6 text-emerald-500" />
              <p className="text-body font-semibold text-muted-foreground">Nothing on today</p>
              <p className="text-meta text-muted-foreground/70">A clear day — or a plan that still needs filling in.</p>
            </div>
          )}

          {allDay.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">All day</p>
              <div className="flex flex-col gap-1">
                {allDay.slice(0, 5).map((i) => (
                  <ItemRow key={i.key} item={i} onOpen={onOpen} />
                ))}
              </div>
            </div>
          )}

          {timed.length > 0 && (
            <div className="relative border-l border-border/70 pl-3">
              {timed.map((i) => (
                <div key={i.key} className="relative mb-2 flex items-start gap-2.5">
                  <span className="absolute -left-[17px] top-2 size-2 rounded-full border-2 border-card bg-primary" />
                  <span className="w-12 shrink-0 pt-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {humanTime(i.startTime).replace(":00", "")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <ItemRow item={i} onOpen={onOpen} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardShell>

        <div className="flex flex-col gap-4">
          <CardShell>
            <SectionTitle title="Needs attention" subtitle="Today + this week" />
            <div className="flex flex-col gap-1.5">
              <Attention label="Overdue items" value={attention.overdue} tone={attention.overdue ? "danger" : "ok"} onClick={() => onOpenView("week")} />
              <Attention label="Awaiting review" value={attention.pending} tone={attention.pending ? "warning" : "ok"} onClick={() => onOpenView("grid")} />
              <Attention label="Posts missed" value={attention.missed} tone={attention.missed ? "danger" : "ok"} onClick={() => onOpenView("grid")} />
              <Attention label="Days with no content" value={attention.gaps} tone={attention.gaps > 2 ? "warning" : "ok"} onClick={() => onOpenView("plans")} />
            </div>
          </CardShell>

          <CardShell>
            <SectionTitle title="This week" subtitle="Sun → Sat" action={<Btn variant="ghost" onClick={() => onOpenView("week")}><ArrowRight className="size-3.5" /></Btn>} />
            <div className="flex flex-col gap-1">
              {week.map((d) => {
                const info = days?.[d];
                const total = info ? Object.values(info.counts ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : 0;
                return (
                  <button
                    key={d}
                    onClick={() => onOpenDay(d)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50",
                      d === today && "bg-primary/5"
                    )}
                  >
                    <span className={cn("w-9 text-[10px] font-bold uppercase tracking-wide", d === today ? "text-primary" : "text-muted-foreground")}>
                      {dayLabel(d).split(",")[0]}
                    </span>
                    <span className="w-5 text-[11px] font-semibold tabular-nums">{Number(d.slice(8))}</span>
                    <span className="flex-1 text-[10px] text-muted-foreground">{total ? `${total} items` : "—"}</span>
                    <DayCellBars counts={info?.counts ?? {}} />
                  </button>
                );
              })}
            </div>
          </CardShell>

          <CardShell>
            <SectionTitle title="Clients this week" subtitle="Workload by client" />
            <div className="flex flex-col gap-1.5">
              {clientRollup.length === 0 && <p className="text-[11px] text-muted-foreground">No client work scheduled.</p>}
              {clientRollup.map((c) => (
                <button key={c.id} onClick={() => onOpenClient(c.id)} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50">
                  <span className="size-2 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 truncate text-left text-[11.5px] font-medium">{c.name}</span>
                  <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{c.count}</span>
                </button>
              ))}
            </div>
          </CardShell>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item, onOpen }: { item: CalItem; onOpen: (i: CalItem) => void }) {
  return (
    <button
      onClick={() => onOpen(item)}
      style={{ borderLeftColor: item.clientColor ?? "#7C3AED" }}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg border-l-2 bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70",
        item.isDone && "opacity-60"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold">{item.title}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {[item.clientName, item.projectName].filter(Boolean).join(" · ") || label(item.source)}
        </span>
      </span>
      {item.platforms.length > 0 && <PlatformBadges platforms={item.platforms} />}
      <ApprovalBadge approval={item.approval} />
      <StatusBadge status={item.status} tone={item.statusTone} />
    </button>
  );
}

function Attention({
  label: lbl,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "ok" | "warning" | "danger";
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center justify-between rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-muted/50">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium">
        {tone === "ok" ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <AlertTriangle className={cn("size-3.5", tone === "danger" ? "text-rose-500" : "text-amber-500")} />
        )}
        {lbl}
      </span>
      <span
        className={cn(
          "min-w-5 rounded-full px-1.5 text-center text-[10.5px] font-bold tabular-nums",
          tone === "ok" ? "bg-muted text-muted-foreground" : tone === "danger" ? "bg-rose-500/15 text-rose-500" : "bg-amber-500/15 text-amber-600 dark:text-amber-300"
        )}
      >
        {value}
      </span>
    </button>
  );
}
