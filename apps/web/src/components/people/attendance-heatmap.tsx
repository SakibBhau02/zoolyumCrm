"use client";

/**
 * Month heat-map for one employee: every day of the range is one cell, coloured
 * by what kind of day it was. This is the "how many days of what" answer that
 * used to require scrolling 30 table rows.
 */
import { useMemo, useState } from "react";
import { cn } from "@/components/shared";

export type AttendanceDay = {
  date: string;
  kind: string; // present | late | half | absent | leave | off | holiday | future
  status?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  workedMinutes?: number | null;
  overtimeMinutes?: number | null;
  stillInside?: boolean;
  punches?: number;
  leave?: boolean;
  holiday?: string | boolean;
};

export const DAY_KIND: Record<string, { label: string; cls: string; dot: string }> = {
  present: { label: "Present", cls: "bg-emerald-500/75 hover:bg-emerald-500", dot: "bg-emerald-500" },
  late: { label: "Late", cls: "bg-amber-500/75 hover:bg-amber-500", dot: "bg-amber-500" },
  half: { label: "Half day", cls: "bg-orange-500/75 hover:bg-orange-500", dot: "bg-orange-500" },
  absent: { label: "Absent", cls: "bg-rose-500/75 hover:bg-rose-500", dot: "bg-rose-500" },
  leave: { label: "Leave", cls: "bg-sky-500/75 hover:bg-sky-500", dot: "bg-sky-500" },
  unrecorded: { label: "No record", cls: "bg-slate-400/50 hover:bg-slate-400/70 dark:bg-slate-600/50", dot: "bg-slate-400 dark:bg-slate-500" },
  holiday: { label: "Holiday", cls: "bg-violet-500/60 hover:bg-violet-500", dot: "bg-violet-500" },
  off: { label: "Weekly off", cls: "bg-muted-foreground/20 hover:bg-muted-foreground/30", dot: "bg-muted-foreground/40" },
  before: { label: "Before joining", cls: "bg-transparent ring-1 ring-inset ring-border/30", dot: "bg-transparent ring-1 ring-border/40" },
  future: { label: "Upcoming", cls: "bg-transparent ring-1 ring-inset ring-border/50", dot: "bg-transparent ring-1 ring-border" },
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function fmtDurText(mins?: number | null) {
  if (mins == null) return "—";
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function AttendanceHeatmap({ days }: { days: AttendanceDay[] }) {
  const [hover, setHover] = useState<AttendanceDay | null>(null);

  const grid = useMemo(() => {
    if (!days.length) return [] as (AttendanceDay | null)[];
    // Pad the first week so the grid starts on the right weekday column.
    const first = new Date(`${days[0].date}T00:00:00.000Z`);
    const lead = first.getUTCDay();
    return [...Array(lead).fill(null), ...days] as (AttendanceDay | null)[];
  }, [days]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.kind, (m.get(d.kind) ?? 0) + 1);
    return m;
  }, [days]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {Object.entries(DAY_KIND)
          .filter(([k]) => (counts.get(k) ?? 0) > 0 || k === "present")
          .map(([k, meta]) => (
            <span key={k} className="flex items-center gap-1.5 text-micro font-semibold text-muted-foreground">
              <span className={cn("size-2 rounded-sm", meta.dot)} />
              {meta.label}
              <span className="tabular-nums text-foreground">{counts.get(k) ?? 0}</span>
            </span>
          ))}
      </div>

      <div className="grid w-fit grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w, i) => (
          <div key={`${w}${i}`} className="pb-0.5 text-center text-micro font-bold uppercase text-muted-foreground/70">{w}</div>
        ))}
        {grid.map((d, i) =>
          !d ? (
            <div key={`pad-${i}`} />
          ) : (
            <button
              key={d.date}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d)}
              title={`${d.date} · ${DAY_KIND[d.kind]?.label ?? d.kind}`}
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-micro font-bold transition-colors",
                DAY_KIND[d.kind]?.cls ?? "bg-muted",
                d.kind === "future" || d.kind === "off" || d.kind === "holiday" || d.kind === "before"
                  ? "text-muted-foreground"
                  : "text-white"
              )}
            >
              {Number(d.date.slice(8, 10))}
            </button>
          )
        )}
      </div>

      {/* Hover read-out keeps detail off the grid itself (no tooltip library). */}
      <div className="mt-2 min-h-8 rounded-lg bg-muted/40 px-3 py-1.5 text-meta text-muted-foreground">
        {hover ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-bold text-foreground">{hover.date}</span>
            <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-bold text-white", DAY_KIND[hover.kind]?.dot)}>
              {DAY_KIND[hover.kind]?.label ?? hover.kind}
            </span>
            {hover.checkIn && <span>in {new Date(hover.checkIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
            {hover.checkOut && <span>out {new Date(hover.checkOut).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
            {hover.stillInside && <span className="text-emerald-500">still inside</span>}
            {hover.workedMinutes != null && <span className="font-semibold text-foreground">{fmtDurText(hover.workedMinutes)}</span>}
            {(hover.overtimeMinutes ?? 0) > 0 && <span className="text-amber-500">+{fmtDurText(hover.overtimeMinutes)} OT</span>}
            {typeof hover.holiday === "string" && <span>{hover.holiday}</span>}
          </span>
        ) : (
          <span>Hover a day for check-in, check-out and hours.</span>
        )}
      </div>
    </div>
  );
}
