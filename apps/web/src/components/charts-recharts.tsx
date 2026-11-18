"use client";

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

/**
 * The recharts-backed charts.
 *
 * This module is imported through `next/dynamic` from `./charts` so that a page
 * which only needs a progress ring (or no chart at all) never downloads
 * recharts. recharts v3 pulls Redux Toolkit, immer, d3 and victory-vendor with
 * it — several megabytes of source for a single donut.
 */

const tooltipStyle = {
  backgroundColor: "oklch(0.18 0.02 285)",
  borderRadius: 12,
  fontSize: 12.5,
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
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-micro font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3.5 rounded-full bg-[var(--chart-1)]" /> Invoiced</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3.5 rounded-full bg-[var(--chart-3)]" /> Collected</span>
        <span className="ml-auto text-micro font-medium text-muted-foreground">hover a point for exact amounts</span>
      </div>
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
          tick={{ fontSize: 11.5, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11.5, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v: number) =>
            v >= 100000 ? `৳${parseFloat((v / 100000).toFixed(1))}L` : v >= 1000 ? `৳${parseFloat((v / 1000).toFixed(1))}k` : `৳${v}`
          }
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
    </div>
  );
}

/* ─── Payment split donut ─── */
const METHOD_COLORS: Record<string, [string, string]> = {
  BKASH: ["#E2136E", "#F472B6"],
  NAGAD: ["#F97316", "#FDBA74"],
  CASH: ["#10B981", "#6EE7B7"],
  BANK_TRANSFER: ["#F97316", "#FDBA74"],
  CARD: ["#EA580C", "#FDBA74"],
};

const METHOD_LABELS: Record<string, string> = {
  BKASH: "bKash",
  NAGAD: "Nagad",
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
};

export function PaymentDonut({
  data,
}: {
  data: { method?: string; name?: string; amount: number }[];
}) {
  const total = data.reduce((s, d) => s + d.amount, 0) || 1;
  // The API returns `{ name, amount }` in some reports and `{ method, amount }`
  // in others — normalise instead of crashing on `undefined.replace`.
  const chartData = data.map((d) => {
    const method = d.method ?? d.name ?? "OTHER";
    return {
      ...d,
      method,
      fill: METHOD_COLORS[method]?.[0] ?? "var(--chart-1)",
    };
  });
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
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
          <span className="text-micro uppercase tracking-wider text-muted-foreground">Collected</span>
          <span className="text-body font-heading font-bold tabular-nums">
            ৳{(total / 100000).toFixed(2)}L
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {chartData.map((d) => (
          <div key={d.method} className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.fill }} />
            <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
              {METHOD_LABELS[d.method] ?? d.method.replace(/_/g, " ")}
            </span>
            <span className="shrink-0 text-body font-bold tabular-nums">
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
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-micro font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-full bg-gradient-to-r from-[var(--chart-1)] to-[var(--chart-2)]" /> Pipeline value (৳)</span>
        <span className="ml-auto text-micro font-medium text-muted-foreground">hover a bar for the lead count &amp; value</span>
      </div>
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
          tick={{ fontSize: 11.5, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => (v >= 100000 ? `৳${(v / 100000).toFixed(1)}L` : `${v}`)}
        />
        <YAxis
          type="category"
          dataKey="stage"
          width={92}
          tick={{ fontSize: 11.5, fill: "var(--muted-foreground)" }}
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
          tick={{ fontSize: 11.5, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11.5, fill: "var(--muted-foreground)" }}
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
