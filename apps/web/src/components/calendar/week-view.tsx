"use client";

import { useMemo, useRef } from "react";
import { cn } from "@/components/shared";
import { CalItem } from "./types";
import { minutes, todayISO, WEEKDAYS, weekDates } from "@/lib/calendar-date";
import { readDrag, writeDrag } from "./parts";
import { PlatformBadges } from "./parts";

const START_HOUR = 8;
const END_HOUR = 20;
const HOUR_PX = 52;
const SLOT_MIN = 30;

type Laid = { item: CalItem; top: number; height: number; lane: number; lanes: number };

function layout(items: CalItem[]): Laid[] {
  const timed = items
    .filter((i) => !i.allDay && i.startTime)
    .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
  const out: Laid[] = [];
  let cluster: CalItem[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const lanesEnd: number[] = [];
    const assigned: { item: CalItem; lane: number }[] = [];
    for (const it of cluster) {
      const start = minutes(it.startTime);
      const end = start + Math.max(30, minutes(it.endTime) - start || 60);
      let lane = lanesEnd.findIndex((e) => e <= start);
      if (lane === -1) {
        lane = lanesEnd.length;
        lanesEnd.push(end);
      } else {
        lanesEnd[lane] = end;
      }
      assigned.push({ item: it, lane });
    }
    const lanes = lanesEnd.length;
    for (const a of assigned) {
      const start = minutes(a.item.startTime);
      const end = start + Math.max(30, minutes(a.item.endTime) - start || 60);
      out.push({
        item: a.item,
        top: ((start - START_HOUR * 60) / 60) * HOUR_PX,
        height: Math.max(22, ((end - start) / 60) * HOUR_PX - 2),
        lane: a.lane,
        lanes,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of timed) {
    const start = minutes(it.startTime);
    const end = start + Math.max(30, minutes(it.endTime) - start || 60);
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

export function WeekView({
  anchor,
  items,
  onOpen,
  onMove,
  onAdd,
  onOpenDay,
}: {
  anchor: string;
  items: CalItem[];
  onOpen: (item: CalItem) => void;
  onMove: (drag: { source: string; id: string }, date: string, time?: string) => void;
  onAdd: (date: string, time?: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const days = useMemo(() => weekDates(anchor), [anchor]);
  const today = todayISO();
  const gridRef = useRef<HTMLDivElement>(null);
  const hours = useMemo(() => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i), []);

  const byDay = useMemo(() => {
    const map: Record<string, CalItem[]> = {};
    for (const i of items) {
      if (i.date < days[0] || i.date > days[6]) continue;
      (map[i.date] ??= []).push(i);
    }
    return map;
  }, [items, days]);

  const dropTime = (e: React.DragEvent, day: string) => {
    const drag = readDrag(e);
    if (!drag) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const total = Math.round((y / HOUR_PX) * 60) + START_HOUR * 60;
    const snapped = Math.max(START_HOUR * 60, Math.round(total / SLOT_MIN) * SLOT_MIN);
    const hh = String(Math.floor(snapped / 60)).padStart(2, "0");
    const mm = String(snapped % 60).padStart(2, "0");
    onMove(drag, day, `${hh}:${mm}`);
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="min-w-[900px]">
        {/* Day headers */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border/60 bg-muted/30">
          <div />
          {days.map((d, i) => {
            const isToday = d === today;
            return (
              <button
                key={d}
                onClick={() => onOpenDay(d)}
                className={cn(
                  "flex flex-col items-center gap-0.5 border-l border-border/50 px-1 py-2 outline-none transition-colors hover:bg-muted/50",
                  isToday && "bg-primary/5"
                )}
              >
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{WEEKDAYS[i]}</span>
                <span className={cn("text-[15px] font-bold tabular-nums", isToday ? "text-primary" : "text-foreground")}>
                  {Number(d.slice(8))}
                </span>
                <span className="text-[9px] font-medium text-muted-foreground">{(byDay[d] ?? []).length || ""}</span>
              </button>
            );
          })}
        </div>

        {/* All-day strip */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border/60 bg-muted/10">
          <div className="px-1 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">All day</div>
          {days.map((d) => (
            <div
              key={d}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const drag = readDrag(e);
                if (drag) {
                  e.preventDefault();
                  onMove(drag, d);
                }
              }}
              className={cn("flex min-h-[30px] flex-col gap-0.5 border-l border-border/50 p-1", d === today && "bg-primary/5")}
            >
              {(byDay[d] ?? [])
                .filter((i) => i.allDay || !i.startTime)
                .map((i) => (
                  <button
                    key={i.key}
                    draggable={i.draggable}
                    onDragStart={(e) => writeDrag(e, i)}
                    onClick={() => onOpen(i)}
                    style={{ borderLeftColor: i.clientColor ?? "#7C3AED" }}
                    className={cn("truncate rounded border-l-2 bg-muted/60 px-1 py-0.5 text-left text-[9.5px] font-medium hover:bg-muted", i.isDone && "opacity-60")}
                  >
                    {i.title}
                  </button>
                ))}
            </div>
          ))}
        </div>

        {/* Timed grid */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" ref={gridRef}>
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="relative border-b border-border/40 pr-1 text-right">
                <span className="absolute -top-2 right-1 text-[9px] font-semibold tabular-nums text-muted-foreground">
                  {h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}
                </span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const laid = layout(byDay[d] ?? []);
            return (
              <div
                key={d}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropTime(e, d);
                }}
                className={cn("relative border-l border-border/50", d === today && "bg-primary/[0.03]")}
                style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}
              >
                {hours.map((h) => (
                  <button
                    key={h}
                    onClick={() => onAdd(d, `${String(h).padStart(2, "0")}:00`)}
                    aria-label={`Add at ${h}:00`}
                    className="absolute left-0 w-full border-b border-border/40 transition-colors hover:bg-muted/40"
                    style={{ top: (h - START_HOUR) * HOUR_PX, height: HOUR_PX }}
                  />
                ))}
                {laid.map(({ item, top, height, lane, lanes }) => {
                  const color = item.clientColor ?? "#7C3AED";
                  return (
                    <button
                      key={item.key}
                      draggable={item.draggable}
                      onDragStart={(e) => writeDrag(e, item)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(item);
                      }}
                      style={{
                        top: Math.max(0, top),
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        borderLeftColor: color,
                        background: `${color}14`,
                      }}
                      className={cn(
                        "absolute z-10 overflow-hidden rounded-md border-l-2 px-1 py-0.5 text-left transition-colors hover:brightness-95",
                        item.isDone && "opacity-60",
                        item.draggable && "cursor-grab active:cursor-grabbing"
                      )}
                      title={`${item.title} · ${item.startTime}–${item.endTime ?? ""}`}
                    >
                      <p className="truncate text-[10px] font-semibold leading-tight">{item.title}</p>
                      <p className="truncate text-[9px] tabular-nums text-muted-foreground">
                        {item.startTime}
                        {item.endTime ? `–${item.endTime}` : ""}
                      </p>
                      {item.platforms.length > 0 && <PlatformBadges platforms={item.platforms} max={2} />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
