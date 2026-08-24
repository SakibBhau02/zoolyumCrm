"use client";

import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "./shared";

const EASE = [0.22, 1, 0.36, 1] as const;

const tooltipStyle = {
  backgroundColor: "oklch(0.18 0.02 285)",
  borderRadius: 12,
  fontSize: 12,
  color: "#fff",
  border: "1px solid oklch(1 0 0 / 10%)",
  boxShadow: "0 16px 40px -8px rgba(0,0,0,.4)",
  padding: "8px 12px",
} as const;

const gridStyle = {
  stroke: "oklch(0.5 0.05 285 / 0.15)",
  strokeDasharray: "3 3",
} as const;

function ChartTooltip({ active, payload, label, money = false }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipStyle}>
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? p.payload?.fill ?? "#fff" }}>
          {p.name}: {money ? `৳${Number(p.value).toLocaleString("en-US")}` : p.value}
        </p>
      ))}
    </div>
  );
}

/* ─── Revenue trend (invoiced / collected / expenses) ─── */
export function RevenueAreaChart({
  data,
  height = 240,
}: {
  data: { month: string; invoiced: number; collected: number; expenses: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id="gradInvoiced" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `৳${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip content={<ChartTooltip money />} cursor={{ stroke: "var(--chart-1)", strokeOpacity: 0.4 }} />
        <Area
          type="monotone"
          dataKey="invoiced"
          name="Invoiced"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          fill="url(#gradInvoiced)"
          animationDuration={1200}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="collected"
          name="Collected"
          stroke="var(--chart-3)"
          strokeWidth={2}
          fill="url(#gradCollected)"
          animationDuration={1200}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Payment split donut ─── */
const METHOD_COLORS: Record<string, [string, string]> = {
  BKASH: ["#E2136E", "#F472B6"],
  NAGAD: ["#F97316", "#FDBA74"],
  CASH: ["#10B981", "#6EE7B7"],
  BANK_TRANSFER: ["#6366F1", "#A5B4FC"],
  CARD: ["#8B5CF6", "#C4B5FD"],
};

export function PaymentDonut({
  data,
}: {
  data: { method: string; amount: number }[];
}) {
  const total = data.reduce((s, d) => s + d.amount, 0) || 1;
  const chartData = data.map((d) => ({
    ...d,
    fill: METHOD_COLORS[d.method]?.[0] ?? "var(--chart-1)",
  }));
  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0">
        <ResponsiveContainer width={170} height={170}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="amount"
              nameKey="method"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={4}
              cornerRadius={8}
              strokeWidth={0}
              animationDuration={1100}
            >
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip money />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</span>
          <span className="text-sm font-heading font-bold tabular-nums">
            ৳{(total / 100000).toFixed(2)}L
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {chartData.map((d) => (
          <div key={d.method} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: d.fill }} />
            <span className="w-28 text-[12px] capitalize text-muted-foreground">
              {d.method.replace(/_/g, " ").toLowerCase()}
            </span>
            <span className="text-[12.5px] font-bold tabular-nums">
              {Math.round((d.amount / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Horizontal bar (leads by stage) ─── */
export function StageBarChart({
  data,
  height = 240,
}: {
  data: { stage: string; count: number; value: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
        barGap={4}
      >
        <defs>
          <linearGradient id="gradStage" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--chart-1)" />
            <stop offset="100%" stopColor="var(--chart-2)" />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => (v >= 100000 ? `৳${(v / 100000).toFixed(1)}L` : `${v}`)}
        />
        <YAxis
          type="category"
          dataKey="stage"
          width={92}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={({ active, payload, label }: any) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload;
            return (
              <div style={tooltipStyle}>
                <p className="mb-1 font-medium">{label}</p>
                <p style={{ color: "var(--chart-1)" }}>
                  Deals: {d.count} · ৳{(d.value / 100000).toFixed(2)}L
                </p>
              </div>
            );
          }}
          cursor={{ fill: "oklch(0.5 0.05 285 / 0.08)" }}
        />
        <Bar
          dataKey="value"
          name="Value"
          fill="url(#gradStage)"
          radius={[0, 6, 6, 0]}
          animationDuration={1000}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Source / owner performance bars (leads, won, conversion) ─── */
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
      {rows.length === 0 && <p className="text-[11.5px] text-muted-foreground">No data yet</p>}
      {rows.map((d, i) => (
        <motion.div key={d.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06, duration: 0.45, ease: EASE }} className="group flex items-center gap-3" title={`${d.name}: ${d.count} leads · ${d.won} won · ${d.conversionRate ?? 0}% · ৳${(d.value / 100000).toFixed(2)}L`}>
          <span className="w-32 shrink-0 truncate text-[11.5px] font-semibold text-muted-foreground capitalize">{srcLabel(d.name)}</span>
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
          <span className="w-8 shrink-0 text-right text-[12.5px] font-bold tabular-nums">{d.count}</span>
          <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-emerald-400">{d.conversionRate != null ? `${d.conversionRate}%` : "—"}</span>
          <span className="w-14 shrink-0 text-right text-[10.5px] font-semibold tabular-nums text-muted-foreground">৳{(d.value / 100000).toFixed(1)}L</span>
        </motion.div>
      ))}
    </div>
  );
}

/* ─── Grouped bars (project health) ─── */
export function HealthBarChart({
  data,
  height = 240,
}: {
  data: { name: string; value: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
        <CartesianGrid {...gridStyle} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "oklch(0.5 0.05 285 / 0.08)" }} />
        <Bar dataKey="value" name="Projects" radius={[6, 6, 0, 0]} animationDuration={1000}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={["var(--chart-3)", "var(--chart-4)", "var(--chart-5)"][i % 3]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
            <th className="pr-3 pb-1 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Team
            </th>
            {weeks.map((w) => (
              <th
                key={w}
                className="pb-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="pr-3 text-[12px] text-muted-foreground">{r.name}</td>
              {r.values.map((v, i) => (
                <td key={i} title={`${r.name} · W${i + 1} — ${Math.round(v * 100)}%`}>
                  <span
                    className={cn(
                      "block aspect-square w-9 rounded-lg text-center text-[10px] font-bold leading-[36px] text-white shadow-sm transition-transform duration-200 hover:scale-110",
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
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums">
        {label ?? `${Math.round(value)}%`}
      </span>
    </div>
  );
}
