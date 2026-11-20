"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronRight, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Modal } from "@/components/ui";
import { CalItem, FeedResponse, SOURCE_LABEL, label } from "./types";
import { humanTime, longDayLabel } from "@/lib/calendar-date";
import { ApprovalBadge, EmptyHint, PlatformBadges, StatusBadge } from "./parts";

/**
 * Day details popup for the month grid. Clicking a date used to jump straight
 * to the Day tab; a peek keeps the month in place while showing what is on the
 * day, and still offers the full day view as a deliberate next step.
 */
export function DayPeek({
  date,
  items,
  dayInfo,
  canEdit = true,
  onClose,
  onOpenItem,
  onAdd,
  onOpenDay,
}: {
  date: string | null;
  items: CalItem[];
  dayInfo?: FeedResponse["days"][string];
  canEdit?: boolean;
  onClose: () => void;
  onOpenItem: (item: CalItem) => void;
  onAdd: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLogs([]);
    setLogsLoading(true);
    apiFetch<any>(`/calendar/day/${date}`)
      .then((d) => !cancelled && setLogs(d?.logs ?? []))
      .catch(() => null)
      .finally(() => !cancelled && setLogsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const byDay = useMemo(() => items.filter((i) => i.date === date), [items, date]);

  // Month cells drop items onto their start date, so anything spanning the peek
  // date is pulled in here instead of being invisible until the day tab.
  const spanning = useMemo(
    () => items.filter((i) => i.endDate && i.date < (date ?? "") && i.endDate >= (date ?? "") && i.date !== date),
    [items, date]
  );

  const all = useMemo(
    () =>
      [...byDay, ...spanning].sort(
        (a, b) =>
          Number(!!(b.allDay || !b.startTime)) - Number(!!(a.allDay || !a.startTime)) ||
          String(a.startTime ?? "").localeCompare(String(b.startTime ?? ""))
      ),
    [byDay, spanning]
  );

  const allDay = all.filter((i) => i.allDay || !i.startTime);
  const timed = all.filter((i) => !i.allDay && i.startTime);
  const overdue = all.filter((i) => i.overdue);
  const inReview = all.filter((i) => i.approval === "INTERNAL_REVIEW");
  const done = all.filter((i) => i.isDone);

  // Count from what the popup actually lists, not the feed's per-day tally —
  // items that started earlier but span this date are shown here too.
  const countsBySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of all) map.set(i.source, (map.get(i.source) ?? 0) + 1);
    return Array.from(map.entries());
  }, [all]);

  return (
    <Modal
      open={!!date}
      onClose={onClose}
      size="lg"
      eyebrow="Day details"
      title={date ? longDayLabel(date) : ""}
      subtitle={
        date ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {all.length} item{all.length === 1 ? "" : "s"} · {done.length} done
            </span>
            {overdue.length > 0 && <span className="font-semibold text-rose-500">{overdue.length} overdue</span>}
            {inReview.length > 0 && (
              <span className="font-semibold text-amber-600 dark:text-amber-300">{inReview.length} in review</span>
            )}
            {dayInfo?.hasHoliday && <span className="font-semibold text-rose-500">Holiday</span>}
          </span>
        ) : null
      }
      footer={
        date ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10.5px] text-muted-foreground">
              {countsBySource
                .map(([source, n]) => `${n} ${SOURCE_LABEL[source] ?? label(source)}`)
                .join(" · ") || "No items"}
            </span>
            <div className="flex items-center gap-1.5">
              <Btn variant="outline" onClick={() => onOpenDay(date)}>
                <CalendarDays className="size-3.5" /> Open day view
              </Btn>
              {canEdit && (
                <Btn variant="primary" onClick={() => onAdd(date)}>
                  <Plus className="size-4" /> Add
                </Btn>
              )}
            </div>
          </div>
        ) : null
      }
    >
      {all.length === 0 ? (
        <EmptyHint title="Nothing scheduled" hint="Add a post, meeting or task to this day from the button below." />
      ) : (
        <div className="flex flex-col gap-4">
          {allDay.length > 0 && (
            <section>
              <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">All day</p>
              <div className="flex flex-col gap-1">
                {allDay.map((i) => (
                  <PeekRow key={i.key} item={i} onClick={() => onOpenItem(i)} />
                ))}
              </div>
            </section>
          )}

          {timed.length > 0 && (
            <section>
              <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Scheduled</p>
              <div className="flex flex-col gap-1">
                {timed.map((i) => (
                  <PeekRow key={i.key} item={i} showTime onClick={() => onOpenItem(i)} />
                ))}
              </div>
            </section>
          )}

          {(logs.length > 0 || logsLoading) && (
            <section className="border-t border-border/60 pt-3">
              <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Day notes</p>
              {logsLoading && logs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {logs.slice(0, 3).map((l) => (
                    <div key={l.id} className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] leading-snug">
                      <p className="font-medium">{l.summary}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {l.author?.name ?? "—"}
                        {l.client?.companyName ? ` · ${l.client.companyName}` : ""}
                      </p>
                      {Array.isArray(l.misses) && l.misses.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {l.misses.map((m: string) => (
                            <span
                              key={m}
                              className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-300"
                            >
                              {label(m)}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function PeekRow({ item, showTime, onClick }: { item: CalItem; showTime?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderLeftColor: item.clientColor ?? "#7C3AED" }}
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg border-l-2 bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70",
        item.isDone && "opacity-70",
        item.overdue && "ring-1 ring-rose-500/20"
      )}
    >
      {showTime && (
        <span className="w-14 shrink-0 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
          {humanTime(item.startTime)}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-[12px] font-semibold", item.isDone && "line-through")}>
          {item.overdue && <AlertTriangle className="mr-1 inline size-3 -translate-y-px text-rose-500" />}
          {item.title}
        </span>
        <span className="truncate text-[10px] text-muted-foreground">
          {[SOURCE_LABEL[item.source] ?? label(item.source), item.clientName, item.projectName].filter(Boolean).join(" · ")}
        </span>
      </span>
      {item.platforms.length > 0 && <PlatformBadges platforms={item.platforms} />}
      <ApprovalBadge approval={item.approval} />
      <span className="hidden sm:inline-flex">
        <StatusBadge status={item.status} tone={item.statusTone} />
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
    </button>
  );
}
