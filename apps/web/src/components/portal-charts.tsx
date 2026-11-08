"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

function AdsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipStyle}>
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? "#fff" }}>
          {p.name}:{" "}
          {p.dataKey === "roas"
            ? `${Number(p.value).toFixed(2)}x`
            : `৳${Number(p.value).toLocaleString("en-US")}`}
        </p>
      ))}
    </div>
  );
}

/** Spend area + ROAS line on a shared time axis (portal Performance tab). */
export function AdsTrendChart({
  data,
  height = 260,
}: {
  data: { date: string; spend: number; roas: number; conversions: number }[];
  height?: number;
}) {
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={label}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          yAxisId="spend"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          width={48}
        />
        <YAxis
          yAxisId="roas"
          orientation="right"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}x`}
          width={38}
        />
        <Tooltip content={<AdsTooltip />} />
        <Area
          yAxisId="spend"
          type="monotone"
          dataKey="spend"
          name="Spend"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#gradSpend)"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          yAxisId="roas"
          type="monotone"
          dataKey="roas"
          name="ROAS"
          stroke="var(--chart-3)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
