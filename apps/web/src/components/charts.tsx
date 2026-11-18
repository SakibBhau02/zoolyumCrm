"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { cn } from "./shared";

/**
 * Chart entry point.
 *
 * recharts is loaded on demand: it is a `next/dynamic` boundary here so an
 * import of this module no longer drags Redux Toolkit + d3 into the route
 * chunk. The pure HTML/SVG pieces below stay synchronous — they cost nothing
 * and are what most screens actually use.
 */
const chartLoading = (height: number) => () => (
  <div
    className="w-full animate-pulse rounded-2xl bg-muted/60"
    style={{ height }}
    aria-busy="true"
    aria-label="Loading chart"
  />
);

// Each call needs its own literal options object: this Next version rejects a
// shared/spread object here ("next/dynamic options must be an object literal")
// and turns the whole route into a 500.
export const RevenueAreaChart = dynamic(
  () => import("./charts-recharts").then((m) => m.RevenueAreaChart),
  { ssr: false, loading: chartLoading(240) }
);
export const PaymentDonut = dynamic(
  () => import("./charts-recharts").then((m) => m.PaymentDonut),
  { ssr: false, loading: chartLoading(170) }
);
export const StageBarChart = dynamic(
  () => import("./charts-recharts").then((m) => m.StageBarChart),
  { ssr: false, loading: chartLoading(240) }
);
export const HealthBarChart = dynamic(
  () => import("./charts-recharts").then((m) => m.HealthBarChart),
  { ssr: false, loading: chartLoading(240) }
);

const EASE = [0.22, 1, 0.36, 1] as const;

const srcLabel = (v: string) => v.replace(/_/g, " ").toLowerCase();

export function SourceBarChart({
  data,
  height = 260,
}: {
  data: { name: string; count: number; won: number; conversionRate: number | null; value: number }[];
  height?: number;
}) {
  const rows = [...data].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((d) => d.count));
  return (
    <div className="flex flex-col gap-3 overflow-y-auto pr-1" style={{ height }}>
      {rows.length === 0 && <p className="text-meta text-muted-foreground">No data yet</p>}
      {rows.map((d, i) => (
        <motion.div key={d.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06, duration: 0.45, ease: EASE }} className="group flex items-center gap-3" title={`${d.name}: ${d.count} leads · ${d.won} won · ${d.conversionRate ?? 0}% · ৳${(d.value / 100000).toFixed(2)}L`}>
          <span className="w-32 shrink-0 truncate text-meta font-semibold text-muted-foreground capitalize">{srcLabel(d.name)}</span>
          <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-muted/50">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-primary/70 to-primary shadow-sm"
              initial={{ width: 0 }}
              animate={{ width: `${(d.count / max) * 100}%` }}
              transition={{ delay: 0.15 + i * 0.06, duration: 0.7, ease: EASE }}
            />
            <motion.div
              className="absolute inset-y-0 left-0 rounded-lg bg-emerald-400/90"
              initial={{ width: 0 }}
              animate={{ width: `${(d.won / max) * 100}%` }}
              transition={{ delay: 0.25 + i * 0.06, duration: 0.7, ease: EASE }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-body font-bold tabular-nums">{d.count}</span>
          <span className="w-12 shrink-0 text-right text-meta font-bold tabular-nums text-emerald-400">{d.conversionRate != null ? `${d.conversionRate}%` : "—"}</span>
          <span className="w-14 shrink-0 text-right text-micro font-semibold tabular-nums text-muted-foreground">৳{(d.value / 100000).toFixed(1)}L</span>
        </motion.div>
      ))}
    </div>
  );
}

/* ─── Utilization heatmap (custom HTML) ─── */
export function UtilizationHeatmap({
  rows,
  weeks,
}: {
  rows: { name: string; values: number[] }[];
  weeks: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1.5">
        <thead>
          <tr>
            <th className="pr-3 pb-1 text-left text-micro font-medium uppercase tracking-widest text-muted-foreground">
              Team
            </th>
            {weeks.map((w) => (
              <th
                key={w}
                className="pb-1 text-center text-micro font-medium uppercase tracking-wider text-muted-foreground"
              >
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="pr-3 text-body text-muted-foreground">{r.name}</td>
              {r.values.map((v, i) => (
                <td key={i} title={`${r.name} · W${i + 1} — ${Math.round(v * 100)}%`}>
                  <span
                    className={cn(
                      "block aspect-square w-9 rounded-lg text-center text-micro font-bold leading-[36px] text-white shadow-sm transition-transform duration-200 hover:scale-110",
                      v >= 1.05
                        ? "bg-rose-500"
                        : v >= 0.95
                          ? "bg-amber-400"
                          : v >= 0.75
                            ? "bg-emerald-400"
                            : "bg-emerald-500"
                    )}
                  >
                    {Math.round(v * 100)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── SVG progress ring ─── */
export function ProgressRing({
  value,
  size = 64,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const r = 28;
  const C = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <defs>
          <linearGradient id="zoolyumRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" />
            <stop offset="100%" stopColor="var(--chart-2)" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={r} fill="none" stroke="oklch(0.9 0.01 285)" strokeWidth={6} />
        <motion.circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#zoolyumRing)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - value / 100) }}
          transition={{ duration: 1.2, ease: EASE }}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-body-lg font-bold tabular-nums">
        {label ?? `${Math.round(value)}%`}
      </span>
    </div>
  );
}

