"use client";
import { useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { Avatar, EmptyState, FadeIn, SkeletonBlock, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Select } from "@/components/ui";
import { PeopleHero, DenseCard } from "../_components/hero";
import { downloadCsv } from "../_components/constants";

type Bucket = {
  presentDays: number;
  lateDays: number;
  lateMinutes: number;
  halfDays: number;
  absentDays: number;
  workedHours: number;
  tasksDone: number;
  loggedHours: number;
  meetingsAttended: number;
  meetingsInvited: number;
  shoots: number;
  leaveDays: number;
};

type Monthly = {
  months: { key: string; label: string }[];
  totals: Record<string, Bucket>;
  rows: {
    employee: { id: string; name: string; roleTitle: string; department: string | null; photoUrl: string | null };
    months: Record<string, Bucket>;
    totals: Bucket;
  }[];
  departments: string[];
};

const METRICS = [
  { key: "tasksDone", label: "Tasks completed" },
  { key: "lateDays", label: "Late days" },
  { key: "lateMinutes", label: "Late minutes" },
  { key: "absentDays", label: "Absent days" },
  { key: "leaveDays", label: "Leave days" },
  { key: "meetingsAttended", label: "Meetings attended" },
  { key: "shoots", label: "Shoots" },
  { key: "workedHours", label: "Worked hours" },
  { key: "loggedHours", label: "Logged hours" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

const isHours = (k: MetricKey) => k === "workedHours" || k === "loggedHours";
const fmt = (v: number, k: MetricKey) => (isHours(k) ? `${Math.round(v * 10) / 10}h` : String(v));

/**
 * People analytics — the management view.
 *
 * The operational screens answer "what is happening today". This page answers
 * the question that actually shows up in a monthly review: for every person,
 * every month — tasks, lateness, absence, leave, meetings and shoots in one
 * row, with the team total underneath.
 */
export default function AnalyticsPage() {
  const [months, setMonths] = useState(6);
  const [department, setDepartment] = useState("");
  const [metric, setMetric] = useState<MetricKey>("tasksDone");
  const path = `/people/analytics/monthly?months=${months}${department ? `&department=${encodeURIComponent(department)}` : ""}`;
  const { data, loading, error, mutate } = useApi<Monthly>(path);

  const rows = data?.rows ?? [];
  const monthList = data?.months ?? [];
  const metricLabel = useMemo(() => METRICS.find((m) => m.key === metric)?.label ?? "", [metric]);

  const exportCsv = () => {
    downloadCsv(
      `people-analytics-${months}m-${metric}.csv`,
      ["Employee", "Role", "Department", ...monthList.map((m) => m.label), "Total"],
      rows.map((r) => [
        r.employee.name,
        r.employee.roleTitle,
        r.employee.department ?? "",
        ...monthList.map((m) => Math.round((r.months[m.key]?.[metric] ?? 0) * 10) / 10),
        Math.round((r.totals[metric] ?? 0) * 10) / 10,
      ]),
    );
  };

  const latest = monthList[monthList.length - 1];
  const latestTotals = latest ? data?.totals[latest.key] : undefined;
  const headcount = rows.length;

  return (
    <div className="flex flex-col gap-3">
      <PeopleHero
        icon={<BarChart3 className="size-4" />}
        title="Analytics"
        subtitle="Per person, per month — tasks, lateness, absence, leave, meetings and shoots"
        stats={[
          { label: "People", value: headcount },
          { label: "Tasks", value: latestTotals?.tasksDone ?? "—", sub: latest?.label, tone: "sky" },
          { label: "Late days", value: latestTotals?.lateDays ?? "—", sub: latest ? `${latestTotals?.lateMinutes ?? 0} min late` : "", tone: "amber" },
          { label: "Absent", value: latestTotals?.absentDays ?? "—", sub: latest?.label, tone: "rose" },
          { label: "Meetings", value: latestTotals?.meetingsAttended ?? "—", sub: latest?.label, tone: "violet" },
          { label: "Shoots", value: latestTotals?.shoots ?? "—", sub: latest?.label, tone: "emerald" },
        ]}
        actions={<Btn onClick={exportCsv} className="!px-2.5 !py-1.5 text-meta"><Download className="size-3.5" /> CSV</Btn>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} className="!w-32 !py-1.5 text-meta">
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
        </Select>
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="!w-44 !py-1.5 text-meta">
          <option value="">All departments</option>
          {(data?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="!w-52 !py-1.5 text-meta">
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </Select>
        <span className="text-micro text-muted-foreground">Showing <span className="font-semibold text-foreground">{metricLabel.toLowerCase()}</span> per month</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{[...Array(6)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : error ? (
        <EmptyState title={error} hint="Could not load analytics" />
      ) : rows.length === 0 ? (
        <EmptyState title="No employees" hint="Add an employee first" />
      ) : (
        <FadeIn>
          <DenseCard title="Monthly matrix" hint={`${rows.length} people · ${monthList.length} months`} icon={<BarChart3 className="size-4" />}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    <th className="sticky left-0 z-10 bg-card px-2 py-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Employee</th>
                    {monthList.map((m) => (
                      <th key={m.key} className="px-2 py-2 text-right text-micro font-bold uppercase tracking-wider text-muted-foreground">{m.label}</th>
                    ))}
                    <th className="border-l border-border/60 px-2 py-2 text-right text-micro font-bold uppercase tracking-wider text-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employee.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                      <td className="sticky left-0 z-10 bg-card px-2 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar name={r.employee.name} size="size-6" src={r.employee.photoUrl} />
                          <div className="min-w-0">
                            <p className="truncate text-body font-medium">{r.employee.name}</p>
                            <p className="truncate text-micro text-muted-foreground">{r.employee.department ?? r.employee.roleTitle}</p>
                          </div>
                        </div>
                      </td>
                      {monthList.map((m) => {
                        const v = r.months[m.key]?.[metric] ?? 0;
                        return (
                          <td key={m.key} className={cn("px-2 py-2 text-right text-body tabular-nums", v === 0 ? "text-muted-foreground/50" : "font-medium")}>
                            {fmt(v, metric)}
                          </td>
                        );
                      })}
                      <td className="border-l border-border/60 px-2 py-2 text-right text-body font-bold tabular-nums">
                        {fmt(r.totals[metric] ?? 0, metric)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DenseCard>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DenseCard title="Team totals by month" hint="all metrics">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left">
                      <th className="px-2 py-2 text-micro font-bold uppercase tracking-wider text-muted-foreground">Metric</th>
                      {monthList.map((m) => (
                        <th key={m.key} className="px-2 py-2 text-right text-micro font-bold uppercase tracking-wider text-muted-foreground">{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((m) => (
                      <tr key={m.key} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                        <td className="px-2 py-1.5 text-meta font-medium">{m.label}</td>
                        {monthList.map((mo) => {
                          const v = data?.totals[mo.key]?.[m.key] ?? 0;
                          return <td key={mo.key} className={cn("px-2 py-1.5 text-right text-meta tabular-nums", v === 0 ? "text-muted-foreground/50" : "")}>{fmt(v, m.key)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DenseCard>

            <DenseCard title="Worth a look" hint="this period" icon={<BarChart3 className="size-4" />}>
              <InsightList rows={rows} metric={metric} metricLabel={metricLabel} />
            </DenseCard>
          </div>
        </FadeIn>
      )}
      <p className="text-micro text-muted-foreground">
        Source: attendance, task completions, time logs, meeting attendance, shoot crew and approved leave.{" "}
        <button onClick={() => mutate()} className="font-semibold text-primary hover:underline">Refresh</button>
      </p>
    </div>
  );
}

function InsightList({ rows, metric, metricLabel }: { rows: Monthly["rows"]; metric: MetricKey; metricLabel: string }) {
  const ranked = [...rows].sort((a, b) => (b.totals[metric] ?? 0) - (a.totals[metric] ?? 0)).slice(0, 5);
  const zero = rows.filter((r) => (r.totals[metric] ?? 0) === 0).length;
  return (
    <div className="flex flex-col gap-1.5">
      {ranked.map((r, i) => (
        <div key={r.employee.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-4 text-micro font-bold text-muted-foreground">{i + 1}</span>
            <Avatar name={r.employee.name} size="size-5" src={r.employee.photoUrl} />
            <span className="truncate text-meta font-medium">{r.employee.name}</span>
          </div>
          <span className="shrink-0 text-meta font-bold tabular-nums">{fmt(r.totals[metric] ?? 0, metric)}</span>
        </div>
      ))}
      <p className="mt-1 text-micro text-muted-foreground">
        Top by {metricLabel.toLowerCase()}. {zero > 0 ? `${zero} ${zero === 1 ? "person has" : "people have"} 0 this period.` : "Everyone recorded activity."}
      </p>
    </div>
  );
}
