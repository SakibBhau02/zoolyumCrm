"use client";

import { cn } from "@/components/shared";
import { CalItem, PLATFORM_LABEL, PLATFORM_STYLE, SOURCE_DOT, TONE_BADGE, label } from "./types";
import { humanTime } from "@/lib/calendar-date";

export const DRAG_MIME = "application/x-zoolyum-calendar";

export function writeDrag(e: React.DragEvent, item: CalItem) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ source: item.source, id: item.sourceId }));
  e.dataTransfer.effectAllowed = "move";
}

export function readDrag(e: React.DragEvent): { source: string; id: string } | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.source || !parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function PlatformBadges({ platforms, max = 3 }: { platforms: string[]; max?: number }) {
  if (!platforms.length) return null;
  return (
    <span className="flex items-center gap-0.5">
      {platforms.slice(0, max).map((p) => (
        <span
          key={p}
          title={PLATFORM_LABEL[p] ?? p}
          className={cn("rounded px-1 py-px text-[8.5px] font-bold uppercase tracking-wide", PLATFORM_STYLE[p] ?? "bg-muted text-muted-foreground")}
        >
          {p.slice(0, 2)}
        </span>
      ))}
      {platforms.length > max && <span className="text-[8.5px] font-semibold text-muted-foreground">+{platforms.length - max}</span>}
    </span>
  );
}

export function StatusBadge({ status, tone }: { status: string; tone: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold", TONE_BADGE[tone] ?? TONE_BADGE.neutral)}>
      {label(status)}
    </span>
  );
}

export function ApprovalBadge({ approval }: { approval?: string }) {
  if (!approval || approval === "NONE") return null;
  const tone =
    approval === "APPROVED" ? TONE_BADGE.success : approval === "REJECTED" ? TONE_BADGE.danger : TONE_BADGE.warning;
  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide", tone)}>
      {approval === "INTERNAL_REVIEW" ? "In review" : label(approval)}
    </span>
  );
}

/** One calendar chip. Min 24px tall — WCAG 2.2 2.5.8 target size (audit UX-06). */
export function CalChip({
  item,
  onClick,
  onDragStart,
  compact,
}: {
  item: CalItem;
  onClick: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  compact?: boolean;
}) {
  const color = item.clientColor ?? "#7C3AED";
  return (
    <button
      type="button"
      draggable={item.draggable}
      onDragStart={item.draggable ? onDragStart : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""} · ${label(item.status)}`}
      style={{ borderLeftColor: color }}
      className={cn(
        "group flex min-h-6 w-full min-w-0 items-center gap-1 rounded-md border-l-2 bg-muted/50 px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors hover:bg-muted",
        compact && "gap-0.5 px-1",
        // Opacity is a contrast multiplier: done items at 60% fell to ~2:1.
        // Fade the surface instead and keep the label legible.
        item.isDone && "bg-muted/30 text-muted-foreground line-through",
        item.draggable && "cursor-grab active:cursor-grabbing"
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", SOURCE_DOT[item.source] ?? "bg-primary")} />
      {!item.allDay && item.startTime && (
        <span className="shrink-0 tabular-nums text-[11px] font-semibold text-muted-foreground">
          {humanTime(item.startTime).replace(":00", "").replace(" ", "")}
        </span>
      )}
      <span className={cn("truncate font-medium", item.overdue && "text-rose-500")}>{item.title}</span>
      {item.platforms.length > 0 && <PlatformBadges platforms={item.platforms} max={2} />}
      {item.approval === "INTERNAL_REVIEW" && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-400" title="In review" />}
    </button>
  );
}

export function DayCellBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).slice(0, 5);
  if (!entries.length) return null;
  return (
    <div className="mt-auto flex items-center gap-0.5 pt-1">
      {entries.map(([source, n]) => (
        <span key={source} className="flex items-center gap-0.5" title={`${n} ${source}`}>
          <span className={cn("size-1 rounded-full", SOURCE_DOT[source] ?? "bg-primary")} />
          <span className="text-[8px] font-semibold tabular-nums text-muted-foreground">{n}</span>
        </span>
      ))}
    </div>
  );
}

export function EmptyHint({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <p className="text-body font-semibold text-muted-foreground">{title}</p>
      {hint && <p className="max-w-sm text-meta text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
