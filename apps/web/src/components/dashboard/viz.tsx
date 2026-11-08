"use client";

import { useId } from "react";
import { cn } from "@/components/shared";

/* ────────────────────────────────────────────────────────────────────────────
   Small, dependency-free SVG visuals for the dashboard.

   Rules borrowed from dashboard research: one idea per chart, no 3D/decoration,
   neutral base + colour only for deviation, and every number gets context.
   ──────────────────────────────────────────────────────────────────────────── */

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

/** Area + line sparkline. `className` sets the colour (e.g. text-emerald-500). */
export function Sparkline({
  points,
  className,
  height = 44,
  fill = true,
  strokeWidth = 1.8,
}: {
  points: number[];
  className?: string;
  height?: number;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const gid = useId().replace(/[:]/g, "");
  const data = points.length ? points : [0, 0];
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = data.length > 1 ? 100 / (data.length - 1) : 100;

  const coords = data.map((v, i) => {
    const x = i * step;
    const y = 30 - ((v - min) / span) * 26;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L100,32 L0,32 Z`;

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`sp-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#sp-${gid})`} />}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {coords.length > 0 && (
        <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={1.8} fill="currentColor" />
      )}
    </svg>
  );
}

/** Vertical mini bars. Colour set by `className`; amber bars for "current" item. */
export function MiniBars({
  data,
  className,
  height = 44,
  highlightLast = false,
  max: forcedMax,
  showLabels = false,
}: {
  data: { label: string; value: number }[];
  className?: string;
  height?: number;
  highlightLast?: boolean;
  max?: number;
  showLabels?: boolean;
}) {
  const max = Math.max(forcedMax ?? 0, ...data.map((d) => d.value), 1);
  return (
    <div>
      <div
        className="flex items-end gap-[3px]"
        style={{ height }}
        role="img"
        aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}
      >
        {data.map((d, i) => {
          const h = Math.max(4, (d.value / max) * 100);
          const isLast = highlightLast && i === data.length - 1;
          return (
            <div key={`${d.label}-${i}`} className="group relative flex h-full flex-1 items-end" title={`${d.label}: ${d.value}`}>
              <div
                className={cn("w-full rounded-[3px] bg-current transition-all", className)}
                style={{ height: `${h}%`, minHeight: 4, opacity: isLast ? 1 : 0.45 }}
              />
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="mt-1 flex gap-[3px]">
          {data.map((d, i) => (
            <span
              key={`${d.label}-l-${i}`}
              title={`${d.label}: ${d.value}`}
              className="min-w-0 flex-1 truncate text-center text-[8.5px] font-medium leading-tight text-muted-foreground"
            >
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal stacked bar with an optional legend. */
export function SegmentedBar({
  segments,
  height = 10,
  showLegend = true,
  legendClassName,
}: {
  segments: { label: string; value: number; className: string }[];
  height?: number;
  showLegend?: boolean;
  legendClassName?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="w-full">
      <div className="flex w-full overflow-hidden rounded-full bg-muted" style={{ height }}>
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.label}
              className={cn("h-full transition-all", s.className)}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${s.value}`}
            />
          );
        })}
      </div>
      {showLegend && (
        <div className={cn("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1", legendClassName)}>
          {segments.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", s.className)} />
              <span className="font-medium text-foreground/80 tabular-nums">{s.value}</span>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Progress ring with a centred value. Colour set through `className`. */
export function Ring({
  value,
  size = 84,
  stroke = 8,
  label,
  sublabel,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: React.ReactNode;
  sublabel?: string;
  className?: string;
}) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const pct = clamp(value);
  return (
    <div className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" width={size} height={size} aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={stroke} />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          transform="rotate(-90 40 40)"
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[15px] font-bold tabular-nums">{label ?? `${Math.round(pct)}%`}</span>
        {sublabel && <span className="mt-0.5 text-[8.5px] font-semibold uppercase tracking-wider opacity-70">{sublabel}</span>}
      </span>
    </div>
  );
}

/** Label + value + track bar, for score components and approval counts. */
export function MeterRow({
  label,
  value,
  max = 100,
  display,
  tone = "bg-primary",
  hint,
}: {
  label: string;
  value: number;
  max?: number;
  display?: React.ReactNode;
  tone?: string;
  hint?: string;
}) {
  const pct = clamp((value / (max || 1)) * 100);
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
        <span className="shrink-0 text-[11.5px] font-semibold tabular-nums">{display ?? value}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="mt-1 truncate text-[9.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
