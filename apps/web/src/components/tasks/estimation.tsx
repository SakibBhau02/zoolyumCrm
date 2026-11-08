"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gauge, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { EmptyState, cn } from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";

interface Bucket {
  key: string;
  name: string;
  samples: number;
  estimatedHours: number;
  actualHours: number;
  avgVarianceRatio: number;
  avgEstimated: number;
  bias: "underestimated" | "overestimated" | "accurate";
}

interface EstimationData {
  sampleCount: number;
  overallVarianceRatio: number;
  byEmployee: Bucket[];
  byTaskType: Bucket[];
  worst: {
    taskId: string;
    employeeName: string;
    taskType: string;
    estimatedHours: number;
    actualHours: number;
    varianceRatio: number;
  }[];
}

const BIAS_TONE: Record<string, string> = {
  underestimated: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
  overestimated: "bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20",
  accurate: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
};

const pct = (r: number) => `${r > 0 ? "+" : ""}${Math.round(r * 100)}%`;

/**
 * Estimation accuracy report. `EstimateAccuracyLog` rows are written when a
 * task with an estimate reaches DONE, so this view only has data once tasks
 * are being completed — the empty state explains that rather than looking broken.
 */
export function EstimationPanel({ refreshKey, employees }: { refreshKey: number; employees: { id: string; name: string }[] }) {
  const [data, setData] = useState<EstimationData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [empFilter, setEmpFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    apiFetch<EstimationData>(`/tasks/reports/estimation${empFilter ? `?employeeId=${empFilter}` : ""}`)
      .then(setData)
      .catch((e) => setErr(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [empFilter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (err) {
    return (
      <div className="flex flex-col items-center gap-3">
        <EmptyState title={err} />
        <Btn variant="outline" onClick={load}><RefreshCw className="size-3.5" /> Retry</Btn>
      </div>
    );
  }

  if (loading && !data) {
    return <div className="flex items-center gap-2 py-6 text-[11.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading report…</div>;
  }

  if (!data?.sampleCount) {
    return (
      <EmptyState
        title="No completed estimates yet"
        hint="A row is recorded each time a task with an estimated-hours value is marked DONE. Complete a few estimated tasks and this report fills in."
      />
    );
  }

  const overall = data.overallVarianceRatio;
  const overallBias = overall > 0.1 ? "underestimated" : overall < -0.1 ? "overestimated" : "accurate";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground">
          <Gauge className="size-3" /> {data.sampleCount} completed tasks sampled
        </span>
        <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold", BIAS_TONE[overallBias])}>
          <TrendingUp className="size-3" /> Overall {pct(overall)} vs estimate — {overallBias}
        </span>
        <select
          aria-label="Filter estimation report by employee"
          value={empFilter}
          onChange={(e) => setEmpFilter(e.target.value)}
          className="ml-auto rounded-xl border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-semibold outline-none focus:border-primary/40"
        >
          <option value="">All employees</option>
          {employees.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{data.byEmployee.length} people with estimates</span>}>
          <table className="w-full">
            <THead><Th>Employee</Th><Th>Tasks</Th><Th>Est / Actual</Th><Th>Variance</Th><Th>Bias</Th></THead>
            <tbody>
              {data.byEmployee.map((b, i) => (
                <Tr key={b.key} index={i}>
                  <Td className="font-medium">{b.name}</Td>
                  <Td className="tabular-nums text-muted-foreground">{b.samples}</Td>
                  <Td className="tabular-nums text-muted-foreground">{b.estimatedHours}h / {b.actualHours}h</Td>
                  <Td className={cn("font-bold tabular-nums", b.avgVarianceRatio > 0.1 ? "text-rose-400" : b.avgVarianceRatio < -0.1 ? "text-sky-400" : "text-emerald-400")}>
                    {pct(b.avgVarianceRatio)}
                  </Td>
                  <Td><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", BIAS_TONE[b.bias])}>{b.bias}</span></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>

        <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{data.byTaskType.length} task types</span>}>
          <table className="w-full">
            <THead><Th>Task Type</Th><Th>Tasks</Th><Th>Avg Estimate</Th><Th>Variance</Th><Th>Bias</Th></THead>
            <tbody>
              {data.byTaskType.map((b, i) => (
                <Tr key={b.key} index={i}>
                  <Td className="font-medium capitalize">{b.name}</Td>
                  <Td className="tabular-nums text-muted-foreground">{b.samples}</Td>
                  <Td className="tabular-nums text-muted-foreground">{b.avgEstimated}h</Td>
                  <Td className={cn("font-bold tabular-nums", b.avgVarianceRatio > 0.1 ? "text-rose-400" : b.avgVarianceRatio < -0.1 ? "text-sky-400" : "text-emerald-400")}>
                    {pct(b.avgVarianceRatio)}
                  </Td>
                  <Td><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", BIAS_TONE[b.bias])}>{b.bias}</span></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </div>

      {data.worst.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-amber-500">
            <AlertTriangle className="size-3.5" /> Biggest misses
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.worst.map((w) => (
              <span key={w.taskId} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10.5px] font-semibold">
                <span className="text-muted-foreground">{w.employeeName}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold capitalize">{w.taskType}</span>
                <span className="tabular-nums text-muted-foreground">{w.estimatedHours}h → {w.actualHours}h</span>
                <span className={cn("font-bold tabular-nums", w.varianceRatio > 0 ? "text-rose-400" : "text-sky-400")}>{pct(w.varianceRatio)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
