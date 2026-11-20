"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/components/shared";
import { CalItem, FeedResponse } from "./types";
import { monthGrid, todayISO, WEEKDAYS } from "@/lib/calendar-date";
import { CalChip, DayCellBars, readDrag, writeDrag } from "./parts";

export function MonthView({
  anchor,
  items,
  days,
  onOpen,
  onMove,
  onAdd,
  onOpenDay,
}: {
  anchor: string;
  items: CalItem[];
  days: FeedResponse["days"];
  onOpen: (item: CalItem) => void;
  onMove: (drag: { source: string; id: string }, date: string) => void;
  onAdd: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const cells = useMemo(() => monthGrid(anchor), [anchor]);
  const byDay = useMemo(() => {
    const map: Record<string, CalItem[]> = {};
    for (const i of items) (map[i.date] ??= []).push(i);
    return map;
  }, [items]);
  const today = todayISO();

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="min-w-[860px]">
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map(({ date, inMonth }, idx) => {
            const dayItems = byDay[date] ?? [];
            const info = days?.[date];
            const isToday = date === today;
            const weekend = idx % 7 === 0 || idx % 7 === 6;
            return (
              <div
                key={date}
                onClick={() => onOpenDay(date)}
                role="button"
                tabIndex={-1}
                aria-label={`${Number(date.slice(8))} — view ${date}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  const drag = readDrag(e);
                  if (drag) {
                    e.preventDefault();
                    onMove(drag, date);
                  }
                }}
                className={cn(
                  "group relative flex min-h-[158px] flex-col border-b border-r border-border/50 p-1.5 transition-colors",
                  !inMonth && "bg-muted/20",
                  weekend && inMonth && "bg-muted/10",
                  info?.hasHoliday && "bg-rose-500/[0.04]",
                  "hover:bg-muted/30"
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDay(date);
                    }}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40",
                      isToday && "bg-primary text-primary-foreground hover:bg-primary",
                      !inMonth && "text-muted-foreground/40",
                      inMonth && !isToday && "text-muted-foreground"
                    )}
                    title="Open day"
                    aria-label={`${Number(date.slice(8))} — open ${date}`}
                  >
                    {Number(date.slice(8))}
                  </button>
                  <div className="flex items-center gap-1">
                    {!!info?.overdue && <span className="size-1.5 rounded-full bg-rose-500" title={`${info.overdue} overdue`} />}
                    {!!info?.pendingApproval && <span className="size-1.5 rounded-full bg-amber-400" title={`${info.pendingApproval} awaiting review`} />}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdd(date);
                      }}
                      aria-label={`Add on ${date}`}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-0.5">
                  {dayItems.slice(0, 4).map((item) => (
                    <CalChip key={item.key} item={item} onClick={() => onOpen(item)} onDragStart={(e) => writeDrag(e, item)} />
                  ))}
                  {dayItems.length > 4 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDay(date);
                      }}
                      className="min-h-6 rounded px-1 text-left text-[11px] font-semibold text-primary hover:underline"
                    >
                      +{dayItems.length - 4} more
                    </button>
                  )}
                </div>

                <DayCellBars counts={info?.counts ?? {}} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
